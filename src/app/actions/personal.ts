"use server";

import { revalidatePath } from "next/cache";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import type { Alert, AlertChannel, AlertFrequency } from "@/lib/types";
import {
  deleteAlert,
  insertAlert,
  setAlertActive,
  setDealSaved,
  getUserData,
  type UserData,
} from "@/lib/user-repository";
import { upsertContact } from "@/lib/notifications/repository";

/**
 * Mutations for a signed-in user's alerts and saved tenders.
 *
 * Server actions rather than route handlers: the client already has to await
 * them for the optimistic update to settle, and revalidatePath keeps the
 * server-rendered personal area in step without a second round trip.
 *
 * The client's optimistic state is a *display* convenience — it is never
 * trusted here. Every action re-reads the session and scopes its SQL by the
 * Clerk user id, so a forged alert id belonging to someone else matches no
 * rows.
 */

export type ActionResult = { ok: true } | { ok: false; reason: "unauthenticated" };

async function currentUserId(): Promise<string | null> {
  if (!isAuthConfigured()) return null;
  const { userId } = await auth();
  return userId;
}

const CHANNELS: AlertChannel[] = ["whatsapp", "email"];
const FREQUENCIES: AlertFrequency[] = ["instant", "daily", "weekly"];

/** Rebuilt field by field: this crosses the network from the browser. */
function sanitiseAlert(input: Alert): Alert {
  return {
    id: String(input.id).slice(0, 64),
    name: String(input.name ?? "").slice(0, 120) || "התראה",
    filters: input.filters && typeof input.filters === "object" ? input.filters : {},
    channels: Array.isArray(input.channels)
      ? input.channels.filter((c): c is AlertChannel => CHANNELS.includes(c))
      : [],
    frequency: FREQUENCIES.includes(input.frequency) ? input.frequency : "instant",
    isActive: input.isActive !== false,
    notifyOnOpen: input.notifyOnOpen !== false,
    triggeredThisMonth: 0,
  };
}

export async function createAlertAction(alert: Alert): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };

  await insertAlert(userId, sanitiseAlert(alert));
  revalidatePath("/alerts");
  return { ok: true };
}

export async function setAlertActiveAction(
  alertId: string,
  isActive: boolean,
): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };

  await setAlertActive(userId, String(alertId).slice(0, 64), isActive);
  revalidatePath("/alerts");
  return { ok: true };
}

export async function deleteAlertAction(alertId: string): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };

  await deleteAlert(userId, String(alertId).slice(0, 64));
  revalidatePath("/alerts");
  return { ok: true };
}

export async function setDealSavedAction(dealId: string, saved: boolean): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };

  await setDealSaved(userId, String(dealId).slice(0, 64), saved);
  revalidatePath("/alerts");
  return { ok: true };
}

/**
 * Contact details, mirrored from the account form into user_contacts.
 *
 * The browser copy stays where it was (localStorage, so guests keep working),
 * but the sender runs on a server that cannot read it — the notification
 * worker needs an address of its own. Email falls back to the verified one on
 * the Clerk profile, so this is really about the phone number and about
 * WhatsApp consent, which is why saving a number turns the opt-in on and
 * clearing it turns it off.
 */
export async function saveContactAction(input: {
  fullName?: string;
  email?: string;
  phone?: string;
}): Promise<ActionResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, reason: "unauthenticated" };

  await upsertContact(userId, {
    fullName: String(input.fullName ?? "").slice(0, 120),
    email: String(input.email ?? "").slice(0, 254),
    phone: String(input.phone ?? "").slice(0, 24),
    whatsappOptIn: Boolean(input.phone),
  });
  return { ok: true };
}

/** Used by the client store to load the account outside the personal area. */
export async function fetchUserDataAction(): Promise<UserData | null> {
  const userId = await currentUserId();
  if (!userId) return null;
  return getUserData(userId);
}
