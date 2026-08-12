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

const BASE = "https://apps.land.gov.il/MichrazimSite";
const API = `${BASE}/api`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const args = process.argv.slice(2);
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const INCLUDE_ALL = args.includes("--all");
const DELAY_MS = 250;

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  prepare: false,
  onnotice: () => {},
});

// ---- tiny cookie jar (the portal sets a session cookie on the SPA root) ----
let cookie = "";
async function http(url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": UA,
      Accept: "application/json, text/plain, */*",
      Referer: `${BASE}/`,
      ...(cookie ? { Cookie: cookie } : {}),
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) {
    cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  }
  return res;
}

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

function scoreOf({ discountPct, daysLeft, zoning, hasAppraisal }) {
  const discountScore = Math.max(0, Math.min(55, discountPct * 2.4));
  const urgency = daysLeft == null ? 6 : daysLeft <= 5 ? 18 : daysLeft <= 14 ? 12 : 8;
  const typeBoost = 10; // every RMI tender is a genuine land tender
  const upside = zoning === "חקלאי" || zoning === "מעורב" ? 8 : 0;
  const confidence = hasAppraisal ? 6 : 0; // real שומה beats a guess
  return Math.max(0, Math.min(99, Math.round(discountScore + urgency + typeBoost + upside + confidence)));
}

async function main() {
  console.log("→ warming session…");
  await http(`${BASE}/`);

  console.log("→ lookups…");
  const tables = await (await http(`${API}/GeneralTablesApi`)).json();
  const tableRows = Array.isArray(tables) ? tables : Object.values(tables);
  const sugMichraz = new Map(
    tableRows.filter((r) => r.TableName === "סוג מכרז").map((r) => [r.Code, r.Value]),
  );

  const yeshuvim = await (await http(`${API}/YeshuvimApi/Get`)).json();
  const cityByCode = new Map(
    (Array.isArray(yeshuvim) ? yeshuvim : Object.values(yeshuvim)).map((y) => [
      y.mtysvSemelYishuv,
      (y.mtysvShemYishuv || "").trim(),
    ]),
  );
  console.log(`  ${cityByCode.size} settlements, ${sugMichraz.size} tender types`);

  console.log("→ searching tenders…");
  const all = await (await http(`${API}/SearchApi/Search`, { method: "POST", body: "{}" })).json();
  console.log(`  ${all.length} tenders total`);

  const now = Date.now();
  const candidates = all
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
      const res = await http(`${API}/MichrazDetailsApi/Get?michrazID=${t.MichrazID}`);
      detail = await res.json();
    } catch {
      failed++;
      continue;
    }
    await sleep(DELAY_MS);

    const city = cityByCode.get(t.KodYeshuv) || "";
    const [zoning, propertyType] = YEUD[t.KodYeudMichraz] ?? ["מעורב", "מתחם להשבחה"];
    const deadline = t.SgiraDate ? new Date(t.SgiraDate) : null;
    const daysLeft = deadline ? Math.ceil((deadline.getTime() - now) / 864e5) : null;
    const tikList = Array.isArray(detail?.Tik) && detail.Tik.length ? detail.Tik : [null];

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
      if (daysLeft != null && daysLeft <= 7) badges.push("deadline_soon");
      if (zoning === "חקלאי" || zoning === "מעורב") badges.push("rezoning_potential");

      const id = `rami-${t.MichrazID}-${k}`;
      await sql`
        INSERT INTO deals
          (id, source_id, source_ref, deal_type, status, raw_address, city, street,
           neighborhood, gush, helka, property_type, zoning, building_rights, area_sqm,
           asking_price, submission_deadline, est_market_value, discount_pct, deal_score,
           badges, raw_document_url, fingerprint, first_seen_at, last_updated_at)
        VALUES (
          ${id}, ${sourceId}, ${t.MichrazName}, 'rami_tender', 'active',
          ${`${propertyType}, ${(t.Shchuna || "").trim() || city}, ${city}`},
          ${city}, ${(t.Shchuna || "").trim() || city}, ${(t.Shchuna || "").trim() || null},
          ${gh?.Gush ?? null}, ${gh?.Helka ?? null}, ${propertyType}, ${zoning}, ${rights},
          ${areaSqm}, ${askingPrice}, ${deadline}, ${estMarketValue}, ${discountPct},
          ${scoreOf({ discountPct, daysLeft, zoning, hasAppraisal: appraisal > 0 })},
          ${badges}, ${`${BASE}/#/michraz/${t.MichrazID}`}, ${id}, now(), now()
        )
        ON CONFLICT (id) DO UPDATE SET
          asking_price = EXCLUDED.asking_price,
          est_market_value = EXCLUDED.est_market_value,
          discount_pct = EXCLUDED.discount_pct,
          deal_score = EXCLUDED.deal_score,
          submission_deadline = EXCLUDED.submission_deadline,
          badges = EXCLUDED.badges,
          last_updated_at = now()`;
      plots++;
    }

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
