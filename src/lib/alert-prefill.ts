import type { DealType, TenderPhase, Zoning } from "./types";
import { FILTERABLE_PHASES } from "./tender-phase";

/**
 * Carries the feed's active filters into the alert builder through the URL, so
 * "שמירת סינון כהתראה" lands on a form that already describes what you were
 * looking at. Both ends live here so the writer (the feed) and the reader (the
 * personal-area route) can't drift apart.
 */

export type AlertPrefill = {
  city?: string;
  maxPrice?: number;
  minDiscount?: number;
  minScore?: number;
  types?: DealType[];
  zonings?: Zoning[];
  phases?: TenderPhase[];
};

const DEAL_TYPES: DealType[] = [
  "rami_tender",
  "foreclosure",
  "private_sale",
  "inheritance",
  "price_drop",
  "other",
];

export const ZONINGS: Zoning[] = [
  "מגורים",
  "מסחר",
  "תעשייה ומלאכה",
  "חקלאי",
  "מעורב",
  "תיירות",
  "מבני ציבור",
];

/**
 * Score threshold for an alert built from one tender. The tender's own score
 * would be far too tight a filter (a 97 would match almost nothing), so it
 * drops to the tier below it — the same 60/80/90 tiers the feed filters by.
 */
export function scoreThresholdFor(score: number): number {
  if (score >= 90) return 90;
  if (score >= 80) return 80;
  if (score >= 60) return 60;
  return 0;
}

export type PersonalTab = "alerts" | "saved" | "account" | "billing";
const TABS: PersonalTab[] = ["alerts", "saved", "account", "billing"];

export function parseTab(value: unknown, fallback: PersonalTab = "alerts"): PersonalTab {
  return TABS.includes(value as PersonalTab) ? (value as PersonalTab) : fallback;
}

/** Only filters that are actually narrowing anything are worth carrying. */
export function buildAlertHref(prefill: AlertPrefill): string {
  const params = new URLSearchParams({ tab: "alerts" });
  if (prefill.city) params.set("city", prefill.city);
  if (prefill.maxPrice != null) params.set("maxPrice", String(Math.round(prefill.maxPrice)));
  if (prefill.minDiscount) params.set("minDiscount", String(Math.round(prefill.minDiscount)));
  if (prefill.minScore) params.set("minScore", String(Math.round(prefill.minScore)));
  if (prefill.types?.length) params.set("types", prefill.types.join(","));
  if (prefill.zonings?.length) params.set("zonings", prefill.zonings.join(","));
  if (prefill.phases?.length) params.set("phases", prefill.phases.join(","));
  return `/alerts?${params}`;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

function num(v: string | string[] | undefined, min: number, max: number): number | undefined {
  const raw = first(v);
  if (raw == null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

/** Anything unrecognised in the query string is dropped rather than trusted. */
export function parseAlertPrefill(params: RawParams): AlertPrefill {
  const types = first(params.types)
    ?.split(",")
    .filter((t): t is DealType => DEAL_TYPES.includes(t as DealType));

  const zonings = first(params.zonings)
    ?.split(",")
    .filter((z): z is Zoning => ZONINGS.includes(z as Zoning));

  const phases = first(params.phases)
    ?.split(",")
    .filter((p): p is TenderPhase => FILTERABLE_PHASES.includes(p as TenderPhase));

  return {
    phases: phases?.length ? phases : undefined,
    city: first(params.city) || undefined,
    maxPrice: num(params.maxPrice, 500_000, 60_000_000),
    minDiscount: num(params.minDiscount, 0, 60),
    minScore: num(params.minScore, 0, 99),
    types: types?.length ? types : undefined,
    zonings: zonings?.length ? zonings : undefined,
  };
}

export function hasPrefill(p: AlertPrefill): boolean {
  return Boolean(
    p.city ||
      p.maxPrice != null ||
      p.minDiscount ||
      p.minScore ||
      p.types?.length ||
      p.zonings?.length ||
      p.phases?.length,
  );
}
