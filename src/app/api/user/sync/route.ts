import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { getUserData, mergeUserData, type UserData } from "@/lib/user-repository";
import type { Alert, AlertChannel, AlertFrequency } from "@/lib/types";

/**
 * Bridges the per-browser personal area to the account.
 *
 *   GET   → what this account has stored
 *   POST  → merge the browser's alerts + saved tenders in, return the union
 *
 * The client posts once per browser after the first sign-in and then adopts
 * the response, so two devices converge instead of overwriting each other.
 *
 * The merge is also where a free plan's limits have to hold: without that,
 * creating ten alerts signed out and then signing in would be the way around
 * them. mergeUserData rations only the genuinely new ones, and removes nothing.
 */

export const dynamic = "force-dynamic";

const CHANNELS: AlertChannel[] = ["whatsapp", "email"];
const FREQUENCIES: AlertFrequency[] = ["instant", "daily", "weekly"];

/** The request body is user input: rebuild it field by field, never trust it. */
function sanitise(body: unknown): UserData {
  const raw = (body ?? {}) as { alerts?: unknown; savedDealIds?: unknown };

  const alerts: Alert[] = Array.isArray(raw.alerts)
    ? raw.alerts.slice(0, 100).flatMap((item) => {
        const a = item as Partial<Alert>;
        if (!a || typeof a.id !== "string" || typeof a.name !== "string") return [];
        const channels = Array.isArray(a.channels)
          ? a.channels.filter((c): c is AlertChannel => CHANNELS.includes(c as AlertChannel))
          : [];
        return [
          {
            id: a.id.slice(0, 64),
            name: a.name.slice(0, 120),
            filters: (a.filters && typeof a.filters === "object" ? a.filters : {}) as Alert["filters"],
            channels,
            frequency: FREQUENCIES.includes(a.frequency as AlertFrequency)
              ? (a.frequency as AlertFrequency)
              : "instant",
            isActive: a.isActive !== false,
            notifyOnOpen: a.notifyOnOpen !== false,
            triggeredThisMonth: 0,
          },
        ];
      })
    : [];

  const savedDealIds = Array.isArray(raw.savedDealIds)
    ? raw.savedDealIds.filter((id): id is string => typeof id === "string").slice(0, 500)
    : [];

  // The browser does not get a say in the plan: whatever it posts, the merge
  // reads the real tier from the database.
  return { alerts, savedDealIds, tier: "free" };
}

/** 501 rather than 401 when auth simply isn't switched on yet. */
async function requireUser() {
  if (!isAuthConfigured()) {
    return { error: NextResponse.json({ error: "auth_not_configured" }, { status: 501 }) };
  }
  const { userId } = await auth();
  if (!userId) {
    return { error: NextResponse.json({ error: "unauthenticated" }, { status: 401 }) };
  }
  return { userId };
}

export async function GET() {
  const { userId, error } = await requireUser();
  if (error) return error;
  return NextResponse.json(await getUserData(userId));
}

export async function POST(request: Request) {
  const { userId, error } = await requireUser();
  if (error) return error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const merged = await mergeUserData(userId, sanitise(body));
  return NextResponse.json(merged);
}
