import "server-only";
import { sql, hasDb } from "./db";
import { EVENT_NAMES, type EventName } from "./events";
import type { PlanTier } from "./types";

/**
 * Every query behind the admin dashboard (db/017_admin.sql and friends).
 *
 * Two rules govern this file.
 *
 * **Sequential, never Promise.all.** A request that holds one pooled connection
 * while awaiting another is how this app deadlocked its pool once already
 * (see src/lib/db.ts). This page runs a dozen queries; fanning them out would
 * be the same bug with more legs. They are all indexed lookups over small
 * tables, so the wall-clock saving was never real.
 *
 * **Every section degrades on its own.** A deploy reaches production before
 * anyone runs psql against Supabase, so a dashboard that 500s on a missing
 * table would be broken exactly when it is most needed — during a release.
 * Each block is wrapped so a missing relation costs that one card, and the page
 * says which migration is outstanding.
 */

async function safe<T>(run: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await run();
  } catch {
    return fallback;
  }
}

const n = (value: unknown): number => Number(value ?? 0);
const date = (value: unknown): string | null =>
  value instanceof Date ? value.toISOString() : value ? String(value) : null;

// ── Shapes ─────────────────────────────────────────────────

export type Tier = PlanTier;
export type TierSource = "default" | "admin" | "legacy_env" | "billing";

export type AdminUserRow = {
  clerkUserId: string;
  email: string | null;
  phone: string | null;
  tier: Tier;
  tierSource: TierSource;
  tierNote: string | null;
  tierUpdatedAt: string | null;
  alerts: number;
  activeAlerts: number;
  saved: number;
  sent: number;
  unsubscribed: boolean;
  lastDigestAt: string | null;
  createdAt: string | null;
};

export type EventStat = {
  name: EventName;
  total7d: number;
  total24h: number;
  subjects7d: number;
  signedOut7d: number;
  lastAt: string | null;
};

export type DeliveryFailure = {
  alertId: string;
  alertName: string;
  dealId: string;
  channel: "email" | "whatsapp";
  reason: string;
  clerkUserId: string;
  attempts: number;
  retryable: boolean;
  error: string | null;
  queuedAt: string | null;
};

export type RunRow = {
  mode: string;
  dryRun: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  candidates: number;
  matched: number;
  sent: number;
  failed: number;
  skipped: number;
  error: string | null;
};

/** Write-side shape: scalars only, so it is valid JSON without a cast. */
export type AuditDetail = Record<string, string | number | boolean | null>;

export type AuditRow = {
  actorId: string;
  action: string;
  subject: string | null;
  detail: Record<string, unknown>;
  createdAt: string | null;
};

export type AdminSnapshot = {
  hasDb: boolean;
  /** False when db/017_admin.sql has not been applied to this database yet. */
  eventsReady: boolean;
  totals: {
    users: number;
    pro: number;
    alerts: number;
    activeAlerts: number;
    saved: number;
    contactsWithPhone: number;
    unsubscribed: number;
  };
  deliveries: {
    sent7d: number;
    failed7d: number;
    queued: number;
    sentTotal: number;
    email7d: number;
    whatsapp7d: number;
  };
  funnel: {
    pricingViews7d: number;
    upgradeClicks7d: number;
    upgradeClicksSignedOut7d: number;
    /** Distinct visitors who clicked, over distinct visitors who looked. */
    conversionPct: number | null;
  };
  events: EventStat[];
  upgradeDaily: { day: string; total: number }[];
  users: AdminUserRow[];
  failures: DeliveryFailure[];
  runs: RunRow[];
  pipeline: {
    deals: number;
    active: number;
    geocoded: number;
    parcelPrecision: number;
    lastSeenAt: string | null;
    lastUpdatedAt: string | null;
    tendersSeen: number;
    lastCheckedAt: string | null;
  };
  audit: AuditRow[];
};

const EMPTY: AdminSnapshot = {
  hasDb: false,
  eventsReady: false,
  totals: { users: 0, pro: 0, alerts: 0, activeAlerts: 0, saved: 0, contactsWithPhone: 0, unsubscribed: 0 },
  deliveries: { sent7d: 0, failed7d: 0, queued: 0, sentTotal: 0, email7d: 0, whatsapp7d: 0 },
  funnel: { pricingViews7d: 0, upgradeClicks7d: 0, upgradeClicksSignedOut7d: 0, conversionPct: null },
  events: [],
  upgradeDaily: [],
  users: [],
  failures: [],
  runs: [],
  pipeline: {
    deals: 0, active: 0, geocoded: 0, parcelPrecision: 0,
    lastSeenAt: null, lastUpdatedAt: null, tendersSeen: 0, lastCheckedAt: null,
  },
  audit: [],
};

// ── The dashboard's read ───────────────────────────────────

export async function getAdminSnapshot(): Promise<AdminSnapshot> {
  if (!hasDb) return EMPTY;

  const snapshot: AdminSnapshot = { ...EMPTY, hasDb: true };

  // -- people --------------------------------------------------------
  const [totals] = await safe(
    () => sql`
      SELECT
        (SELECT count(*) FROM (
           SELECT clerk_user_id FROM user_contacts
           UNION SELECT clerk_user_id FROM user_alerts
           UNION SELECT clerk_user_id FROM user_saved_deals) u)          AS users,
        (SELECT count(*) FROM user_contacts WHERE tier = 'pro')          AS pro,
        (SELECT count(*) FROM user_alerts)                               AS alerts,
        (SELECT count(*) FROM user_alerts WHERE is_active)               AS active_alerts,
        (SELECT count(*) FROM user_saved_deals)                          AS saved,
        (SELECT count(*) FROM user_contacts WHERE phone_e164 IS NOT NULL) AS with_phone,
        (SELECT count(*) FROM user_contacts WHERE unsubscribed_at IS NOT NULL) AS unsubscribed`,
    [] as Record<string, unknown>[],
  );

  if (totals) {
    snapshot.totals = {
      users: n(totals.users),
      pro: n(totals.pro),
      alerts: n(totals.alerts),
      activeAlerts: n(totals.active_alerts),
      saved: n(totals.saved),
      contactsWithPhone: n(totals.with_phone),
      unsubscribed: n(totals.unsubscribed),
    };
  }

  // -- what actually went out ---------------------------------------
  const [deliveries] = await safe(
    () => sql`
      SELECT
        count(*) FILTER (WHERE status = 'sent' AND sent_at > now() - interval '7 days')   AS sent_7d,
        count(*) FILTER (WHERE status = 'failed' AND queued_at > now() - interval '7 days') AS failed_7d,
        count(*) FILTER (WHERE status = 'queued')                                        AS queued,
        count(*) FILTER (WHERE status = 'sent')                                          AS sent_total,
        count(*) FILTER (WHERE status = 'sent' AND channel = 'email'
                           AND sent_at > now() - interval '7 days')                      AS email_7d,
        count(*) FILTER (WHERE status = 'sent' AND channel = 'whatsapp'
                           AND sent_at > now() - interval '7 days')                      AS whatsapp_7d
      FROM notification_deliveries`,
    [] as Record<string, unknown>[],
  );

  if (deliveries) {
    snapshot.deliveries = {
      sent7d: n(deliveries.sent_7d),
      failed7d: n(deliveries.failed_7d),
      queued: n(deliveries.queued),
      sentTotal: n(deliveries.sent_total),
      email7d: n(deliveries.email_7d),
      whatsapp7d: n(deliveries.whatsapp_7d),
    };
  }

  // -- events (migration 017; absent until it is applied) ------------
  const eventRows = await safe(
    () => sql`
      SELECT
        name,
        count(*) FILTER (WHERE created_at > now() - interval '7 days')  AS total_7d,
        count(*) FILTER (WHERE created_at > now() - interval '24 hours') AS total_24h,
        count(DISTINCT coalesce(clerk_user_id, anon_id))
          FILTER (WHERE created_at > now() - interval '7 days')          AS subjects_7d,
        count(*) FILTER (WHERE clerk_user_id IS NULL
                           AND created_at > now() - interval '7 days')   AS signed_out_7d,
        max(created_at)                                                  AS last_at
      FROM app_events
      WHERE name = ANY(${EVENT_NAMES as unknown as string[]})
      GROUP BY name`,
    null as Record<string, unknown>[] | null,
  );

  snapshot.eventsReady = eventRows != null;

  if (eventRows) {
    const byName = new Map(eventRows.map((row) => [String(row.name), row]));
    snapshot.events = EVENT_NAMES.map((name) => {
      const row = byName.get(name);
      return {
        name,
        total7d: n(row?.total_7d),
        total24h: n(row?.total_24h),
        subjects7d: n(row?.subjects_7d),
        signedOut7d: n(row?.signed_out_7d),
        lastAt: date(row?.last_at),
      };
    });

    // The funnel counts *visitors*, not clicks: one person pressing the button
    // four times is one person who wants to pay, and the ratio is the number
    // the pricing decision rests on.
    const [funnel] = await safe(
      () => sql`
        SELECT
          count(DISTINCT coalesce(clerk_user_id, anon_id))
            FILTER (WHERE name = 'pricing_view')  AS viewers,
          count(DISTINCT coalesce(clerk_user_id, anon_id))
            FILTER (WHERE name = 'upgrade_click') AS clickers,
          count(*) FILTER (WHERE name = 'upgrade_click') AS clicks,
          count(*) FILTER (WHERE name = 'upgrade_click' AND clerk_user_id IS NULL) AS clicks_signed_out
        FROM app_events
        WHERE created_at > now() - interval '7 days'`,
      [] as Record<string, unknown>[],
    );

    const viewers = n(funnel?.viewers);
    const clickers = n(funnel?.clickers);
    snapshot.funnel = {
      pricingViews7d: viewers,
      upgradeClicks7d: n(funnel?.clicks),
      upgradeClicksSignedOut7d: n(funnel?.clicks_signed_out),
      conversionPct: viewers > 0 ? Math.round((clickers / viewers) * 1000) / 10 : null,
    };

    // Fourteen days of upgrade intent, gaps filled, so a flat run of zeros
    // reads as "nobody clicked" rather than as missing bars.
    snapshot.upgradeDaily = await safe(
      async () => {
        const rows = await sql`
          SELECT d::date AS day, count(e.id) AS total
          FROM generate_series(now() - interval '13 days', now(), interval '1 day') AS d
          LEFT JOIN app_events e
            ON e.name = 'upgrade_click' AND e.created_at::date = d::date
          GROUP BY 1 ORDER BY 1`;
        return rows.map((row) => ({ day: String(date(row.day)).slice(0, 10), total: n(row.total) }));
      },
      [] as { day: string; total: number }[],
    );
  }

  // -- people, one row each -----------------------------------------
  snapshot.users = await safe(
    async () => {
      const rows = await sql`
        WITH ids AS (
          SELECT clerk_user_id FROM user_contacts
          UNION SELECT clerk_user_id FROM user_alerts
          UNION SELECT clerk_user_id FROM user_saved_deals
        )
        SELECT
          i.clerk_user_id,
          uc.email, uc.phone_e164, uc.tier, uc.tier_source, uc.tier_note, uc.tier_updated_at,
          uc.unsubscribed_at, uc.last_digest_at, uc.created_at,
          (SELECT count(*) FROM user_alerts a WHERE a.clerk_user_id = i.clerk_user_id) AS alerts,
          (SELECT count(*) FROM user_alerts a
            WHERE a.clerk_user_id = i.clerk_user_id AND a.is_active)                   AS active_alerts,
          (SELECT count(*) FROM user_saved_deals s WHERE s.clerk_user_id = i.clerk_user_id) AS saved,
          (SELECT count(*) FROM notification_deliveries d
            WHERE d.clerk_user_id = i.clerk_user_id AND d.status = 'sent')             AS sent
        FROM ids i
        LEFT JOIN user_contacts uc ON uc.clerk_user_id = i.clerk_user_id
        ORDER BY (uc.tier = 'pro') DESC NULLS LAST, alerts DESC, i.clerk_user_id
        LIMIT 200`;

      return rows.map((row): AdminUserRow => ({
        clerkUserId: String(row.clerk_user_id),
        email: (row.email as string) ?? null,
        phone: (row.phone_e164 as string) ?? null,
        tier: (row.tier as Tier) ?? "free",
        tierSource: (row.tier_source as TierSource) ?? "default",
        tierNote: (row.tier_note as string) ?? null,
        tierUpdatedAt: date(row.tier_updated_at),
        alerts: n(row.alerts),
        activeAlerts: n(row.active_alerts),
        saved: n(row.saved),
        sent: n(row.sent),
        unsubscribed: row.unsubscribed_at != null,
        lastDigestAt: date(row.last_digest_at),
        createdAt: date(row.created_at),
      }));
    },
    [] as AdminUserRow[],
  );

  // -- what failed to send ------------------------------------------
  snapshot.failures = await safe(
    async () => {
      const rows = await sql`
        SELECT d.alert_id, d.deal_id, d.channel, d.reason, d.clerk_user_id,
               d.attempts, d.retryable, d.error, d.queued_at, ua.name AS alert_name
        FROM notification_deliveries d
        LEFT JOIN user_alerts ua ON ua.id = d.alert_id
        WHERE d.status = 'failed'
        ORDER BY d.queued_at DESC
        LIMIT 25`;

      return rows.map((row): DeliveryFailure => ({
        alertId: String(row.alert_id),
        alertName: String(row.alert_name ?? "התראה שנמחקה"),
        dealId: String(row.deal_id),
        channel: row.channel as "email" | "whatsapp",
        reason: String(row.reason ?? "new"),
        clerkUserId: String(row.clerk_user_id),
        attempts: n(row.attempts),
        retryable: row.retryable === true,
        error: (row.error as string) ?? null,
        queuedAt: date(row.queued_at),
      }));
    },
    [] as DeliveryFailure[],
  );

  // -- the worker's own log -----------------------------------------
  snapshot.runs = await safe(
    async () => {
      const rows = await sql`
        SELECT mode, dry_run, started_at, finished_at, candidates, matched, sent, failed, skipped, error
        FROM notification_runs ORDER BY started_at DESC LIMIT 12`;

      return rows.map((row): RunRow => ({
        mode: String(row.mode),
        dryRun: row.dry_run === true,
        startedAt: date(row.started_at),
        finishedAt: date(row.finished_at),
        candidates: n(row.candidates),
        matched: n(row.matched),
        sent: n(row.sent),
        failed: n(row.failed),
        skipped: n(row.skipped),
        error: (row.error as string) ?? null,
      }));
    },
    [] as RunRow[],
  );

  // -- the ingest pipeline's output ---------------------------------
  const [pipeline] = await safe(
    () => sql`
      SELECT count(*)                                        AS deals,
             count(*) FILTER (WHERE status = 'active')        AS active,
             count(*) FILTER (WHERE lat IS NOT NULL)          AS geocoded,
             count(*) FILTER (WHERE geo_precision = 'parcel') AS parcel,
             max(first_seen_at)                               AS last_seen,
             max(last_updated_at)                             AS last_updated
      FROM deals`,
    [] as Record<string, unknown>[],
  );

  const [seen] = await safe(
    () => sql`SELECT count(*) AS total, max(checked_at) AS last_checked FROM rami_tenders_seen`,
    [] as Record<string, unknown>[],
  );

  snapshot.pipeline = {
    deals: n(pipeline?.deals),
    active: n(pipeline?.active),
    geocoded: n(pipeline?.geocoded),
    parcelPrecision: n(pipeline?.parcel),
    lastSeenAt: date(pipeline?.last_seen),
    lastUpdatedAt: date(pipeline?.last_updated),
    tendersSeen: n(seen?.total),
    lastCheckedAt: date(seen?.last_checked),
  };

  // -- who changed what ---------------------------------------------
  snapshot.audit = await safe(
    async () => {
      const rows = await sql`
        SELECT actor_id, action, subject, detail, created_at
        FROM admin_audit ORDER BY created_at DESC LIMIT 20`;

      return rows.map((row): AuditRow => ({
        actorId: String(row.actor_id),
        action: String(row.action),
        subject: (row.subject as string) ?? null,
        detail: (row.detail ?? {}) as Record<string, unknown>,
        createdAt: date(row.created_at),
      }));
    },
    [] as AuditRow[],
  );

  return snapshot;
}

// ── Writes ─────────────────────────────────────────────────

/**
 * Sets someone's plan, and records that a human did it.
 *
 * `tier_source = 'admin'` is the part that matters beyond the tier itself: it
 * is what stops the legacy NOTIFY_PRO_USER_IDS bootstrap from quietly undoing
 * a downgrade on the next worker run.
 *
 * The row is created if it does not exist — someone can be granted PRO before
 * they have ever opened the account form, and the alternative is a grant that
 * silently applies to nobody.
 */
export async function setUserTier(params: {
  clerkUserId: string;
  tier: Tier;
  actorId: string;
  note?: string | null;
}): Promise<void> {
  if (!hasDb) return;

  await sql`
    INSERT INTO user_contacts (clerk_user_id, tier, tier_source, tier_updated_at, tier_set_by, tier_note)
    VALUES (${params.clerkUserId}, ${params.tier}, 'admin', now(), ${params.actorId}, ${params.note ?? null})
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      tier            = EXCLUDED.tier,
      tier_source     = 'admin',
      tier_updated_at = now(),
      tier_set_by     = EXCLUDED.tier_set_by,
      tier_note       = EXCLUDED.tier_note,
      updated_at      = now()`;
}

/**
 * Drops a failed delivery row so the tender can be sent again.
 *
 * The worker will not retry a non-retryable failure by design — a rejected API
 * key fails identically forever — so once the underlying cause is fixed the
 * only way to re-send has been deleting the ledger row by hand in psql. This is
 * that, with an audit trail. Scoped to `status = 'failed'`: a 'sent' row is
 * history and must never be re-openable from a web page.
 */
export async function retryDelivery(params: {
  alertId: string;
  dealId: string;
  channel: string;
  reason: string;
}): Promise<number> {
  if (!hasDb) return 0;

  const rows = await sql`
    DELETE FROM notification_deliveries
    WHERE alert_id = ${params.alertId}
      AND deal_id  = ${params.dealId}
      AND channel  = ${params.channel}
      AND reason   = ${params.reason}
      AND status   = 'failed'
    RETURNING deal_id`;

  return rows.length;
}

/** Undoes an unsubscribe — only ever at the person's own request. */
export async function resubscribeContact(clerkUserId: string): Promise<number> {
  if (!hasDb) return 0;
  const rows = await sql`
    UPDATE user_contacts
    SET unsubscribed_at = NULL, email_opt_in = true, updated_at = now()
    WHERE clerk_user_id = ${clerkUserId} AND unsubscribed_at IS NOT NULL
    RETURNING clerk_user_id`;
  return rows.length;
}

export async function logAdminAction(params: {
  actorId: string;
  action: string;
  subject?: string | null;
  detail?: AuditDetail;
}): Promise<void> {
  if (!hasDb) return;
  // Never let the audit write fail the action it describes — the change has
  // already happened, and throwing here would report a failure that did not
  // occur and invite a second attempt.
  try {
    await sql`
      INSERT INTO admin_audit (actor_id, action, subject, detail)
      VALUES (${params.actorId}, ${params.action}, ${params.subject ?? null},
              ${sql.json(params.detail ?? {})})`;
  } catch {
    // Missing table (migration 017 not applied yet) or a transient error.
  }
}
