"use client";

import Link from "next/link";
import { ArrowLeft, BookmarkX, Crown, Gavel } from "lucide-react";
import type { Deal } from "@/lib/types";
import { formatILS, formatLandArea } from "@/lib/format";
import { submissionInfo } from "@/lib/tender-phase";
import { useSavedDeals } from "@/lib/personal-data";
import { hasFeature, isAtLimit, limitFor } from "@/lib/limits";
import { useUpgradeGate } from "@/components/UpgradeGate";
import { trackEvent } from "@/lib/events";
import type { UserData } from "@/lib/user-repository";
import type { PlanTier } from "@/lib/types";
import { DealTypeChip, DiscountTag, ScoreChip } from "@/components/ui";
import { EmptyState, IconBtn } from "@/components/personal/controls";

/**
 * Saved tenders. Only ids are stored locally — the tender itself comes from
 * the live feed passed in by the server, so a saved deal never shows a stale
 * price or a deadline that has since moved.
 */
export function SavedDealsPanel({
  deals,
  account,
  serverTier = "free",
}: {
  deals: Deal[];
  account?: UserData;
  /**
   * The plan as the server resolved it — the same value that decided whether
   * the projection was stripped out of `deals` at all.
   *
   * Deliberately not the store's tier, which is what the save-limit logic
   * below uses. The store reads `signedIn` from Clerk, and that is false until
   * Clerk finishes loading, so a PRO subscriber's first render would call
   * itself free and paint a lock over the number they are paying for before
   * flipping back. src/lib/plan.ts spends a query per request to avoid exactly
   * that flash; it would be undone here by deriving the same answer from the
   * client mirror.
   *
   * Pairing it with the strip has a second benefit: display and data can never
   * disagree, because one value decides both.
   */
  serverTier?: PlanTier;
}) {
  const { ids, remove, tier } = useSavedDeals(account);
  const { show } = useUpgradeGate();
  const savedLimit = limitFor(tier, "saved");
  // The projection fields are stripped server-side for this plan (see
  // PersonalAreaRoute), so this decides what stands in their place — it is not
  // what hides them.
  const premiumLocked = !hasFeature(serverTier, "premium_calculator");
  const atSavedLimit = isAtLimit(tier, "saved", ids.length);
  const byId = new Map(deals.map((d) => [d.id, d]));

  const saved = ids.map((id) => byId.get(id)).filter((d): d is Deal => Boolean(d));
  const goneCount = ids.length - saved.length;

  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h1 className="text-xl font-extrabold text-primary">עסקאות שמורות</h1>
        {saved.length > 0 && (
          <span className="text-xs text-faint">
            <span className="num font-semibold text-muted">{saved.length}</span> מכרזים
            {savedLimit != null && (
              <>
                {" "}
                <span className="text-faint">מתוך</span>{" "}
                <span className="num font-semibold text-muted">{savedLimit}</span>
              </>
            )}
          </span>
        )}
      </div>

      {/* Shown here as well as at the point of refusal, so the number is
          visible while deciding what to remove rather than only when the next
          save is blocked. */}
      {atSavedLimit && savedLimit != null && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning-soft p-3 text-[11px] leading-relaxed text-warning">
          <Crown size={14} className="mt-px shrink-0" />
          <span>
            הגעת ל-<span className="num font-bold">{savedLimit}</span> העסקאות השמורות של מסלול
            החינם. השמורות הקיימות נשארות — כדי לשמור עסקה נוספת אפשר להסיר אחת מהן, או{" "}
            <button
              type="button"
              onClick={() => show({ kind: "saved", limit: savedLimit, current: ids.length })}
              className="font-bold underline hover:no-underline"
            >
              לעבור ל-PRO
            </button>
            .
          </span>
        </div>
      )}

      {goneCount > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[11px] text-muted">
          <span>
            <span className="num font-semibold">{goneCount}</span> מכרזים שסימנת אינם פעילים יותר (נסגרו
            או הוסרו).
          </span>
          <button
            type="button"
            onClick={() => void Promise.all(ids.filter((id) => !byId.has(id)).map(remove))}
            className="font-semibold text-accent hover:underline"
          >
            הסרה מהרשימה
          </button>
        </div>
      )}

      {saved.length === 0 ? (
        <EmptyState title="אין עדיין עסקאות שמורות">
          סמנו מכרזים בפיד בעזרת כפתור הסימנייה, והם יופיעו כאן למעקב.{" "}
          <Link href="/" className="font-semibold text-accent hover:underline">
            למעבר לפיד
          </Link>
        </EmptyState>
      ) : (
        <div className="space-y-3">
          {saved.map((d) => (
            <div
              key={d.id}
              className="card-hover flex gap-3 rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)] transition"
            >
              <ScoreChip score={d.dealScore} size="sm" />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <Link
                    href={`/deal/${d.id}`}
                    className="font-bold text-primary transition hover:text-accent"
                  >
                    {[d.city, d.neighborhood].filter(Boolean).join(" · ")}
                  </Link>
                  <span className="num text-sm font-bold text-primary" dir="ltr">
                    {formatILS(d.askingPrice)}
                  </span>
                </div>

                <p className="mt-0.5 text-xs text-muted">
                  {d.propertyType} · {formatLandArea(d.areaSqm)} · ייעוד: {d.zoning}
                </p>

                {/* Locked, not dropped. Removing the line for a free account
                    would read as "this tender has no projection", which is a
                    different fact — the same distinction the feed's PremiumCell
                    draws. It shows on every saved tender because whether this
                    one has a projection is itself behind the gate, so the
                    button offers the capability rather than implying a number
                    exists. */}
                {premiumLocked ? (
                  <button
                    type="button"
                    onClick={() => {
                      trackEvent("limit_hit", { kind: "premium_calculator", tier: serverTier });
                      show({ feature: "premium_calculator" });
                    }}
                    className="mt-1 inline-flex items-center gap-1.5 rounded-md border border-dashed border-accent/40 px-1.5 py-0.5 text-[11px] font-medium text-muted transition hover:bg-accent-soft"
                  >
                    <Gavel size={11} />
                    פער חזוי משומה
                    <span className="inline-flex items-center gap-0.5 font-bold text-accent">
                      <Crown size={10} />
                      PRO
                    </span>
                  </button>
                ) : (
                  d.expectedGapPct != null && (
                    <p
                      className={`mt-1 flex items-center gap-1 text-[11px] font-medium ${
                        d.expectedGapPct > 0 ? "text-positive" : "text-warning"
                      }`}
                    >
                      <Gavel size={11} />
                      {d.expectedGapPct > 0
                        ? `חזוי ${Math.round(d.expectedGapPct)}% מתחת לשומה`
                        : `חזוי ${Math.abs(Math.round(d.expectedGapPct))}% מעל השומה`}
                    </p>
                  )
                )}

                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
                  <DealTypeChip type={d.dealType} />
                  <span className="text-faint">{submissionInfo(d).label}</span>
                  <span className="text-faint">
                    פער משומה: <DiscountTag pct={d.discountPct} />
                  </span>
                  <Link
                    href={`/deal/${d.id}`}
                    className="ms-auto inline-flex items-center gap-1 font-semibold text-accent hover:underline"
                  >
                    פרטים <ArrowLeft size={12} />
                  </Link>
                </div>
              </div>

              <IconBtn
                onClick={() => void remove(d.id)}
                title="הסרה מהעסקאות השמורות"
                tone="danger"
              >
                <BookmarkX size={14} />
              </IconBtn>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
