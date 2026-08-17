-- 014: let one tender be worth two messages.
--
-- The ledger's primary key was (alert_id, deal_id, channel): one message per
-- alert, per tender, per channel, forever. That was the right guarantee while
-- the only reason to write was "we found something new" — it is what makes an
-- over-eager cron harmless.
--
-- Tender phases gave us a second, genuinely different reason. Roughly half the
-- feed is טרם החל: published, not yet open for bids. Someone told about such a
-- tender on Monday gets no further word when it actually becomes biddable on
-- Thursday — which is the moment they can act, and the one worth interrupting
-- them for.
--
-- So the key gains a `reason`. 'new' is the discovery message, 'opening' is
-- the one sent as bidding starts. Two messages maximum per alert/tender/
-- channel, and the dedup guarantee is otherwise unchanged: a run that repeats
-- still cannot re-send either of them.

ALTER TABLE notification_deliveries
  ADD COLUMN IF NOT EXISTS reason text NOT NULL DEFAULT 'new'
    CHECK (reason IN ('new', 'opening'));

-- Swap the primary key. Existing rows all default to 'new', which is exactly
-- what they were, so no row changes meaning.
ALTER TABLE notification_deliveries
  DROP CONSTRAINT IF EXISTS notification_deliveries_pkey;

ALTER TABLE notification_deliveries
  ADD CONSTRAINT notification_deliveries_pkey
  PRIMARY KEY (alert_id, deal_id, channel, reason);

COMMENT ON COLUMN notification_deliveries.reason IS
  'Why this message was sent: new = first sighting, opening = bidding is about to open (טרם החל → פתוח).';

-- The run log records which pass produced it.
ALTER TABLE notification_runs DROP CONSTRAINT IF EXISTS notification_runs_mode_check;
ALTER TABLE notification_runs
  ADD CONSTRAINT notification_runs_mode_check CHECK (mode IN ('instant', 'digest', 'opening'));
