"use client";

import { useEffect, useState } from "react";
import { Check, Crown, Info, Minus, ShieldCheck, Sparkles } from "lucide-react";
import { trackEvent } from "@/lib/events";
import type { PlanTier } from "@/lib/types";

type Plan = {
  key: "free" | "pro";
  name: string;
  price: string;
  period?: string;
  tagline: string;
  features: { label: string; included: boolean }[];
};

const PLANS: Plan[] = [
  {
    key: "free",
    name: "מסלול חינם",
    price: "₪0",
    tagline: "להתחיל לעקוב אחרי מכרזי קרקע",
    features: [
      { label: "סיכום אימייל יומי/שבועי בלבד (דיליי שליחה)", included: true },
      { label: "עד 2 התראות פעילות", included: true },
      { label: "עד 3 עסקאות שמורות", included: true },
      { label: "מפה ופיד מכרזים", included: true },
      { label: "התראות WhatsApp ו-Email מיידיות", included: false },
      { label: "סינון אוטומטי לפי ציון עסקה 80+", included: false },
      { label: "מחשבון פרמיית זכייה מלא", included: false },
    ],
  },
  {
    key: "pro",
    name: "מסלול PRO",
    price: "₪99",
    period: "לחודש",
    tagline: "להגיע למכרז הנכון לפני כולם",
    features: [
      { label: "התראות WhatsApp ו-Email מיידיות (Instant)", included: true },
      { label: "התראות ועסקאות שמורות ללא הגבלה", included: true },
      { label: "סינון אוטומטי לפי ציון עסקה 80+", included: true },
      { label: "מחשבון פרמיית זכייה מלא", included: true },
      { label: "מפה ופיד מכרזים", included: true },
      { label: "ביטול בכל עת", included: true },
    ],
  },
];

export function BillingPanel({ tier = "free" }: { tier?: PlanTier }) {
  const [notice, setNotice] = useState(false);
  const isPro = tier === "pro";

  /**
   * How many people reach the pricing table at all — the denominator without
   * which the upgrade count below means nothing. `once` guards against React's
   * development double-invoke and against a tab switch counting as a second
   * visit; the server deduplicates as well, since this map dies with the page.
   */
  useEffect(() => {
    trackEvent("pricing_view", { tier }, { once: true });
  }, [tier]);

  return (
    <section className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold text-primary">מנוי ותשלום</h1>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted">
          המסלול הנוכחי שלך:
          <span
            className={`inline-flex items-center gap-1 font-semibold ${isPro ? "text-accent" : "text-primary"}`}
          >
            {isPro && <Crown size={14} />}
            {isPro ? "PRO" : "חינם"}
          </span>
        </p>
      </div>

      <p className="flex items-start gap-2 rounded-lg border border-accent/30 bg-accent-soft p-3 text-[11px] leading-relaxed text-muted">
        <Sparkles size={14} className="mt-px shrink-0 text-accent" />
        <span>
          בתקופת ההרצה <span className="font-semibold text-primary">כל היכולות פתוחות לכולם</span> ללא
          תשלום, וללא המגבלות המופיעות במסלול החינם. הטבלה מתארת את המסלולים כפי שייכנסו לתוקף
          בהמשך.
        </span>
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        {PLANS.map((plan) => {
          const pro = plan.key === "pro";
          return (
            <div
              key={plan.key}
              className={`relative flex flex-col rounded-xl border bg-surface p-5 shadow-[var(--shadow)] ${
                pro ? "border-accent" : "border-border"
              }`}
            >
              {pro && (
                <span className="absolute -top-2.5 start-5 rounded-full bg-accent px-2.5 py-0.5 text-[10px] font-bold text-white">
                  מומלץ
                </span>
              )}

              <h2 className="text-lg font-bold text-primary">{plan.name}</h2>
              <p className="mt-0.5 text-xs text-muted">{plan.tagline}</p>

              <div className="mt-4 flex items-baseline gap-1.5">
                <span className="num text-3xl font-black text-primary" dir="ltr">
                  {plan.price}
                </span>
                {plan.period && <span className="text-sm text-muted">{plan.period}</span>}
              </div>

              <ul className="mt-4 flex-1 space-y-2">
                {plan.features.map((f) => (
                  <li key={f.label} className="flex items-start gap-2 text-sm">
                    {f.included ? (
                      <Check size={15} className="mt-0.5 shrink-0 text-positive" />
                    ) : (
                      <Minus size={15} className="mt-0.5 shrink-0 text-faint" />
                    )}
                    <span className={f.included ? "text-primary" : "text-faint line-through"}>
                      {f.label}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="mt-5">
                {pro && isPro ? (
                  <div className="rounded-lg border border-accent bg-accent-soft px-4 py-2.5 text-center text-sm font-semibold text-accent">
                    המסלול הנוכחי שלך
                  </div>
                ) : pro ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        // The event that the roadmap actually hangs on. It
                        // fires before the state update, and trackEvent uses
                        // sendBeacon, so it survives even if the click ends up
                        // navigating the page away.
                        trackEvent("upgrade_click", { tier, price: 99 });
                        trackEvent("billing_notice_view", { tier });
                        setNotice(true);
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#ffc439] px-4 py-2.5 text-sm font-bold text-[#0f1e3d] transition hover:brightness-105"
                    >
                      מעבר לתשלום עם
                      <span className="font-black tracking-tight" dir="ltr">
                        <span className="text-[#003087]">Pay</span>
                        <span className="text-[#0070ba]">Pal</span>
                      </span>
                    </button>
                    <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-faint">
                      <ShieldCheck size={12} /> תשלום מאובטח דרך PayPal · גם בכרטיס אשראי
                    </p>
                  </>
                ) : (
                  <div className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-center text-sm font-semibold text-muted">
                    {isPro ? "מסלול הבסיס" : "המסלול הנוכחי שלך"}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {notice && (
        <p className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
          <Info size={14} className="mt-px shrink-0 text-accent" />
          <span>
            הסליקה דרך PayPal עדיין לא נפתחה — לא בוצע חיוב. בינתיים כל היכולות זמינות לך ללא תשלום,
            ונעדכן כאן ברגע שהמנוי ייצא לדרך.
          </span>
        </p>
      )}

      <div className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-bold text-primary">אמצעי תשלום</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          <span className="font-semibold text-primary" dir="ltr">
            PayPal
          </span>{" "}
          הוא שער התשלום הראשי של קרקעHOT: אפשר לשלם מיתרת PayPal או בכרטיס אשראי דרך PayPal, בלי
          שפרטי הכרטיס נשמרים אצלנו. החיוב חודשי, וניתן לבטל בכל עת מהמסך הזה.
        </p>
      </div>
    </section>
  );
}
