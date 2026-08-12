// Live ingestion from nadlan.gov.il (רשות המסים) into historical_transactions.
//
// ⚠️  The nadlan.gov.il REST API is GEO-BLOCKED to Israeli IPs. From outside
//     Israel every call 302-redirects to `?view=status` and returns nothing.
//     Run this from an Israeli IP (or an IL egress proxy). The field mapping
//     below matches the real API response captured in db/data/nadlan_holon_real.json.
//
// Usage:
//   DATABASE_URL=... node db/ingest-nadlan.mjs "רחוב סוקולוב חולון"
//   DATABASE_URL=... node db/ingest-nadlan.mjs "חיפה" 5      # 5 pages
import postgres from "postgres";

const BASE = "https://www.nadlan.gov.il/Nadlan.REST/Main";
const query = process.argv[2] || "תל אביב יפו";
const maxPages = Number(process.argv[3] || 3);

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  onnotice: () => {},
});

const headers = {
  "Content-Type": "application/json",
  Referer: "https://www.nadlan.gov.il/",
  "User-Agent": "Mozilla/5.0",
  "X-Requested-With": "XMLHttpRequest",
};

async function getNav(q) {
  const res = await fetch(`${BASE}/GetDataByQuery`, {
    method: "POST",
    headers,
    body: JSON.stringify({ query: q }),
    redirect: "manual",
  });
  if (res.status === 302) {
    throw new Error(
      "nadlan API returned 302 (?view=status) — you are likely outside Israel. Run from an IL IP/proxy.",
    );
  }
  return res.json();
}

async function getDeals(nav, pageNo) {
  const res = await fetch(`${BASE}/GetAssestAndDeals`, {
    method: "POST",
    headers,
    body: JSON.stringify({ ...nav, PageNo: pageNo, OrderByFilled: "1", OrderByDescending: "1" }),
  });
  return res.json();
}

async function ensureSource() {
  const [existing] = await sql`SELECT id FROM sources WHERE source_type='tax_history' AND is_real LIMIT 1`;
  if (existing) return existing.id;
  const [row] = await sql`
    INSERT INTO sources (name, source_type, base_url, is_real)
    VALUES ('רשות המסים / נדל״ן-נט', 'tax_history', 'https://www.nadlan.gov.il', true)
    RETURNING id`;
  return row.id;
}

function upsert(sourceId, r) {
  const ppsqm = r.price_per_sqm ?? (r.asset_area ? Math.round(r.deal_amount / r.asset_area) : null);
  return sql`
    INSERT INTO historical_transactions
      (source_id, external_id, city, street, house_number, neighborhood, gush, helka,
       tat_helka, property_type, area_sqm, rooms, sale_price, sale_date, price_per_sqm, raw_data)
    VALUES (
      ${sourceId}, ${String(r.dealId ?? r.objectid)}, ${r.settlement_name_heb},
      ${r.streetNameHeb ?? r.street_name ?? null}, ${r.houseNum != null ? String(r.houseNum) : null},
      ${r.neighborhood ?? null}, ${r.gushNum != null ? String(r.gushNum) : null},
      ${r.parcelNum != null ? String(r.parcelNum) : null},
      ${r.subParcelNum != null ? String(r.subParcelNum) : null},
      ${r.dealNatureDescription ?? r.property_type_description ?? null},
      ${r.asset_area ?? null}, ${r.assetRoomNum ?? null}, ${r.deal_amount}, ${r.deal_date},
      ${ppsqm}, ${sql.json(r)}
    )
    ON CONFLICT (external_id) DO UPDATE SET sale_price = EXCLUDED.sale_price, raw_data = EXCLUDED.raw_data`;
}

async function main() {
  console.log(`→ Querying nadlan for: "${query}"`);
  const nav = await getNav(query);
  const sourceId = await ensureSource();
  let total = 0;
  for (let page = 1; page <= maxPages; page++) {
    const data = await getDeals(nav, page);
    const rows = data.AllResults || data.Results || [];
    if (!rows.length) break;
    for (const r of rows) await upsert(sourceId, r);
    total += rows.length;
    console.log(`  page ${page}: +${rows.length}`);
    await new Promise((r) => setTimeout(r, 800)); // be polite
  }
  console.log(`✓ upserted ${total} real transactions`);
  await sql.end();
}

main().catch((e) => {
  console.error("✗", e.message);
  process.exit(1);
});
