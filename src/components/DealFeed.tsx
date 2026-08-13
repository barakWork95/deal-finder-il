"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { BellPlus, LayoutGrid, Table2, Clock, ArrowLeft, Gavel, Map as MapIcon } from "lucide-react";
import type { Deal, DealType } from "@/lib/types";
import {
  DEAL_TYPE_LABEL,
  deadlineInfo,
  formatILS,
  formatILSCompact,
  formatLandArea,
} from "@/lib/format";
import { DealBadge, DealTypeChip, ScoreChip, DiscountTag } from "@/components/ui";
import { SaveDealButton } from "@/components/SaveDealButton";
import { buildAlertHref } from "@/lib/alert-prefill";

type SortKey = "score" | "discount" | "price_asc" | "deadline" | "expected_gap" | "premium";
type ViewMode = "table" | "cards" | "map";

// Leaflet touches `window` at import time, so the map never prerenders.
const DealMap = dynamic(() => import("@/components/DealMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[clamp(420px,68vh,760px)] place-items-center rounded-xl border border-border bg-surface text-sm text-muted">
      טוען מפה…
    </div>
  ),
});

const DEAL_TYPES: DealType[] = ["foreclosure", "rami_tender", "price_drop", "inheritance"];
const DISCOUNT_PRESETS = [0, 10, 15, 20];
// Mirrors the Deal Score tiers used everywhere else (80+ green, 60–79 amber).
const SCORE_PRESETS = [0, 60, 80, 90];
const PRICE_MAX = 60_000_000; // real RMI land tenders reach tens of millions

/** True on phone-width screens; cards replace the wide table there. */
function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const update = () => setIsMobile(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);
  return isMobile;
}

export function DealFeed({ deals, cities }: { deals: Deal[]; cities: string[] }) {
  const [city, setCity] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<number>(PRICE_MAX);
  const [minDiscount, setMinDiscount] = useState<number>(0);
  const [minScore, setMinScore] = useState<number>(0);
  const [types, setTypes] = useState<DealType[]>([]);
  // "Realistic" = expected winning price still below the official appraisal.
  const [onlyRealistic, setOnlyRealistic] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<ViewMode>("table");
  const isMobile = useIsMobile();
  // The wide table has no phone layout; the map does, so it stays available.
  const effectiveView: ViewMode = isMobile && view === "table" ? "cards" : view;

  function toggleType(t: DealType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function reset() {
    setCity("");
    setMaxPrice(PRICE_MAX);
    setMinDiscount(0);
    setMinScore(0);
    setTypes([]);
    setOnlyRealistic(false);
  }

  const filtered = useMemo(() => {
    const result = deals.filter((d) => {
      if (d.status === "sold") return false;
      if (city && d.city !== city) return false;
      if (d.askingPrice > maxPrice) return false;
      if (d.discountPct < minDiscount) return false;
      if (d.dealScore < minScore) return false;
      if (types.length && !types.includes(d.dealType)) return false;
      if (onlyRealistic && !((d.expectedGapPct ?? -1) > 0)) return false;
      return true;
    });
    const nullLast = (v: number | undefined) => (v == null ? -Infinity : v);
    result.sort((a, b) => {
      switch (sort) {
        case "discount":
          return b.discountPct - a.discountPct;
        case "expected_gap":
          return nullLast(b.expectedGapPct) - nullLast(a.expectedGapPct);
        case "premium":
          return nullLast(b.winningPremium) - nullLast(a.winningPremium);
        case "price_asc":
          return a.askingPrice - b.askingPrice;
        case "deadline": {
          const av = a.submissionDeadline ? new Date(a.submissionDeadline).getTime() : Infinity;
          const bv = b.submissionDeadline ? new Date(b.submissionDeadline).getTime() : Infinity;
          return av - bv;
        }
        default:
          return b.dealScore - a.dealScore;
      }
    });
    return result;
  }, [deals, city, maxPrice, minDiscount, minScore, types, sort, onlyRealistic]);

  const activeFilterCount =
    (city ? 1 : 0) +
    (maxPrice < PRICE_MAX ? 1 : 0) +
    (minDiscount > 0 ? 1 : 0) +
    (minScore > 0 ? 1 : 0) +
    types.length +
    (onlyRealistic ? 1 : 0);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      {/* Filter bar */}
      <div className="rounded-xl border border-border bg-surface p-3 shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-end gap-3">
          <FilterField label="עיר">
            <select value={city} onChange={(e) => setCity(e.target.value)} className="input min-w-[150px]">
              <option value="">כל הערים</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FilterField>

          <FilterField label={`תקציב מקסימלי: ${formatILSCompact(maxPrice)}`}>
            <input
              type="range"
              min={500_000}
              max={PRICE_MAX}
              step={500_000}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="w-44 accent-[var(--accent)]"
            />
          </FilterField>

          <FilterField label="פער משומה מינ׳">
            <div className="flex gap-1">
              {DISCOUNT_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setMinDiscount(p)}
                  className={`num rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                    minDiscount === p
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface-2 text-muted hover:text-primary"
                  }`}
                >
                  {p === 0 ? "הכל" : `${p}%+`}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="ציון עסקה מינ׳">
            <div className="flex gap-1">
              {SCORE_PRESETS.map((p) => (
                <button
                  key={p}
                  onClick={() => setMinScore(p)}
                  className={`num rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                    minScore === p
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface-2 text-muted hover:text-primary"
                  }`}
                >
                  {p === 0 ? "הכל" : `${p}+`}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="סוג עסקה">
            <div className="flex flex-wrap gap-1">
              {DEAL_TYPES.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleType(t)}
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                    types.includes(t)
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface-2 text-muted hover:text-primary"
                  }`}
                >
                  {DEAL_TYPE_LABEL[t]}
                </button>
              ))}
            </div>
          </FilterField>

          <FilterField label="סינון חכם">
            <button
              onClick={() => setOnlyRealistic((v) => !v)}
              title="מציג רק מכרזים שגם לאחר פרמיית הזכייה החזויה צפויים להישאר מתחת לשומה"
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                onlyRealistic
                  ? "border-positive bg-positive-soft text-positive"
                  : "border-border bg-surface-2 text-muted hover:text-primary"
              }`}
            >
              <Gavel size={13} /> מתחת לשומה גם אחרי פרמיה
            </button>
          </FilterField>

          <div className="ms-auto flex items-center gap-2">
            {activeFilterCount > 0 && (
              <button
                onClick={reset}
                className="rounded-lg px-3 py-2 text-xs font-medium text-muted transition hover:text-primary"
              >
                ניקוי ({activeFilterCount})
              </button>
            )}
            <Link
              href={buildAlertHref({
                city: city || undefined,
                // Only a budget that actually narrows the feed is worth carrying.
                maxPrice: maxPrice < PRICE_MAX ? maxPrice : undefined,
                minDiscount,
                minScore,
                types,
              })}
              title="פתיחת טופס התראה עם הסינון הנוכחי"
              className="flex items-center gap-1.5 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs font-semibold text-primary transition hover:border-border-strong"
            >
              <BellPlus size={14} /> שמירת סינון כהתראה
            </Link>
          </div>
        </div>
      </div>

      {/* Result meta + sort + view toggle */}
      <div className="mt-4 mb-3 flex flex-wrap items-center gap-3">
        <p className="text-sm text-muted">
          <span className="num font-bold text-primary">{filtered.length}</span> עסקאות פעילות
        </p>
        <div className="ms-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            מיון:
            <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="input">
              <option value="score">ציון עסקה</option>
              <option value="expected_gap">פער חזוי (אחרי פרמיה)</option>
              <option value="premium">פרמיית זכייה</option>
              <option value="discount">פער משומה</option>
              <option value="price_asc">מחיר (נמוך לגבוה)</option>
              <option value="deadline">מועד הגשה קרוב</option>
            </select>
          </label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            <ToggleBtn active={effectiveView === "cards"} onClick={() => setView("cards")}>
              <LayoutGrid size={14} /> כרטיסים
            </ToggleBtn>
            <ToggleBtn
              active={effectiveView === "table"}
              onClick={() => setView("table")}
              className="hidden md:inline-flex"
            >
              <Table2 size={14} /> טבלה
            </ToggleBtn>
            <ToggleBtn active={effectiveView === "map"} onClick={() => setView("map")}>
              <MapIcon size={14} /> מפה
            </ToggleBtn>
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState onReset={reset} />
      ) : effectiveView === "map" ? (
        <DealMap deals={filtered} />
      ) : effectiveView === "table" ? (
        <DealTable deals={filtered} />
      ) : (
        <DealCards deals={filtered} />
      )}
    </div>
  );
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[11px] font-medium text-faint">{label}</span>
      {children}
    </div>
  );
}

function ToggleBtn({
  active,
  onClick,
  children,
  className = "",
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition ${
        className || "inline-flex"
      } ${active ? "bg-accent text-white" : "text-muted hover:text-primary"}`}
    >
      {children}
    </button>
  );
}

function DealTable({ deals }: { deals: Deal[] }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
      <table className="w-full min-w-[900px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-xs text-faint">
            <Th>ציון</Th>
            <Th>מיקום</Th>
            <Th>סוג עסקה</Th>
            <Th>שטח / ייעוד</Th>
            <Th>עלות כניסה</Th>
            <Th>פער משומה</Th>
            <Th>פרמיית זכייה</Th>
            <Th>מועד הגשה</Th>
            <Th>תגיות</Th>
            <Th />
          </tr>
        </thead>
        <tbody>
          {deals.map((d) => (
            <tr key={d.id} className="group border-b border-border last:border-0 transition hover:bg-surface-2">
              <td className="px-3 py-3">
                <ScoreChip score={d.dealScore} size="sm" />
              </td>
              <td className="px-3 py-3">
                <Link href={`/deal/${d.id}`} className="font-semibold text-primary hover:text-accent">
                  {[d.city, d.neighborhood].filter(Boolean).join(" · ")}
                </Link>
                <div className="text-xs text-muted">{d.propertyType}</div>
              </td>
              <td className="px-3 py-3">
                <DealTypeChip type={d.dealType} />
              </td>
              <td className="px-3 py-3 text-muted">
                <span className="whitespace-nowrap">{formatLandArea(d.areaSqm)}</span>
                <div className="text-xs text-faint">{d.zoning}</div>
              </td>
              <td className="num px-3 py-3 text-start font-bold text-primary" dir="ltr">
                {formatILS(d.askingPrice)}
              </td>
              <td className="px-3 py-3 text-start" dir="ltr">
                <DiscountTag pct={d.discountPct} />
              </td>
              <td className="px-3 py-3">
                <PremiumCell deal={d} />
              </td>
              <td className="px-3 py-3">
                <DeadlineCell iso={d.submissionDeadline} />
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {d.badges.slice(0, 2).map((b) => (
                    <DealBadge key={b} kind={b} />
                  ))}
                </div>
              </td>
              <td className="px-3 py-3 text-start">
                <div className="flex items-center gap-1.5">
                  <SaveDealButton dealId={d.id} />
                  <Link
                    href={`/deal/${d.id}`}
                    className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold text-primary opacity-0 transition hover:border-accent group-hover:opacity-100"
                  >
                    פרטים
                  </Link>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DealCards({ deals }: { deals: Deal[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
      {deals.map((d) => (
        <Link
          key={d.id}
          href={`/deal/${d.id}`}
          className="card-hover group flex flex-col rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)] transition hover:border-border-strong"
        >
          <div className="mb-3 flex items-start justify-between gap-2">
            <div>
              <h3 className="font-bold text-primary group-hover:text-accent">
                {[d.city, d.neighborhood].filter(Boolean).join(" · ")}
              </h3>
              <p className="text-xs text-muted">{d.propertyType}</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <SaveDealButton dealId={d.id} />
              <ScoreChip score={d.dealScore} />
            </div>
          </div>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="num text-2xl font-extrabold text-primary" dir="ltr">
              {formatILS(d.askingPrice)}
            </span>
            <DiscountTag pct={d.discountPct} />
          </div>
          <div className="mb-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
            <span>{formatLandArea(d.areaSqm)}</span>
            <span>·</span>
            <span>ייעוד: {d.zoning}</span>
          </div>
          {d.winningPremium != null && (
            <div className="mb-3 flex items-center justify-between rounded-lg bg-surface-2 px-2.5 py-1.5 text-xs">
              <span className="flex items-center gap-1 text-muted">
                <Gavel size={12} /> פרמיית זכייה
              </span>
              <span className="flex items-center gap-2">
                <span className="num font-bold text-accent" dir="ltr">
                  +{Math.round(d.winningPremium * 100)}%
                </span>
                {d.expectedGapPct != null && (
                  <span
                    className={`text-[10px] font-semibold ${
                      d.expectedGapPct > 0 ? "text-positive" : "text-warning"
                    }`}
                  >
                    {d.expectedGapPct > 0
                      ? `חזוי ${Math.round(d.expectedGapPct)}% מתחת`
                      : `חזוי ${Math.abs(Math.round(d.expectedGapPct))}% מעל`}
                  </span>
                )}
              </span>
            </div>
          )}

          <div className="mb-3 flex flex-wrap gap-1">
            <DealTypeChip type={d.dealType} />
            {d.badges.map((b) => (
              <DealBadge key={b} kind={b} />
            ))}
          </div>
          <div className="mt-auto flex items-center justify-between border-t border-border pt-3 text-xs">
            <DeadlineCell iso={d.submissionDeadline} />
            <span className="inline-flex items-center gap-1 font-semibold text-accent">
              פרטים <ArrowLeft size={14} />
            </span>
          </div>
        </Link>
      ))}
    </div>
  );
}

/**
 * Winning premium + whether the projected winning price still clears the
 * appraisal. "—" when too little tender history backs a projection.
 */
function PremiumCell({ deal }: { deal: Deal }) {
  if (deal.winningPremium == null) {
    return <span className="text-xs text-faint">—</span>;
  }
  const stillUnder = (deal.expectedGapPct ?? 0) > 0;
  return (
    <div className="whitespace-nowrap">
      <span className="num text-sm font-bold text-accent" dir="ltr">
        +{Math.round(deal.winningPremium * 100)}%
      </span>
      {deal.expectedGapPct != null && (
        <div className={`text-[10px] font-medium ${stillUnder ? "text-positive" : "text-warning"}`}>
          {stillUnder
            ? `חזוי: ${Math.abs(Math.round(deal.expectedGapPct))}% מתחת לשומה`
            : `חזוי: ${Math.abs(Math.round(deal.expectedGapPct))}% מעל`}
        </div>
      )}
    </div>
  );
}

function DeadlineCell({ iso }: { iso?: string }) {
  const { label, urgent } = deadlineInfo(iso);
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${urgent ? "text-warning" : "text-muted"}`}>
      {iso && <Clock size={13} />} {label}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2.5 text-start font-medium">{children}</th>;
}

function EmptyState({ onReset }: { onReset: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface py-16 text-center">
      <p className="mb-1 text-lg font-semibold text-primary">לא נמצאו עסקאות התואמות את הסינון</p>
      <p className="mb-4 text-sm text-muted">נסה להרחיב את הקריטריונים או להסיר חלק מהמסננים.</p>
      <button
        onClick={onReset}
        className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
      >
        ניקוי כל המסננים
      </button>
    </div>
  );
}
