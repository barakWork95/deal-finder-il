-- ============================================================
-- Winning-premium signal.
--
-- RMI minimum bids are low anchors: across ~2,000 decided tenders the MEDIAN
-- winning bid came in ~+369% above the minimum. So a tender's headline gap vs
-- the שומה is not what a bidder will actually pay. This adds:
--   * deals.min_bid / deals.development_costs — the two components of the
--     entry cost, kept separate so the premium applies to the bid alone.
--   * winning_premium(city, zoning, months) — median historical premium,
--     derived from comps that store their own minBid in raw_data.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS min_bid           numeric(14,2),
  ADD COLUMN IF NOT EXISTS development_costs numeric(14,2);

-- Backfill from the text already captured in building_rights, e.g.
--   "יח״ד: 6 · הוצאות פיתוח: ₪1,437,510 · מחיר מינימום: ₪1,665,381"
-- (ingest-rami also writes these columns directly going forward).
UPDATE deals SET
  min_bid = NULLIF(replace((regexp_match(building_rights, 'מחיר מינימום: ₪([0-9,]+)'))[1], ',', ''), '')::numeric
WHERE min_bid IS NULL AND building_rights LIKE '%מחיר מינימום%';

UPDATE deals SET
  development_costs = NULLIF(replace((regexp_match(building_rights, 'הוצאות פיתוח: ₪([0-9,]+)'))[1], ',', ''), '')::numeric
WHERE development_costs IS NULL AND building_rights LIKE '%הוצאות פיתוח%';

-- Anything left without a split: the whole entry cost was the bid.
UPDATE deals SET min_bid = asking_price
WHERE min_bid IS NULL AND deal_type = 'rami_tender';
UPDATE deals SET development_costs = 0 WHERE development_costs IS NULL;

-- Median winning premium (as a ratio, e.g. 3.69 = +369%) for a city+zoning.
-- Falls back to the whole city when a zoning has too few observations.
CREATE OR REPLACE FUNCTION winning_premium(
  p_city   text,
  p_zoning text DEFAULT NULL,
  p_months int DEFAULT 240,
  p_min_n  int DEFAULT 4
)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  WITH obs AS (
    SELECT (sale_price - (raw_data->>'minBid')::numeric)
           / NULLIF((raw_data->>'minBid')::numeric, 0) AS premium
    FROM historical_transactions
    WHERE city = p_city
      AND zoning IS NOT NULL
      AND (p_zoning IS NULL OR zoning = p_zoning)
      AND raw_data ? 'minBid'
      AND (raw_data->>'minBid')::numeric > 0
      AND sale_date > (now() - make_interval(months => p_months))
  )
  SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY premium)::numeric, 3)
  FROM obs
  HAVING count(*) >= p_min_n;
$$;

-- How many observations back a given premium (so the UI can show confidence).
CREATE OR REPLACE FUNCTION winning_premium_n(
  p_city   text,
  p_zoning text DEFAULT NULL,
  p_months int DEFAULT 240
)
RETURNS int
LANGUAGE sql STABLE AS $$
  SELECT count(*)::int
  FROM historical_transactions
  WHERE city = p_city
    AND zoning IS NOT NULL
    AND (p_zoning IS NULL OR zoning = p_zoning)
    AND raw_data ? 'minBid'
    AND (raw_data->>'minBid')::numeric > 0
    AND sale_date > (now() - make_interval(months => p_months));
$$;
