"use client";

import { useMemo, useState } from "react";
import { formatILS } from "@/lib/format";

/**
 * מחשבון עלויות והשבחה — land cost & appreciation calculator.
 * Land purchase tax (מס רכישה) defaults to 6% (the Israeli rate for land),
 * plus development levies/betterment (פיתוח והיטלי השבחה). Estimates only.
 */
export function LandCalculator({
  purchasePrice,
  estMarketValue,
  areaSqm,
}: {
  purchasePrice: number;
  estMarketValue: number;
  areaSqm: number;
}) {
  const [price, setPrice] = useState(purchasePrice);
  const [taxPct, setTaxPct] = useState(6);
  const [development, setDevelopment] = useState(Math.round((price * 0.08) / 1000) * 1000);
  const [otherCosts, setOtherCosts] = useState(Math.round((price * 0.03) / 1000) * 1000);
  const [exitValue, setExitValue] = useState(Math.max(estMarketValue, Math.round((price * 1.2) / 1000) * 1000));

  const purchaseTax = Math.round(price * (taxPct / 100));
  const totalInvested = price + development + purchaseTax + otherCosts;

  const result = useMemo(() => {
    const profit = exitValue - totalInvested;
    const roiPct = (profit / totalInvested) * 100;
    const pricePerSqm = areaSqm ? Math.round(price / areaSqm) : 0;
    return { profit, roiPct, pricePerSqm };
  }, [exitValue, totalInvested, price, areaSqm]);

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
      <h3 className="mb-3 text-sm font-bold text-primary">מחשבון עלויות והשבחה</h3>

      <div className="space-y-2.5">
        <NumInput label="מחיר רכישה" value={price} onChange={setPrice} step={10_000} />
        <div className="grid grid-cols-2 gap-2.5">
          <NumInput label="מס רכישה %" value={taxPct} onChange={setTaxPct} step={1} />
          <NumInput label="עלויות נלוות (עו״ד, תיווך)" value={otherCosts} onChange={setOtherCosts} step={5_000} />
        </div>
        <NumInput label="פיתוח והיטלי השבחה" value={development} onChange={setDevelopment} step={10_000} />
        <NumInput label="שווי צפוי במימוש / לאחר השבחה" value={exitValue} onChange={setExitValue} step={50_000} />
      </div>

      {/* Cost summary */}
      <div className="mt-3 space-y-1 rounded-lg bg-surface-2 p-3 text-xs">
        <Row label="מס רכישה משוער" value={formatILS(purchaseTax)} />
        <Row label="מחיר למ״ר קרקע" value={formatILS(result.pricePerSqm)} />
        <Row label="סך השקעה כוללת" value={formatILS(totalInvested)} strong />
      </div>

      {/* Outputs */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Stat
          label="רווח צפוי"
          value={formatILS(result.profit)}
          tone={result.profit >= 0 ? "positive" : "negative"}
        />
        <Stat
          label="תשואה על ההשקעה"
          value={`${result.roiPct.toFixed(1)}%`}
          tone={result.roiPct >= 0 ? "positive" : "negative"}
        />
      </div>
      <p className="mt-2 text-[10px] leading-tight text-faint">
        * הערכה בלבד, אינה מהווה ייעוץ. מס הרכישה ועלויות הפיתוח משתנים לפי סוג הקרקע, הייעוד וסטטוס התכנון.
      </p>
    </div>
  );
}

function NumInput({
  label,
  value,
  onChange,
  step,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[11px] font-medium text-faint">{label}</span>
      <input
        type="number"
        value={value}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="num input w-full text-start"
        dir="ltr"
      />
    </label>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className={`num ${strong ? "font-bold text-primary" : "text-primary"}`} dir="ltr">
        {value}
      </span>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "positive" | "negative" | "neutral";
}) {
  const toneClass =
    tone === "positive" ? "text-positive" : tone === "negative" ? "text-negative" : "text-primary";
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-2.5 text-center">
      <div className={`num text-lg font-extrabold ${toneClass}`} dir="ltr">
        {value}
      </div>
      <div className="mt-0.5 text-[10px] text-muted">{label}</div>
    </div>
  );
}
