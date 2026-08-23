import "server-only";
import { sql, hasDb } from "./db";
import type { Alert, AlertChannel, AlertFrequency, PlanTier } from "./types";
import { headroom, isAtLimit, limitFor, type LimitKind } from "./limits";

/**
 * Per-user alerts and saved tenders (db/010_user_data.sql).
 *
 * Everything here merges rather than replaces. The browser is not authoritative
 * — someone can sign in on a second device carrying a different localStorage,
 * and the last one to sync must not wipe what the first one saved.
 */

export type UserData = { alerts: Alert[]; savedDealIds: string[]; tier: PlanTier };

const EMPTY: UserData = { alerts: [], savedDealIds: [], tier: "free" };

/**
 * Every write that can be refused says so in the same shape, rather than
 * throwing or returning void. A limit is an ordinary outcome the interface has
 * to carry — the caller needs the numbers to explain the wall, and an exception
 * would make "you already have three" indistinguishable from "the database is
 * down".
 */
export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "limit"; kind: LimitKind; limit: number; current: number };

/** The plan on the account. Absent contact row = free, like everywhere else. */
export async function tierOf(clerkUserId: string): Promise<PlanTier> {
  if (!hasDb) return "free";
  const [row] = await sql`SELECT tier FROM user_contacts WHERE clerk_user_id = ${clerkUserId}`;
  return (row?.tier as PlanTier) === "pro" ? "pro" : "free";
}

/** Active alerts, which is what the alert limit counts. */
async function activeAlertCount(clerkUserId: string): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM user_alerts
    WHERE clerk_user_id = ${clerkUserId} AND is_active = true`;
  return Number(row?.n ?? 0);
}

async function savedCount(clerkUserId: string): Promise<number> {
  const [row] = await sql`
    SELECT count(*)::int AS n FROM user_saved_deals WHERE clerk_user_id = ${clerkUserId}`;
  return Number(row?.n ?? 0);
}

function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    filters: (row.filters ?? {}) as Alert["filters"],
    channels: ((row.channels as string[]) ?? []) as AlertChannel[],
    frequency: (row.frequency as AlertFrequency) ?? "instant",
    isActive: Boolean(row.is_active),
    notifyOnOpen: row.notify_on_open !== false,
    triggeredThisMonth: 0, // nothing sends yet; see AlertsPanel's notice
  };
}

export async function getUserData(clerkUserId: string): Promise<UserData> {
  if (!hasDb) return EMPTY;

  // Sequential, not Promise.all. Running them together makes one request hold
  // two pooled connections at the same time, and a request that holds one
  // connection while waiting for another is how a connection pool deadlocks:
  // enough concurrent callers and every slot is held by someone waiting for a
  // slot. Both queries are single-index lookups, so the saving was never real.
  const alertRows =
    await sql`SELECT * FROM user_alerts WHERE clerk_user_id = ${clerkUserId} ORDER BY created_at DESC`;
  const savedRows =
    await sql`SELECT deal_id FROM user_saved_deals WHERE clerk_user_id = ${clerkUserId} ORDER BY saved_at DESC`;

  // Third sequential query, not a third parallel one — see the note above.
  // The tier rides along so the browser can explain a limit before a click
  // appears to work and then reverts; the server still decides.
  const tier = await tierOf(clerkUserId);

  return {
    alerts: alertRows.map(mapAlert),
    savedDealIds: savedRows.map((r) => String(r.deal_id)),
    tier,
  };
}

export async function insertAlert(clerkUserId: string, alert: Alert): Promise<WriteResult> {
  if (!hasDb) return { ok: true };

  // Checked here rather than only in the action, because this is the last
  // place before the row exists: the action, the sync endpoint and any future
  // caller all funnel through it.
  const tier = await tierOf(clerkUserId);
  if (alert.isActive !== false) {
    const current = await activeAlertCount(clerkUserId);
    if (isAtLimit(tier, "alerts", current)) {
      return { ok: false, reason: "limit", kind: "alerts", limit: limitFor(tier, "alerts")!, current };
    }
  }

  await sql`
    INSERT INTO user_alerts
      (id, clerk_user_id, name, filters, channels, frequency, is_active, notify_on_open)
    VALUES (${alert.id}, ${clerkUserId}, ${alert.name}, ${sql.json(alert.filters)},
            ${alert.channels}, ${alert.frequency}, ${alert.isActive},
            ${alert.notifyOnOpen !== false})
    ON CONFLICT (id) DO NOTHING`;
  return { ok: true };
}

// Every mutation is scoped by clerk_user_id as well as by id, so a guessed id
// from another account simply matches no rows.
export async function setAlertActive(
  clerkUserId: string,
  alertId: string,
  isActive: boolean,
): Promise<WriteResult> {
  if (!hasDb) return { ok: true };

  // Un-pausing is how the limit would otherwise be walked around: keep five
  // alerts, pause three, re-activate them one at a time. Turning one *off* is
  // always allowed — that is how someone gets back under the line.
  if (isActive) {
    const tier = await tierOf(clerkUserId);
    const current = await activeAlertCount(clerkUserId);
    if (isAtLimit(tier, "alerts", current)) {
      return { ok: false, reason: "limit", kind: "alerts", limit: limitFor(tier, "alerts")!, current };
    }
  }

  await sql`
    UPDATE user_alerts SET is_active = ${isActive}, updated_at = now()
    WHERE id = ${alertId} AND clerk_user_id = ${clerkUserId}`;
  return { ok: true };
}

export async function deleteAlert(clerkUserId: string, alertId: string): Promise<void> {
  if (!hasDb) return;
  await sql`DELETE FROM user_alerts WHERE id = ${alertId} AND clerk_user_id = ${clerkUserId}`;
}

export async function setDealSaved(
  clerkUserId: string,
  dealId: string,
  saved: boolean,
): Promise<WriteResult> {
  if (!hasDb) return { ok: true };

  if (saved) {
    const tier = await tierOf(clerkUserId);
    const current = await savedCount(clerkUserId);
    // Re-saving something already saved is a no-op, not a new one — otherwise
    // a double click at the boundary reports a limit that is not being crossed.
    const [existing] = await sql`
      SELECT 1 AS hit FROM user_saved_deals
      WHERE clerk_user_id = ${clerkUserId} AND deal_id = ${dealId}`;
    if (!existing && isAtLimit(tier, "saved", current)) {
      return { ok: false, reason: "limit", kind: "saved", limit: limitFor(tier, "saved")!, current };
    }
  }

  if (saved) {
    // The SELECT drops ids that don't match a live tender.
    await sql`
      INSERT INTO user_saved_deals (clerk_user_id, deal_id)
      SELECT ${clerkUserId}, d.id FROM deals d WHERE d.id = ${dealId}
      ON CONFLICT DO NOTHING`;
  } else {
    await sql`
      DELETE FROM user_saved_deals
      WHERE clerk_user_id = ${clerkUserId} AND deal_id = ${dealId}`;
  }
  return { ok: true };
}

/**
 * Folds the browser's copy into the account's, then returns the union so the
 * client can adopt it. Alerts upsert by id (re-syncing the same browser is a
 * no-op); saved deals ignore ids that no longer exist as tenders.
 */
export async function mergeUserData(clerkUserId: string, incoming: UserData): Promise<UserData> {
  if (!hasDb) return EMPTY;

  // The merge has to respect the plan too, or the limit is one sign-in away
  // from meaningless: create ten alerts signed out, sign in, and they all land.
  //
  // Updating an alert the account already holds is not adding one, so existing
  // ids pass through untouched however many there are — this only rations the
  // genuinely new ones, and only while they would push the account past the
  // line. Nothing already stored is ever removed.
  const tier = await tierOf(clerkUserId);

  const existingRows = await sql`
    SELECT id FROM user_alerts WHERE clerk_user_id = ${clerkUserId}`;
  const existingIds = new Set(existingRows.map((r) => String(r.id)));

  let alertRoom = headroom(tier, "alerts", await activeAlertCount(clerkUserId));

  for (const alert of incoming.alerts) {
    const isNew = !existingIds.has(alert.id);
    const wantsActive = alert.isActive !== false;

    if (isNew && wantsActive && alertRoom != null) {
      if (alertRoom <= 0) continue; // over the plan: leave it in the browser
      alertRoom -= 1;
    }
    await sql`
      INSERT INTO user_alerts
        (id, clerk_user_id, name, filters, channels, frequency, is_active, notify_on_open)
      VALUES (${alert.id}, ${clerkUserId}, ${alert.name}, ${sql.json(alert.filters)},
              ${alert.channels}, ${alert.frequency}, ${alert.isActive},
              ${alert.notifyOnOpen !== false})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        filters = EXCLUDED.filters,
        channels = EXCLUDED.channels,
        frequency = EXCLUDED.frequency,
        is_active = EXCLUDED.is_active,
        notify_on_open = EXCLUDED.notify_on_open,
        updated_at = now()
      WHERE user_alerts.clerk_user_id = ${clerkUserId}`;
  }

  if (incoming.savedDealIds.length) {
    const savedRoom = headroom(tier, "saved", await savedCount(clerkUserId));

    // Already-saved ids are not new, so they must not spend the allowance.
    const alreadyRows = await sql`
      SELECT deal_id FROM user_saved_deals
      WHERE clerk_user_id = ${clerkUserId} AND deal_id = ANY(${incoming.savedDealIds})`;
    const already = new Set(alreadyRows.map((r) => String(r.deal_id)));

    const fresh = incoming.savedDealIds.filter((id) => !already.has(id));
    const accepted = savedRoom == null ? fresh : fresh.slice(0, savedRoom);

    if (accepted.length) {
      await sql`
        INSERT INTO user_saved_deals (clerk_user_id, deal_id)
        SELECT ${clerkUserId}, d.id FROM deals d WHERE d.id = ANY(${accepted})
        ON CONFLICT DO NOTHING`;
    }
  }

  return getUserData(clerkUserId);
}
