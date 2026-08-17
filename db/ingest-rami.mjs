// Ingest REAL land tenders from רשות מקרקעי ישראל (rmi / רמ"י).
//
// Source: https://apps.land.gov.il/MichrazimSite  (public tender portal)
// Flow (discovered by inspecting the portal's own XHR calls):
//   1. GET  /MichrazimSite/            → establishes the session cookie (required!)
//   2. GET  /api/GeneralTablesApi      → code→Hebrew lookups (ייעוד, סוג מכרז, סטטוס)
//   3. GET  /api/YeshuvimApi/Get       → settlement code → Hebrew city name
//   4. POST /api/SearchApi/Search {}   → every tender (~10k, all years)
//   5. GET  /api/MichrazDetailsApi/Get?michrazID=N → per-tender plots:
//          Shetach (m²), MechirSaf (min price), mechirShuma (official appraisal),
//          GushHelka[], Kibolet (units), HotzaotPituach (development costs)
//
// All requests need `Accept: application/json` or the portal returns an HTML
// error page. Be polite: this hits a public government service.
//
// Usage:
//   DATABASE_URL=... node db/ingest-rami.mjs            # active tenders only
//   DATABASE_URL=... node db/ingest-rami.mjs --limit 50
//   DATABASE_URL=... node db/ingest-rami.mjs --all      # include closed ones
import postgres from "postgres";
import { getJson, warmSession, RAMI_BASE, RAMI_API } from "./rami-http.mjs";

const BASE = RAMI_BASE;
const API = RAMI_API;
const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const INCLUDE_ALL = args.includes("--all");
/**
 * Fetch details only for tenders we have never seen, or whose status changed.
 *
 * The hourly pipeline uses this. A full pass is ~470 detail calls; run every
 * hour that is 11,000 requests a day at a government portal, which is both
 * rude and a good way to earn the block we just proved does not exist. The
 * search endpoint already tells us everything that changed, so the expensive
 * per-tender call is reserved for tenders that actually need it — typically a
 * handful. The nightly full run still refreshes prices for everything.
 */
const NEW_ONLY = args.includes("--new-only");
const DELAY_MS = 250;

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  prepare: false,
  onnotice: () => {},
});

// Every portal call goes through the retrying client: the API flaps on a
// minutes timescale, so a single failure means "wait and ask again", not
// "give up on this tender" (see db/rami-http.mjs).
const noteRetry = ({ attempt, attempts, delay, reason, label }) =>
  console.log(`    retry ${attempt}/${attempts} in ${delay}ms — ${label}: ${reason}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- RMI ייעוד code → our zoning + land category ----
// (codes from GeneralTablesApi, TableName "ייעוד מכרז")
const YEUD = {
  1: ["מגורים", "מגרש למגורים"], // בנייה נמוכה/צמודת קרקע
  2: ["מגורים", "מגרש למגורים"], // בנייה רוויה
  3: ["מסחר", "מגרש מסחרי"], // מסחר ו/או משרדים
  4: ["תעשייה ומלאכה", "מגרש לתעשייה"], // תעשיה
  5: ["מבני ציבור", "מגרש מסחרי"], // מוסדות/בניינים ציבוריים
  6: ["מסחר", "מגרש מסחרי"], // חניונים
  7: ["מסחר", "מגרש מסחרי"], // תחנות דלק
  8: ["תיירות", "מגרש מסחרי"], // מלונאות
  9: ["תיירות", "מגרש מסחרי"], // ספורט/נופש/תיירות
  10: ["תעשייה ומלאכה", "מגרש לתעשייה"], // כרייה וחציבה
  11: ["חקלאי", "קרקע חקלאית"], // חקלאות
  12: ["מעורב", "מתחם להשבחה"], // מגורים/מסחר/מלונאות/נופש
  13: ["מגורים", "מגרש למגורים"], // דיור מוגן
  14: ["מגורים", "מגרש למגורים"], // נכסי הרשות - מכירה - מגורים
  15: ["מעורב", "מתחם להשבחה"], // נכסי הרשות - מכירה - אחר
  16: ["מעורב", "מתחם להשבחה"], // עודפים
  17: ["חקלאי", "קרקע חקלאית"], // נופש וחקלאות
  18: ["תעשייה ומלאכה", "מגרש לתעשייה"], // הטמנת פסולת
  20: ["מגורים", "מגרש למגורים"], // דיור להשכרה
  21: ["מגורים", "מגרש למגורים"], // נכסי הרשות - השכרה - מגורים
  22: ["מעורב", "מתחם להשבחה"], // נכסי הרשות - השכרה - אחר
  23: ["תעשייה ומלאכה", "מגרש לתעשייה"], // אנרגיה מתחדשת
  24: ["תעשייה ומלאכה", "מגרש לתעשייה"], // תחנת כוח
  25: ["תעשייה ומלאכה", "מגרש לתעשייה"], // תכנון וביצוע לכריה וחציבה
  26: ["מסחר", "מגרש מסחרי"], // תעסוקה
  99: ["מעורב", "מתחם להשבחה"], // אחר
};

function scoreOf({ discountPct, daysToAction, notStarted, zoning, hasAppraisal }) {
  const discountScore = Math.max(0, Math.min(55, discountPct * 2.4));
  // Urgency reads the date the bidder can actually act on. For a tender that
  // has not opened, "5 days" means five days until it opens — genuinely worth
  // surfacing (there is time to prepare), but not the scramble that five days
  // to a *deadline* deserves, so it tops out lower.
  const urgency = notStarted
    ? daysToAction != null && daysToAction <= 14
      ? 12
      : 8
    : daysToAction == null
      ? 6
      : daysToAction <= 5
        ? 18
        : daysToAction <= 14
          ? 12
          : 8;
  const typeBoost = 10; // every RMI tender is a genuine land tender
  const upside = zoning === "חקלאי" || zoning === "מעורב" ? 8 : 0;
  const confidence = hasAppraisal ? 6 : 0; // real שומה beats a guess
  return Math.max(0, Math.min(99, Math.round(discountScore + urgency + typeBoost + upside + confidence)));
}

async function main() {
  console.log("→ warming session…");
  await warmSession();

  console.log("→ lookups…");
  const tables = await getJson(`${API}/GeneralTablesApi`, {}, { label: "GeneralTablesApi", onRetry: noteRetry });
  const tableRows = Array.isArray(tables) ? tables : Object.values(tables);
  const sugMichraz = new Map(
    tableRows.filter((r) => r.TableName === "סוג מכרז").map((r) => [r.Code, r.Value]),
  );

  const yeshuvim = await getJson(`${API}/YeshuvimApi/Get`, {}, { label: "YeshuvimApi", onRetry: noteRetry });
  const cityByCode = new Map(
    (Array.isArray(yeshuvim) ? yeshuvim : Object.values(yeshuvim)).map((y) => [
      y.mtysvSemelYishuv,
      (y.mtysvShemYishuv || "").trim(),
    ]),
  );
  console.log(`  ${cityByCode.size} settlements, ${sugMichraz.size} tender types`);

  console.log("→ searching tenders…");
  const all = await getJson(
    `${API}/SearchApi/Search`,
    { method: "POST", body: "{}" },
    { label: "SearchApi/Search", onRetry: noteRetry },
  );
  console.log(`  ${all.length} tenders total`);

  const now = Date.now();
  let candidates = all
    .filter((t) => {
      if (INCLUDE_ALL) return true;
      // 1 = מפורסם, 2 = פתוח להגשת הצעות
      const open = t.StatusMichraz === 1 || t.StatusMichraz === 2;
      const future = t.SgiraDate && new Date(t.SgiraDate).getTime() > now;
      return open && future;
    })
    .sort((a, b) => new Date(a.SgiraDate) - new Date(b.SgiraDate))
    .slice(0, LIMIT);
  console.log(`  ${candidates.length} active tenders to ingest`);

  if (NEW_ONLY) {
    // rami_tenders_seen, not `deals`: most active tenders legitimately produce
    // no rows (apartment tenders, no minimum price, aggregate areas), and
    // judging by `deals` would make those permanently "new" and re-fetch them
    // every hour forever. A recorded status change still forces a re-fetch, so
    // a tender crossing טרם החל → פתוח is picked up.
    const known = await sql`SELECT michraz_id, source_status FROM rami_tenders_seen`;
    const statusById = new Map(known.map((r) => [String(r.michraz_id), r.source_status]));

    const before = candidates.length;
    candidates = candidates.filter((t) => {
      const seen = statusById.has(String(t.MichrazID));
      if (!seen) return true;
      return statusById.get(String(t.MichrazID)) !== t.StatusMichraz;
    });
    console.log(`  --new-only: ${candidates.length} of ${before} need a detail fetch`);
  }

  const [src] = await sql`
    INSERT INTO sources (name, source_type, base_url, is_real)
    VALUES ('רשות מקרקעי ישראל (רמ״י)', 'rami', ${BASE}, true)
    ON CONFLICT DO NOTHING
    RETURNING id`;
  const sourceId =
    src?.id ??
    (await sql`SELECT id FROM sources WHERE source_type='rami' AND is_real ORDER BY created_at LIMIT 1`)[0].id;

  let plots = 0;
  let failed = 0;

  for (const [i, t] of candidates.entries()) {
    let detail;
    try {
      detail = await getJson(
        `${API}/MichrazDetailsApi/Get?michrazID=${t.MichrazID}`,
        {},
        { label: `detail ${t.MichrazID}`, onRetry: noteRetry },
      );
    } catch (error) {
      // Only after the retry budget is spent is this a real failure.
      console.log(`  ✗ ${t.MichrazID}: ${error.message}`);
      failed++;
      continue;
    }
    await sleep(DELAY_MS);

    const city = cityByCode.get(t.KodYeshuv) || "";
    const [zoning, propertyType] = YEUD[t.KodYeudMichraz] ?? ["מעורב", "מתחם להשבחה"];
    const deadline = t.SgiraDate ? new Date(t.SgiraDate) : null;
    const daysLeft = deadline ? Math.ceil((deadline.getTime() - now) / 864e5) : null;
    // PtichaDate is when bidding OPENS. A tender published but not yet open is
    // "טרם החל" — רמ"י has no such status code, it is status 1 (מפורסם) with
    // this date still in the future. Roughly half of the live feed is in that
    // state, and until now they were indistinguishable from biddable tenders.
    const opensAt = t.PtichaDate ? new Date(t.PtichaDate) : null;
    const notStarted = Boolean(opensAt && opensAt.getTime() > now);
    // Days until the tender can actually be acted on: the opening date while it
    // is still closed, the deadline once it is open.
    const daysToAction = notStarted
      ? Math.ceil((opensAt.getTime() - now) / 864e5)
      : daysLeft;
    const tikList = Array.isArray(detail?.Tik) && detail.Tik.length ? detail.Tik : [null];
    let tenderPlots = 0;

    for (const [k, tik] of tikList.entries()) {
      const areaSqm = Number(tik?.Shetach) || 0;
      const minBid = Number(tik?.MechirSaf ?? detail?.MechirSafMichraz) || 0;
      const development = Number(tik?.HotzaotPituach) || 0;
      const appraisal = Number(tik?.mechirShuma) || 0;
      // Sanity guards: some rows carry regional/aggregate figures rather than a
      // real parcel (e.g. 26,800 dunam), which would be nonsense in the feed.
      const MAX_PLOT_SQM = 1_000_000; // 1,000 dunam
      if (!minBid || !areaSqm) continue; // unusable without price+area
      if (areaSqm > MAX_PLOT_SQM) continue;

      // MechirSaf is only the OPENING minimum bid — the winner also pays
      // הוצאות פיתוח. The honest entry cost is minBid + development, and the
      // gap to the official שומה is what actually matters to an investor.
      const askingPrice = minBid + development;
      const estMarketValue = appraisal > 0 ? appraisal : askingPrice;
      const discountPct =
        appraisal > 0 ? Math.round(((estMarketValue - askingPrice) / estMarketValue) * 1000) / 10 : 0;

      const gh = tik?.GushHelka?.[0];
      const units = Number(tik?.Kibolet) || Number(t.YechidotDiur) || 0;
      const buildingArea = Number(tik?.ShetachBniya) || 0;
      const rights =
        [
          units ? `יח״ד: ${units}` : null,
          buildingArea ? `שטח בנייה: ${buildingArea} מ״ר` : null,
          development ? `הוצאות פיתוח: ₪${development.toLocaleString("he-IL")}` : null,
          minBid ? `מחיר מינימום: ₪${minBid.toLocaleString("he-IL")}` : null,
        ]
          .filter(Boolean)
          .join(" · ") || null;

      const badges = [];
      if (discountPct > 0) badges.push("below_average");
      // "זמן קצר להגשה" only means something once submission is open — on a
      // tender that has not started it would rush people towards a form they
      // cannot fill in yet.
      if (notStarted) badges.push("not_started");
      else if (daysLeft != null && daysLeft <= 7) badges.push("deadline_soon");
      if (zoning === "חקלאי" || zoning === "מעורב") badges.push("rezoning_potential");

      const id = `rami-${t.MichrazID}-${k}`;
      await sql`
        INSERT INTO deals
          (id, source_id, source_ref, deal_type, status, raw_address, city, street,
           neighborhood, gush, helka, property_type, zoning, building_rights, area_sqm,
           min_bid, development_costs,
           asking_price, submission_deadline, submission_opens_at, source_status,
           est_market_value, discount_pct, deal_score,
           badges, raw_document_url, fingerprint, first_seen_at, last_updated_at)
        VALUES (
          ${id}, ${sourceId}, ${t.MichrazName}, 'rami_tender', 'active',
          ${`${propertyType}, ${(t.Shchuna || "").trim() || city}, ${city}`},
          ${city}, ${(t.Shchuna || "").trim() || city}, ${(t.Shchuna || "").trim() || null},
          ${gh?.Gush ?? null}, ${gh?.Helka ?? null}, ${propertyType}, ${zoning}, ${rights},
          ${areaSqm}, ${minBid}, ${development},
          ${askingPrice}, ${deadline}, ${opensAt}, ${t.StatusMichraz ?? null},
          ${estMarketValue}, ${discountPct},
          ${scoreOf({ discountPct, daysToAction, notStarted, zoning, hasAppraisal: appraisal > 0 })},
          ${badges}, ${`${BASE}/#/michraz/${t.MichrazID}`}, ${id}, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          asking_price = EXCLUDED.asking_price,
          est_market_value = EXCLUDED.est_market_value,
          discount_pct = EXCLUDED.discount_pct,
          deal_score = EXCLUDED.deal_score,
          submission_deadline = EXCLUDED.submission_deadline,
          -- Re-ingest is how a tender crosses from טרם החל to פתוח: רמ"י moves
          -- StatusMichraz 1 → 2, and both of these have to follow or the feed
          -- keeps calling an open tender "not started".
          submission_opens_at = EXCLUDED.submission_opens_at,
          source_status = EXCLUDED.source_status,
          badges = EXCLUDED.badges,
          last_updated_at = now()`;
      plots++;
      tenderPlots++;
    }

    // Recorded whether or not it produced anything — "examined, nothing for
    // us" is the answer that keeps the hourly run cheap.
    await sql`
      INSERT INTO rami_tenders_seen (michraz_id, source_status, sgira_date, plots, checked_at)
      VALUES (${String(t.MichrazID)}, ${t.StatusMichraz ?? null}, ${deadline}, ${tenderPlots}, now())
      ON CONFLICT (michraz_id) DO UPDATE SET
        source_status = EXCLUDED.source_status,
        sgira_date    = EXCLUDED.sgira_date,
        plots         = EXCLUDED.plots,
        checked_at    = now()`;

    if ((i + 1) % 25 === 0) console.log(`  …${i + 1}/${candidates.length} tenders → ${plots} plots`);
  }

  console.log(`\n✓ ingested ${plots} real land plots from ${candidates.length} tenders (${failed} failed)`);
  const [{ count }] = await sql`SELECT count(*)::int FROM deals WHERE deal_type='rami_tender'`;
  console.log(`  deals with deal_type='rami_tender': ${count}`);
  await sql.end();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
