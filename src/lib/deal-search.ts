import type { Deal } from "./types";

/**
 * Free-text matching for the header search.
 *
 * Every term has to match somewhere (AND), so "חריש מגורים" narrows rather than
 * widens. Fields cover how people actually describe a tender: where it is
 * (city, neighbourhood, street, raw address), what it is (land type, zoning),
 * and how it is identified (גוש/חלקה, and the רמ"י tender number embedded in
 * the deal id — "rami-20240309-0" matches a search for "20240309").
 */
function normalise(value: string): string {
  return (
    value
      .toLowerCase()
      // Hebrew is often typed with geresh/gershayim variants; fold them so
      // רמ"י and רמ״י both match.
      .replace(/[״"]/g, '"')
      .replace(/[׳']/g, "'")
      .trim()
  );
}

function haystack(deal: Deal): string {
  return normalise(
    [
      deal.city,
      deal.neighborhood,
      deal.street,
      deal.rawAddress,
      deal.propertyType,
      deal.zoning,
      deal.gush,
      deal.helka,
      deal.gush && deal.helka ? `${deal.gush}/${deal.helka}` : "",
      deal.id,
      deal.sourceName,
    ]
      .filter(Boolean)
      .join(" "),
  );
}

export function matchesQuery(deal: Deal, query: string): boolean {
  const terms = normalise(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return true;
  const text = haystack(deal);
  return terms.every((term) => text.includes(term));
}
