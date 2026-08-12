-- ============================================================
-- Deal Finder IL — core schema (Supabase / Postgres compatible)
-- Hebrew text = TEXT (UTF-8). Money = NUMERIC. Coordinates as
-- double precision + earthdistance for portable metric proximity.
-- On Supabase, additionally run 003_postgis.sql to enable native
-- PostGIS geometry (ST_DWithin) — the app works either way.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy address matching / dedup
CREATE EXTENSION IF NOT EXISTS unaccent;  -- niqqud-insensitive search
CREATE EXTENSION IF NOT EXISTS cube;      -- required by earthdistance
CREATE EXTENSION IF NOT EXISTS earthdistance; -- earth_distance() in metres

-- ---------- SOURCES ----------
CREATE TABLE IF NOT EXISTS sources (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text NOT NULL,
  source_type     text NOT NULL CHECK (source_type IN
                    ('foreclosure','rami','tax_history','court','off_market','sample')),
  base_url        text,
  is_real         boolean NOT NULL DEFAULT true,  -- provenance flag for the UI
  last_scraped_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- HISTORICAL TRANSACTIONS (comps backbone, נדל"ן-נט) ----------
CREATE TABLE IF NOT EXISTS historical_transactions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id      uuid REFERENCES sources(id),
  external_id    text,                 -- nadlan dealId / objectid
  city           text NOT NULL,
  street         text,
  house_number   text,
  neighborhood   text,
  gush           text,
  helka          text,
  tat_helka      text,
  lat            double precision,
  lng            double precision,
  property_type  text,
  area_sqm       numeric(10,2),
  rooms          numeric(4,1),
  floor          integer,
  sale_price     numeric(14,2) NOT NULL,
  sale_date      date NOT NULL,
  price_per_sqm  numeric(12,2),
  raw_data       jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (external_id)
);

CREATE INDEX IF NOT EXISTS idx_hist_city_street ON historical_transactions (city, street);
CREATE INDEX IF NOT EXISTS idx_hist_gush_helka  ON historical_transactions (gush, helka);
CREATE INDEX IF NOT EXISTS idx_hist_date        ON historical_transactions (sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_hist_earth
  ON historical_transactions USING gist (ll_to_earth(lat, lng))
  WHERE lat IS NOT NULL AND lng IS NOT NULL;

-- ---------- DEALS (canonical opportunity) ----------
CREATE TABLE IF NOT EXISTS deals (
  id                  text PRIMARY KEY,           -- stable slug (e.g. d-001 / nadlan dealId)
  source_id           uuid REFERENCES sources(id),
  source_ref          text,
  deal_type           text NOT NULL CHECK (deal_type IN
                        ('foreclosure','rami_tender','price_drop','inheritance','other')),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN
                        ('active','expired','sold','withdrawn')),

  raw_address         text,
  city                text NOT NULL,
  street              text,
  house_number        text,
  neighborhood        text,
  gush                text,
  helka               text,
  tat_helka           text,
  lat                 double precision,
  lng                 double precision,

  property_type       text,
  area_sqm            numeric(10,2),
  rooms               numeric(4,1),
  floor               integer,

  asking_price        numeric(14,2) NOT NULL,
  submission_deadline timestamptz,

  est_market_value    numeric(14,2),
  discount_pct        numeric(6,2),
  deal_score          numeric(5,2),

  badges              text[] NOT NULL DEFAULT '{}',
  raw_document_url    text,
  fingerprint         text UNIQUE,
  first_seen_at       timestamptz NOT NULL DEFAULT now(),
  last_updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deals_city     ON deals (city);
CREATE INDEX IF NOT EXISTS idx_deals_type     ON deals (deal_type);
CREATE INDEX IF NOT EXISTS idx_deals_score    ON deals (deal_score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_deadline ON deals (submission_deadline);
CREATE INDEX IF NOT EXISTS idx_deals_status   ON deals (status);
-- Note: unaccent() is STABLE and cannot appear in an index expression, so the
-- index uses to_tsvector directly; apply unaccent() to the query string at
-- search time for niqqud-insensitive matching.
CREATE INDEX IF NOT EXISTS idx_deals_fts
  ON deals USING gin (to_tsvector('simple',
      coalesce(raw_address,'') || ' ' || coalesce(city,'') || ' ' ||
      coalesce(gush,'') || ' ' || coalesce(helka,'')));

-- ---------- USERS ----------
CREATE TABLE IF NOT EXISTS users (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text UNIQUE,
  phone       text,
  full_name   text,
  persona     text CHECK (persona IN ('investor','realtor','sourcer','other')),
  tier        text NOT NULL DEFAULT 'free' CHECK (tier IN ('free','basic','pro','business')),
  locale      text NOT NULL DEFAULT 'he',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- ALERTS ----------
CREATE TABLE IF NOT EXISTS alerts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid REFERENCES users(id) ON DELETE CASCADE,
  name              text,
  filters           jsonb NOT NULL,
  channels          text[] NOT NULL DEFAULT '{email}',
  frequency         text NOT NULL DEFAULT 'instant' CHECK (frequency IN ('instant','daily','weekly')),
  is_active         boolean NOT NULL DEFAULT true,
  last_triggered_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_alerts_user ON alerts (user_id);

CREATE TABLE IF NOT EXISTS alert_deliveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id   uuid REFERENCES alerts(id) ON DELETE CASCADE,
  deal_id    text REFERENCES deals(id) ON DELETE CASCADE,
  channel    text,
  status     text NOT NULL DEFAULT 'sent',
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (alert_id, deal_id, channel)
);

CREATE TABLE IF NOT EXISTS user_deal_actions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  deal_id    text REFERENCES deals(id) ON DELETE CASCADE,
  action     text CHECK (action IN ('saved','contacted','dismissed','relevant')),
  note       text,
  created_at timestamptz NOT NULL DEFAULT now()
);
