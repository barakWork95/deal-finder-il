-- 013: remember which רמ"י tenders we have already examined.
--
-- The hourly pipeline only wants to spend a detail call on a tender that is
-- new or has changed. The obvious test — "is it in `deals`?" — is wrong: most
-- active tenders legitimately produce no rows there. They are apartment
-- tenders, or have no minimum price, or carry an aggregate 26,000-dunam area
-- the ingester rejects as not a real parcel. Of ~470 active tenders only 94
-- yield land plots.
--
-- Judging by `deals` alone, those other ~376 are permanently "new" and get a
-- detail fetch every hour forever — 9,000 requests a day at a government
-- portal, which is the load the hourly/nightly split exists to avoid.
--
-- So we record the examination, not the outcome. `plots = 0` is a real answer
-- and worth remembering.

CREATE TABLE IF NOT EXISTS rami_tenders_seen (
  michraz_id     text PRIMARY KEY,
  -- StatusMichraz at the time we looked. A tender crossing 1 → 2
  -- (טרם החל → פתוח להגשה) is worth re-fetching; an unchanged one is not.
  source_status  smallint,
  sgira_date     timestamptz,
  -- How many usable land plots it produced. 0 means "examined, nothing for
  -- us" — which is exactly the fact that stops the re-fetch loop.
  plots          integer NOT NULL DEFAULT 0,
  checked_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rami_seen_checked ON rami_tenders_seen (checked_at DESC);

-- Backfill from what we already hold, so the first incremental run after this
-- migration does not re-examine the 94 tenders we demonstrably know about.
INSERT INTO rami_tenders_seen (michraz_id, source_status, plots, checked_at)
SELECT split_part(id, '-', 2), max(source_status), count(*), max(last_updated_at)
FROM deals
WHERE id LIKE 'rami-%'
GROUP BY 1
ON CONFLICT (michraz_id) DO NOTHING;
