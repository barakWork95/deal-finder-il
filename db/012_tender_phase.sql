-- 012: when a tender opens for bidding, not just when it closes.
--
-- רמ"י publishes a tender (PirsumDate), opens it for submissions later
-- (PtichaDate), and closes it (SgiraDate). We only ever stored the closing
-- date, so a tender that opens in three weeks looked identical to one you can
-- bid on today — 150 of 335 active tenders were showing a countdown to a
-- deadline nobody could act on yet.
--
-- "טרם החל" is not a status רמ"י publishes. Its extended status table is
-- 1 מפורסם · 2 פתוח להגשת הצעות · 3 טרם הוכרזו זוכים · 4 נדחה/מוקפא ·
-- 5 נדון · 7 בוטל. The label is derived: status 1 with a PtichaDate in the
-- future. In the live feed that correspondence is exact — every status-1
-- tender opens in the future, every status-2 one is already open.
--
-- NOTE ON `deals.status`: deliberately untouched. That column is OUR lifecycle
-- (active/expired/sold/withdrawn) and every read filters `status = 'active'`.
-- Adding a phase value there would drop these tenders out of the feed, the map
-- and saved deals in one move. The phase is a separate fact, and it is derived
-- at read time (src/lib/tender-phase.ts) rather than stored — a stored phase
-- would be wrong the moment PtichaDate passes, with nothing to recompute it.

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS submission_opens_at timestamptz,
  -- Raw StatusMichraz, kept as reported. Storing the source's own code means a
  -- later question about מוקפא/נדחה tenders can be answered from the database
  -- instead of a re-ingest.
  ADD COLUMN IF NOT EXISTS source_status      smallint;

-- Feed sorting and the "opens soon" filter both order by this.
CREATE INDEX IF NOT EXISTS idx_deals_opens_at
  ON deals (submission_opens_at)
  WHERE status = 'active';

COMMENT ON COLUMN deals.submission_opens_at IS
  'PtichaDate — when bidding opens. NULL for sources that have no such concept.';
COMMENT ON COLUMN deals.source_status IS
  'רמ"י StatusMichraz as reported: 1 מפורסם, 2 פתוח להגשת הצעות, 3 טרם הוכרזו זוכים, 4 נדחה/מוקפא, 5 נדון, 7 בוטל.';
