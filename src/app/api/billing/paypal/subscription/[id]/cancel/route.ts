import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { cancelSubscription } from "@/lib/billing/paypal";
import {
  applyBillingTier,
  getSubscriptionRow,
  hasActiveSubscription,
  updateSubscription,
} from "@/lib/billing/repository";

/**
 * Cancels a subscription, at the subscriber's own request.
 *
 * "ביטול בכל עת" is on the pricing table, so it has to be one button here and
 * not an email to support. PayPal keeps the plan running to the end of the
 * period it was paid for; we mirror that by leaving the tier alone until their
 * webhook says the subscription actually ended, rather than revoking a plan
 * somebody has already paid for the rest of the month.
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

  const row = await getSubscriptionRow(subscriptionId);
  if (!row || row.clerkUserId !== userId) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (row.status === "CANCELLED" || row.status === "EXPIRED") {
    return NextResponse.json({ status: row.status, alreadyCancelled: true });
  }

  try {
    await cancelSubscription(subscriptionId, "Cancelled by the subscriber from קרקעHOT");
  } catch (error) {
    console.error("[billing] cancel failed:", (error as Error).message);
    return NextResponse.json({ error: "cancel_failed" }, { status: 502 });
  }

  await updateSubscription({ id: subscriptionId, status: "CANCELLED", cancelled: true });

  // If this was their only live subscription and the plan came from billing,
  // drop it now. applyBillingTier refuses to touch an admin-granted plan, so a
  // comped account keeps what it was given.
  if (!(await hasActiveSubscription(userId))) {
    await applyBillingTier({
      clerkUserId: userId,
      tier: "free",
      note: `PayPal ${subscriptionId} cancelled by subscriber`,
    });
  }

  revalidatePath("/account");
  revalidatePath("/alerts");
  return NextResponse.json({ status: "CANCELLED" });
}
