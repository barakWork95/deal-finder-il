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
    geoPrecision: (row.geo_precision as Deal["geoPrecision"]) ?? undefined,
    propertyType: (row.property_type as PropertyType) ?? "מגרש למגורים",
    zoning: (row.zoning as Zoning) ?? "מגורים",
    areaSqm: num(row.area_sqm),
    buildingRights: (row.building_rights as string) ?? undefined,
    minBid: row.min_bid == null ? undefined : num(row.min_bid),
    developmentCosts: row.development_costs == null ? undefined : num(row.development_costs),
    askingPrice: num(row.asking_price),
    submissionDeadline: iso(row.submission_deadline),
    submissionOpensAt: iso(row.submission_opens_at),
    sourceStatus: row.source_status == null ? undefined : num(row.source_status),
    estMarketValue: num(row.est_market_value),
    discountPct: num(row.discount_pct),
    dealScore: num(row.deal_score),
    badges: ((row.badges as string[]) ?? []) as BadgeKind[],
    rawDocumentUrl: (row.raw_document_url as string) ?? undefined,
    firstSeenAt: iso(row.first_seen_at) ?? new Date().toISOString(),
    comps,
    areaAvgPricePerSqm: areaAvg,
    // Winning-premium signal is materialised on the row (see 007_premium_score).
    winningPremium: row.winning_premium == null ? undefined : num(row.winning_premium),
    winningPremiumN: row.winning_premium_n == null ? undefined : num(row.winning_premium_n),
    expectedWinningPrice:
      row.expected_winning_price == null ? undefined : num(row.expected_winning_price),
    expectedGapPct: row.expected_gap_pct == null ? undefined : num(row.expected_gap_pct),
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

/**
 * Active tenders first seen since `since` — the notification worker's input.
 *
 * `first_seen_at` is set by the ingestion upsert, so "new" means new to us,
 * not newly published by רמ"י. Comps are not loaded: an alert message quotes
 * the entry cost and the appraisal gap, both of which are on the row.
 */
export async function listDealsSince(since: Date): Promise<Deal[]> {
  if (!hasDb) return [];
  const rows = await sql`
    SELECT d.*, s.name AS source_name
    FROM deals d LEFT JOIN sources s ON s.id = d.source_id
    WHERE d.status = 'active' AND d.first_seen_at >= ${since}
    ORDER BY d.first_seen_at DESC`;
  return rows.map((r) =>
    mapDeal(r, [], r.area_sqm ? Math.round(num(r.est_market_value) / num(r.area_sqm)) : 0),
  );
}

/**
 * Active tenders whose bidding opens between `from` and `until`.
 *
 * The "it opens tomorrow" alert's candidates. Unlike the other two modes this
 * ignores first_seen_at entirely — a tender ingested weeks ago is exactly the
 * one worth a nudge on the morning it becomes biddable.
 */
export async function listDealsOpeningWithin(from: Date, until: Date): Promise<Deal[]> {
  if (!hasDb) return [];
  const rows = await sql`
    SELECT d.*, s.name AS source_name
    FROM deals d LEFT JOIN sources s ON s.id = d.source_id
    WHERE d.status = 'active'
      AND d.submission_opens_at IS NOT NULL
      AND d.submission_opens_at > ${from}
      AND d.submission_opens_at <= ${until}
    ORDER BY d.submission_opens_at`;
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
