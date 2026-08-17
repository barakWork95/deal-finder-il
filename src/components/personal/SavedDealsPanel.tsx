"use client";

import Link from "next/link";
import { ArrowLeft, BookmarkX, Gavel } from "lucide-react";
import type { Deal } from "@/lib/types";
import { formatILS, formatLandArea } from "@/lib/format";
import { submissionInfo } from "@/lib/tender-phase";
import { useSavedDeals } from "@/lib/personal-data";
import type { UserData } from "@/lib/user-repository";
import { DealTypeChip, DiscountTag, ScoreChip } from "@/components/ui";
import { EmptyState, IconBtn } from "@/components/personal/controls";

/**
 * Saved tenders. Only ids are stored locally — the tender itself comes from
 * the live feed passed in by the server, so a saved deal never shows a stale
 * price or a deadline that has since moved.
 */
export function SavedDealsPanel({ deals, account }: { deals: Deal[]; account?: UserData }) {
  const { ids, remove } = useSavedDeals(account);
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
          </span>
        )}
      </div>

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

                {d.expectedGapPct != null && (
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
