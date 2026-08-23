import { NextResponse } from "next/server";
import { auth, currentUser } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { canCheckout, paypalConfig } from "@/lib/billing/config";
import { createSubscription, PayPalError } from "@/lib/billing/paypal";
import { recordSubscription } from "@/lib/billing/repository";
import { notificationSettings } from "@/lib/notifications/config";

/**
 * Starts a subscription.
 *
 * Unlike /api/events, this one requires a session and says so plainly: a
 * subscription with no account to attach it to is money taken for a plan
 * nobody can be given.
 *
 * The subscription is created here rather than in the browser with the SDK's
 * `actions.subscription.create`. That keeps `custom_id` — the payer's Clerk id
 * — out of reach of the page, and it means the row mapping PayPal's id to a
 * Clerk user exists in our database before the payer has approved anything, so
 * no webhook can arrive about a subscription we cannot attribute.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  if (!isAuthConfigured()) {
    return NextResponse.json({ error: "auth_not_configured" }, { status: 503 });
  }

  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "unauthenticated" }, { status: 401 });

  const config = paypalConfig();
  if (!canCheckout(config)) {
    return NextResponse.json({ error: "billing_not_configured" }, { status: 503 });
  }

  // Prefills the payer's address on PayPal's side. Best-effort: a failure here
  // costs a convenience, and must not cost the checkout.
  let email: string | undefined;
  try {
    const user = await currentUser();
    email = user?.primaryEmailAddress?.emailAddress ?? user?.emailAddresses?.[0]?.emailAddress;
  } catch {
    email = undefined;
  }

  const siteUrl = notificationSettings.siteUrl;

  try {
    const subscription = await createSubscription({
      clerkUserId: userId,
      email,
      returnUrl: `${siteUrl}/account?tab=billing&subscribed=1`,
      cancelUrl: `${siteUrl}/account?tab=billing&cancelled=1`,
      // Scoped to the user and the minute: a double-submitted checkout returns
      // the first subscription instead of opening a second one against the
      // same account.
      requestId: `sub-${userId}-${Math.floor(Date.now() / 60_000)}`,
    });

    await recordSubscription({
      id: subscription.id,
      clerkUserId: userId,
      planId: config.planId,
      status: "CREATED",
      currency: config.currency,
      amount: config.price,
    });

    return NextResponse.json({
      id: subscription.id,
      status: subscription.status,
      approveUrl: subscription.links?.find((link) => link.rel === "approve")?.href ?? null,
    });
  } catch (error) {
    const paypal = error as PayPalError;
    console.error("[billing] create subscription failed:", paypal.message, paypal.detail ?? "");
    // PayPal's own detail is not echoed to the browser: it can name the plan,
    // the merchant account and the failure mode, none of which the payer needs
    // in order to try again.
    return NextResponse.json({ error: "create_failed" }, { status: 502 });
  }
}
