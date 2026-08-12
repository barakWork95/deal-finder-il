-- ============================================================
-- Land pivot: the platform focuses on plots/tracts (מגרשים וקרקעות).
-- Add zoning (ייעוד) and building rights (זכויות בנייה). Rooms/floors
-- are irrelevant to land and are left nullable / unused.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS zoning          text,   -- ייעוד תכנוני
  ADD COLUMN IF NOT EXISTS building_rights text;   -- זכויות בנייה (free text)

ALTER TABLE historical_transactions
  ADD COLUMN IF NOT EXISTS zoning text;

CREATE INDEX IF NOT EXISTS idx_deals_zoning ON deals (zoning);

-- Allow the land-oriented deal types (adds 'private_sale').
ALTER TABLE deals DROP CONSTRAINT IF EXISTS deals_deal_type_check;
ALTER TABLE deals ADD CONSTRAINT deals_deal_type_check
  CHECK (deal_type IN ('rami_tender','foreclosure','private_sale','inheritance','price_drop','other'));
