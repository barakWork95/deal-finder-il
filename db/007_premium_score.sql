-- ============================================================
-- Materialise the winning-premium signal onto deals and fold it into the
-- Deal Score.
--
-- Rationale: a tender is attractive only if the price a bidder will REALISTICALLY
-- pay (minimum bid grown by the local winning premium, plus development costs)
-- still lands below the official שומה. The raw minimum-vs-שומה gap flatters
-- every tender equally and is not a ranking signal.
-- ============================================================

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS winning_premium        numeric(8,3),
  ADD COLUMN IF NOT EXISTS winning_premium_n      integer,
  ADD COLUMN IF NOT EXISTS expected_winning_price numeric(14,2),
  ADD COLUMN IF NOT EXISTS expected_gap_pct       numeric(6,2);

-- n must describe the SAME population the premium came from: if the
-- zoning-specific premium was too thin and we fell back to the whole city,
-- report the city-wide count, not the zoning count.
WITH sig AS (
  SELECT
    d.id,
    COALESCE(winning_premium(d.city, d.zoning), winning_premium(d.city, NULL)) AS prem,
    CASE
      WHEN winning_premium(d.city, d.zoning) IS NOT NULL
        THEN winning_premium_n(d.city, d.zoning)
      ELSE winning_premium_n(d.city, NULL)
    END AS n
  FROM deals d
  WHERE d.deal_type = 'rami_tender'
)
UPDATE deals d SET
  winning_premium   = sig.prem,
  winning_premium_n = sig.n,
  expected_winning_price = CASE
    WHEN sig.prem IS NULL THEN NULL
    ELSE round(COALESCE(d.min_bid, d.asking_price) * (1 + sig.prem) + COALESCE(d.development_costs, 0))
  END
FROM sig
WHERE d.id = sig.id;

-- Gap of the EXPECTED winning price against the appraisal (positive = still below).
UPDATE deals SET
  expected_gap_pct = CASE
    WHEN expected_winning_price IS NULL OR est_market_value IS NULL OR est_market_value <= 0 THEN NULL
    ELSE round(((est_market_value - expected_winning_price) / est_market_value) * 100, 2)
  END;

-- Fold into the Deal Score: reward tenders that still clear the appraisal
-- after a realistic winning premium, penalise those that clearly won't.
-- Guarded by premium_scored so re-running this file never double-applies.
ALTER TABLE deals ADD COLUMN IF NOT EXISTS premium_scored boolean NOT NULL DEFAULT false;

UPDATE deals SET
  deal_score = GREATEST(0, LEAST(99, deal_score +
    CASE
      WHEN expected_gap_pct IS NULL      THEN 0    -- no signal, leave as-is
      WHEN expected_gap_pct >= 25        THEN 14
      WHEN expected_gap_pct >= 0         THEN 7
      WHEN expected_gap_pct >= -25       THEN -6
      ELSE -14
    END)),
  premium_scored = true
WHERE deal_type = 'rami_tender' AND NOT premium_scored;

CREATE INDEX IF NOT EXISTS idx_deals_expected_gap ON deals (expected_gap_pct DESC);
