import Link from "next/link";
import {
  Bell,
  Share2,
  FileText,
  ExternalLink,
  Clock,
  CalendarClock,
  Sparkles,
} from "lucide-react";
import type { Deal, PlanTier } from "@/lib/types";
import {
  formatDate,
  formatILS,
  formatPerSqm,
  formatLandArea,
  BADGE_LABEL,
} from "@/lib/format";
import { DealBadge, DealTypeChip, ScoreChip, DiscountTag } from "@/components/ui";
import { LandCalculator } from "@/components/RoiCalculator";
import { WinningPremium } from "@/components/WinningPremium";
import { CmaChart } from "@/components/CmaChart";
import DealLocationMap from "@/components/DealLocationMap";
import { SaveDealButton } from "@/components/SaveDealButton";
import { DealDetailTabs } from "@/components/DealDetailTabs";
import { buildAlertHref, scoreThresholdFor } from "@/lib/alert-prefill";
import { submissionInfo } from "@/lib/tender-phase";

/**
 * Everything a tender's deep view shows, shared by the full page and the
 * drawer that intercepts a click on the feed.
 *
 * A **server** component, and that is the whole point rather than an
 * incidental detail. WinningPremium omits the two PRO numbers from its render
 * instead of hiding them with CSS, which only holds while the deciding happens
 * on the server. Were this body pulled into a client component as props, the
 * projection would be serialised into the page for anyone with a network tab
 * and the gate would become decorative — the same trap src/app/page.tsx
 * documents when it strips those fields out of the feed's payload.
 *
 * So the two client pieces here, DealDrawer and DealDetailTabs, are shells:
 * they receive this already rendered and never learn what is inside it.
 *
 * The shape is a verdict first, then tabs. Opening a tender used to mean
 * scrolling past a facts grid, a chart, a comparables table and two
 * calculators before knowing whether any of it was worth reading. The verdict
 * answers that in one screen; the tabs mean the rest is chosen rather than
 * endured.
 */
export function DealDetailBody({
  deal,
  tier,
  layout = "page",
}: {
  deal: Deal;
  tier: PlanTier;
  /** "drawer" tightens the type scale; the panel is narrower than the page. */
  layout?: "page" | "drawer";
}) {
  const submission = submissionInfo(deal);
  const subjectPerSqm = Math.round(deal.askingPrice / deal.areaSqm);
  const sortedComps = [...deal.comps].sort(
    (a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime(),
  );
  const perSqmDelta = deal.areaAvgPricePerSqm
    ? Math.round(((subjectPerSqm - deal.areaAvgPricePerSqm) / deal.areaAvgPricePerSqm) * 1000) / 10
    : 0;
  const drawer = layout === "drawer";
  const reasons = verdictReasons(deal, perSqmDelta);

  return (
    <div className="space-y-5">
      <VerdictHeader
        deal={deal}
        reasons={reasons}
        subjectPerSqm={subjectPerSqm}
        perSqmDelta={perSqmDelta}
        drawer={drawer}
      />

      <DealDetailTabs
        tabs={[
          {
            id: "overview",
            label: "פרטי המגרש",
            content: (
              <Overview
                deal={deal}
                submission={submission}
                subjectPerSqm={subjectPerSqm}
              />
            ),
          },
          {
            id: "market",
            label: "ניתוח שוק",
            content: (
              <Market
                deal={deal}
                sortedComps={sortedComps}
                subjectPerSqm={subjectPerSqm}
                perSqmDelta={perSqmDelta}
              />
            ),
          },
          {
            id: "tools",
            label: "תחזיות ומחשבון",
            content: (
              <div className="space-y-5">
                {/* Server-rendered, tier decided here. */}
                <WinningPremium deal={deal} tier={tier} />
                <LandCalculator
                  purchasePrice={deal.askingPrice}
                  estMarketValue={deal.estMarketValue}
                  areaSqm={deal.areaSqm}
                />
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

/**
 * The verdict: the score, the three numbers that decide it, and why the tender
 * is worth opening — stated in the deal's own figures.
 *
 * Honest when there is nothing to recommend. A plot priced above its appraisal
 * gets told so under the same heading, because a "why this is worth it" panel
 * that always finds something is worth nothing.
 */
function VerdictHeader({
  deal,
  reasons,
  subjectPerSqm,
  perSqmDelta,
  drawer,
}: {
  deal: Deal;
  reasons: string[];
  subjectPerSqm: number;
  perSqmDelta: number;
  drawer: boolean;
}) {
  const good = reasons.length > 0;
  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-[var(--shadow)]">
      <div className="p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <DealTypeChip type={deal.dealType} />
            </div>
            <h1
              className={`font-extrabold text-primary ${drawer ? "text-xl" : "text-2xl"}`}
            >
              {deal.propertyType} · {deal.city}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {deal.neighborhood}
              {deal.gush ? ` · גוש ${deal.gush} חלקה ${deal.helka}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-center gap-1">
            <ScoreChip score={deal.dealScore} size="lg" />
            <span className="text-[11px] font-medium text-muted">ציון עסקה</span>
          </div>
        </div>

        {/* The three numbers. */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <KeyMetric label="עלות כניסה מינימלית">
            <span className="num text-2xl font-black text-primary" dir="ltr">
              {formatILS(deal.askingPrice)}
            </span>
          </KeyMetric>
          <KeyMetric label="פער משומה רשמית">
            <span className="text-2xl font-black">
              <DiscountTag pct={deal.discountPct} />
            </span>
            <span className="num mt-0.5 block text-[11px] text-faint" dir="ltr">
              {formatILS(deal.estMarketValue)}
            </span>
          </KeyMetric>
          <KeyMetric label="₪ למ״ר קרקע">
            <span className="num text-2xl font-black text-primary" dir="ltr">
              {formatPerSqm(subjectPerSqm)}
            </span>
            {deal.areaAvgPricePerSqm > 0 && (
              <span
                className={`mt-0.5 block text-[11px] font-semibold ${
                  perSqmDelta < 0 ? "text-positive" : "text-negative"
                }`}
              >
                {perSqmDelta < 0
                  ? `${Math.abs(perSqmDelta)}% מתחת לחציון האזורי`
                  : `${perSqmDelta}% מעל החציון האזורי`}
              </span>
            )}
          </KeyMetric>
        </div>
      </div>

      {/* Why it is worth it. */}
      <div
        className={`border-t px-6 py-4 ${
          good ? "border-positive/25 bg-positive-soft/40" : "border-border bg-surface-2"
        }`}
      >
        <h2
          className={`mb-2 flex items-center gap-1.5 text-sm font-bold ${
            good ? "text-positive" : "text-muted"
          }`}
        >
          <Sparkles size={14} />
          {good ? "למה העסקה הזו שווה" : "אין כאן יתרון מובהק"}
        </h2>
        {good ? (
          <ul className="flex flex-wrap gap-x-5 gap-y-1.5">
            {reasons.map((r) => (
              <li key={r} className="text-sm text-primary">
                · {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            עלות הכניסה אינה נמוכה מהשומה הרשמית ולא נמצא סימן השבחה מובהק. שווה לבדוק את
            ניתוח השוק לפני שממשיכים.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * Up to three reasons this tender is worth the time, strongest first.
 *
 * Only what the data actually supports: each line is a number this deal
 * carries, not a phrasing of the same fact twice. An empty list is a real
 * answer and the header says so rather than reaching for a fourth-best reason.
 */
function verdictReasons(deal: Deal, perSqmDelta: number): string[] {
  const out: string[] = [];
  if (deal.discountPct > 0) {
    out.push(`עלות הכניסה ${Math.round(deal.discountPct)}% מתחת לשומה הרשמית`);
  }
  if (deal.areaAvgPricePerSqm > 0 && perSqmDelta < -2) {
    out.push(`${Math.abs(Math.round(perSqmDelta))}% מתחת למחיר החציוני למ״ר באזור`);
  }
  if (deal.badges.includes("rezoning_potential")) {
    out.push(BADGE_LABEL.rezoning_potential);
  }
  if (deal.buildingRights) out.push(`זכויות בנייה: ${deal.buildingRights}`);
  if (deal.badges.includes("motivated_seller")) out.push(BADGE_LABEL.motivated_seller);
  if (deal.dealScore >= 80) out.push(`ציון עסקה ${deal.dealScore} מתוך 100`);
  return out.slice(0, 3);
}

function KeyMetric({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="mb-1 text-[11px] font-medium text-faint">{label}</div>
      {children}
    </div>
  );
}

/** Tab 1: what the plot actually is, plus the dates and the paperwork. */
function Overview({
  deal,
  submission,
  subjectPerSqm,
}: {
  deal: Deal;
  submission: ReturnType<typeof submissionInfo>;
  subjectPerSqm: number;
}) {
  return (
    <>
      <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
        {deal.badges.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {deal.badges.map((b) => (
              <DealBadge key={b} kind={b} />
            ))}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="שטח" value={formatLandArea(deal.areaSqm)} />
          <Fact label="ייעוד" value={deal.zoning} />
          <Fact label="סוג קרקע" value={deal.propertyType} />
          <Fact label="₪ למ״ר קרקע" value={formatPerSqm(subjectPerSqm)} />
          <Fact label="גוש" value={deal.gush ?? "—"} />
          <Fact label="חלקה" value={deal.helka ?? "—"} />
          <Fact label="תת-חלקה" value={deal.tatHelka ?? "—"} />
          <Fact label="מחיר לדונם" value={formatILS(subjectPerSqm * 1000)} />
        </div>

        {deal.buildingRights && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-accent/30 bg-accent-soft p-3 text-sm">
            <span className="font-semibold text-accent">זכויות בנייה:</span>
            <span className="text-primary">{deal.buildingRights}</span>
          </div>
        )}

        {deal.dealType === "rami_tender" && (
          <p className="mt-3 text-[11px] leading-relaxed text-faint">
            * עלות הכניסה מחושבת כמחיר המינימום בתוספת הוצאות הפיתוח. הפער משומה אינו הנחה מובטחת —
            מכרזי רמ״י תחרותיים ומחירי הזכייה בפועל גבוהים ממחיר המינימום.
          </p>
        )}

        {/* Deadline + source. Flex-wrap so the map panel can claim a full
            row of its own below the buttons. */}
        <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3">
          {/* Both dates, because a tender that has not opened yet has two
              and only one of them is actionable. Showing just the deadline
              told 150 of 335 tenders' readers they had months to act on
              something they could not act on at all. */}
          {submission.phase === "not_started" && (
            <div className="flex items-center gap-2 text-sm">
              <CalendarClock size={16} className="text-accent" />
              <span className="text-muted">נפתח להגשה:</span>
              <span className="num font-bold text-primary" dir="ltr">
                {formatDate(deal.submissionOpensAt)}
              </span>
              <span className="text-accent">({submission.relative})</span>
            </div>
          )}
          <div className="flex items-center gap-2 text-sm">
            <Clock size={16} className={submission.urgent ? "text-warning" : "text-muted"} />
            <span className="text-muted">מועד אחרון להגשה:</span>
            <span className="num font-bold text-primary" dir="ltr">
              {formatDate(deal.submissionDeadline)}
            </span>
            {submission.phase !== "not_started" && (
              <span className={submission.urgent ? "text-warning" : "text-muted"}>
                ({submission.label})
              </span>
            )}
          </div>
          {deal.rawDocumentUrl && (
            <a
              href={deal.rawDocumentUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="ms-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-accent"
            >
              <FileText size={14} /> מסמך מקור
              <ExternalLink size={11} className="text-faint" />
            </a>
          )}
          {deal.lat && deal.lng ? (
            <DealLocationMap
              deal={{
                lat: deal.lat,
                lng: deal.lng,
                dealScore: deal.dealScore,
                geoPrecision: deal.geoPrecision,
                city: deal.city,
                neighborhood: deal.neighborhood,
                gush: deal.gush,
                helka: deal.helka,
              }}
            />
          ) : (
            <span className="text-xs text-faint" title="למכרז זה אין גוש/חלקה שניתן לאתר">
              אין מיקום זמין
            </span>
          )}
        </div>
        <p className="mt-2 text-xs text-faint">
          מקור: {deal.sourceName} · נצפה לראשונה: {formatDate(deal.firstSeenAt)}
        </p>
      </section>
    </>
  );
}

/** Tab 2: the comparable land tenders this plot is judged against. */
function Market({
  deal,
  sortedComps,
  subjectPerSqm,
  perSqmDelta,
}: {
  deal: Deal;
  sortedComps: Deal["comps"];
  subjectPerSqm: number;
  perSqmDelta: number;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
      <div className="mb-1 flex items-center justify-between">
        <h2 className="text-lg font-bold text-primary">ניתוח שוק השוואתי</h2>
        <span className="text-xs text-faint">תוצאות מכרזי קרקע · רמ״י</span>
      </div>
      {sortedComps.length > 0 ? (
        <p className="mb-4 text-sm text-muted">
          הקרקע במחיר של{" "}
          <span className="num font-bold text-primary">{formatPerSqm(subjectPerSqm)}</span> למ״ר —{" "}
          <span className={perSqmDelta < 0 ? "font-bold text-positive" : "font-bold text-negative"}>
            {perSqmDelta < 0 ? `${Math.abs(perSqmDelta)}% מתחת` : `${perSqmDelta}% מעל`} לחציון האזורי
          </span>{" "}
          (<span className="num">{formatPerSqm(deal.areaAvgPricePerSqm)}</span> למ״ר קרקע).
        </p>
      ) : (
        <p className="mb-4 text-sm text-muted">
          הקרקע במחיר של{" "}
          <span className="num font-bold text-primary">{formatPerSqm(subjectPerSqm)}</span> למ״ר קרקע.
        </p>
      )}

      {sortedComps.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-surface-2 p-6 text-center text-sm text-muted">
          אין עדיין עסקאות השוואה זמינות לאזור זה.
        </p>
      ) : (
        <>
          <div className="mb-5 rounded-lg border border-border bg-surface-2 p-3">
            <CmaChart
              comps={deal.comps}
              subjectPerSqm={subjectPerSqm}
              areaAvgPerSqm={deal.areaAvgPricePerSqm}
            />
          </div>

          <h3 className="mb-2 text-sm font-semibold text-primary">עסקאות אחרונות באזור</h3>
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b border-border text-xs text-faint">
                  <th className="px-3 py-2 text-start font-medium">כתובת</th>
                  <th className="px-3 py-2 text-start font-medium">תאריך</th>
                  <th className="px-3 py-2 text-start font-medium">שטח</th>
                  <th className="px-3 py-2 text-start font-medium">מחיר</th>
                  <th className="px-3 py-2 text-start font-medium">₪ למ״ר</th>
                </tr>
              </thead>
              <tbody>
                {sortedComps.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 text-primary">
                      {c.city} · {c.street}
                    </td>
                    <td className="num px-3 py-2 text-muted" dir="ltr">
                      {formatDate(c.saleDate)}
                    </td>
                    <td className="px-3 py-2 text-muted">{formatLandArea(c.areaSqm)}</td>
                    <td className="num px-3 py-2 font-semibold text-primary" dir="ltr">
                      {formatILS(c.salePrice)}
                    </td>
                    <td className="num px-3 py-2 text-muted" dir="ltr">
                      {formatPerSqm(c.pricePerSqm)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/** Save / similar-alert / share, shared by the page header and the drawer's toolbar. */
export function DealActions({ deal }: { deal: Deal }) {
  return (
    <div className="flex flex-wrap gap-2">
      <SaveDealButton dealId={deal.id} variant="labelled" />
      {/* Same city + zoning, and a score floor one tier below this tender's,
          so the alert catches comparable plots rather than only an exact
          repeat of this one. */}
      <Link
        href={buildAlertHref({
          city: deal.city,
          zonings: [deal.zoning],
          minScore: scoreThresholdFor(deal.dealScore),
        })}
        className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-border-strong"
      >
        <Bell size={14} /> התראה דומה
      </Link>
      <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-border-strong">
        <Share2 size={14} />
        שיתוף
      </button>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2.5">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="num mt-0.5 font-semibold text-primary">{value}</div>
    </div>
  );
}
