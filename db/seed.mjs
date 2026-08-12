// Seed the DB with (a) REAL nadlan transactions (Holon) captured from the
// gov API, and (b) sample opportunity/comps data for a rich demo.
// Provenance is tracked via sources.is_real so the UI never misrepresents.
//
// Usage: DATABASE_URL=postgres://localhost/deal_finder node db/seed.mjs
import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { DEALS } from "../src/lib/mock-data.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATABASE_URL = process.env.DATABASE_URL || "postgres://localhost/deal_finder";
const sql = postgres(DATABASE_URL, { onnotice: () => {} });

const real = JSON.parse(readFileSync(join(__dirname, "data/nadlan_holon_real.json"), "utf8"));

// Holon centroid for approximate coordinates (real records carry ITM polygons;
// precise geom is derived via PostGIS in production — see 003_postgis.sql).
const HOLON = { lat: 32.0167, lng: 34.7792 };
const jitter = (base, seed) => base + (((seed * 9301 + 49297) % 233280) / 233280 - 0.5) * 0.02;

function toInt(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  console.log("→ Connecting to", DATABASE_URL.replace(/:[^:@]*@/, ":****@"));

  await sql`TRUNCATE deals, historical_transactions, sources, alerts, alert_deliveries, user_deal_actions RESTART IDENTITY CASCADE`;

  // ---- sources ----
  const [realSrc] = await sql`
    INSERT INTO sources (name, source_type, base_url, is_real)
    VALUES ('רשות המסים / נדל״ן-נט', 'tax_history', 'https://www.nadlan.gov.il', true)
    RETURNING id`;
  const [sampleSrc] = await sql`
    INSERT INTO sources (name, source_type, is_real)
    VALUES ('דוגמה (Sample data)', 'sample', false)
    RETURNING id`;

  // Distinct opportunity sources from the demo deals (flagged not-real: these
  // specific listings are illustrative until live scrapers are connected).
  const srcByName = new Map();
  for (const d of DEALS) {
    if (srcByName.has(d.sourceName)) continue;
    const type = d.dealType === "foreclosure" ? "foreclosure" : d.dealType === "rami_tender" ? "rami" : "off_market";
    const [row] = await sql`
      INSERT INTO sources (name, source_type, is_real)
      VALUES (${d.sourceName}, ${type}, false) RETURNING id`;
    srcByName.set(d.sourceName, row.id);
  }

  // ---- REAL historical transactions (Holon) ----
  let realCount = 0;
  for (let i = 0; i < real.length; i++) {
    const r = real[i];
    const ppsqm = r.price_per_sqm ?? (r.asset_area ? Math.round(r.deal_amount / r.asset_area) : null);
    await sql`
      INSERT INTO historical_transactions
        (source_id, external_id, city, street, house_number, neighborhood,
         gush, helka, tat_helka, lat, lng, property_type, area_sqm, rooms, floor,
         sale_price, sale_date, price_per_sqm, raw_data)
      VALUES (
        ${realSrc.id},
        ${String(r.dealId ?? r.objectid ?? `real-${i}`)},
        ${r.settlement_name_heb},
        ${r.streetNameHeb ?? r.street_name ?? null},
        ${r.houseNum != null ? String(r.houseNum) : null},
        ${r.neighborhood ?? null},
        ${r.gushNum != null ? String(r.gushNum) : null},
        ${r.parcelNum != null ? String(r.parcelNum) : null},
        ${r.subParcelNum != null ? String(r.subParcelNum) : null},
        ${jitter(HOLON.lat, i + 1)}, ${jitter(HOLON.lng, i + 7)},
        ${r.dealNatureDescription ?? r.property_type_description ?? null},
        ${r.asset_area ?? null},
        ${r.assetRoomNum ?? null},
        ${toInt(r.floor_number)},
        ${r.deal_amount},
        ${r.deal_date},
        ${ppsqm},
        ${sql.json(r)}
      ) ON CONFLICT (external_id) DO NOTHING`;
    realCount++;
  }
  console.log(`✓ inserted ${realCount} REAL Holon transactions`);

  // ---- SAMPLE land comps (from the demo deals' generated comps) ----
  let sampleComps = 0;
  for (const d of DEALS) {
    for (const c of d.comps) {
      await sql`
        INSERT INTO historical_transactions
          (source_id, external_id, city, street, house_number, property_type,
           zoning, area_sqm, sale_price, sale_date, price_per_sqm)
        VALUES (
          ${sampleSrc.id}, ${"sample-" + c.id}, ${c.city}, ${c.street},
          ${c.houseNumber}, ${c.propertyType}, ${c.zoning ?? null}, ${c.areaSqm},
          ${c.salePrice}, ${c.saleDate}, ${c.pricePerSqm}
        ) ON CONFLICT (external_id) DO NOTHING`;
      sampleComps++;
    }
  }
  console.log(`✓ inserted ${sampleComps} sample land comps`);

  // ---- LAND deals (opportunities) ----
  for (const d of DEALS) {
    await sql`
      INSERT INTO deals
        (id, source_id, deal_type, status, raw_address, city, street, house_number,
         neighborhood, gush, helka, tat_helka, lat, lng, property_type, zoning,
         building_rights, area_sqm, asking_price, submission_deadline, est_market_value,
         discount_pct, deal_score, badges, raw_document_url, fingerprint, first_seen_at)
      VALUES (
        ${d.id}, ${srcByName.get(d.sourceName) ?? sampleSrc.id}, ${d.dealType}, ${d.status ?? "active"},
        ${d.rawAddress}, ${d.city}, ${d.street}, ${d.houseNumber || null}, ${d.neighborhood ?? null},
        ${d.gush ?? null}, ${d.helka ?? null}, ${d.tatHelka ?? null}, ${d.lat}, ${d.lng},
        ${d.propertyType}, ${d.zoning}, ${d.buildingRights ?? null}, ${d.areaSqm}, ${d.askingPrice},
        ${d.submissionDeadline ?? null}, ${d.estMarketValue}, ${d.discountPct}, ${d.dealScore},
        ${d.badges}, ${d.rawDocumentUrl ?? null}, ${d.id}, ${d.firstSeenAt}
      ) ON CONFLICT (id) DO NOTHING`;
  }
  console.log(`✓ inserted ${DEALS.length} land deals`);

  const [{ count: htc }] = await sql`SELECT count(*)::int FROM historical_transactions`;
  const [{ count: dc }] = await sql`SELECT count(*)::int FROM deals`;
  console.log(`\nDone. deals=${dc}, historical_transactions=${htc}`);
  await sql.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
