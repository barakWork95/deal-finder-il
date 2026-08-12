import type { DealType, BadgeKind } from "./types";

/** Land area: m² up to ~1 dunam, otherwise dunam (1 dunam = 1,000 m²). */
export function formatLandArea(sqm: number): string {
  if (sqm >= 1500) {
    const dunam = sqm / 1000;
    return `${dunam.toFixed(dunam >= 10 ? 0 : 1)} דונם`;
  }
  return `${Math.round(sqm).toLocaleString("he-IL")} מ״ר`;
}

/** ₪ per m² of land. */
export function formatPerDunam(pricePerSqm: number): string {
  return `₪${Math.round(pricePerSqm * 1000).toLocaleString("he-IL")}`;
}

const ILS = new Intl.NumberFormat("he-IL", {
  style: "currency",
  currency: "ILS",
  maximumFractionDigits: 0,
});

/** Full shekel amount, e.g. ₪1,250,000 */
export function formatILS(value: number): string {
  return ILS.format(value);
}

/** Compact shekel for tight table cells, e.g. ₪1.25M / ₪890K */
export function formatILSCompact(value: number): string {
  if (value >= 1_000_000) {
    return `₪${(value / 1_000_000).toFixed(2).replace(/\.?0+$/, "")}M`;
  }
  if (value >= 1_000) {
    return `₪${Math.round(value / 1_000)}K`;
  }
  return `₪${value}`;
}

export function formatPerSqm(value: number): string {
  return `₪${Math.round(value).toLocaleString("he-IL")}`;
}

export function formatDate(iso?: string): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(iso));
}

/** Hebrew countdown to a deadline, relative to `now`. */
export function daysUntil(iso?: string, now: Date = new Date()): number | null {
  if (!iso) return null;
  const diff = new Date(iso).getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

export function deadlineLabel(iso?: string, now?: Date): string {
  const d = daysUntil(iso, now);
  if (d === null) return "ללא מועד";
  if (d < 0) return "הסתיים";
  if (d === 0) return "היום!";
  if (d === 1) return "מחר";
  return `בעוד ${d} ימים`;
}

export const DEAL_TYPE_LABEL: Record<DealType, string> = {
  rami_tender: 'מכרז רמ"י',
  foreclosure: "כינוס נכסים",
  private_sale: "מכירה פרטית",
  inheritance: "ירושה",
  price_drop: "ירידת מחיר",
  other: "אחר",
};

export const BADGE_LABEL: Record<BadgeKind, string> = {
  motivated_seller: "מוכר לחוץ",
  deadline_soon: "זמן קצר להגשה",
  below_average: "מתחת לשומה",
  rezoning_potential: "פוטנציאל השבחה",
};

/** Semantic color token name for a Deal Score. */
export function scoreTone(score: number): "positive" | "warning" | "negative" {
  if (score >= 80) return "positive";
  if (score >= 60) return "warning";
  return "negative";
}
