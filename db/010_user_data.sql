-- 010: per-user data, keyed by the Clerk user id.
--
-- Until sign-in existed, alerts and saved tenders lived only in the visitor's
-- localStorage (src/lib/client-store.ts). These tables are where that data
-- lands on first login (POST /api/user/sync), so it follows the person across
-- devices and can eventually be read by a server-side sender.
--
-- clerk_user_id is text (e.g. "user_2abc..."), not a FK: Clerk owns the user
-- record, this database only references it.

CREATE TABLE IF NOT EXISTS user_alerts (
  id              text PRIMARY KEY,
  clerk_user_id   text NOT NULL,
  name            text NOT NULL,
  filters         jsonb NOT NULL DEFAULT '{}'::jsonb,
  channels        text[] NOT NULL DEFAULT '{}',
  frequency       text NOT NULL DEFAULT 'instant',
  is_active       boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_alerts_user ON user_alerts (clerk_user_id);

CREATE TABLE IF NOT EXISTS user_saved_deals (
  clerk_user_id   text NOT NULL,
  deal_id         text NOT NULL REFERENCES deals (id) ON DELETE CASCADE,
  saved_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clerk_user_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_deals_user ON user_saved_deals (clerk_user_id);
