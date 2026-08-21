import "server-only";
import { sql, hasDb } from "@/lib/db";
import { notificationSettings, opsConfig } from "./config";
import { sendEmail } from "./email";
import { sendWhatsApp } from "./whatsapp";

/**
 * Operational alerts — "the pipeline broke", not "here is a tender".
 *
 * Deliberately reuses the same transports as user notifications rather than
 * giving the CI workflow its own copy of the Green API credentials. Provider
 * config stays in one place, and an ops message goes out through a path that
 * is already exercised every hour.
 *
 * It is a separate function, not an alert, because none of the user-facing
 * machinery applies: no matching, no tiering, and above all no delivery ledger
 * — the ledger is keyed by tender, and a broken pipeline is not a tender.
 */

export type OpsResult = {
  status: "sent" | "throttled" | "skipped" | "failed";
  channels?: string[];
  suppressed?: number;
  error?: string;
};

/**
 * Sends at most one message per `kind` per OPS_ALERT_MIN_GAP_HOURS.
 *
 * The pipeline runs hourly, so a persistent fault would otherwise deliver
 * twenty-four identical WhatsApps a day — which is how an ops channel gets
 * muted, and a muted channel is worse than none because it looks like
 * coverage. Suppressed occurrences are counted and reported in the next
 * message that does go out, so the throttle never hides how bad it got.
 */
export async function sendOpsAlert(kind: string, text: string): Promise<OpsResult> {
  const config = opsConfig();
  if (!config.to.length) return { status: "skipped", error: "ops_alert_not_configured" };

  const suppressed = await claim(kind, text, config.minGapHours);
  if (suppressed === null) return { status: "throttled" };

  const body =
    suppressed > 0
      ? `${text}\n\n(ועוד ${suppressed} התראות זהות שנחסמו מאז ההודעה הקודמת)`
      : text;

  const channels: string[] = [];
  let error: string | undefined;

  if (config.phone) {
    const outcome = await sendWhatsApp({ to: config.phone, body });
    if (outcome.status === "sent") channels.push("whatsapp");
    else error = outcome.error;
  }

  if (config.email) {
    const outcome = await sendEmail({
      to: config.email,
      subject: `קרקעHOT — תקלה בצינור הנתונים (${kind})`,
      // Plain text either way: an ops alert is read on a phone at an
      // inconvenient hour, not admired.
      html: `<pre dir="ltr" style="font-family:monospace;white-space:pre-wrap">${body
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")}</pre>`,
      text: body,
    });
    if (outcome.status === "sent") channels.push("email");
    else error ??= outcome.error;
  }

  if (channels.length === 0) {
    return { status: "failed", error: error ?? "no_channel_succeeded", suppressed };
  }
  return { status: "sent", channels, suppressed };
}

/**
 * Atomically decides whether this alert may send, in one statement.
 *
 * Returns the suppressed count when the caller wins the slot, or null when the
 * gap has not elapsed. Doing it as an upsert rather than read-then-write means
 * two runs overlapping cannot both decide they are first — the same reasoning
 * as the delivery ledger's claim.
 */
async function claim(kind: string, text: string, minGapHours: number): Promise<number | null> {
  if (!hasDb) return 0;

  // The CTE reads the row as it stood at statement start, so the count of
  // suppressed occurrences survives the upsert that resets it to zero.
  const rows = await sql`
    WITH prior AS (
      SELECT suppressed FROM ops_alerts WHERE kind = ${kind}
    )
    INSERT INTO ops_alerts (kind, last_sent_at, last_text, suppressed)
    VALUES (${kind}, now(), ${text}, 0)
    ON CONFLICT (kind) DO UPDATE SET
      last_sent_at = now(),
      last_text    = EXCLUDED.last_text,
      suppressed   = 0
    WHERE ops_alerts.last_sent_at < now() - (${minGapHours} * interval '1 hour')
    RETURNING COALESCE((SELECT suppressed FROM prior), 0) AS prior_suppressed`;

  if (rows.length > 0) return Number(rows[0].prior_suppressed ?? 0);

  // Inside the quiet window: count the occurrence and say nothing.
  await sql`
    UPDATE ops_alerts SET suppressed = suppressed + 1, last_text = ${text}
    WHERE kind = ${kind}`;
  return null;
}

/** Site URL for links inside ops messages. */
export const opsSiteUrl = () => notificationSettings.siteUrl;
