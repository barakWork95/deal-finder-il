-- ============================================================
-- OPTIONAL — run this ONLY on Supabase (or any Postgres with PostGIS).
-- Adds native geometry columns + GIST indexes for ST_DWithin queries.
-- The app runs fine without this (it uses earthdistance from 001/002);
-- enable this for high-volume spatial matching in production.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326) END
  ) STORED;

ALTER TABLE historical_transactions
  ADD COLUMN IF NOT EXISTS geom geometry(Point, 4326)
  GENERATED ALWAYS AS (
    CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
    THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326) END
  ) STORED;

CREATE INDEX IF NOT EXISTS idx_deals_geom ON deals USING gist (geom);
CREATE INDEX IF NOT EXISTS idx_hist_geom  ON historical_transactions USING gist (geom);

-- Example production comps query (nearest sales within 500m, last 24 months):
--   SELECT * FROM historical_transactions h
--   WHERE h.sale_date > now() - interval '24 months'
--     AND ST_DWithin(h.geom::geography, $1::geography, 500)
--   ORDER BY h.geom <-> $1 LIMIT 20;
