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
  SlidersHorizontal,
  ChevronDown,
} from "lucide-react";
import type { BadgeKind, Deal, DealType, TenderPhase } from "@/lib/types";
import { BADGE_LABEL, DEAL_TYPE_LABEL, formatILS, formatILSCompact, formatLandArea } from "@/lib/format";
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
  // Collapsed to start: the feed is the page, and the controls for narrowing
  // it are only worth their vertical space once someone wants them.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Cards, not the table. The feed is the product and it has to be readable
  // on arrival; the 10-column table is still one click away for anyone who
  // wants to compare tenders side by side.
  const [view, setView] = useState<ViewMode>("cards");
  const search = useSearchQuery();
  const isMobile = useIsMobile();
  // The wide table still has no phone layout; the map does, so it stays
  // available. Only reachable now by choosing it, since cards are the default.
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

  // What the collapsed bar says is on. Same set the count is built from, so
  // the two can never disagree about whether a filter is active.
  const activeFilterSummary = useMemo(() => {
    const out: string[] = [];
    if (city) out.push(city);
    if (maxPrice < PRICE_MAX) out.push(`עד ${formatILSCompact(maxPrice)}`);
    if (minDiscount > 0) out.push(`פער ${minDiscount}%+`);
    if (minScore > 0) out.push(`ציון ${minScore}+`);
    for (const p of phases) out.push(PHASE_LABEL[p]);
    for (const t of types) out.push(DEAL_TYPE_LABEL[t]);
    if (onlyRealistic) out.push("מתחת לשומה אחרי פרמיה");
    return out;
  }, [city, maxPrice, minDiscount, minScore, phases, types, onlyRealistic]);

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-5">
      {/* Filter bar — a disclosure, not a wall.

          Seven controls unfolded above the feed is most of a phone screen and
          a third of a laptop one, spent before a single tender is visible. The
          summary row keeps what is actually needed at rest — that filters
          exist, how many are on, and the way out of them — and the controls
          themselves are one click away. */}
      <div className="rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
        <div className="flex flex-wrap items-center gap-2 p-3">
          <button
            type="button"
            onClick={() => setFiltersOpen((v) => !v)}
            aria-expanded={filtersOpen}
            aria-controls="feed-filters"
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs font-semibold transition ${
              activeFilterCount > 0
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface-2 text-primary hover:border-border-strong"
            }`}
          >
            <SlidersHorizontal size={14} />
            סינון
            {activeFilterCount > 0 && (
              <span className="num rounded-full bg-accent px-1.5 py-0.5 text-[10px] leading-none text-white">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown
              size={14}
              className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`}
            />
          </button>

          {/* Collapsed, the count alone does not say *what* is on — and a feed
              narrowed by a filter you cannot see reads as a feed with nothing
              in it. */}
          {!filtersOpen && activeFilterSummary.length > 0 && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {activeFilterSummary.map((label) => (
                <span
                  key={label}
                  className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-[11px] text-muted"
                >
                  {label}
                </span>
              ))}
            </div>
          )}

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

        {filtersOpen && (
          <div
            id="feed-filters"
            className="flex flex-wrap items-end gap-3 border-t border-border p-3"
          >
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
          </div>
        )}
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
        {/* Wraps on a phone. Held on one line, the sort control and the three
            view toggles together are wider than a 375px screen and pushed the
            whole page into a sideways scroll. */}
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <label className="flex min-w-0 items-center gap-2 text-sm text-muted">
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
              className="input min-w-0"
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

function DealCards({ deals }: { deals: Deal[] }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
      {deals.map((d) => (
        <DealCard key={d.id} deal={d} />
      ))}
    </div>
  );
}

/**
 * The one reason this tender is worth opening, in the deal's own words.
 *
 * Ordered by what actually argues for the plot rather than by what is
 * loudest: a gap under the official appraisal is the product's whole premise,
 * upside comes next, and a pressured seller after that. "זמן קצר להגשה" is
 * deliberately not here — a closing date is urgency, not a reason the deal is
 * good, and dressing it as one would recommend every expiring tender equally.
 */
const WHY_GOOD_ORDER: BadgeKind[] = [
  "below_average",
  "rezoning_potential",
  "motivated_seller",
];

function whyGood(d: Deal): { label: string; kind: BadgeKind } | null {
  const kind = WHY_GOOD_ORDER.find((b) => d.badges.includes(b));
  if (kind) return { label: BADGE_LABEL[kind], kind };
  // No badge, but the numbers can still carry the card: a real gap under the
  // appraisal is worth saying even when nothing flagged it.
  if (d.discountPct >= 10) return { label: `${Math.round(d.discountPct)}% מתחת לשומה`, kind: "below_average" };
  return null;
}

/**
 * A tender at a glance: where it is, how it scores, what it costs, and the one
 * reason to look closer.
 *
 * Four things, deliberately. Everything else — zoning, area, the premium
 * projection, the comparables, the deal-type chip, the rest of the badges —
 * is in the drawer a click away. A card carrying nine facts is not nine times
 * as useful; it is a paragraph that has to be read in full before any two
 * tenders can be told apart, and a full screen of them is why this feed read
 * as a wall.
 *
 * The exception is a submission date that changes whether you can act at all
 * — already closing, or not yet open. That is not a metric competing for
 * attention, it is the difference between a live tender and one you cannot
 * bid on, so it earns the footer when it applies and stays out of the way
 * when it does not.
 */
function DealCard({ deal: d }: { deal: Deal }) {
  const why = whyGood(d);
  const { label: dateLabel, urgent, phase } = submissionInfo(d);
  // Only when the date is the story. A tender open for another two months has
  // nothing here, which is most of them.
  const showDate = urgent || phase === "not_started" || phase === "closed";

  return (
    <Link
      href={`/deal/${d.id}`}
      className="card-hover group flex flex-col gap-5 rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow)] transition hover:border-accent/50"
    >
      {/* Title + score. The gauge is the anchor the eye lands on, so it keeps
          its own corner at full size rather than shrinking into the header. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-lg leading-tight font-extrabold text-primary transition group-hover:text-accent">
            {d.city}
          </h3>
          {d.neighborhood && (
            <p className="mt-1 truncate text-sm text-muted">{d.neighborhood}</p>
          )}
        </div>
        <ScoreChip score={d.dealScore} size="lg" />
      </div>

      {/* Price, and what it is cheap against. */}
      <div>
        <div className="num text-3xl leading-none font-black text-primary" dir="ltr">
          {formatILS(d.askingPrice)}
        </div>
        <div className="mt-2 flex items-baseline gap-1.5 text-sm">
          <DiscountTag pct={d.discountPct} />
          <span className="text-muted">משומה רשמית</span>
        </div>
      </div>

      {/* The single reason. */}
      {why && (
        <div>
          <DealBadge kind={why.kind} label={why.label} size="md" />
        </div>
      )}

      <div className="mt-auto flex items-center justify-between gap-2 border-t border-border pt-4 text-xs">
        <div onClick={(e) => e.preventDefault()}>
          <SaveDealButton dealId={d.id} />
        </div>
        {showDate ? (
          <span
            className={`inline-flex items-center gap-1 font-medium ${
              phase === "not_started" ? "text-accent" : "text-warning"
            }`}
          >
            {phase === "not_started" ? <CalendarClock size={13} /> : <Clock size={13} />}
            {dateLabel}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold text-accent">
            פרטים <ArrowLeft size={14} />
          </span>
        )}
      </div>
    </Link>
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
