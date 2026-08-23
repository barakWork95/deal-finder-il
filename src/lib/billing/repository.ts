import "server-only";
import { sql, hasDb } from "@/lib/db";
import type { PlanTier } from "@/lib/types";

/**
 * Storage for subscriptions and webhook events (db/018_billing.sql).
 *
 * The two rules worth stating up front, because both are about not undoing
 * something a human decided:
 *
 *   1. A paid subscription always wins an *upgrade*. Somebody who paid gets
 *      what they paid for, whatever the row said before.
 *   2. A cancellation only downgrades a plan that billing itself granted. An
 *      account comped from the admin dashboard (tier_source = 'admin') keeps
 *      its plan when an unrelated subscription lapses — revoking a comp
 *      because PayPal sent a cancellation would be the system overruling the
 *      person who runs it.
 */

export type SubscriptionStatus =
  | "CREATED"
  | "APPROVAL_PENDING"
  | "APPROVED"
  | "ACTIVE"
  | "SUSPENDED"
  | "CANCELLED"
  | "EXPIRED";

export type SubscriptionRow = {
  id: string;
  clerkUserId: string;
  status: SubscriptionStatus;
  planId: string | null;
  currency: string | null;
  amount: number | null;
  currentPeriodEnd: string | null;
  lastPaymentAt: string | null;
  cancelledAt: string | null;
  createdAt: string | null;
};

const date = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null;

function mapSubscription(row: Record<string, unknown>): SubscriptionRow {
  return {
    id: String(row.id),
    clerkUserId: String(row.clerk_user_id),
    status: (row.status as SubscriptionStatus) ?? "CREATED",
    planId: (row.plan_id as string) ?? null,
    currency: (row.currency as string) ?? null,
    amount: row.amount == null ? null : Number(row.amount),
    currentPeriodEnd: date(row.current_period_end),
    lastPaymentAt: date(row.last_payment_at),
    cancelledAt: date(row.cancelled_at),
    createdAt: date(row.created_at),
  };
}

// ── Subscriptions ──────────────────────────────────────────

/**
 * Written the moment PayPal hands back a subscription id, before the payer has
 * approved anything. This row — not the webhook payload — is what maps a PayPal
 * subscription to a Clerk user, so the mapping is guaranteed to exist by the
 * time any event about it arrives.
 */
export async function recordSubscription(params: {
  id: string;
  clerkUserId: string;
  planId?: string;
  status?: SubscriptionStatus;
  currency?: string;
  amount?: number;
}): Promise<void> {
  if (!hasDb) return;
  await sql`
    INSERT INTO billing_subscriptions
      (id, clerk_user_id, plan_id, status, currency, amount)
    VALUES (${params.id}, ${params.clerkUserId}, ${params.planId ?? null},
            ${params.status ?? "CREATED"}, ${params.currency ?? null}, ${params.amount ?? null})
    ON CONFLICT (id) DO UPDATE SET
      status     = EXCLUDED.status,
      plan_id    = COALESCE(EXCLUDED.plan_id, billing_subscriptions.plan_id),
      updated_at = now()`;
}

export async function getSubscriptionRow(id: string): Promise<SubscriptionRow | null> {
  if (!hasDb) return null;
  const [row] = await sql`SELECT * FROM billing_subscriptions WHERE id = ${id}`;
  return row ? mapSubscription(row) : null;
}

/** The account's subscriptions, newest first. Used by the billing panel. */
export async function listSubscriptionsForUser(clerkUserId: string): Promise<SubscriptionRow[]> {
  if (!hasDb) return [];
  const rows = await sql`
    SELECT * FROM billing_subscriptions
    WHERE clerk_user_id = ${clerkUserId}
    ORDER BY created_at DESC`;
  return rows.map(mapSubscription);
}

export async function updateSubscription(params: {
  id: string;
  status?: SubscriptionStatus;
  currentPeriodEnd?: string | null;
  lastPaymentAt?: string | null;
  cancelled?: boolean;
}): Promise<void> {
  if (!hasDb) return;
  await sql`
    UPDATE billing_subscriptions SET
      status             = COALESCE(${params.status ?? null}, status),
      current_period_end = COALESCE(${params.currentPeriodEnd ?? null}::timestamptz, current_period_end),
      last_payment_at    = COALESCE(${params.lastPaymentAt ?? null}::timestamptz, last_payment_at),
      cancelled_at       = CASE WHEN ${params.cancelled === true} THEN now() ELSE cancelled_at END,
      updated_at         = now()
    WHERE id = ${params.id}`;
}

// ── The plan column ────────────────────────────────────────

/**
 * Writes a plan that a payment decided.
 *
 * Upgrades are unconditional: the money arrived, the account gets the plan.
 *
 * Downgrades are not. `tier_source <> 'admin'` is the guard — a comped account
 * is a decision a person made in the dashboard, and a lapsed subscription
 * somewhere else in the system is not grounds for reversing it. Everything
 * else (a plan this subscription granted, or a default row) downgrades
 * normally.
 */
export async function applyBillingTier(params: {
  clerkUserId: string;
  tier: PlanTier;
  note: string;
}): Promise<boolean> {
  if (!hasDb) return false;

  if (params.tier === "pro") {
    const rows = await sql`
      INSERT INTO user_contacts (clerk_user_id, tier, tier_source, tier_updated_at, tier_set_by, tier_note)
      VALUES (${params.clerkUserId}, 'pro', 'billing', now(), 'paypal', ${params.note})
      ON CONFLICT (clerk_user_id) DO UPDATE SET
        tier            = 'pro',
        tier_source     = 'billing',
        tier_updated_at = now(),
        tier_set_by     = 'paypal',
        tier_note       = EXCLUDED.tier_note,
        updated_at      = now()
      RETURNING clerk_user_id`;
    return rows.length > 0;
  }

  const rows = await sql`
    UPDATE user_contacts SET
      tier            = 'free',
      tier_source     = 'billing',
      tier_updated_at = now(),
      tier_set_by     = 'paypal',
      tier_note       = ${params.note},
      updated_at      = now()
    WHERE clerk_user_id = ${params.clerkUserId}
      AND tier_source <> 'admin'
    RETURNING clerk_user_id`;
  return rows.length > 0;
}

/**
 * Whether the account still has any live subscription.
 *
 * Asked before a cancellation downgrades anyone: someone can hold two
 * subscriptions (a second device, a retried checkout, an upgrade), and
 * cancelling one of them is not cancelling the plan.
 */
export async function hasActiveSubscription(clerkUserId: string): Promise<boolean> {
  if (!hasDb) return false;
  const [row] = await sql`
    SELECT 1 AS live FROM billing_subscriptions
    WHERE clerk_user_id = ${clerkUserId} AND status = 'ACTIVE' LIMIT 1`;
  return Boolean(row);
}

// ── Webhook idempotency ────────────────────────────────────

/**
 * Claims a webhook event, returning false if it has already been handled.
 *
 * PayPal retries anything it did not get a 200 for, and can redeliver an event
 * regardless — so the handler behind this has to be safe to run twice. Claiming
 * before acting (the same discipline as the notification ledger) turns "safe to
 * run twice" into "only ever runs once": the redelivery loses the INSERT.
 *
 * The one exception is a row left 'failed' by a handler that threw. That claim
 * is handed over again, because PayPal's retry is the recovery path and our own
 * deduplication must not be what swallows it.
 */
export async function claimWebhookEvent(params: {
  id: string;
  eventType: string;
  subscriptionId?: string | null;
  payload: unknown;
}): Promise<boolean> {
  if (!hasDb) return true; // No database: nothing to deduplicate against.
  const rows = await sql`
    INSERT INTO billing_events (id, event_type, subscription_id, payload, status)
    VALUES (${params.id}, ${params.eventType}, ${params.subscriptionId ?? null},
            ${sql.json(params.payload as never)}, 'claimed')
    ON CONFLICT (id) DO UPDATE SET
      status      = 'claimed',
      error       = NULL,
      received_at = now()
    WHERE billing_events.status = 'failed'
    RETURNING id`;
  return rows.length > 0;
}

export async function markWebhookEvent(
  id: string,
  status: "processed" | "ignored" | "failed",
  error?: string,
): Promise<void> {
  if (!hasDb) return;
  await sql`
    UPDATE billing_events SET status = ${status}, error = ${error?.slice(0, 500) ?? null}
    WHERE id = ${id}`;
}
