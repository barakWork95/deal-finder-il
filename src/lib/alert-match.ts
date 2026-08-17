import type { Alert, Deal } from "./types";
import { matchesPhase, tenderPhase } from "./tender-phase";

/**
 * Does this tender satisfy an alert's filters?
 *
 * Deliberately mirrors the feed's filtering (DealFeed) field for field — an
 * alert saved from the feed has to mean the same thing it meant there, or the
 * "X מכרזים תואמים" count on the card would contradict what the user just saw.
 * An unset filter matches everything.
 */
export function matchesAlert(deal: Deal, alert: Alert, now?: Date): boolean {
  const f = alert.filters;
  if (f.phases?.length && !matchesPhase(tenderPhase(deal, now), f.phases)) return false;
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
  // One reading of the clock for the whole list: with a phase filter in play,
  // two deals evaluated either side of midnight could otherwise be judged
  // against different "todays".
  const now = new Date();
  let n = 0;
  for (const d of deals) if (matchesAlert(d, alert, now)) n++;
  return n;
}
