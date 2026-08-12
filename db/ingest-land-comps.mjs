// Ingest REAL land comparables from רמ"י *closed* tenders (winning prices).
//
// Why this source rather than nadlan/רשות המסים:
//   nadlan.gov.il now gates its transaction data behind a reCAPTCHA
//   (api.nadlan.gov.il/token-verify), which we do not attempt to bypass.
//   RMI's own closed tenders are openly accessible through the same public
//   portal we already use, and are a *better* comp set for a land platform:
//   every record is a real land parcel with a real transacted price
//   (SchumZchiya = winning bid), area, גוש/חלקה, zoning and settlement —
//   whereas nadlan is dominated by built apartments.
//
// Usage:
//   DATABASE_URL=... node db/ingest-land-comps.mjs                # since 2020
//   DATABASE_URL=... node db/ingest-land-comps.mjs --since 2015
//   DATABASE_URL=... node db/ingest-land-comps.mjs --limit 200
import postgres from "postgres";

const BASE = "https://apps.land.gov.il/MichrazimSite";
const API = `${BASE}/api`;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

const args = process.argv.slice(2);
const SINCE_YEAR = args.includes("--since") ? Number(args[args.indexOf("--since") + 1]) : 2020;
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;
const DELAY_MS = 220;

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  prepare: false,
  onnotice: () => {},
});

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
    },
  });
  const sc = res.headers.getSetCookie?.() ?? [];
  if (sc.length) cookie = sc.map((c) => c.split(";")[0]).join("; ");
  return res;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// RMI ייעוד code → our zoning + land category (same mapping as ingest-rami).
const YEUD = {
  1: ["מגורים", "מגרש למגורים"],
  2: ["מגורים", "מגרש למגורים"],
  3: ["מסחר", "מגרש מסחרי"],
  4: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  5: ["מבני ציבור", "מגרש מסחרי"],
  6: ["מסחר", "מגרש מסחרי"],
  7: ["מסחר", "מגרש מסחרי"],
  8: ["תיירות", "מגרש מסחרי"],
  9: ["תיירות", "מגרש מסחרי"],
  10: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  11: ["חקלאי", "קרקע חקלאית"],
  12: ["מעורב", "מתחם להשבחה"],
  13: ["מגורים", "מגרש למגורים"],
  14: ["מגורים", "מגרש למגורים"],
  15: ["מעורב", "מתחם להשבחה"],
  16: ["מעורב", "מתחם להשבחה"],
  17: ["חקלאי", "קרקע חקלאית"],
  18: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  20: ["מגורים", "מגרש למגורים"],
  21: ["מגורים", "מגרש למגורים"],
  22: ["מעורב", "מתחם להשבחה"],
  23: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  24: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  25: ["תעשייה ומלאכה", "מגרש לתעשייה"],
  26: ["מסחר", "מגרש מסחרי"],
  99: ["מעורב", "מתחם להשבחה"],
};

const MAX_PLOT_SQM = 1_000_000;

// Only tender types where bidders genuinely compete on LAND PRICE.
// Excluded: מחיר למשתכן (7), מחיר מטרה (5), דיור במחיר מופחת (8),
// הרשמה והגרלה (2), קדימות (4), דיור להשכרה (6), עמידר/עכו (10, 11) —
// in those the minimum is symbolic and the competition is on other terms,
// so the "winning price" is not a market land value.
const MARKET_TENDER_TYPES = new Set([1, 9]); // פומבי רגיל, ייזום
// Symbolic minimums (₪1 etc.) also signal a non-market tender.
const MIN_REALISTIC_BID = 10_000;

async function main() {
  console.log("→ warming session…");
  await http(`${BASE}/`);

  const yeshuvim = await (await http(`${API}/YeshuvimApi/Get`)).json();
  const cityByCode = new Map(
    (Array.isArray(yeshuvim) ? yeshuvim : Object.values(yeshuvim)).map((y) => [
      y.mtysvSemelYishuv,
      (y.mtysvShemYishuv || "").trim(),
    ]),
  );

  const all = await (await http(`${API}/SearchApi/Search`, { method: "POST", body: "{}" })).json();

  // StatusMichraz 5 = נדון בוועדת מכרזים → winners decided, prices published.
  const closed = all
    .filter((t) => {
      if (t.StatusMichraz !== 5) return false;
      if (!MARKET_TENDER_TYPES.has(t.KodSugMichraz)) return false;
      const d = t.SgiraDate ? new Date(t.SgiraDate) : null;
      return d && d.getFullYear() >= SINCE_YEAR;
    })
    .sort((a, b) => new Date(b.SgiraDate) - new Date(a.SgiraDate))
    .slice(0, LIMIT);
  console.log(`  ${all.length} tenders total → ${closed.length} decided since ${SINCE_YEAR}`);

  const [existing] =
    await sql`SELECT id FROM sources WHERE source_type='rami' AND is_real ORDER BY created_at LIMIT 1`;
  const sourceId =
    existing?.id ??
    (
      await sql`INSERT INTO sources (name, source_type, base_url, is_real)
                VALUES ('רשות מקרקעי ישראל (רמ״י) — תוצאות מכרזים', 'rami', ${BASE}, true)
                RETURNING id`
    )[0].id;

  let comps = 0;
  const premiums = [];

  for (const [i, t] of closed.entries()) {
    let detail;
    try {
      detail = await (await http(`${API}/MichrazDetailsApi/Get?michrazID=${t.MichrazID}`)).json();
    } catch {
      continue;
    }
    await sleep(DELAY_MS);

    const city = cityByCode.get(t.KodYeshuv) || "";
    const [zoning, propertyType] = YEUD[t.KodYeudMichraz] ?? ["מעורב", "מתחם להשבחה"];
    // Committee date is the truest "transaction" date; fall back to closing.
    const saleDate = t.VaadaDate || t.SgiraDate;
    if (!city || !saleDate) continue;

    for (const [k, tik] of (detail?.Tik ?? []).entries()) {
      const areaSqm = Number(tik?.Shetach) || 0;
      const winning = Number(tik?.SchumZchiya) || 0;
      const minBid = Number(tik?.MechirSaf) || 0;
      if (!winning || !areaSqm || areaSqm > MAX_PLOT_SQM) continue;
      if (minBid < MIN_REALISTIC_BID) continue; // symbolic minimum → not a market price
      // Reject impossible unit prices (bad Shetach values produce ₪1B/m²).
      const perSqm = Math.round(winning / areaSqm);
      if (perSqm < 10 || perSqm > 200_000) continue;

      premiums.push((winning - minBid) / minBid);

      const gh = tik?.GushHelka?.[0];
      await sql`
        INSERT INTO historical_transactions
          (source_id, external_id, city, street, neighborhood, gush, helka,
           property_type, zoning, area_sqm, sale_price, sale_date, price_per_sqm, raw_data)
        VALUES (
          ${sourceId}, ${`rami-comp-${t.MichrazID}-${k}`}, ${city},
          ${(t.Shchuna || "").trim() || city}, ${(t.Shchuna || "").trim() || null},
          ${gh?.Gush ?? null}, ${gh?.Helka ?? null}, ${propertyType}, ${zoning},
          ${areaSqm}, ${winning}, ${new Date(saleDate)}, ${perSqm},
          ${sql.json({ michraz: t.MichrazName, minBid, winner: tik?.ShemZoche ?? null })}
        )
        ON CONFLICT (external_id) DO UPDATE SET
          sale_price = EXCLUDED.sale_price,
          price_per_sqm = EXCLUDED.price_per_sqm`;
      comps++;
    }

    if ((i + 1) % 50 === 0) console.log(`  …${i + 1}/${closed.length} tenders → ${comps} comps`);
  }

  console.log(`\n✓ ingested ${comps} real land comparables`);
  if (premiums.length) {
    // Median, not mean — a few outliers otherwise dominate.
    premiums.sort((a, b) => a - b);
    const median = premiums[Math.floor(premiums.length / 2)];
    console.log(
      `  median winning premium over minimum bid: +${(median * 100).toFixed(0)}% (n=${premiums.length})`,
    );
  }
  await sql.end();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
