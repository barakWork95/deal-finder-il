-- 016: throttle state for operational alerts.
--
-- The pipeline runs hourly. A fault that persists — a portal outage outlasting
-- the retry budget, a bad migration, an expired credential — would otherwise
-- send one WhatsApp per hour until someone notices, and twenty-four identical
-- messages a day is how an alert channel gets muted. A muted ops channel is
-- worse than none, because it looks like coverage.
--
-- One row per alert kind, holding when it last went out.

CREATE TABLE IF NOT EXISTS ops_alerts (
  kind         text PRIMARY KEY,
  last_sent_at timestamptz NOT NULL DEFAULT now(),
  last_text    text,
  -- How many times this kind fired since the last one actually sent, so a
  -- throttled message can say "and 5 more like it".
  suppressed   integer NOT NULL DEFAULT 0
);

COMMENT ON TABLE ops_alerts IS
  'Throttle state for operational alerts (pipeline failures). Not user-facing.';
