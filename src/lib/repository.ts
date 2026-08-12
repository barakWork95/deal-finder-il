import "server-only";
import { sql, hasDb } from "./db";
import type { Deal, HistoricalTransaction, PropertyType, BadgeKind, DealType, Zoning } from "./types";
import { DEALS as MOCK_DEALS, getDeal as getMockDeal, CITIES as MOCK_CITIES } from "./mock-data";

// NUMERIC columns come back as strings from postgres.js — coerce explicitly.
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | undefined =>
  v == null ? undefined : v instanceof Date ? v.toISOString() : String(v);

function mapDeal(row: Record<string, unknown>, comps: HistoricalTransaction[], areaAvg: number): Deal {
  return {
    id: String(row.id),
    sourceName: String(row.source_name ?? ""),
    dealType: row.deal_type as DealType,
    status: row.status as Deal["status"],
    rawAddress: String(row.raw_address ?? ""),
    city: String(row.city ?? ""),
    street: String(row.street ?? ""),
    houseNumber: String(row.house_number ?? ""),
    neighborhood: (row.neighborhood as string) ?? undefined,
    gush: (row.gush as string) ?? undefined,
    helka: (row.helka as string) ?? undefined,
    tatHelka: (row.tat_helka as string) ?? undefined,
    lat: num(row.lat),
    lng: num(row.lng),
    propertyType: (row.property_type as PropertyType) ?? "מגרש למגורים",
    zoning: (row.zoning as Zoning) ?? "מגורים",
    areaSqm: num(row.area_sqm),
    buildingRights: (row.building_rights as string) ?? undefined,
    askingPrice: num(row.asking_price),
    submissionDeadline: iso(row.submission_deadline),
    estMarketValue: num(row.est_market_value),
    discountPct: num(row.discount_pct),
    dealScore: num(row.deal_score),
    badges: ((row.badges as string[]) ?? []) as BadgeKind[],
    rawDocumentUrl: (row.raw_document_url as string) ?? undefined,
    firstSeenAt: iso(row.first_seen_at) ?? new Date().toISOString(),
    comps,
    areaAvgPricePerSqm: areaAvg,
  };
}

function mapComp(row: Record<string, unknown>): HistoricalTransaction {
  return {
    id: String(row.id),
    city: String(row.city ?? ""),
    street: String(row.street ?? ""),
    houseNumber: String(row.house_number ?? ""),
    gush: (row.gush as string) ?? undefined,
    helka: (row.helka as string) ?? undefined,
    propertyType: (row.property_type as PropertyType) ?? "מגרש למגורים",
    zoning: (row.zoning as Zoning) ?? undefined,
    areaSqm: num(row.area_sqm),
    salePrice: num(row.sale_price),
    saleDate: iso(row.sale_date) ?? "",
    pricePerSqm: num(row.price_per_sqm),
  };
}

export async function listDeals(): Promise<Deal[]> {
  if (!hasDb) return MOCK_DEALS.filter((d) => d.status !== "sold");
  const rows = await sql`
    SELECT d.*, s.name AS source_name
    FROM deals d LEFT JOIN sources s ON s.id = d.source_id
    WHERE d.status = 'active'
    ORDER BY d.deal_score DESC NULLS LAST`;
  return rows.map((r) =>
    mapDeal(r, [], r.area_sqm ? Math.round(num(r.est_market_value) / num(r.area_sqm)) : 0),
  );
}

export async function getDealById(id: string): Promise<Deal | undefined> {
  if (!hasDb) return getMockDeal(id);
  const [row] = await sql`
    SELECT d.*, s.name AS source_name
    FROM deals d LEFT JOIN sources s ON s.id = d.source_id
    WHERE d.id = ${id}`;
  if (!row) return undefined;

  // Real dataset is sparse/older, so use a wide 240-month window for comps.
  const compRows = await sql`
    SELECT * FROM get_comps(${row.city}, ${row.street}, ${row.gush ?? null},
                            ${row.lat ?? null}, ${row.lng ?? null}, 240, 8)`;
  // Benchmark against the same zoning first (residential land vs residential
  // land); fall back to all land in the city when that's too thin.
  const [{ avg } = { avg: null }] = await sql`
    SELECT COALESCE(
      area_avg_price_per_sqm(${row.city}, ${row.zoning ?? null}, 240),
      area_avg_price_per_sqm(${row.city}, NULL, 240)
    ) AS avg`;

  const comps = compRows.map(mapComp);
  const areaAvg = avg != null ? num(avg) : row.area_sqm ? Math.round(num(row.est_market_value) / num(row.area_sqm)) : 0;
  return mapDeal(row, comps, areaAvg);
}

export async function listCities(): Promise<string[]> {
  if (!hasDb) return MOCK_CITIES;
  const rows = await sql`SELECT DISTINCT city FROM deals WHERE status='active' ORDER BY city`;
  return rows.map((r) => String(r.city));
}
