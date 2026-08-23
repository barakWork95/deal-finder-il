/**
 * What a plan allows.
 *
 * No "use client" and no server-only: the same numbers have to be enforced on
 * the server (which is the authority) and known in the browser (so the wall is
 * explained *before* a click appears to work and then silently reverts). One
 * module, so the two can never drift.
 *
 * The pricing table has promised these numbers since the beta banner went up;
 * they live here now rather than in prose.
 */

import type { PlanTier } from "./types";

export type LimitKind = "alerts" | "saved";

/** `null` = no limit. PRO is unlimited on both. */
export const PLAN_LIMITS: Record<PlanTier, Record<LimitKind, number | null>> = {
  free: { alerts: 2, saved: 3 },
  pro: { alerts: null, saved: null },
};

export function limitFor(tier: PlanTier, kind: LimitKind): number | null {
  return PLAN_LIMITS[tier]?.[kind] ?? PLAN_LIMITS.free[kind];
}

/**
 * Whether one more would exceed the plan.
 *
 * Deliberately `>=`, not `>`. Someone who accumulated five alerts during the
 * open beta is not asked to delete three before the app works again — nothing
 * of theirs is removed, and everything they already have keeps running. They
 * simply cannot add a sixth until they are back under the line or on PRO.
 * Taking things away from people who were invited to create them would be a
 * worse trade than a blocked button.
 */
export function isAtLimit(tier: PlanTier, kind: LimitKind, current: number): boolean {
  const limit = limitFor(tier, kind);
  return limit != null && current >= limit;
}

/** How many more they could add. `null` = unlimited; never negative. */
export function headroom(tier: PlanTier, kind: LimitKind, current: number): number | null {
  const limit = limitFor(tier, kind);
  return limit == null ? null : Math.max(0, limit - current);
}

/**
 * What the wall says. Hebrew, and specific about *why* — "הגעת למגבלה" alone
 * reads as a fault rather than a plan boundary, and a person who has five
 * alerts from the beta needs to be told that none of them were touched.
 */
export const LIMIT_COPY: Record<LimitKind, { title: string; body: (limit: number) => string }> = {
  alerts: {
    title: "הגעת למספר ההתראות במסלול החינם",
    body: (limit) =>
      `מסלול החינם כולל עד ${limit} התראות פעילות. ההתראות הקיימות שלך ממשיכות לעבוד כרגיל — ` +
      `כדי להוסיף עוד אפשר להשהות או למחוק התראה קיימת, או לעבור ל-PRO ללא הגבלה.`,
  },
  saved: {
    title: "הגעת למספר העסקאות השמורות במסלול החינם",
    body: (limit) =>
      `מסלול החינם כולל עד ${limit} עסקאות שמורות. השמורות הקיימות שלך נשארות במקומן — ` +
      `כדי לשמור עוד אפשר להסיר אחת מהן, או לעבור ל-PRO ללא הגבלה.`,
  },
};
