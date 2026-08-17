import "server-only";
import { sql, hasDb } from "@/lib/db";
import { toE164 } from "@/lib/phone";
import type { Alert, AlertChannel, AlertFrequency } from "@/lib/types";
import type { SendOutcome } from "./types";

/**
 * Storage for the notification engine (db/011_notifications.sql).
 *
 * The important piece here is `claimDeliveries`. Sending is not idempotent —
 * a retried cron run must not re-send yesterday's tenders — so the ledger row
 * is written *before* the provider is called, in a statement that a second
 * concurrent run loses. Whoever gets the row owns the send.
 */

export type Tier = "free" | "pro";

export type Recipient = {
  clerkUserId: string;
  email?: string;
  phone?: string;
  tier: Tier;
  emailOptIn: boolean;
  whatsappOptIn: boolean;
  unsubscribed: boolean;
  unsubscribeToken?: string;
  lastDigestAt?: Date;
  alerts: Alert[];
};

export type ContactInput = {
  email?: string | null;
  phone?: string | null;
  fullName?: string | null;
  whatsappOptIn?: boolean;
};

// ── Contacts ───────────────────────────────────────────────

/**
 * Fields left `undefined` keep their stored value; a field sent as an empty
 * string is an erasure the person actually asked for (they cleared the box).
 * A phone that does not normalise is treated as no change rather than stored
 * as junk the worker would later try to message — the account form validates
 * before it ever gets here.
 */
export async function upsertContact(clerkUserId: string, input: ContactInput): Promise<void> {
  if (!hasDb) return;

  const clearPhone = input.phone != null && input.phone.trim() === "";
  const clearEmail = input.email != null && input.email.trim() === "";

  const phone = input.phone ? toE164(input.phone) : null;
  const email = input.email?.trim() || null;
  const fullName = input.fullName?.trim() || null;
  const optIn = input.whatsappOptIn ?? Boolean(phone);

  await sql`
    INSERT INTO user_contacts (clerk_user_id, email, phone_e164, full_name, whatsapp_opt_in)
    VALUES (${clerkUserId}, ${email}, ${phone}, ${fullName}, ${optIn})
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      email           = CASE WHEN ${clearEmail} THEN NULL
                             ELSE COALESCE(EXCLUDED.email, user_contacts.email) END,
      phone_e164      = CASE WHEN ${clearPhone} THEN NULL
                             ELSE COALESCE(EXCLUDED.phone_e164, user_contacts.phone_e164) END,
      full_name       = COALESCE(EXCLUDED.full_name, user_contacts.full_name),
      whatsapp_opt_in = EXCLUDED.whatsapp_opt_in,
      updated_at      = now()`;
}

export async function getContact(clerkUserId: string): Promise<Recipient | null> {
  if (!hasDb) return null;
  const [row] = await sql`
    SELECT * FROM user_contacts WHERE clerk_user_id = ${clerkUserId}`;
  return row ? mapContact(row) : null;
}

function mapContact(row: Record<string, unknown>): Recipient {
  return {
    clerkUserId: String(row.clerk_user_id),
    email: (row.email as string) ?? undefined,
    phone: (row.phone_e164 as string) ?? undefined,
    tier: (row.tier as Tier) ?? "free",
    emailOptIn: row.email_opt_in !== false,
    whatsappOptIn: row.whatsapp_opt_in === true,
    unsubscribed: row.unsubscribed_at != null,
    unsubscribeToken: (row.unsubscribe_token as string) ?? undefined,
    lastDigestAt: (row.last_digest_at as Date) ?? undefined,
    alerts: [],
  };
}

/** One-click unsubscribe from a mailed link — no session required. */
export async function unsubscribeByToken(token: string): Promise<boolean> {
  if (!hasDb) return false;
  const rows = await sql`
    UPDATE user_contacts
    SET unsubscribed_at = now(), email_opt_in = false, whatsapp_opt_in = false, updated_at = now()
    WHERE unsubscribe_token = ${token} AND unsubscribed_at IS NULL
    RETURNING clerk_user_id`;
  return rows.length > 0;
}

export async function setLastDigestAt(clerkUserId: string, at: Date): Promise<void> {
  if (!hasDb) return;
  await sql`
    UPDATE user_contacts SET last_digest_at = ${at}, updated_at = now()
    WHERE clerk_user_id = ${clerkUserId}`;
}

/**
 * Contact rows are created lazily: someone can have alerts long before they
 * ever open the account form. The worker calls this so a Clerk-sourced email
 * still gets an unsubscribe token and a place to record last_digest_at.
 */
export async function ensureContact(clerkUserId: string, email?: string): Promise<Recipient | null> {
  if (!hasDb) return null;
  await sql`
    INSERT INTO user_contacts (clerk_user_id, email)
    VALUES (${clerkUserId}, ${email ?? null})
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      email = COALESCE(user_contacts.email, EXCLUDED.email)`;
  return getContact(clerkUserId);
}

// ── Recipients (active alerts + where to send them) ────────

/**
 * Every active alert in the system, grouped by the person who owns it.
 *
 * Deliberately one query with no per-user round trip: the alert table is small
 * (one row per saved filter) and the worker needs all of it anyway to match
 * against the new tenders it already loaded.
 */
export async function listRecipients(): Promise<Recipient[]> {
  if (!hasDb) return [];

  const rows = await sql`
    SELECT
      ua.id, ua.clerk_user_id, ua.name, ua.filters, ua.channels, ua.frequency,
      uc.email, uc.phone_e164, uc.tier, uc.email_opt_in, uc.whatsapp_opt_in,
      uc.unsubscribed_at, uc.unsubscribe_token, uc.last_digest_at
    FROM user_alerts ua
    LEFT JOIN user_contacts uc ON uc.clerk_user_id = ua.clerk_user_id
    WHERE ua.is_active = true
    ORDER BY ua.clerk_user_id, ua.created_at`;

  const byUser = new Map<string, Recipient>();

  for (const row of rows) {
    const userId = String(row.clerk_user_id);
    let recipient = byUser.get(userId);
    if (!recipient) {
      recipient = mapContact({ ...row, clerk_user_id: userId, phone_e164: row.phone_e164 });
      byUser.set(userId, recipient);
    }
    recipient.alerts.push({
      id: String(row.id),
      name: String(row.name ?? "התראה"),
      filters: (row.filters ?? {}) as Alert["filters"],
      channels: ((row.channels as string[]) ?? []) as AlertChannel[],
      frequency: (row.frequency as AlertFrequency) ?? "instant",
      isActive: true,
      triggeredThisMonth: 0,
    });
  }

  return [...byUser.values()];
}

// ── The delivery ledger ────────────────────────────────────

/**
 * Reserves (alert, deal, channel) rows and returns only the ones this caller
 * won. Rows that already exist as 'sent' or 'queued' come back empty-handed;
 * a previously 'failed' row is handed over again only while it is still marked
 * retryable and has attempts left — a rejected API key fails the same way on
 * every run, so repeating it would just spend the budget.
 */
export async function claimDeliveries(params: {
  alertId: string;
  clerkUserId: string;
  channel: AlertChannel;
  dealIds: string[];
  maxAttempts: number;
}): Promise<string[]> {
  if (!hasDb || params.dealIds.length === 0) return [];

  const rows = await sql`
    INSERT INTO notification_deliveries (alert_id, deal_id, channel, clerk_user_id, status, attempts)
    SELECT ${params.alertId}, d, ${params.channel}, ${params.clerkUserId}, 'queued', 1
    FROM unnest(${params.dealIds}::text[]) AS d
    ON CONFLICT (alert_id, deal_id, channel) DO UPDATE SET
      status    = 'queued',
      attempts  = notification_deliveries.attempts + 1,
      queued_at = now(),
      error     = NULL
    WHERE notification_deliveries.status = 'failed'
      AND notification_deliveries.retryable = true
      AND notification_deliveries.attempts < ${params.maxAttempts}
    RETURNING deal_id`;

  return rows.map((r) => String(r.deal_id));
}

/** Writes the provider's verdict onto the rows claimed above. */
export async function markDeliveries(params: {
  alertId: string;
  channel: AlertChannel;
  dealIds: string[];
  outcome: SendOutcome;
}): Promise<void> {
  if (!hasDb || params.dealIds.length === 0) return;
  const { outcome } = params;

  await sql`
    UPDATE notification_deliveries SET
      status              = ${outcome.status},
      provider            = ${outcome.provider},
      provider_message_id = ${outcome.id ?? null},
      error               = ${outcome.error ?? null},
      retryable           = ${outcome.retryable === true},
      sent_at             = CASE WHEN ${outcome.status} = 'sent' THEN now() ELSE sent_at END
    WHERE alert_id = ${params.alertId}
      AND channel  = ${params.channel}
      AND deal_id  = ANY(${params.dealIds})`;
}

/**
 * Gives a claim back. Used when the send never happened for a reason that may
 * not hold next time — the provider is not configured yet, or the run hit its
 * per-invocation cap. Deleting rather than marking 'skipped' is what lets the
 * tender still go out once the channel is switched on.
 */
export async function releaseDeliveries(params: {
  alertId: string;
  channel: AlertChannel;
  dealIds: string[];
}): Promise<void> {
  if (!hasDb || params.dealIds.length === 0) return;
  await sql`
    DELETE FROM notification_deliveries
    WHERE alert_id = ${params.alertId}
      AND channel  = ${params.channel}
      AND deal_id  = ANY(${params.dealIds})
      AND status   = 'queued'`;
}

// ── Run log ────────────────────────────────────────────────

export async function startRun(mode: "instant" | "digest", dryRun: boolean): Promise<string | null> {
  if (!hasDb) return null;
  const [row] = await sql`
    INSERT INTO notification_runs (mode, dry_run) VALUES (${mode}, ${dryRun}) RETURNING id`;
  return row ? String(row.id) : null;
}

export async function finishRun(
  id: string | null,
  totals: { candidates: number; matched: number; sent: number; failed: number; skipped: number },
  error?: string,
): Promise<void> {
  if (!hasDb || !id) return;
  await sql`
    UPDATE notification_runs SET
      finished_at = now(),
      candidates  = ${totals.candidates},
      matched     = ${totals.matched},
      sent        = ${totals.sent},
      failed      = ${totals.failed},
      skipped     = ${totals.skipped},
      error       = ${error ?? null}
    WHERE id = ${id}`;
}

/** Last few runs, for the health endpoint. */
export async function recentRuns(limit = 5) {
  if (!hasDb) return [];
  return sql`
    SELECT mode, dry_run, started_at, finished_at, candidates, matched, sent, failed, skipped, error
    FROM notification_runs ORDER BY started_at DESC LIMIT ${limit}`;
}
