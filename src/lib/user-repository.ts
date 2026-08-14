import "server-only";
import { sql, hasDb } from "./db";
import type { Alert, AlertChannel, AlertFrequency } from "./types";

/**
 * Per-user alerts and saved tenders (db/010_user_data.sql).
 *
 * Everything here merges rather than replaces. The browser is not authoritative
 * — someone can sign in on a second device carrying a different localStorage,
 * and the last one to sync must not wipe what the first one saved.
 */

export type UserData = { alerts: Alert[]; savedDealIds: string[] };

const EMPTY: UserData = { alerts: [], savedDealIds: [] };

function mapAlert(row: Record<string, unknown>): Alert {
  return {
    id: String(row.id),
    name: String(row.name ?? ""),
    filters: (row.filters ?? {}) as Alert["filters"],
    channels: ((row.channels as string[]) ?? []) as AlertChannel[],
    frequency: (row.frequency as AlertFrequency) ?? "instant",
    isActive: Boolean(row.is_active),
    triggeredThisMonth: 0, // nothing sends yet; see AlertsPanel's notice
  };
}

export async function getUserData(clerkUserId: string): Promise<UserData> {
  if (!hasDb) return EMPTY;

  const [alertRows, savedRows] = await Promise.all([
    sql`SELECT * FROM user_alerts WHERE clerk_user_id = ${clerkUserId} ORDER BY created_at DESC`,
    sql`SELECT deal_id FROM user_saved_deals WHERE clerk_user_id = ${clerkUserId} ORDER BY saved_at DESC`,
  ]);

  return {
    alerts: alertRows.map(mapAlert),
    savedDealIds: savedRows.map((r) => String(r.deal_id)),
  };
}

export async function insertAlert(clerkUserId: string, alert: Alert): Promise<void> {
  if (!hasDb) return;
  await sql`
    INSERT INTO user_alerts (id, clerk_user_id, name, filters, channels, frequency, is_active)
    VALUES (${alert.id}, ${clerkUserId}, ${alert.name}, ${sql.json(alert.filters)},
            ${alert.channels}, ${alert.frequency}, ${alert.isActive})
    ON CONFLICT (id) DO NOTHING`;
}

// Every mutation is scoped by clerk_user_id as well as by id, so a guessed id
// from another account simply matches no rows.
export async function setAlertActive(
  clerkUserId: string,
  alertId: string,
  isActive: boolean,
): Promise<void> {
  if (!hasDb) return;
  await sql`
    UPDATE user_alerts SET is_active = ${isActive}, updated_at = now()
    WHERE id = ${alertId} AND clerk_user_id = ${clerkUserId}`;
}

export async function deleteAlert(clerkUserId: string, alertId: string): Promise<void> {
  if (!hasDb) return;
  await sql`DELETE FROM user_alerts WHERE id = ${alertId} AND clerk_user_id = ${clerkUserId}`;
}

export async function setDealSaved(
  clerkUserId: string,
  dealId: string,
  saved: boolean,
): Promise<void> {
  if (!hasDb) return;
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
}

/**
 * Folds the browser's copy into the account's, then returns the union so the
 * client can adopt it. Alerts upsert by id (re-syncing the same browser is a
 * no-op); saved deals ignore ids that no longer exist as tenders.
 */
export async function mergeUserData(clerkUserId: string, incoming: UserData): Promise<UserData> {
  if (!hasDb) return EMPTY;

  for (const alert of incoming.alerts) {
    await sql`
      INSERT INTO user_alerts (id, clerk_user_id, name, filters, channels, frequency, is_active)
      VALUES (${alert.id}, ${clerkUserId}, ${alert.name}, ${sql.json(alert.filters)},
              ${alert.channels}, ${alert.frequency}, ${alert.isActive})
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        filters = EXCLUDED.filters,
        channels = EXCLUDED.channels,
        frequency = EXCLUDED.frequency,
        is_active = EXCLUDED.is_active,
        updated_at = now()
      WHERE user_alerts.clerk_user_id = ${clerkUserId}`;
  }

  if (incoming.savedDealIds.length) {
    await sql`
      INSERT INTO user_saved_deals (clerk_user_id, deal_id)
      SELECT ${clerkUserId}, d.id FROM deals d WHERE d.id = ANY(${incoming.savedDealIds})
      ON CONFLICT DO NOTHING`;
  }

  return getUserData(clerkUserId);
}
