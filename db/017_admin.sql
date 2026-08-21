-- 017: the admin dashboard's two missing pieces — product events, and a plan
-- column that anyone can actually change.
--
-- Until now there were exactly two ways to learn anything about the product:
-- read the notification run log, or query the tables by hand. Neither answers
-- the question that decides what gets built next — how many people reached the
-- pricing table and tried to pay. That signal is mostly produced by *signed-out*
-- visitors, so it cannot live on a per-user row.
--
-- The plan half: PRO has been granted by NOTIFY_PRO_USER_IDS, an environment
-- variable. An env var cannot be changed without a redeploy, is invisible from
-- the app, and disagrees silently with user_contacts.tier — which already
-- existed and is what every read actually uses. From here the column is the
-- source of truth and the dashboard is how it is set; the env var survives only
-- as a one-way bootstrap (see syncLegacyProGrants).

-- ---------- PRODUCT EVENTS ----------
-- Deliberately one wide table rather than a table per funnel step: the schema
-- of a funnel changes every time the product does, and a migration per question
-- is how analytics stops being asked.
CREATE TABLE IF NOT EXISTS app_events (
  id            bigserial PRIMARY KEY,
  name          text NOT NULL,

  -- Who, as far as we can tell. Both are nullable and usually only one is set:
  -- a signed-out visitor has an anon_id from their own browser, a signed-in one
  -- has a Clerk id. No IP address is stored — it is the one identifier the
  -- visitor cannot clear, and nothing here needs it once rate limiting has run.
  clerk_user_id text,
  anon_id       text,

  path          text,
  props         jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Collapses repeats of the same event by the same subject inside a short
  -- window. A double-clicked button, a remounted panel in React strict mode and
  -- a retried beacon are all the same intention, and counting them three times
  -- overstates the exact number the pricing decision rests on. It is a hash of
  -- (name, subject, time bucket), so it carries no identifier of its own.
  dedupe_key    text,

  created_at    timestamptz NOT NULL DEFAULT now()
);

-- The dedup rule itself. Partial, so events that opt out of deduplication
-- (dedupe_key NULL) are never collapsed against each other.
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_events_dedupe
  ON app_events (dedupe_key) WHERE dedupe_key IS NOT NULL;

-- Every dashboard query is "this event, over this window".
CREATE INDEX IF NOT EXISTS idx_app_events_name_time ON app_events (name, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_time      ON app_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_events_user      ON app_events (clerk_user_id)
  WHERE clerk_user_id IS NOT NULL;

COMMENT ON TABLE app_events IS
  'Product events, written by POST /api/events. Open to signed-out visitors on purpose: the upgrade click we most need to count happens before anyone has an account.';

-- ---------- PLAN PROVENANCE ----------
-- tier already exists (011). What was missing is *why* it says what it says,
-- without which the legacy env grant and an admin decision are indistinguishable
-- and the bootstrap would keep overwriting the human.
ALTER TABLE user_contacts
  ADD COLUMN IF NOT EXISTS tier_source text NOT NULL DEFAULT 'default'
    CHECK (tier_source IN ('default', 'admin', 'legacy_env', 'billing')),
  ADD COLUMN IF NOT EXISTS tier_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS tier_set_by text,
  ADD COLUMN IF NOT EXISTS tier_note text;

COMMENT ON COLUMN user_contacts.tier_source IS
  'default = never set; admin = set from the dashboard (wins over everything); legacy_env = bootstrapped from NOTIFY_PRO_USER_IDS, deprecated; billing = set by the payment provider, once billing is live.';

-- ---------- ADMIN AUDIT ----------
-- Small, but the one thing that must not be reconstructible only from memory:
-- granting PRO is giving away the product, and "who did that, and when" should
-- outlive the session that did it.
CREATE TABLE IF NOT EXISTS admin_audit (
  id            bigserial PRIMARY KEY,
  actor_id      text NOT NULL,           -- the admin's Clerk id
  action        text NOT NULL,           -- e.g. 'tier.set', 'delivery.retry'
  subject       text,                    -- who/what it was done to
  detail        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_audit_time ON admin_audit (created_at DESC);
