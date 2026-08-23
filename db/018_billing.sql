-- 018: PayPal subscriptions.
--
-- Until now `user_contacts.tier` was set by hand from the admin dashboard, and
-- 011's comment said outright that this column "is where the plan will land"
-- once billing existed. This is that. The dashboard keeps its toggle — a
-- comped account is a real thing — but from here a paid subscription can write
-- the column too, and `tier_source` is what tells the two apart.
--
-- Two tables, and the second one is the important one.

-- ---------- WHAT SOMEONE IS PAYING FOR ----------
--
-- The row is written when the subscription is CREATED, before the payer has
-- approved anything. That ordering is the whole point: it means the mapping
-- from PayPal's subscription id to our Clerk user id exists in our database
-- before any webhook can arrive. PayPal does echo a `custom_id` back, but the
-- exact field varies by event type (BILLING.SUBSCRIPTION.* carry custom_id,
-- PAYMENT.SALE.COMPLETED identifies the subscription as billing_agreement_id),
-- and a payload shape is a poor thing to hang account upgrades on. We look the
-- subscription up in our own table instead, and treat custom_id as a hint.
CREATE TABLE IF NOT EXISTS billing_subscriptions (
  -- PayPal's subscription id (I-XXXXXXXXXXXX).
  id                 text PRIMARY KEY,
  provider           text NOT NULL DEFAULT 'paypal' CHECK (provider IN ('paypal')),
  clerk_user_id      text NOT NULL,
  plan_id            text,

  -- Mirrors PayPal's own vocabulary rather than inventing ours, so a support
  -- question can be answered by comparing this column with their dashboard.
  status             text NOT NULL DEFAULT 'CREATED'
                       CHECK (status IN ('CREATED','APPROVAL_PENDING','APPROVED','ACTIVE',
                                         'SUSPENDED','CANCELLED','EXPIRED')),

  -- ILS does not support decimals at PayPal ("if you pass a decimal amount, an
  -- error occurs"), so the plan is priced in whole shekels. Stored as numeric
  -- anyway: the currency is configurable and the next one may have cents.
  currency           text,
  amount             numeric(12,2),

  current_period_end timestamptz,
  last_payment_at    timestamptz,
  cancelled_at       timestamptz,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_subs_user   ON billing_subscriptions (clerk_user_id);
CREATE INDEX IF NOT EXISTS idx_billing_subs_status ON billing_subscriptions (status);

-- ---------- WHAT PAYPAL HAS TOLD US ----------
--
-- The idempotency ledger, and the same discipline as notification_deliveries:
-- claim the row before acting on it. PayPal retries a webhook it did not get a
-- 200 for, and it can deliver the same event more than once regardless — so
-- "grant PRO" has to be safe to receive twice. The event id is the primary
-- key, so the second delivery loses the INSERT and does nothing.
CREATE TABLE IF NOT EXISTS billing_events (
  -- PayPal's event id (WH-XXXXXXXX-XXXXXXXX).
  id              text PRIMARY KEY,
  event_type      text NOT NULL,
  subscription_id text,
  -- 'claimed' = taken by a handler that has not finished, 'processed' = acted
  -- on, 'ignored' = a type we do not act on (kept so an unexpected event is
  -- visible rather than silently dropped), 'failed' = verified and understood
  -- but the handler threw.
  --
  -- 'failed' is deliberately re-claimable. Claiming before acting is what stops
  -- a redelivered event granting PRO twice — but if the claim outlived a
  -- handler that crashed, PayPal's retry (which is the recovery mechanism)
  -- would be swallowed by our own deduplication. So the claim is only final
  -- once the handler says so.
  status          text NOT NULL DEFAULT 'claimed'
                    CHECK (status IN ('claimed','processed','ignored','failed')),
  error           text,
  -- Kept for forensics: a disputed upgrade is answered by the payload that
  -- caused it, not by a reconstruction.
  payload         jsonb,
  received_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_events_time ON billing_events (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_billing_events_sub  ON billing_events (subscription_id);

COMMENT ON TABLE billing_events IS
  'Webhook idempotency ledger. The event id is the PK, so a redelivered PayPal event cannot grant PRO twice.';
