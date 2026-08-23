"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  Crown,
  BellPlus,
  LayoutGrid,
  Table2,
  Clock,
  CalendarClock,
  ArrowLeft,
  Gavel,
  X,
  Map as MapIcon,
} from "lucide-react";
import type { Deal, DealType, TenderPhase } from "@/lib/types";
import { DEAL_TYPE_LABEL, formatILS, formatILSCompact, formatLandArea } from "@/lib/format";
import { FILTERABLE_PHASES, PHASE_LABEL, matchesPhase, submissionInfo, tenderPhase } from "@/lib/tender-phase";
import { DealBadge, DealTypeChip, ScoreChip, DiscountTag } from "@/components/ui";
import { hasFeature, isScorePresetLocked } from "@/lib/limits";
import { useServerTier } from "@/lib/personal-data";
import { useUpgradeGate } from "@/components/UpgradeGate";
import { trackEvent } from "@/lib/events";
import type { PlanTier } from "@/lib/types";
import { SaveDealButton } from "@/components/SaveDealButton";
import { buildAlertHref } from "@/lib/alert-prefill";
import { clearSearch, useSearchQuery } from "@/lib/search-store";
import { matchesQuery } from "@/lib/deal-search";
import { LogoLoader } from "@/components/LogoLoader";

type SortKey = "score" | "discount" | "price_asc" | "deadline" | "opens" | "expected_gap" | "premium";
type ViewMode = "table" | "cards" | "map";

// Leaflet touches `window` at import time, so the map never prerenders.
const DealMap = dynamic(() => import("@/components/DealMap"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[clamp(420px,68vh,760px)] place-items-center rounded-xl border border-border bg-surface">
      <LogoLoader label="טוען מפה…" />
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

export function DealFeed({
  deals,
  cities,
  tier = "free",
}: {
  deals: Deal[];
  cities: string[];
  /** Resolved on the server, so a PRO subscriber never sees the lock flash. */
  tier?: PlanTier;
}) {
  const { show } = useUpgradeGate();
  // The bookmark button on every row enforces the saved-deals limit from the
  // shared store, which has no other way to learn the plan on this page.
  useServerTier(tier);
  // The server already stripped the numbers for a free account; this is only
  // about saying *why* the column is empty.
  const premiumLocked = !hasFeature(tier, "premium_calculator");
  const [city, setCity] = useState<string>("");
  const [maxPrice, setMaxPrice] = useState<number>(PRICE_MAX);
  const [minDiscount, setMinDiscount] = useState<number>(0);
  const [minScore, setMinScore] = useState<number>(0);
  const [types, setTypes] = useState<DealType[]>([]);
  // Empty = every phase. Roughly half the feed is טרם החל, so being able to
  // say "only what I can bid on today" (or only what is still coming) is the
  // difference between a browsable feed and a misleading one.
  const [phases, setPhases] = useState<TenderPhase[]>([]);
  // "Realistic" = expected winning price still below the official appraisal.
  const [onlyRealistic, setOnlyRealistic] = useState(false);
  const [sort, setSort] = useState<SortKey>("score");
  const [view, setView] = useState<ViewMode>("table");
  const search = useSearchQuery();
  const isMobile = useIsMobile();
  // The wide table has no phone layout; the map does, so it stays available.
  const effectiveView: ViewMode = isMobile && view === "table" ? "cards" : view;

  function toggleType(t: DealType) {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }

  function togglePhase(p: TenderPhase) {
    setPhases((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  }

  function reset() {
    setCity("");
    setMaxPrice(PRICE_MAX);
    setMinDiscount(0);
    setMinScore(0);
    setTypes([]);
    setPhases([]);
    setOnlyRealistic(false);
  }

  const filtered = useMemo(() => {
    // Read the clock once: deriving a phase per deal would let two tenders be
    // judged against different "todays" in a single render.
    const now = new Date();
    const result = deals.filter((d) => {
      if (d.status === "sold") return false;
      if (phases.length && !matchesPhase(tenderPhase(d, now), phases)) return false;
      if (city && d.city !== city) return false;
      // At the top of the slider the budget stops constraining entirely — 13
      // active tenders cost more than the slider's ceiling, and a control
      // sitting at its maximum shouldn't still be hiding them.
      if (maxPrice < PRICE_MAX && d.askingPrice > maxPrice) return false;
      // 0 means "הכל" — no gap constraint at all, including tenders whose
      // entry cost is *above* the appraisal. Treating 0 as ">= 0" quietly hid
      // 189 of 335 active tenders behind a preset labelled "all".
      if (minDiscount > 0 && d.discountPct < minDiscount) return false;
      if (d.dealScore < minScore) return false;
      if (types.length && !types.includes(d.dealType)) return false;
      if (onlyRealistic && !((d.expectedGapPct ?? -1) > 0)) return false;
      if (search && !matchesQuery(d, search)) return false;
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
        case "opens": {
          // Tenders already open have nothing to wait for, so they sort last
          // behind everything with an opening date still ahead of it.
          const av = a.submissionOpensAt ? new Date(a.submissionOpensAt).getTime() : Infinity;
          const bv = b.submissionOpensAt ? new Date(b.submissionOpensAt).getTime() : Infinity;
          // Reuses the single clock reading from the top of this pass — the
          // lint rule forbids calling the clock here, and rightly so: a
          // comparator that reads the time is not a stable ordering.
          const t = now.getTime();
          return (av < t ? Infinity : av) - (bv < t ? Infinity : bv);
        }
        default:
          return b.dealScore - a.dealScore;
      }
    });
    return result;
  }, [deals, city, maxPrice, minDiscount, minScore, types, phases, sort, onlyRealistic, search]);

  // Search runs *inside* the active filters, so a city the filters already
  // exclude looks like "no such tender". Counted against what reset() actually
  // produces — now genuinely unfiltered — so the hint never promises results
  // that clicking it won't reveal.
  const hiddenByFilters = useMemo(
    () =>
      search && filtered.length === 0
        ? deals.filter((d) => d.status !== "sold" && matchesQuery(d, search)).length
        : 0,
    [deals, search, filtered.length],
  );

  const activeFilterCount =
    (city ? 1 : 0) +
    (maxPrice < PRICE_MAX ? 1 : 0) +
    (minDiscount > 0 ? 1 : 0) +
    (minScore > 0 ? 1 : 0) +
    types.length +
    phases.length +
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

          <FilterField
            label={`תקציב מקסימלי: ${maxPrice >= PRICE_MAX ? "ללא הגבלה" : formatILSCompact(maxPrice)}`}
          >
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
              {SCORE_PRESETS.map((p) => {
                // 60+ stays open — the feed has to be useful without paying.
                // What PRO buys is the sharp end of it, which is exactly what
                // the pricing table has promised all along.
                const locked = isScorePresetLocked(tier, p);
                return (
                  <button
                    key={p}
                    onClick={() => {
                      if (locked) {
                        trackEvent("limit_hit", { kind: "score_filter", tier, preset: p });
                        return show({ feature: "score_filter" });
                      }
                      setMinScore(p);
                    }}
                    title={locked ? "סינון ציון 80+ פתוח למנויי PRO" : undefined}
                    className={`num inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                      minScore === p
                        ? "border-accent bg-accent-soft text-accent"
                        : locked
                          ? "border-border bg-surface-2 text-faint hover:border-accent/50 hover:text-accent"
                          : "border-border bg-surface-2 text-muted hover:text-primary"
                    }`}
                  >
                    {p === 0 ? "הכל" : `${p}+`}
                    {locked && <Crown size={11} aria-label="PRO" />}
                  </button>
                );
              })}
            </div>
          </FilterField>

          <FilterField label="שלב המכרז">
            <div className="flex gap-1">
              {FILTERABLE_PHASES.map((ph) => (
                <button
                  key={ph}
                  onClick={() => togglePhase(ph)}
                  title={
                    ph === "not_started"
                      ? "מכרזים שפורסמו אך ההגשה בהם טרם נפתחה"
                      : "מכרזים שניתן להגיש אליהם הצעות כעת"
                  }
                  className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition ${
                    phases.includes(ph)
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-border bg-surface-2 text-muted hover:text-primary"
                  }`}
                >
                  {PHASE_LABEL[ph]}
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
              onClick={() => {
                // Without the projection this filter would match nothing, so a
                // free account is told why rather than shown an empty feed.
                if (premiumLocked) {
                  trackEvent("limit_hit", { kind: "premium_calculator", tier, from: "smart_filter" });
                  return show({ feature: "premium_calculator" });
                }
                setOnlyRealistic((v) => !v);
              }}
              title={
                premiumLocked
                  ? "סינון לפי פרמיית הזכייה החזויה פתוח למנויי PRO"
                  : "מציג רק מכרזים שגם לאחר פרמיית הזכייה החזויה צפויים להישאר מתחת לשומה"
              }
              className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-semibold transition ${
                onlyRealistic
                  ? "border-positive bg-positive-soft text-positive"
                  : "border-border bg-surface-2 text-muted hover:text-primary"
              }`}
            >
              <Gavel size={13} /> מתחת לשומה גם אחרי פרמיה
              {premiumLocked && <Crown size={11} />}
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
                phases,
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
        {search && (
          <button
            type="button"
            onClick={clearSearch}
            title="ניקוי החיפוש"
            className="inline-flex items-center gap-1.5 rounded-lg border border-accent/40 bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent transition hover:brightness-110"
          >
            חיפוש: {search}
            <X size={12} />
          </button>
        )}
        <div className="ms-auto flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-muted">
            מיון:
            <select
              value={sort}
              onChange={(e) => {
                const next = e.target.value as SortKey;
                // Sorting by a number the plan does not include would silently
                // order the feed at random; refuse and explain instead.
                if (premiumLocked && (next === "premium" || next === "expected_gap")) {
                  trackEvent("limit_hit", { kind: "premium_calculator", tier, from: "sort" });
                  return show({ feature: "premium_calculator" });
                }
                setSort(next);
              }}
              className="input"
            >
              <option value="score">ציון עסקה</option>
              <option value="expected_gap">
                פער חזוי (אחרי פרמיה){premiumLocked ? " · PRO" : ""}
              </option>
              <option value="premium">פרמיית זכייה{premiumLocked ? " · PRO" : ""}</option>
              <option value="discount">פער משומה</option>
              <option value="price_asc">מחיר (נמוך לגבוה)</option>
              <option value="deadline">מועד הגשה קרוב</option>
              <option value="opens">נפתח להגשה בקרוב</option>
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
        <EmptyState onReset={reset} search={search} hiddenByFilters={hiddenByFilters} />
      ) : effectiveView === "map" ? (
        <DealMap deals={filtered} />
      ) : effectiveView === "table" ? (
        <DealTable deals={filtered} premiumLocked={premiumLocked} tier={tier} show={show} />
      ) : (
        <DealCards deals={filtered} premiumLocked={premiumLocked} tier={tier} show={show} />
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

type PremiumGate = { premiumLocked: boolean; tier: PlanTier; show: (b: { feature: "premium_calculator" }) => void };

function DealTable({ deals, premiumLocked, tier, show }: { deals: Deal[] } & PremiumGate) {
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
            <Th>מועד</Th>
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
                <PremiumCell
                  deal={d}
                  locked={premiumLocked}
                  onLocked={() => {
                    trackEvent("limit_hit", { kind: "premium_calculator", tier });
                    show({ feature: "premium_calculator" });
                  }}
                />
              </td>
              <td className="px-3 py-3">
                <DeadlineCell deal={d} />
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

function DealCards({ deals, premiumLocked, tier, show }: { deals: Deal[] } & PremiumGate) {
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
          {premiumLocked && (
            <button
              type="button"
              onClick={() => {
                trackEvent("limit_hit", { kind: "premium_calculator", tier });
                show({ feature: "premium_calculator" });
              }}
              className="mb-3 flex w-full items-center justify-between rounded-lg border border-dashed border-accent/40 px-2.5 py-1.5 text-xs transition hover:bg-accent-soft"
            >
              <span className="flex items-center gap-1 text-muted">
                <Gavel size={12} /> פרמיית זכייה
              </span>
              <span className="inline-flex items-center gap-1 font-bold text-accent">
                <Crown size={11} /> PRO
              </span>
            </button>
          )}
          {!premiumLocked && d.winningPremium != null && (
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
            <DeadlineCell deal={d} />
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
function PremiumCell({ deal, locked, onLocked }: { deal: Deal; locked: boolean; onLocked: () => void }) {
  // "—" means we have no projection for this tender. A locked plan is a
  // different fact and must not be dressed as missing data.
  if (locked) {
    return (
      <button
        type="button"
        onClick={onLocked}
        className="inline-flex items-center gap-1 rounded-md border border-dashed border-accent/40 px-1.5 py-0.5 text-[10px] font-semibold text-accent transition hover:bg-accent-soft"
      >
        <Crown size={10} /> PRO
      </button>
    );
  }
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

/**
 * The actionable date, not simply the deadline.
 *
 * Nearly half the live feed is טרם החל — published but not yet open for bids.
 * Counting those down to their closing date reads as "you have 77 days" when
 * the honest answer is "you cannot bid until the 24th".
 */
function DeadlineCell({ deal }: { deal: Deal }) {
  const { label, urgent, phase } = submissionInfo(deal);
  const tone =
    phase === "not_started" ? "text-accent" : urgent ? "text-warning" : "text-muted";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-medium ${tone}`}>
      {phase === "not_started" ? <CalendarClock size={13} /> : <Clock size={13} />} {label}
    </span>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2.5 text-start font-medium">{children}</th>;
}

function EmptyState({
  onReset,
  search,
  hiddenByFilters = 0,
}: {
  onReset: () => void;
  search?: string;
  hiddenByFilters?: number;
}) {
  // A search that finds nothing is a different dead end from filters that are
  // too tight — pointing at the wrong one sends people to the wrong control.
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface py-16 text-center">
      <p className="mb-1 text-lg font-semibold text-primary">
        {search ? `לא נמצאו מכרזים עבור "${search}"` : "לא נמצאו עסקאות התואמות את הסינון"}
      </p>
      <p className="mb-4 text-sm text-muted">
        {hiddenByFilters > 0 ? (
          <>
            <span className="num font-bold text-primary">{hiddenByFilters}</span> מכרזים תואמים
            לחיפוש אך מוסתרים על ידי הסינון הנוכחי.
          </>
        ) : search ? (
          "אפשר לנסות עיר, גוש/חלקה או מספר מכרז — או לנקות את החיפוש."
        ) : (
          "נסה להרחיב את הקריטריונים או להסיר חלק מהמסננים."
        )}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        {search && (
          <button
            onClick={clearSearch}
            className="rounded-lg border border-border bg-surface-2 px-4 py-2 text-sm font-semibold text-primary transition hover:border-border-strong"
          >
            ניקוי החיפוש
          </button>
        )}
        <button
          onClick={onReset}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover"
        >
          ניקוי כל המסננים
        </button>
      </div>
    </div>
  );
}
