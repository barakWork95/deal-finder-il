"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Mail,
  MessageCircle,
  Pause,
  Play,
  Trash2,
  Info,
  Plus,
  SlidersHorizontal,
  Radar,
  type LucideIcon,
} from "lucide-react";
import type { Alert, AlertChannel, AlertFrequency, Deal, DealType, Zoning } from "@/lib/types";
import { DEAL_TYPE_LABEL, formatILSCompact } from "@/lib/format";
import { useProfile } from "@/lib/client-store";
import { usePersonalAlerts } from "@/lib/personal-data";
import type { UserData } from "@/lib/user-repository";
import { Chip, EmptyState, Field, IconBtn } from "@/components/personal/controls";
import { ZONINGS, hasPrefill, type AlertPrefill } from "@/lib/alert-prefill";
import { countMatches } from "@/lib/alert-match";

export const CHANNELS: { key: AlertChannel; label: string; icon: LucideIcon }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "email", label: "אימייל", icon: Mail },
];

const FREQ: { key: AlertFrequency; label: string }[] = [
  { key: "instant", label: "מיידי" },
  { key: "daily", label: "סיכום יומי" },
  { key: "weekly", label: "סיכום שבועי" },
];

const DEAL_TYPES: DealType[] = ["rami_tender", "foreclosure", "price_drop", "inheritance"];

const PRICE_MAX = 60_000_000;

/**
 * Arriving from "שמירת סינון כהתראה" makes the feed's filters authoritative:
 * anything the feed was NOT filtering on starts unset here, rather than
 * inheriting a friendly default that would quietly narrow the alert further
 * than what the user was looking at.
 */
function initialForm(prefill: AlertPrefill) {
  const carried = hasPrefill(prefill);
  return {
    city: prefill.city ?? "",
    maxPrice: prefill.maxPrice ?? (carried ? PRICE_MAX : 3_000_000),
    minDiscount: prefill.minDiscount ?? (carried ? 0 : 15),
    minScore: prefill.minScore ?? (carried ? 0 : 80),
    types: prefill.types ?? (carried ? [] : (["rami_tender"] as DealType[])),
    zonings: prefill.zonings ?? [],
  };
}

export function AlertsPanel({
  deals,
  cities,
  prefill = {},
  account,
  delivery = { email: false, whatsapp: false },
}: {
  deals: Deal[];
  cities: string[];
  prefill?: AlertPrefill;
  account?: UserData;
  /** Which channels the server can actually send on right now. */
  delivery?: { email: boolean; whatsapp: boolean };
}) {
  const { alerts, create, setActive, remove, signedIn } = usePersonalAlerts(account);
  const [profile] = useProfile();
  const [justSaved, setJustSaved] = useState<string | null>(null);

  // Query builder
  const start = initialForm(prefill);
  const [carriedFilters, setCarriedFilters] = useState(hasPrefill(prefill));
  const [name, setName] = useState("");
  const [city, setCity] = useState(start.city);
  const [maxPrice, setMaxPrice] = useState(start.maxPrice);
  const [minDiscount, setMinDiscount] = useState(start.minDiscount);
  const [minScore, setMinScore] = useState(start.minScore);
  const [types, setTypes] = useState<DealType[]>(start.types);
  const [zonings, setZonings] = useState<Zoning[]>(start.zonings);
  const [channels, setChannels] = useState<AlertChannel[]>(["email"]);
  const [frequency, setFrequency] = useState<AlertFrequency>("instant");

  function resetForm() {
    const d = initialForm({});
    setName("");
    setCity(d.city);
    setMaxPrice(d.maxPrice);
    setMinDiscount(d.minDiscount);
    setMinScore(d.minScore);
    setTypes(d.types);
    setZonings(d.zonings);
    setCarriedFilters(false);
  }

  function toggle<T>(list: T[], item: T, setter: (v: T[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  function saveAlert() {
    if (channels.length === 0) return;
    const alert: Alert = {
      id: `a-${Date.now()}`,
      name: name.trim() || `התראה · ${city || "כל הערים"}`,
      filters: {
        cities: city ? [city] : undefined,
        // Slider at the top means "no budget limit", not "up to ₪60M".
        maxPrice: maxPrice < PRICE_MAX ? maxPrice : undefined,
        minDiscountPct: minDiscount || undefined,
        minScore: minScore || undefined,
        dealTypes: types.length ? types : undefined,
        zonings: zonings.length ? zonings : undefined,
      },
      channels,
      frequency,
      isActive: true,
      triggeredThisMonth: 0,
    };
    void create(alert);
    setName("");
    setJustSaved(alert.id);
  }

  // What the alert being built would catch right now, so the filters can be
  // judged before saving them.
  const draftMatches = countMatches(deals, {
    id: "draft",
    name: "",
    filters: {
      cities: city ? [city] : undefined,
      maxPrice,
      minDiscountPct: minDiscount || undefined,
      minScore: minScore || undefined,
      dealTypes: types.length ? types : undefined,
      zonings: zonings.length ? zonings : undefined,
    },
    channels,
    frequency,
    isActive: true,
    triggeredThisMonth: 0,
  });

  // A channel with nowhere to send to is worth flagging before it silently
  // does nothing.
  const missingEmail = channels.includes("email") && !profile.email;
  const missingPhone = channels.includes("whatsapp") && !profile.phone;

  return (
    <div className="space-y-5">
      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h1 className="text-xl font-extrabold text-primary">ההתראות שלי</h1>
          {alerts.length > 0 && (
            <span className="text-xs text-faint">
              <span className="num font-semibold text-muted">{alerts.filter((a) => a.isActive).length}</span>{" "}
              פעילות מתוך <span className="num">{alerts.length}</span>
            </span>
          )}
        </div>

        <p className="mb-3 flex items-start gap-2 rounded-lg border border-border bg-surface-2 p-3 text-[11px] leading-relaxed text-muted">
          <Info size={14} className="mt-px shrink-0 text-accent" />
          <span>
            {!signedIn
              ? "ההתראות נשמרות בדפדפן הזה בלבד. התחברות תעביר אותן לחשבון, תסנכרן בין המכשירים ותאפשר לנו לשלוח אותן בפועל."
              : delivery.email
                ? `ההתראות שמורות בחשבון שלך ונשלחות בפועל${
                    delivery.whatsapp ? " באימייל וב-WhatsApp" : " באימייל"
                  }. בחשבון החינמי הן מגיעות בסיכום יומי; במנוי PRO — מיד עם פרסום המכרז.`
                : "ההתראות שמורות בחשבון שלך וזמינות מכל מכשיר. השליחה בפועל ב-WhatsApp ובאימייל עדיין לא הופעלה — כרגע זו הגדרת הסינון שתרוץ אז."}
          </span>
        </p>

        <div className="space-y-3">
          {alerts.map((a) => (
            <AlertCard
              key={a.id}
              alert={a}
              matches={countMatches(deals, a)}
              highlight={a.id === justSaved}
              onToggle={() => void setActive(a.id, !a.isActive)}
              onRemove={() => void remove(a.id)}
            />
          ))}
          {alerts.length === 0 && (
            <EmptyState title="עוד לא יצרת התראות">
              בנה התראה בטופס שלמטה ותקבל עדכון על כל מכרז חדש שעונה על הסינון שלך.
            </EmptyState>
          )}
        </div>
      </section>

      {/* Query builder */}
      <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
        <h2 className="mb-4 text-lg font-bold text-primary">יצירת התראה חדשה</h2>

        {carriedFilters && (
          <p className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-accent/30 bg-accent-soft p-3 text-[11px] text-muted">
            <SlidersHorizontal size={13} className="shrink-0 text-accent" />
            <span>הסינון מהפיד הועתק לטופס. אפשר לשנות כל שדה לפני השמירה.</span>
            <Link href="/" className="font-semibold text-accent hover:underline">
              חזרה לפיד
            </Link>
          </p>
        )}

        <div className="mb-4">
          <Field label="שם ההתראה">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder='למשל: מגרשים למגורים בשרון עד 3M'
              className="input w-full"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="עיר">
            <select value={city} onChange={(e) => setCity(e.target.value)} className="input w-full">
              <option value="">כל הערים</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Field>

          <Field
            label={`תקציב מקסימלי: ${maxPrice >= PRICE_MAX ? "ללא הגבלה" : formatILSCompact(maxPrice)}`}
          >
            <input
              type="range"
              min={500_000}
              max={PRICE_MAX}
              step={250_000}
              value={maxPrice}
              onChange={(e) => setMaxPrice(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
            />
          </Field>

          <Field label={`פער משומה מינ׳: ${minDiscount}%`}>
            <input
              type="range"
              min={0}
              max={60}
              step={1}
              value={minDiscount}
              onChange={(e) => setMinDiscount(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
            />
          </Field>

          <Field label={`ציון עסקה מינ׳: ${minScore}`}>
            <input
              type="range"
              min={0}
              max={99}
              step={1}
              value={minScore}
              onChange={(e) => setMinScore(Number(e.target.value))}
              className="mt-3 w-full accent-[var(--accent)]"
            />
          </Field>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-[11px] font-medium text-faint">סוג עסקה</span>
          <div className="flex flex-wrap gap-2">
            {DEAL_TYPES.map((t) => (
              <Chip key={t} active={types.includes(t)} onClick={() => toggle(types, t, setTypes)}>
                {DEAL_TYPE_LABEL[t]}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-[11px] font-medium text-faint">
            ייעוד תכנוני <span className="text-faint">(ריק = כל הייעודים)</span>
          </span>
          <div className="flex flex-wrap gap-2">
            {ZONINGS.map((z) => (
              <Chip key={z} active={zonings.includes(z)} onClick={() => toggle(zonings, z, setZonings)}>
                {z}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-[11px] font-medium text-faint">ערוצי התראה</span>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map(({ key, label, icon: Icon }) => (
              <Chip
                key={key}
                active={channels.includes(key)}
                onClick={() => toggle(channels, key, setChannels)}
              >
                <Icon size={14} /> {label}
              </Chip>
            ))}
          </div>
          {channels.length === 0 && (
            <p className="mt-2 text-[11px] text-negative">בחר לפחות ערוץ אחד.</p>
          )}
          {(missingEmail || missingPhone) && (
            <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
              <Info size={13} />
              {missingEmail && missingPhone
                ? "חסרים אימייל וטלפון בפרטי החשבון."
                : missingEmail
                  ? "חסר אימייל בפרטי החשבון."
                  : "חסר מספר טלפון ל-WhatsApp בפרטי החשבון."}
            </p>
          )}
        </div>

        <div className="mt-4">
          <span className="mb-2 block text-[11px] font-medium text-faint">תדירות</span>
          <div className="flex flex-wrap gap-2">
            {FREQ.map((f) => (
              <Chip key={f.key} active={frequency === f.key} onClick={() => setFrequency(f.key)}>
                {f.label}
              </Chip>
            ))}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <Radar size={14} className="text-accent" />
            הסינון הנוכחי תואם{" "}
            <span className="num font-bold text-primary">{draftMatches}</span> מכרזים פעילים
          </span>
          <span className="ms-auto" />
          <button
            type="button"
            onClick={resetForm}
            className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:text-primary"
          >
            ניקוי
          </button>
          <button
            type="button"
            onClick={saveAlert}
            disabled={channels.length === 0}
            className="btn-primary inline-flex items-center gap-1.5 rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Plus size={15} /> שמירת התראה
          </button>
        </div>
      </section>
    </div>
  );
}

function AlertCard({
  alert,
  matches,
  highlight,
  onToggle,
  onRemove,
}: {
  alert: Alert;
  matches: number;
  highlight: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const f = alert.filters;
  const summary: string[] = [];
  if (f.cities?.length) summary.push(f.cities.join(", "));
  if (f.maxPrice) summary.push(`עד ${formatILSCompact(f.maxPrice)}`);
  if (f.minDiscountPct) summary.push(`פער משומה ${f.minDiscountPct}%+`);
  if (f.minScore) summary.push(`ציון ${f.minScore}+`);
  if (f.dealTypes?.length) summary.push(f.dealTypes.map((t) => DEAL_TYPE_LABEL[t]).join(" · "));
  if (f.zonings?.length) summary.push(`ייעוד: ${f.zonings.join(", ")}`);

  return (
    <div
      className={`rounded-xl border bg-surface p-4 shadow-[var(--shadow)] transition ${
        highlight ? "border-accent" : "border-border"
      } ${alert.isActive ? "" : "opacity-70"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-bold text-primary">{alert.name}</h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                alert.isActive ? "bg-positive-soft text-positive" : "bg-surface-2 text-muted"
              }`}
            >
              ● {alert.isActive ? "פעילה" : "מושהית"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{summary.join(" · ") || "כל המכרזים"}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
            {alert.channels.map((c) => {
              const ch = CHANNELS.find((x) => x.key === c);
              if (!ch) return null;
              const Icon = ch.icon;
              return (
                <span
                  key={c}
                  className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-muted"
                >
                  <Icon size={12} /> {ch.label}
                </span>
              );
            })}
            <span>· {FREQ.find((f) => f.key === alert.frequency)?.label}</span>
          </div>
          <p
            className={`mt-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-semibold ${
              matches > 0 ? "bg-accent-soft text-accent" : "bg-surface-2 text-faint"
            }`}
            title="נבדק מול המכרזים הפעילים כרגע"
          >
            <Radar size={12} />
            {matches > 0 ? (
              <>
                נמצאו <span className="num">{matches}</span> מכרזים תואמים
              </>
            ) : (
              "אין כרגע מכרזים תואמים"
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconBtn onClick={onToggle} title={alert.isActive ? "השהיית ההתראה" : "הפעלת ההתראה"}>
            {alert.isActive ? <Pause size={14} /> : <Play size={14} />}
          </IconBtn>
          <IconBtn onClick={onRemove} title="מחיקת ההתראה" tone="danger">
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}
