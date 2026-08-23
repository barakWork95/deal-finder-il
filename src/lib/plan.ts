import "server-only";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "./auth";
import { tierOf } from "./user-repository";
import type { PlanTier } from "./types";

/**
 * The visitor's plan, for pages that gate a feature.
 *
 * Resolved on the server rather than from the client mirror on purpose. The
 * mirror starts empty and fills in after a fetch, so a PRO subscriber would
 * watch a paywall appear and then disappear on every page load — showing
 * someone who paid a locked version of what they bought, however briefly, is
 * the one failure mode worth spending a query to avoid.
 *
 * Signed out is always free: there is no account to carry a plan.
 */
export async function currentTier(): Promise<PlanTier> {
  if (!isAuthConfigured()) return "free";
  const { userId } = await auth();
  if (!userId) return "free";
  return tierOf(userId);
}
