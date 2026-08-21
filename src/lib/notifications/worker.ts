import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { matchesAlert } from "@/lib/alert-match";
import { tenderPhase } from "@/lib/tender-phase";
import { listDealsSince, listDealsOpeningWithin } from "@/lib/repository";
import type { Alert, AlertChannel, Deal } from "@/lib/types";
import { notificationSettings, notificationStatus } from "./config";
import { sendEmail } from "./email";
import {
  claimDeliveries,
  ensureContact,
  finishRun,
  listRecipients,
  markDeliveries,
  releaseDeliveries,
  setLastDigestAt,
  startRun,
  type Recipient,
  type Tier,
} from "./repository";
import {
  digestEmail,
  instantEmail,
  openingEmail,
  whatsappAlert,
  whatsappOpening,
  type MessageDeal,
} from "./templates";
import type { SendOutcome } from "./types";
import { sendWhatsApp } from "./whatsapp";

/**
 * The alert-matching worker.
 *
 * Two modes, both driven by cron:
 *
 *   instant — PRO only. Tenders ingested in the last few hours, matched
 *             against instant alerts, out over WhatsApp and email straight
 *             away. Runs as often as the hosting plan allows.
 *   digest  — everyone else. One email per person per day covering every
 *             alert they own, and — this is the tier boundary — free accounts
 *             only see tenders that are already NOTIFY_FREE_DELAY_HOURS old.
 *
 * Three invariants worth keeping:
 *
 *   1. Nothing sends twice. A ledger row is claimed before the provider call
 *      (repository.claimDeliveries), so two overlapping runs cannot both win.
 *   2. Missing configuration never throws. With no provider keys the worker
 *      still matches and reports what it *would* have sent — which is how it
 *      gets tested before any account exists.
 *   3. Matching is `matchesAlert`, the same function the feed and the alert
 *      cards use. If the message and the "N מכרזים תואמים" count on the card
 *      ever disagreed, the product would be lying about its own filters.
 */

export type WorkerMode = "instant" | "digest" | "opening";

export type WorkerSummary = {
  mode: WorkerMode;
  dryRun: boolean;
  /** New tenders in the lookback window. */
  candidates: number;
  /** (alert, tender) pairs that passed the filters. */
  matched: number;
  sent: number;
  failed: number;
  skipped: number;
  recipients: number;
  durationMs: number;
  /** Per-message detail — the useful half of a dry run. */
  messages: MessageLog[];
  status: ReturnType<typeof notificationStatus>;
};

export type MessageLog = {
  clerkUserId: string;
  alertId?: string;
  alertName?: string;
  channel: AlertChannel;
  dealIds: string[];
  status: SendOutcome["status"] | "would_send";
  provider?: string;
  error?: string;
};

export type WorkerOptions = {
  mode: WorkerMode;
  /** Match and report, write nothing, send nothing. */
  dryRun?: boolean;
  /** Injected clock — the tests and a manual replay both need to move it. */
  now?: Date;
};

const HOUR_MS = 60 * 60 * 1000;

export async function runNotificationWorker(options: WorkerOptions): Promise<WorkerSummary> {
  const { mode } = options;
  const now = options.now ?? new Date();
  const status = notificationStatus();

  // Asking for a real run without a configured provider silently downgrades to
  // a dry run rather than marking every delivery failed.
  const dryRun = options.dryRun === true || !status.canSend;

  const started = Date.now();
  const runId = dryRun ? null : await startRun(mode, dryRun);

  const summary: WorkerSummary = {
    mode,
    dryRun,
    candidates: 0,
    matched: 0,
    sent: 0,
    failed: 0,
    skipped: 0,
    recipients: 0,
    durationMs: 0,
    messages: [],
    status,
  };

  try {
    // "opening" does not look backwards at all: its candidates are tenders
    // whose bidding window starts soon, whenever we first saw them.
    const deals =
      mode === "opening"
        ? await listDealsOpeningWithin(
            now,
            new Date(now.getTime() + notificationSettings.openingLeadHours * HOUR_MS),
          )
        : await listDealsSince(
            new Date(
              now.getTime() -
                (mode === "instant"
                  ? notificationSettings.instantLookbackHours
                  : notificationSettings.digestLookbackHours) *
                  HOUR_MS,
            ),
          );
    summary.candidates = deals.length;

    const recipients = await listRecipients();
    if (deals.length === 0 || recipients.length === 0) {
      return finalise(summary, runId, started);
    }

    await hydrateEmails(recipients, dryRun);

    for (const recipient of recipients) {
      if (summary.sent + summary.failed >= notificationSettings.maxSendsPerRun) break;

      // user_contacts.tier is the whole answer: set from the admin dashboard,
      // read here, with nothing in the environment able to contradict it.
      const tier: Tier = recipient.tier;
      if (recipient.unsubscribed) {
        summary.skipped += 1;
        continue;
      }

      const handled =
        mode === "instant"
          ? await runInstantFor(recipient, tier, deals, dryRun, summary)
          : mode === "opening"
            ? await runOpeningFor(recipient, tier, deals, now, dryRun, summary)
            : await runDigestFor(recipient, tier, deals, now, dryRun, summary);

      if (handled) summary.recipients += 1;
    }

    return finalise(summary, runId, started);
  } catch (error) {
    summary.durationMs = Date.now() - started;
    await finishRun(runId, summary, (error as Error).message);
    throw error;
  }
}

async function finalise(
  summary: WorkerSummary,
  runId: string | null,
  started: number,
): Promise<WorkerSummary> {
  summary.durationMs = Date.now() - started;
  await finishRun(runId, summary);
  return summary;
}

// ── Instant (PRO) ──────────────────────────────────────────

async function runInstantFor(
  recipient: Recipient,
  tier: Tier,
  deals: Deal[],
  dryRun: boolean,
  summary: WorkerSummary,
): Promise<boolean> {
  // A free account's "instant" alert is not dropped — it is left for the
  // digest run to pick up, which is exactly what the pricing table promises.
  if (tier !== "pro") return false;

  const alerts = recipient.alerts.filter((alert) => alert.frequency === "instant");
  if (alerts.length === 0) return false;

  let touched = false;

  for (const alert of alerts) {
    const matches = deals.filter((deal) => matchesAlert(deal, alert));
    if (matches.length === 0) continue;
    summary.matched += matches.length;
    touched = true;

    for (const { channel, to } of resolveChannels(alert, recipient, tier)) {
      await deliver({
        recipient,
        alert,
        channel,
        to,
        deals: matches,
        dryRun,
        summary,
        build: (batch, remainder) =>
          channel === "email"
            ? buildInstantEmail(alert, batch, remainder, recipient)
            : buildWhatsApp(alert, batch, remainder),
      });
    }
  }

  return touched;
}

// ── Opening (a tender you already know about becomes biddable) ──

/**
 * The second message a tender may earn: bidding is about to open.
 *
 * Half the feed is טרם החל, so the discovery alert often lands weeks before
 * anyone can act on it. This is the nudge at the moment they can — and the
 * only place in the engine that deliberately messages a tender twice, which
 * is why the ledger key carries a reason (migration 014). Two messages
 * maximum: a repeated run still cannot send either again.
 *
 * PRO only, and only for instant alerts. Timeliness is what the paid tier
 * sells, and a free account still meets these tenders in the daily digest.
 */
async function runOpeningFor(
  recipient: Recipient,
  tier: Tier,
  deals: Deal[],
  now: Date,
  dryRun: boolean,
  summary: WorkerSummary,
): Promise<boolean> {
  if (tier !== "pro") return false;

  // notifyOnOpen defaults to on, so an alert saved before the switch existed
  // keeps behaving the way its owner has already experienced.
  const alerts = recipient.alerts.filter(
    (alert) => alert.frequency === "instant" && alert.notifyOnOpen !== false,
  );
  if (alerts.length === 0) return false;

  let touched = false;

  for (const alert of alerts) {
    // Still not_started at this instant — the candidate query already bounded
    // the window, this guards the edge where one crossed while the run was in
    // flight and has therefore become an ordinary open tender.
    const matches = deals.filter(
      (deal) => tenderPhase(deal, now) === "not_started" && matchesAlert(deal, alert, now),
    );
    if (matches.length === 0) continue;
    summary.matched += matches.length;
    touched = true;

    for (const { channel, to } of resolveChannels(alert, recipient, tier)) {
      await deliver({
        recipient,
        alert,
        channel,
        to,
        reason: "opening",
        deals: matches,
        dryRun,
        summary,
        build: (batch, remainder) =>
          channel === "email"
            ? {
                kind: "email",
                ...openingEmail({
                  alertName: alert.name,
                  deals: batch.map(toMessageDeal),
                  remainder,
                  siteUrl: notificationSettings.siteUrl,
                  unsubscribeUrl: unsubscribeUrl(recipient),
                }),
              }
            : {
                kind: "whatsapp",
                ...whatsappOpening({
                  alertName: alert.name,
                  deals: batch.map(toMessageDeal),
                  remainder,
                  siteUrl: notificationSettings.siteUrl,
                }),
              },
      });
    }
  }

  return touched;
}

// ── Digest (free tier, and daily/weekly alerts) ────────────

async function runDigestFor(
  recipient: Recipient,
  tier: Tier,
  deals: Deal[],
  now: Date,
  dryRun: boolean,
  summary: WorkerSummary,
): Promise<boolean> {
  if (!recipient.email || !recipient.emailOptIn) return false;

  // The digest covers daily/weekly alerts, plus the instant alerts of free
  // accounts that the instant run deliberately left alone. A free account's
  // WhatsApp-only alert is included too: email digest is the only delivery
  // that tier has, and silence would be a worse answer than the daily mail.
  const alerts = recipient.alerts.filter(
    (alert) => alert.frequency !== "instant" || tier !== "pro",
  );
  if (alerts.length === 0) return false;

  const weeklyOnly = alerts.every((alert) => alert.frequency === "weekly");
  const minGapHours = weeklyOnly ? 24 * 7 : 24;
  if (recipient.lastDigestAt) {
    const elapsed = now.getTime() - new Date(recipient.lastDigestAt).getTime();
    // Minus an hour of slack: a cron that fires at 08:00:31 one day and
    // 08:00:12 the next must not skip a day for being 19 seconds early.
    if (elapsed < (minGapHours - 1) * HOUR_MS) return false;
  }

  // The free tier's delay, and the single reason to upgrade.
  const delayed = tier !== "pro" && notificationSettings.freeDelayHours > 0;
  const cutoff = delayed ? now.getTime() - notificationSettings.freeDelayHours * HOUR_MS : Infinity;
  const eligible = deals.filter((deal) => new Date(deal.firstSeenAt).getTime() <= cutoff);
  if (eligible.length === 0) return false;

  // One claim per (alert, deal) so the ledger stays honest, but the person
  // gets a single email — a tender matching three alerts is not three emails.
  const claimedByAlert: { alert: Alert; dealIds: string[] }[] = [];
  const seen = new Set<string>();
  const digestDeals: Deal[] = [];

  for (const alert of alerts) {
    const matches = eligible.filter((deal) => matchesAlert(deal, alert));
    if (matches.length === 0) continue;
    summary.matched += matches.length;

    const dealIds = dryRun
      ? matches.map((deal) => deal.id)
      : await claimDeliveries({
          alertId: alert.id,
          clerkUserId: recipient.clerkUserId,
          channel: "email",
          dealIds: matches.map((deal) => deal.id),
          maxAttempts: notificationSettings.maxAttempts,
        });

    if (dealIds.length === 0) continue;
    claimedByAlert.push({ alert, dealIds });

    for (const deal of matches) {
      if (dealIds.includes(deal.id) && !seen.has(deal.id)) {
        seen.add(deal.id);
        digestDeals.push(deal);
      }
    }
  }

  if (digestDeals.length === 0) return false;

  const ranked = rank(digestDeals);
  const batch = ranked.slice(0, notificationSettings.maxItemsPerMessage);
  const remainder = ranked.length - batch.length;

  const message = digestEmail({
    deals: batch.map(toMessageDeal),
    remainder,
    alertNames: claimedByAlert.map((entry) => entry.alert.name),
    delayed,
    siteUrl: notificationSettings.siteUrl,
    unsubscribeUrl: unsubscribeUrl(recipient),
  });

  if (dryRun) {
    summary.skipped += 1;
    summary.messages.push({
      clerkUserId: recipient.clerkUserId,
      channel: "email",
      dealIds: ranked.map((deal) => deal.id),
      status: "would_send",
    });
    return true;
  }

  const outcome = await sendEmail({
    to: recipient.email,
    subject: message.subject,
    html: message.html,
    text: message.text,
    unsubscribeUrl: unsubscribeUrl(recipient),
  });

  for (const entry of claimedByAlert) {
    if (outcome.status === "skipped") {
      await releaseDeliveries({ alertId: entry.alert.id, channel: "email", dealIds: entry.dealIds });
    } else {
      await markDeliveries({
        alertId: entry.alert.id,
        channel: "email",
        dealIds: entry.dealIds,
        outcome,
      });
    }
  }

  if (outcome.status === "sent") {
    summary.sent += 1;
    await setLastDigestAt(recipient.clerkUserId, now);
  } else if (outcome.status === "failed") {
    summary.failed += 1;
  } else {
    summary.skipped += 1;
  }

  summary.messages.push({
    clerkUserId: recipient.clerkUserId,
    channel: "email",
    dealIds: ranked.map((deal) => deal.id),
    status: outcome.status,
    provider: outcome.provider,
    error: outcome.error,
  });

  return true;
}

// ── Shared delivery path ───────────────────────────────────

type BuiltMessage =
  | { kind: "email"; subject: string; html: string; text: string }
  | { kind: "whatsapp"; body: string; templateVariables: Record<string, string> };

/**
 * Claim → build → send → record, for one alert on one channel.
 *
 * Claiming happens before the message is built so that the batch reflects
 * exactly the tenders this run owns: if a parallel run already took two of
 * five, this message must not mention them.
 */
async function deliver(params: {
  recipient: Recipient;
  alert: Alert;
  channel: AlertChannel;
  /** Address resolved by resolveChannels — an email or an E.164 number. */
  to: string;
  /** Which of the two messages a tender may earn; part of the ledger key. */
  reason?: "new" | "opening";
  deals: Deal[];
  dryRun: boolean;
  summary: WorkerSummary;
  build: (batch: Deal[], remainder: number) => BuiltMessage;
}): Promise<void> {
  const { recipient, alert, channel, to, deals, dryRun, summary, build } = params;
  const reason = params.reason ?? "new";

  const dealIds = dryRun
    ? deals.map((deal) => deal.id)
    : await claimDeliveries({
        alertId: alert.id,
        clerkUserId: recipient.clerkUserId,
        channel,
        dealIds: deals.map((deal) => deal.id),
        maxAttempts: notificationSettings.maxAttempts,
        reason,
      });

  if (dealIds.length === 0) return;

  const claimed = rank(deals.filter((deal) => dealIds.includes(deal.id)));
  const batch = claimed.slice(0, notificationSettings.maxItemsPerMessage);
  const remainder = claimed.length - batch.length;
  const message = build(batch, remainder);

  if (dryRun) {
    summary.skipped += 1;
    summary.messages.push({
      clerkUserId: recipient.clerkUserId,
      alertId: alert.id,
      alertName: alert.name,
      channel,
      dealIds,
      status: "would_send",
    });
    return;
  }

  const outcome =
    message.kind === "email"
      ? await sendEmail({
          to,
          subject: message.subject,
          html: message.html,
          text: message.text,
          unsubscribeUrl: unsubscribeUrl(recipient),
        })
      : await sendWhatsApp({
          to,
          body: message.body,
          templateVariables: message.templateVariables,
        });

  if (outcome.status === "skipped") {
    // Not sent for a reason that may not hold next run — give the claim back.
    await releaseDeliveries({ alertId: alert.id, channel, dealIds, reason });
    summary.skipped += 1;
  } else {
    await markDeliveries({ alertId: alert.id, channel, dealIds, outcome, reason });
    if (outcome.status === "sent") summary.sent += 1;
    else summary.failed += 1;
  }

  summary.messages.push({
    clerkUserId: recipient.clerkUserId,
    alertId: alert.id,
    alertName: alert.name,
    channel,
    dealIds,
    status: outcome.status,
    provider: outcome.provider,
    error: outcome.error,
  });
}

function buildInstantEmail(
  alert: Alert,
  batch: Deal[],
  remainder: number,
  recipient: Recipient,
): BuiltMessage {
  const message = instantEmail({
    alertName: alert.name,
    deals: batch.map(toMessageDeal),
    remainder,
    siteUrl: notificationSettings.siteUrl,
    unsubscribeUrl: unsubscribeUrl(recipient),
  });
  return { kind: "email", ...message };
}

function buildWhatsApp(alert: Alert, batch: Deal[], remainder: number): BuiltMessage {
  const message = whatsappAlert({
    alertName: alert.name,
    deals: batch.map(toMessageDeal),
    remainder,
    siteUrl: notificationSettings.siteUrl,
  });
  return { kind: "whatsapp", ...message };
}

/** Which channels this alert can actually reach right now, and at what address. */
function resolveChannels(
  alert: Alert,
  recipient: Recipient,
  tier: Tier,
): { channel: AlertChannel; to: string }[] {
  const resolved: { channel: AlertChannel; to: string }[] = [];

  if (alert.channels.includes("email") && recipient.email && recipient.emailOptIn) {
    resolved.push({ channel: "email", to: recipient.email });
  }
  // WhatsApp is PRO-only, needs a normalised number, and needs its own opt-in:
  // an email address is not consent to message someone's phone.
  if (
    alert.channels.includes("whatsapp") &&
    tier === "pro" &&
    recipient.phone &&
    recipient.whatsappOptIn
  ) {
    resolved.push({ channel: "whatsapp", to: recipient.phone });
  }

  return resolved;
}

/**
 * Best tenders first, so the per-message cap keeps the strongest matches.
 * Deal Score leads because it already carries the winning-premium adjustment
 * (db/008); the appraisal gap only breaks ties between equal scores.
 */
function rank(deals: Deal[]): Deal[] {
  return [...deals].sort(
    (a, b) => b.dealScore - a.dealScore || (b.expectedGapPct ?? 0) - (a.expectedGapPct ?? 0),
  );
}

function toMessageDeal(deal: Deal): MessageDeal {
  return {
    id: deal.id,
    city: deal.city,
    rawAddress: deal.rawAddress,
    zoning: deal.zoning,
    areaSqm: deal.areaSqm,
    askingPrice: deal.askingPrice,
    dealScore: deal.dealScore,
    discountPct: deal.discountPct,
    submissionDeadline: deal.submissionDeadline,
    expectedGapPct: deal.expectedGapPct,
  };
}

function unsubscribeUrl(recipient: Recipient): string | undefined {
  return recipient.unsubscribeToken
    ? `${notificationSettings.siteUrl}/api/notifications/unsubscribe?token=${recipient.unsubscribeToken}`
    : undefined;
}

/**
 * Fills in addresses from Clerk for anyone who never opened the account form.
 *
 * Clerk already holds a verified email for every signed-in user, so requiring
 * people to retype it before alerts work would be a self-inflicted funnel
 * step. Failures here are non-fatal: a recipient without an address is simply
 * not emailed this run.
 */
async function hydrateEmails(recipients: Recipient[], dryRun: boolean): Promise<void> {
  const missing = recipients.filter((recipient) => !recipient.email);
  if (missing.length === 0 || !isAuthConfigured()) return;

  try {
    const client = await clerkClient();
    const { data } = await client.users.getUserList({
      userId: missing.map((recipient) => recipient.clerkUserId),
      limit: Math.min(missing.length, 100),
    });

    const byId = new Map(data.map((user) => [user.id, user]));

    for (const recipient of missing) {
      const user = byId.get(recipient.clerkUserId);
      const email =
        user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
      if (!email) continue;

      recipient.email = email;

      // A dry run resolves the address so its report is accurate, but stops
      // short of storing it. Creating the contact row is a write, and "writes
      // nothing" has to mean nothing — otherwise the safe way to inspect the
      // worker quietly mutates the database it is inspecting.
      if (dryRun) continue;

      // Persist it so the next run needs no Clerk round trip, and so the
      // person has an unsubscribe token before the first message goes out.
      const stored = await ensureContact(recipient.clerkUserId, email);
      if (stored) {
        recipient.unsubscribeToken = stored.unsubscribeToken;
        recipient.tier = stored.tier;
        recipient.lastDigestAt = stored.lastDigestAt;
      }
    }
  } catch {
    // Clerk unreachable or misconfigured — carry on with whoever has a
    // stored address rather than failing the whole run.
  }
}
