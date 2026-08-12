-- ============================================================
-- Comps matching for Israeli addresses.
-- Ranking: same גוש > same street+city > same city, then most recent.
-- Portable (earthdistance) — no PostGIS required.
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
    AND h.sale_date > (now() - make_interval(months => p_months))
  ORDER BY
    (h.gush IS NOT DISTINCT FROM p_gush AND p_gush IS NOT NULL) DESC,  -- same block first
    (h.street IS NOT DISTINCT FROM p_street) DESC,                     -- then same street
    CASE
      WHEN p_lat IS NOT NULL AND h.lat IS NOT NULL
      THEN earth_distance(ll_to_earth(p_lat, p_lng), ll_to_earth(h.lat, h.lng))
      ELSE 1e12
    END ASC,                                                          -- then nearest
    h.sale_date DESC
  LIMIT p_limit;
$$;

-- Area average ₪/sqm for a city (optionally a street), last N months.
CREATE OR REPLACE FUNCTION area_avg_price_per_sqm(
  p_city   text,
  p_street text DEFAULT NULL,
  p_months int DEFAULT 36
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT round(avg(price_per_sqm))
  FROM historical_transactions
  WHERE city = p_city
    AND (p_street IS NULL OR street = p_street)
    AND price_per_sqm IS NOT NULL
    AND sale_date > (now() - make_interval(months => p_months));
$$;
