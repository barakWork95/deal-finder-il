import type { Alert, Deal } from "./types";

/**
 * Does this tender satisfy an alert's filters?
 *
 * Deliberately mirrors the feed's filtering (DealFeed) field for field — an
 * alert saved from the feed has to mean the same thing it meant there, or the
 * "X מכרזים תואמים" count on the card would contradict what the user just saw.
 * An unset filter matches everything.
 */
export function matchesAlert(deal: Deal, alert: Alert): boolean {
  const f = alert.filters;
  if (f.cities?.length && !f.cities.includes(deal.city)) return false;
  if (f.maxPrice != null && deal.askingPrice > f.maxPrice) return false;
  if (f.minPrice != null && deal.askingPrice < f.minPrice) return false;
  if (f.minDiscountPct != null && deal.discountPct < f.minDiscountPct) return false;
  if (f.minScore != null && deal.dealScore < f.minScore) return false;
  if (f.dealTypes?.length && !f.dealTypes.includes(deal.dealType)) return false;
  if (f.zonings?.length && !f.zonings.includes(deal.zoning)) return false;
  return true;
}

export function countMatches(deals: Deal[], alert: Alert): number {
  let n = 0;
  for (const d of deals) if (matchesAlert(d, alert)) n++;
  return n;
}
