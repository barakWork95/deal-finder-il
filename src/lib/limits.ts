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
  // Fall back to the free *plan*, never to a free *value*.
  //
  // This was `PLAN_LIMITS[tier]?.[kind] ?? PLAN_LIMITS.free[kind]`, which reads
  // as "an unknown plan is treated as free" and is — except that PRO's limits
  // are deliberately `null` for "unlimited", and `??` cannot tell an
  // intentional null from a missing one. So every PRO lookup fell through to
  // the free number and paying accounts were held to 2 alerts and 3 saved
  // tenders. The guard against an unknown tier has to be applied to the plan
  // it selects, not to the answer it returns.
  const plan = PLAN_LIMITS[tier] ?? PLAN_LIMITS.free;
  return plan[kind];
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

// ── Capability gates ───────────────────────────────────────
//
// Separate from the quotas above, and deliberately a different shape. A quota
// is "you have three of a thing you may have three of" and needs numbers to
// explain itself. A capability is simply not part of the free plan, and
// pretending it has a count would make the copy worse, not better.

export type ProFeature = "score_filter" | "premium_calculator";

/**
 * Every gated capability is PRO-only, so this does not branch on which one —
 * it takes the feature anyway so call sites read as a question about that
 * feature, and so a future plan that unlocks one but not another is a change
 * here rather than at twenty call sites.
 */
export function hasFeature(tier: PlanTier, feature: ProFeature): boolean {
  return tier === "pro" && FEATURE_COPY[feature] !== undefined;
}

/**
 * The score presets a free account may use. 60+ stays open because the feed
 * has to be useful without paying — what PRO buys is the sharp end of it,
 * which is exactly what the pricing table has been promising ("סינון אוטומטי
 * לפי ציון עסקה 80+").
 */
export const FREE_MAX_SCORE_FILTER = 60;

export function isScorePresetLocked(tier: PlanTier, preset: number): boolean {
  return !hasFeature(tier, "score_filter") && preset > FREE_MAX_SCORE_FILTER;
}

export const FEATURE_COPY: Record<ProFeature, { title: string; body: string }> = {
  score_filter: {
    title: "סינון לפי ציון עסקה 80+ הוא יכולת PRO",
    body:
      "מסלול החינם כולל סינון עד ציון 60. הסינון לציונים הגבוהים — המכרזים שבהם הפער מול השומה " +
      "הכי גדול — פתוח למנויי PRO. שאר הפילטרים והפיד המלא נשארים זמינים לכולם.",
  },
  premium_calculator: {
    title: "מחשבון פרמיית הזכייה המלא הוא יכולת PRO",
    body:
      "מסלול החינם מציג את הבסיס לחישוב — מחיר המינימום, השומה הרשמית ומספר המכרזים שנבדקו. " +
      "התחזית עצמה, כמה צפויים לשלם מעל המינימום ומה מחיר הזכייה הצפוי, פתוחה למנויי PRO.",
  },
};
