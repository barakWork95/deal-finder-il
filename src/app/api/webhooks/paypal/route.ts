import { NextResponse, type NextRequest } from "next/server";
import { revalidatePath } from "next/cache";
import { paypalConfig } from "@/lib/billing/config";
import { verifyWebhook } from "@/lib/billing/paypal";
import {
  applyBillingTier,
  claimWebhookEvent,
  getSubscriptionRow,
  hasActiveSubscription,
  markWebhookEvent,
  recordSubscription,
  updateSubscription,
  type SubscriptionStatus,
} from "@/lib/billing/repository";

/**
 * PayPal webhooks — the authority on who is PRO.
 *
 * Everything else in the billing path is a convenience. The browser's
 * confirm call makes the page update promptly; this is what actually decides,
 * because it is the only source that is not the payer's own browser.
 *
 * Which makes verification the whole security story. An unverified endpoint
 * that sets `tier = 'pro'` is a public endpoint for granting yourself a paid
 * plan — anyone who guesses the URL can POST themselves an upgrade. So:
 *
 *   1. Nothing happens without PAYPAL_WEBHOOK_ID. Not "assume valid", not
 *      "log and continue" — no configuration means no writes, ever.
 *   2. The signature is checked against the raw bytes PayPal sent, before the
 *      body is used for anything.
 *   3. The event is claimed before it is acted on, so a redelivery cannot
 *      grant the same plan twice.
 *   4. Who the subscription belongs to is read from *our* table, keyed by the
 *      row written when the subscription was created — not from a field in
 *      the payload.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type WebhookEvent = {
  id?: string;
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    billing_agreement_id?: string;
    status?: string;
    plan_id?: string;
    create_time?: string;
    billing_info?: {
      next_billing_time?: string;
      last_payment?: { time?: string };
    };
  };
};

/** Subscription lifecycle events carry it as resource.id; sale events don't. */
function subscriptionIdOf(event: WebhookEvent): string | null {
  const type = event.event_type ?? "";
  if (type.startsWith("BILLING.SUBSCRIPTION.")) return event.resource?.id ?? null;
  if (type.startsWith("PAYMENT.SALE.")) return event.resource?.billing_agreement_id ?? null;
  return event.resource?.billing_agreement_id ?? event.resource?.id ?? null;
}

export async function POST(request: NextRequest) {
  const config = paypalConfig();

  // Read as text, not json(): the signature is over the exact bytes, and
  // re-serialising a parsed object can reorder keys or renormalise numbers.
  const rawBody = await request.text();

  if (!config?.webhookId) {
    console.error("[billing] webhook received but PAYPAL_WEBHOOK_ID is not set — ignoring");
    // 503, not 200: PayPal should keep retrying while this is being fixed,
    // rather than being told the event was handled when it was discarded.
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 503 });
  }

  const verified = await verifyWebhook({
    rawBody,
    headers: {
      authAlgo: request.headers.get("paypal-auth-algo") ?? "",
      certUrl: request.headers.get("paypal-cert-url") ?? "",
      transmissionId: request.headers.get("paypal-transmission-id") ?? "",
      transmissionSig: request.headers.get("paypal-transmission-sig") ?? "",
      transmissionTime: request.headers.get("paypal-transmission-time") ?? "",
    },
  });

  if (!verified) {
    console.error("[billing] webhook signature verification failed");
    return NextResponse.json({ error: "invalid_signature" }, { status: 401 });
  }

  let event: WebhookEvent;
  try {
    event = JSON.parse(rawBody) as WebhookEvent;
  } catch {
    return NextResponse.json({ error: "bad_json" }, { status: 400 });
  }

  const eventId = event.id;
  const eventType = event.event_type ?? "";
  if (!eventId || !eventType) {
    return NextResponse.json({ error: "missing_event_fields" }, { status: 400 });
  }

  const subscriptionId = subscriptionIdOf(event);

  const claimed = await claimWebhookEvent({
    id: eventId,
    eventType,
    subscriptionId,
    payload: event,
  });
  // Already handled. 200, or PayPal keeps redelivering something we are
  // deliberately doing nothing about.
  if (!claimed) return NextResponse.json({ ok: true, duplicate: true });

  try {
    const outcome = await handle(eventType, subscriptionId, event);
    await markWebhookEvent(eventId, outcome);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    // 'failed' is re-claimable, so PayPal's retry is a real recovery path
    // rather than something our own deduplication eats.
    await markWebhookEvent(eventId, "failed", (error as Error).message);
    console.error("[billing] webhook handler failed:", eventType, (error as Error).message);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }
}

async function handle(
  eventType: string,
  subscriptionId: string | null,
  event: WebhookEvent,
): Promise<"processed" | "ignored"> {
  if (!subscriptionId) return "ignored";

  // Our own row is the mapping. The payload's custom_id is only a fallback for
  // a subscription created outside this app — which should not happen, but
  // dropping a real payment on the floor because a row is missing would be a
  // worse failure than trusting a field PayPal echoed back to us.
  const row = await getSubscriptionRow(subscriptionId);
  const clerkUserId = row?.clerkUserId ?? event.resource?.custom_id;
  if (!clerkUserId) {
    console.error("[billing] no account for subscription", subscriptionId, eventType);
    return "ignored";
  }

  if (!row && event.resource?.custom_id) {
    // Backfill, so the next event about it does not need the fallback again.
    await recordSubscription({
      id: subscriptionId,
      clerkUserId,
      planId: event.resource.plan_id,
      status: "ACTIVE",
    });
  }

  switch (eventType) {
    case "BILLING.SUBSCRIPTION.ACTIVATED": {
      await updateSubscription({
        id: subscriptionId,
        status: "ACTIVE",
        currentPeriodEnd: event.resource?.billing_info?.next_billing_time ?? null,
      });
      await applyBillingTier({
        clerkUserId,
        tier: "pro",
        note: `PayPal ${subscriptionId} activated`,
      });
      break;
    }

    case "PAYMENT.SALE.COMPLETED": {
      // Every renewal. Re-asserting PRO here is what makes a missed
      // ACTIVATED event self-healing: the next monthly payment fixes it.
      await updateSubscription({
        id: subscriptionId,
        status: "ACTIVE",
        lastPaymentAt: new Date().toISOString(),
      });
      await applyBillingTier({
        clerkUserId,
        tier: "pro",
        note: `PayPal ${subscriptionId} payment received`,
      });
      break;
    }

    case "BILLING.SUBSCRIPTION.CANCELLED":
    case "BILLING.SUBSCRIPTION.EXPIRED":
    case "BILLING.SUBSCRIPTION.SUSPENDED": {
      const status: SubscriptionStatus =
        eventType.endsWith("CANCELLED")
          ? "CANCELLED"
          : eventType.endsWith("EXPIRED")
            ? "EXPIRED"
            : "SUSPENDED";

      await updateSubscription({
        id: subscriptionId,
        status,
        cancelled: status === "CANCELLED",
      });

      // Only if nothing else is still paying. Someone can hold a second
      // subscription — a retried checkout, another device — and cancelling one
      // of them is not cancelling their plan.
      if (!(await hasActiveSubscription(clerkUserId))) {
        await applyBillingTier({
          clerkUserId,
          tier: "free",
          note: `PayPal ${subscriptionId} ${status.toLowerCase()}`,
        });
      }
      break;
    }

    case "BILLING.SUBSCRIPTION.CREATED":
    case "BILLING.SUBSCRIPTION.UPDATED":
    case "BILLING.SUBSCRIPTION.PAYMENT.FAILED":
    case "PAYMENT.SALE.REFUNDED":
    case "PAYMENT.SALE.REVERSED": {
      // Recorded, not acted on. A failed payment is retried by PayPal and
      // ends in SUSPENDED if it keeps failing; a refund does not by itself
      // end a subscription. Both are visible in billing_events either way.
      return "ignored";
    }

    default:
      return "ignored";
  }

  revalidatePath("/account");
  revalidatePath("/alerts");
  revalidatePath("/admin");
  return "processed";
}
