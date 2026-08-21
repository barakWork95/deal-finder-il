-- 015: per-alert control over the "it opens tomorrow" message.
--
-- The opening pass currently applies to every PRO instant alert, with no way
-- to decline it. That is a reasonable default — roughly 150 of 355 active
-- tenders are טרם החל, so without it the discovery alert is often the only
-- word you get, weeks before you can act — but it is the second message a
-- tender can produce, and a second message is exactly the kind of thing
-- people want a switch for.
--
-- Defaults to true so existing alerts keep the behaviour they already have.

ALTER TABLE user_alerts
  ADD COLUMN IF NOT EXISTS notify_on_open boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN user_alerts.notify_on_open IS
  'Send a second message when a matching טרם החל tender opens for bidding.';
