-- ============================================================
-- Make the premium scoring RE-RUNNABLE as comps keep arriving.
--
-- Bug in 007: the adjustment was guarded by a boolean (premium_scored) set on
-- every rami_tender row — including rows that had NO signal at the time and so
-- received no adjustment. Once comps arrive and those tenders gain a premium,
-- the guard would (correctly) refuse to double-apply, but would also (wrongly)
-- never apply the first adjustment at all.
--
-- Fix: remember the delta actually applied. Each refresh subtracts the previous
-- delta and adds the current one, so the file is idempotent AND keeps up with
-- new data.
-- ============================================================

ALTER TABLE deals ADD COLUMN IF NOT EXISTS premium_score_delta integer NOT NULL DEFAULT 0;

-- One-time reconciliation: reconstruct what 007 already applied. The stored
-- expected_gap_pct still reflects the value that drove it (the signal has not
-- been recomputed since), so the same CASE reproduces the delta.
UPDATE deals SET premium_score_delta =
  CASE
    WHEN expected_gap_pct IS NULL THEN 0
    WHEN expected_gap_pct >= 25   THEN 14
    WHEN expected_gap_pct >= 0    THEN 7
    WHEN expected_gap_pct >= -25  THEN -6
    ELSE -14
  END
WHERE deal_type = 'rami_tender' AND premium_scored AND premium_score_delta = 0;

-- ---- refresh the signal from the current comps ----
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

UPDATE deals SET
  expected_gap_pct = CASE
    WHEN expected_winning_price IS NULL OR est_market_value IS NULL OR est_market_value <= 0 THEN NULL
    ELSE round(((est_market_value - expected_winning_price) / est_market_value) * 100, 2)
  END
WHERE deal_type = 'rami_tender';

-- ---- re-apply the score adjustment as a replaceable delta ----
WITH d2 AS (
  SELECT id,
    CASE
      WHEN expected_gap_pct IS NULL THEN 0
      WHEN expected_gap_pct >= 25   THEN 14
      WHEN expected_gap_pct >= 0    THEN 7
      WHEN expected_gap_pct >= -25  THEN -6
      ELSE -14
    END AS new_delta
  FROM deals WHERE deal_type = 'rami_tender'
)
UPDATE deals d SET
  deal_score = GREATEST(0, LEAST(99, d.deal_score - d.premium_score_delta + d2.new_delta)),
  premium_score_delta = d2.new_delta,
  premium_scored = true
FROM d2
WHERE d.id = d2.id;
