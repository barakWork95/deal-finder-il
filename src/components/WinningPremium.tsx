import { Gavel, TrendingUp, Info } from "lucide-react";
import { formatILS } from "@/lib/format";
import type { Deal } from "@/lib/types";

/**
 * "פרמיית זכייה" — RMI minimum bids are low anchors, so the headline gap vs
 * the שומה is not what a bidder actually pays. This projects the likely
 * winning price from how much past winners in the same city+zoning paid over
 * the minimum, and judges it against the official appraisal.
 */
export function WinningPremium({ deal }: { deal: Deal }) {
  if (deal.winningPremium == null || deal.expectedWinningPrice == null) return null;

  const premiumPct = Math.round(deal.winningPremium * 100);
  const expected = deal.expectedWinningPrice;
  const appraisal = deal.estMarketValue;
  const stillUnder = appraisal > 0 && expected < appraisal;
  const vsAppraisal =
    appraisal > 0 ? Math.round(((expected - appraisal) / appraisal) * 100) : null;
  const thin = (deal.winningPremiumN ?? 0) < 8;

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
      <div className="mb-3 flex items-center gap-2">
        <Gavel size={16} className="text-accent" />
        <h3 className="text-sm font-bold text-primary">פרמיית זכייה חזויה</h3>
      </div>

      <div className="mb-3 flex items-baseline gap-2">
        <span className="num text-3xl font-black text-accent" dir="ltr">
          +{premiumPct}%
        </span>
        <span className="text-xs text-muted">מעל מחיר המינימום</span>
      </div>

      <p className="mb-3 text-[11px] leading-relaxed text-muted">
        מבוסס על <span className="num font-semibold text-primary">{deal.winningPremiumN}</span> מכרזי
        קרקע שהוכרעו ב{deal.city}
        {deal.zoning ? ` (${deal.zoning})` : ""}.
      </p>

      <div className="space-y-1 rounded-lg bg-surface-2 p-3 text-xs">
        <Row label="מחיר מינימום" value={formatILS(deal.minBid ?? deal.askingPrice)} />
        {deal.developmentCosts ? (
          <Row label="הוצאות פיתוח" value={formatILS(deal.developmentCosts)} />
        ) : null}
        <Row label="שומה רשמית" value={formatILS(appraisal)} />
      </div>

      <div
        className={`mt-3 rounded-lg border p-3 text-center ${
          stillUnder ? "border-positive/40 bg-positive-soft" : "border-warning/40 bg-warning-soft"
        }`}
      >
        <div className="text-[10px] text-muted">מחיר זכייה חזוי</div>
        <div
          className={`num text-2xl font-extrabold ${stillUnder ? "text-positive" : "text-warning"}`}
          dir="ltr"
        >
          {formatILS(expected)}
        </div>
        {vsAppraisal !== null && (
          <div className={`mt-1 text-[11px] font-semibold ${stillUnder ? "text-positive" : "text-warning"}`}>
            <TrendingUp size={11} className="inline" />{" "}
            {stillUnder
              ? `עדיין ${Math.abs(vsAppraisal)}% מתחת לשומה`
              : `${vsAppraisal}% מעל השומה`}
          </div>
        )}
      </div>

      {thin && (
        <p className="mt-2 flex items-start gap-1 text-[10px] leading-tight text-faint">
          <Info size={11} className="mt-0.5 shrink-0" />
          מדגם קטן — יש להתייחס לתחזית בזהירות.
        </p>
      )}
      <p className="mt-2 text-[10px] leading-tight text-faint">
        * תחזית סטטיסטית בלבד המבוססת על תוצאות עבר, אינה מהווה ייעוץ ואינה מבטיחה את תוצאת המכרז.
      </p>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num text-primary" dir="ltr">
        {value}
      </span>
    </div>
  );
}
