import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { getSubscription } from "@/lib/billing/paypal";
import {
  applyBillingTier,
  getSubscriptionRow,
  updateSubscription,
} from "@/lib/billing/repository";
import { revalidatePath } from "next/cache";

/**
 * Called by the browser once PayPal reports the payer approved — the
 * "capture" step, in the vocabulary of one-off orders.
 *
 * It exists for latency, not for correctness. The webhook is the authority on
 * whether someone is PRO; this simply asks PayPal for the subscription's
 * current status so the page can update now rather than whenever the webhook
 * lands. Both paths go through the same idempotent write, so whichever arrives
 * first wins and the second changes nothing.
 *
 * The status is fetched from PayPal, never taken from the request. The browser
 * can say anything; the only thing it is trusted for here is *which*
 * subscription to go and ask about — and even that is checked against the row
 * we wrote when it was created.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const { id } = await context.params;
  const subscriptionId = String(id).slice(0, 64);

  // Scoped to the caller: confirming somebody else's subscription must not be
  // possible by guessing an id, even though the worst it could do is upgrade
  // the person who actually paid.
  const row = await getSubscriptionRow(subscriptionId);
  if (!row || row.clerkUserId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  try {
    const subscription = await getSubscription(subscriptionId);

    await updateSubscription({
      id: subscriptionId,
      status: subscription.status as never,
      currentPeriodEnd: subscription.billing_info?.next_billing_time ?? null,
      lastPaymentAt: subscription.billing_info?.last_payment?.time ?? null,
    });

    const active = subscription.status === "ACTIVE";
    if (active) {
      await applyBillingTier({
        clerkUserId: userId,
        tier: "pro",
        note: `PayPal ${subscriptionId}`,
      });
      revalidatePath("/account");
      revalidatePath("/alerts");
    }

    return NextResponse.json({ status: subscription.status, pro: active });
  } catch (error) {
    console.error("[billing] confirm failed:", (error as Error).message);
    // Deliberately not an error the UI treats as failure: the webhook will
    // still arrive and grant the plan. Saying "it failed" to someone whose
    // money has left their account is worse than saying "this is pending".
    return NextResponse.json({ status: "PENDING", pro: false }, { status: 202 });
  }
}
