"use server";

import { revalidatePath } from "next/cache";
import { currentAdminId } from "@/lib/admin";
import {
  logAdminAction,
  resubscribeContact,
  retryDelivery,
  setUserTier,
  type Tier,
} from "@/lib/admin-repository";

/**
 * Admin mutations.
 *
 * Each one re-derives the admin from the session rather than trusting anything
 * the form sent. A server action is a public POST endpoint with a
 * hard-to-guess name — not a private function — so "the button is only
 * rendered for admins" is not access control, and the page's own guard
 * protects only the page.
 */

export type AdminResult = { ok: true; message?: string } | { ok: false; reason: string };

const FORBIDDEN: AdminResult = { ok: false, reason: "forbidden" };

const id = (value: unknown, max = 64): string => String(value ?? "").trim().slice(0, max);

/**
 * Grants or revokes PRO.
 *
 * This is now the only thing that decides who is PRO: user_contacts.tier is the
 * source of truth, and NOTIFY_PRO_USER_IDS is a deprecated bootstrap that can
 * no longer overturn a decision made here (see syncLegacyProGrants).
 */
export async function setUserTierAction(input: {
  clerkUserId: string;
  tier: Tier;
  note?: string;
}): Promise<AdminResult> {
  const actorId = await currentAdminId();
  if (!actorId) return FORBIDDEN;

  const clerkUserId = id(input.clerkUserId);
  const tier: Tier = input.tier === "pro" ? "pro" : "free";
  const note = input.note ? String(input.note).slice(0, 200) : null;
  if (!clerkUserId) return { ok: false, reason: "missing_user" };

  await setUserTier({ clerkUserId, tier, actorId, note });
  await logAdminAction({ actorId, action: "tier.set", subject: clerkUserId, detail: { tier, note } });

  revalidatePath("/admin");
  // The plan changes what the billing panel says about the person, and that
  // page is force-dynamic per user — revalidating it keeps a signed-in tab
  // from showing yesterday's plan.
  revalidatePath("/alerts");
  revalidatePath("/account");

  return { ok: true, message: tier === "pro" ? "שודרג ל-PRO" : "הוחזר למסלול חינם" };
}

/**
 * Clears a failed delivery so the next worker run may send it again.
 * Only ever a row the worker gave up on; a sent message stays sent.
 */
export async function retryDeliveryAction(input: {
  alertId: string;
  dealId: string;
  channel: string;
  reason: string;
}): Promise<AdminResult> {
  const actorId = await currentAdminId();
  if (!actorId) return FORBIDDEN;

  const params = {
    alertId: id(input.alertId),
    dealId: id(input.dealId),
    channel: input.channel === "whatsapp" ? "whatsapp" : "email",
    reason: input.reason === "opening" ? "opening" : "new",
  };

  const cleared = await retryDelivery(params);
  if (cleared === 0) return { ok: false, reason: "not_failed" };

  await logAdminAction({
    actorId,
    action: "delivery.retry",
    subject: params.alertId,
    detail: { ...params },
  });

  revalidatePath("/admin");
  return { ok: true, message: "השורה נוקתה — הריצה הבאה תשלח שוב" };
}

/**
 * Reverses an unsubscribe. Deliberately narrow: it only undoes the flag, and it
 * exists for the case where someone asks to be put back on — never as a way to
 * quietly re-enrol people who opted out.
 */
export async function resubscribeContactAction(clerkUserId: string): Promise<AdminResult> {
  const actorId = await currentAdminId();
  if (!actorId) return FORBIDDEN;

  const subject = id(clerkUserId);
  const restored = await resubscribeContact(subject);
  if (restored === 0) return { ok: false, reason: "not_unsubscribed" };

  await logAdminAction({ actorId, action: "contact.resubscribe", subject });
  revalidatePath("/admin");
  return { ok: true, message: "ההרשמה שוחזרה" };
}
