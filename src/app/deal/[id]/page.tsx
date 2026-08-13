import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Bell, Share2, FileText, ExternalLink, Clock, type LucideIcon } from "lucide-react";
import { getDealById } from "@/lib/repository";
import {
  deadlineLabel,
  formatDate,
  formatILS,
  formatPerSqm,
  formatLandArea,
} from "@/lib/format";
import { DealBadge, DealTypeChip, ScoreChip, DiscountTag } from "@/components/ui";
import { LandCalculator } from "@/components/RoiCalculator";
import { WinningPremium } from "@/components/WinningPremium";
import { CmaChart } from "@/components/CmaChart";
import DealLocationMap from "@/components/DealLocationMap";
import { SaveDealButton } from "@/components/SaveDealButton";

export default async function DealDetailPage({ params }: PageProps<"/deal/[id]">) {
  const { id } = await params;
  const deal = await getDealById(id);
  if (!deal) notFound();

  const subjectPerSqm = Math.round(deal.askingPrice / deal.areaSqm);
  const sortedComps = [...deal.comps].sort(
    (a, b) => new Date(b.saleDate).getTime() - new Date(a.saleDate).getTime(),
  );
  const perSqmDelta = deal.areaAvgPricePerSqm
    ? Math.round(((subjectPerSqm - deal.areaAvgPricePerSqm) / deal.areaAvgPricePerSqm) * 1000) / 10
    : 0;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-5">
      {/* Back + actions */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-y-2">
        <Link href="/" className="flex items-center gap-1.5 text-sm text-muted transition hover:text-primary">
          <ArrowRight size={16} /> חזרה לפיד
        </Link>
        <div className="flex flex-wrap gap-2">
          <SaveDealButton dealId={deal.id} variant="labelled" />
          <ActionBtn icon={Bell}>התראה דומה</ActionBtn>
          <ActionBtn icon={Share2}>שיתוף</ActionBtn>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        {/* Main column */}
        <div className="min-w-0 space-y-5">
          {/* Hero */}
          <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <DealTypeChip type={deal.dealType} />
              {deal.badges.map((b) => (
                <DealBadge key={b} kind={b} />
              ))}
            </div>
            <h1 className="text-2xl font-extrabold text-primary">
              {deal.propertyType} · {deal.city}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {deal.neighborhood}
              {deal.gush ? ` · גוש ${deal.gush} חלקה ${deal.helka}` : ""}
            </p>

            <div className="mt-5 flex flex-wrap items-end gap-x-8 gap-y-4">
              <div>
                <div className="text-xs text-faint">עלות כניסה מינימלית</div>
                <div className="num text-3xl font-black text-primary" dir="ltr">
                  {formatILS(deal.askingPrice)}
                </div>
              </div>
              <div>
                <div className="text-xs text-faint">פער משומה</div>
                <div className="text-2xl font-extrabold">
                  <DiscountTag pct={deal.discountPct} />
                </div>
              </div>
              <div>
                <div className="text-xs text-faint">שומה רשמית</div>
                <div className="num text-lg font-semibold text-muted" dir="ltr">
                  {formatILS(deal.estMarketValue)}
                </div>
              </div>
            </div>

            {deal.dealType === "rami_tender" && (
              <p className="mt-3 text-[11px] leading-relaxed text-faint">
                * עלות הכניסה מחושבת כמחיר המינימום בתוספת הוצאות הפיתוח. הפער משומה אינו הנחה מובטחת —
                מכרזי רמ״י תחרותיים ומחירי הזכייה בפועל גבוהים ממחיר המינימום.
              </p>
            )}

            {/* Key facts grid */}
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

            {/* Deadline + source. Flex-wrap so the map panel can claim a full
                row of its own below the buttons. */}
            <div className="mt-5 flex flex-wrap items-center gap-3 rounded-lg bg-surface-2 p-3">
              <div className="flex items-center gap-2 text-sm">
                <Clock size={16} className="text-warning" />
                <span className="text-muted">מועד אחרון להגשה:</span>
                <span className="num font-bold text-primary" dir="ltr">
                  {formatDate(deal.submissionDeadline)}
                </span>
                <span className="text-warning">({deadlineLabel(deal.submissionDeadline)})</span>
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

          {/* CMA widget */}
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
        </div>

        {/* Side rail */}
        <aside className="min-w-0 space-y-5 lg:sticky lg:top-20 lg:self-start">
          <div className="flex flex-col items-center rounded-xl border border-border bg-surface p-5 text-center shadow-[var(--shadow)]">
            <ScoreChip score={deal.dealScore} size="lg" />
            <div className="mt-2 text-sm font-bold text-primary">ציון עסקה</div>
            <p className="mt-1 text-xs leading-relaxed text-muted">
              מבוסס על הפער מהשומה הרשמית, פוטנציאל ההשבחה, ודחיפות מועד ההגשה.
            </p>
          </div>

          <WinningPremium deal={deal} />

          <LandCalculator
            purchasePrice={deal.askingPrice}
            estMarketValue={deal.estMarketValue}
            areaSqm={deal.areaSqm}
          />
        </aside>
      </div>
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

function ActionBtn({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <button className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary transition hover:border-border-strong">
      <Icon size={14} />
      {children}
    </button>
  );
}
