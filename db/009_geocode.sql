-- 009: geocoding provenance for deals.
--
-- lat/lng existed since 001 but were never populated by the רמ"י ingest —
-- the tender API carries no coordinates, only גוש/חלקה. db/geocode-deals.mjs
-- resolves those against the open MAPI parcel layer
-- (open.govmap.gov.il WFS, opendata:PARCEL_ALL) and falls back to the
-- settlement centroid. The map view must be able to tell the two apart:
-- a parcel centroid is the real plot, a settlement centroid is "somewhere
-- in this town" and must never be presented as the plot's location.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS geo_precision text;

COMMENT ON COLUMN deals.geo_precision IS
  'parcel = centroid of the registered גוש/חלקה polygon; city = settlement centroid (approximate); NULL = not geocoded';

CREATE INDEX IF NOT EXISTS idx_deals_geo ON deals (lat, lng) WHERE lat IS NOT NULL;
