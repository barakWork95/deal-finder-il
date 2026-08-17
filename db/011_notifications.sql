-- 011: notification delivery (email + WhatsApp).
--
-- Until now nothing was ever sent: alerts were only a saved filter, and the
-- personal area said so outright. This migration adds the three things a
-- sender needs that the app did not have.
--
--   user_contacts           where to send, and on whose plan
--   notification_deliveries what has already been sent (the dedup ledger)
--   notification_runs       what the worker did, per invocation
--
-- Note on the legacy tables: 001_schema.sql already carries `alerts` and
-- `alert_deliveries`, keyed by a uuid `users.id`. That design predates Clerk
-- and was superseded by `user_alerts` (010), which is keyed by the Clerk user
-- id and is what the app actually writes. The ledger below therefore hangs off
-- user_alerts; the 001 tables are left untouched and unused.

-- ---------- WHERE TO SEND ----------
CREATE TABLE IF NOT EXISTS user_contacts (
  clerk_user_id     text PRIMARY KEY,
  email             text,
  -- E.164, normalised on write (0501234567 -> +972501234567). WhatsApp
  -- providers reject anything else, so the app never stores the local form.
  phone_e164        text,
  full_name         text,

  -- Billing is not live (the pricing table says so). This column is where the
  -- plan will land; until then everyone is 'free' unless granted PRO by hand
  -- or through NOTIFY_PRO_USER_IDS.
  tier              text NOT NULL DEFAULT 'free' CHECK (tier IN ('free','pro')),

  email_opt_in      boolean NOT NULL DEFAULT true,
  -- WhatsApp is opt-in on its own: an address someone typed for email is not
  -- consent to message their phone.
  whatsapp_opt_in   boolean NOT NULL DEFAULT false,
  unsubscribed_at   timestamptz,
  -- Lets the unsubscribe link work without a session (people read mail on
  -- devices they are not signed in on). Random hex, no pgcrypto dependency.
  unsubscribe_token text NOT NULL DEFAULT md5(random()::text || clock_timestamp()::text),

  -- Digest scheduling. The worker compares against last_digest_at rather than
  -- trusting the cron to fire exactly once a day.
  digest_hour       smallint NOT NULL DEFAULT 8 CHECK (digest_hour BETWEEN 0 AND 23),
  timezone          text NOT NULL DEFAULT 'Asia/Jerusalem',
  last_digest_at    timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_contacts_unsub
  ON user_contacts (unsubscribe_token);

-- ---------- WHAT WAS ALREADY SENT ----------
-- The primary key IS the deduplication rule: one message per alert, per
-- tender, per channel, forever. Two overlapping cron runs cannot both send,
-- because claiming a row is an INSERT that the second one loses.
CREATE TABLE IF NOT EXISTS notification_deliveries (
  alert_id            text NOT NULL REFERENCES user_alerts (id) ON DELETE CASCADE,
  deal_id             text NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  channel             text NOT NULL CHECK (channel IN ('email','whatsapp')),
  clerk_user_id       text NOT NULL,

  status              text NOT NULL DEFAULT 'queued'
                        CHECK (status IN ('queued','sent','failed','skipped')),
  attempts            smallint NOT NULL DEFAULT 1,
  -- Whether a later run should try again. A 429 or a 5xx is worth repeating;
  -- a rejected API key or a malformed address will fail identically forever,
  -- and retrying it just burns the attempt budget and the log.
  retryable           boolean NOT NULL DEFAULT true,
  provider            text,
  provider_message_id text,
  error               text,

  queued_at           timestamptz NOT NULL DEFAULT now(),
  sent_at             timestamptz,

  PRIMARY KEY (alert_id, deal_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_deliveries_user   ON notification_deliveries (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON notification_deliveries (status, queued_at DESC);

-- ---------- WHAT THE WORKER DID ----------
-- Cheap observability: a cron that silently sends nothing looks exactly like a
-- cron that is not running at all.
CREATE TABLE IF NOT EXISTS notification_runs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mode         text NOT NULL CHECK (mode IN ('instant','digest')),
  dry_run      boolean NOT NULL DEFAULT false,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  candidates   integer NOT NULL DEFAULT 0,  -- new tenders considered
  matched      integer NOT NULL DEFAULT 0,  -- (alert, tender) pairs that matched
  sent         integer NOT NULL DEFAULT 0,
  failed       integer NOT NULL DEFAULT 0,
  skipped      integer NOT NULL DEFAULT 0,
  error        text
);

CREATE INDEX IF NOT EXISTS idx_notification_runs_started
  ON notification_runs (started_at DESC);
