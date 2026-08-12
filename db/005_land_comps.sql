-- ============================================================
-- Land-only comparables.
-- historical_transactions may still hold non-land rows (e.g. the early
-- nadlan apartment sales kept as ingestion provenance). Mixing built
-- apartments (~₪20,000/m²) with raw land (~₪800/m²) would wreck every
-- average, so comps are restricted to rows carrying a land zoning.
-- ============================================================

CREATE OR REPLACE FUNCTION get_comps(
  p_city   text,
  p_street text,
  p_gush   text,
  p_lat    double precision DEFAULT NULL,
  p_lng    double precision DEFAULT NULL,
  p_months int DEFAULT 36,
  p_limit  int DEFAULT 12
)
RETURNS SETOF historical_transactions
LANGUAGE sql STABLE AS $$
  SELECT h.*
  FROM historical_transactions h
  WHERE h.city = p_city
    AND h.zoning IS NOT NULL              -- land only
    AND h.price_per_sqm BETWEEN 10 AND 200000  -- drop broken records
    AND h.sale_date > (now() - make_interval(months => p_months))
  ORDER BY
    (h.gush IS NOT DISTINCT FROM p_gush AND p_gush IS NOT NULL) DESC,
    (h.street IS NOT DISTINCT FROM p_street) DESC,
    CASE
      WHEN p_lat IS NOT NULL AND h.lat IS NOT NULL
      THEN earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(h.lat, h.lng))
      ELSE 1e12
    END ASC,
    h.sale_date DESC
  LIMIT p_limit;
$$;

-- Area average ₪/m² of LAND. Optionally narrowed to a single zoning so a
-- residential plot isn't benchmarked against industrial land.
-- (Second parameter was renamed p_street → p_zoning, so the old signature
-- must be dropped before redefining.)
DROP FUNCTION IF EXISTS area_avg_price_per_sqm(text, text, integer);

CREATE OR REPLACE FUNCTION area_avg_price_per_sqm(
  p_city   text,
  p_zoning text DEFAULT NULL,
  p_months int DEFAULT 36
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  -- MEDIAN, not average: land prices are heavy-tailed and a single bad
  -- record (tiny area ÷ large price) would otherwise dominate the benchmark.
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY price_per_sqm))::numeric
  FROM historical_transactions
  WHERE city = p_city
    AND zoning IS NOT NULL
    AND (p_zoning IS NULL OR zoning = p_zoning)
    AND price_per_sqm IS NOT NULL
    AND price_per_sqm BETWEEN 10 AND 200000   -- plausible ₪/m² of land
    AND sale_date > (now() - make_interval(months => p_months));
$$;
