"use client";

import { useState } from "react";
import { MessageCircle, Send, Mail, Pause, Play, Trash2, Info, type LucideIcon } from "lucide-react";
import { ALERTS, CITIES } from "@/lib/mock-data";
import type { Alert, AlertChannel, AlertFrequency, DealType } from "@/lib/types";
import { DEAL_TYPE_LABEL, formatILSCompact } from "@/lib/format";

const CHANNELS: { key: AlertChannel; label: string; icon: LucideIcon }[] = [
  { key: "whatsapp", label: "WhatsApp", icon: MessageCircle },
  { key: "telegram", label: "Telegram", icon: Send },
  { key: "email", label: "Email", icon: Mail },
];

const FREQ: { key: AlertFrequency; label: string }[] = [
  { key: "instant", label: "מיידי" },
  { key: "daily", label: "סיכום יומי" },
  { key: "weekly", label: "סיכום שבועי" },
];

const DEAL_TYPES: DealType[] = ["foreclosure", "rami_tender", "price_drop", "inheritance"];

const SIDEBAR = [
  { label: "ההתראות שלי", active: true },
  { label: "עסקאות שמורות", active: false },
  { label: "פרטי חשבון", active: false },
  { label: "מנוי ותשלום", active: false },
];

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>(ALERTS);

  // Query builder state
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [maxPrice, setMaxPrice] = useState(2_000_000);
  const [minDiscount, setMinDiscount] = useState(15);
  const [minScore, setMinScore] = useState(80);
  const [types, setTypes] = useState<DealType[]>(["foreclosure", "rami_tender"]);
  const [channels, setChannels] = useState<AlertChannel[]>(["whatsapp", "email"]);
  const [frequency, setFrequency] = useState<AlertFrequency>("instant");

  function toggle<T>(list: T[], item: T, setter: (v: T[]) => void) {
    setter(list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  }

  function toggleActive(id: string) {
    setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isActive: !a.isActive } : a)));
  }

  function removeAlert(id: string) {
    setAlerts((prev) => prev.filter((a) => a.id !== id));
  }

  function saveAlert() {
    const newAlert: Alert = {
      id: `a-${Date.now()}`,
      name: name.trim() || "התראה חדשה",
      filters: {
        cities: city ? [city] : undefined,
        maxPrice,
        minDiscountPct: minDiscount,
        minScore,
        dealTypes: types,
      },
      channels,
      frequency,
      isActive: true,
      triggeredThisMonth: 0,
    };
    setAlerts((prev) => [newAlert, ...prev]);
    setName("");
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-5">
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Sidebar */}
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 px-2 text-sm font-bold text-primary">איזור אישי</h2>
          <nav className="space-y-1">
            {SIDEBAR.map((item) => (
              <button
                key={item.label}
                className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium transition ${
                  item.active
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-primary"
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>
          <div className="mt-4 rounded-lg border border-border bg-surface p-3 text-xs">
            <div className="mb-1 font-semibold text-primary">תוכנית: בסיק</div>
            <div className="text-muted">
              נשלחו <span className="num font-bold text-accent">19</span> התראות החודש
            </div>
          </div>
        </aside>

        {/* Content */}
        <div className="space-y-5">
          {/* Alerts list */}
          <section>
            <h1 className="mb-3 text-xl font-extrabold text-primary">ההתראות שלי</h1>
            <div className="space-y-3">
              {alerts.map((a) => (
                <AlertCard key={a.id} alert={a} onToggle={toggleActive} onRemove={removeAlert} />
              ))}
              {alerts.length === 0 && (
                <p className="rounded-xl border border-dashed border-border bg-surface p-6 text-center text-sm text-muted">
                  אין התראות פעילות. צור התראה חדשה למטה.
                </p>
              )}
            </div>
          </section>

          {/* Query builder */}
          <section className="rounded-xl border border-border bg-surface p-5 shadow-[var(--shadow)]">
            <h2 className="mb-4 text-lg font-bold text-primary">יצירת התראה חדשה</h2>

            <label className="mb-4 block">
              <span className="mb-1 block text-[11px] font-medium text-faint">שם ההתראה</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="למשל: דירות בחיפה מתחת ל-1.2M"
                className="input w-full"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-faint">עיר</span>
                <select value={city} onChange={(e) => setCity(e.target.value)} className="input w-full">
                  <option value="">כל הערים</option>
                  {CITIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-faint">
                  תקציב מקסימלי: {formatILSCompact(maxPrice)}
                </span>
                <input
                  type="range"
                  min={500_000}
                  max={15_000_000}
                  step={250_000}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-faint">
                  אחוז דיסקאונט מינ׳: <span className="num">{minDiscount}%</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={40}
                  step={1}
                  value={minDiscount}
                  onChange={(e) => setMinDiscount(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--accent)]"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-[11px] font-medium text-faint">
                  ציון עסקה מינ׳: <span className="num">{minScore}</span>
                </span>
                <input
                  type="range"
                  min={0}
                  max={99}
                  step={1}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="mt-3 w-full accent-[var(--accent)]"
                />
              </label>
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
              <span className="mb-2 block text-[11px] font-medium text-faint">ערוצי התראה</span>
              <div className="flex flex-wrap gap-2">
                {CHANNELS.map((c) => {
                  const Icon = c.icon;
                  return (
                    <Chip
                      key={c.key}
                      active={channels.includes(c.key)}
                      onClick={() => toggle(channels, c.key, setChannels)}
                    >
                      <Icon size={14} /> {c.label}
                    </Chip>
                  );
                })}
              </div>
              {channels.includes("whatsapp") && (
                <p className="mt-2 flex items-center gap-1.5 text-[11px] text-warning">
                  <Info size={13} /> נדרש אימות מספר טלפון להפעלת התראות WhatsApp.
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

            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setName("")}
                className="rounded-lg px-4 py-2 text-sm font-medium text-muted transition hover:text-primary"
              >
                ביטול
              </button>
              <button
                onClick={saveAlert}
                className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-white transition hover:bg-accent-hover"
              >
                שמירת התראה
              </button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function AlertCard({
  alert,
  onToggle,
  onRemove,
}: {
  alert: Alert;
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const f = alert.filters;
  const summary: string[] = [];
  if (f.cities?.length) summary.push(`עיר: ${f.cities.join(", ")}`);
  if (f.maxPrice) summary.push(`עד ${formatILSCompact(f.maxPrice)}`);
  if (f.minDiscountPct) summary.push(`דיסקאונט ${f.minDiscountPct}%+`);
  if (f.minScore) summary.push(`ציון ${f.minScore}+`);
  if (f.dealTypes?.length) summary.push(f.dealTypes.map((t) => DEAL_TYPE_LABEL[t]).join(" · "));

  return (
    <div className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-primary">{alert.name}</h3>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                alert.isActive ? "bg-positive-soft text-positive" : "bg-surface-2 text-muted"
              }`}
            >
              ● {alert.isActive ? "פעיל" : "מושהה"}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted">{summary.join(" · ")}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-faint">
            <span>ערוצים:</span>
            {alert.channels.map((c) => {
              const ch = CHANNELS.find((x) => x.key === c);
              if (!ch) return null;
              const Icon = ch.icon;
              return (
                <span key={c} className="inline-flex items-center gap-1 rounded bg-surface-2 px-1.5 py-0.5 text-muted">
                  <Icon size={12} /> {ch.label}
                </span>
              );
            })}
            <span className="ms-1">
              · נשלחו <span className="num font-semibold text-muted">{alert.triggeredThisMonth}</span> החודש
            </span>
          </div>
        </div>
        <div className="flex shrink-0 gap-1">
          <IconBtn onClick={() => onToggle(alert.id)} title={alert.isActive ? "השהיה" : "הפעלה"}>
            {alert.isActive ? <Pause size={14} /> : <Play size={14} />}
          </IconBtn>
          <IconBtn onClick={() => onRemove(alert.id)} title="מחיקה">
            <Trash2 size={14} />
          </IconBtn>
        </div>
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border bg-surface-2 text-muted hover:text-primary"
      }`}
    >
      {children}
    </button>
  );
}

function IconBtn({
  onClick,
  title,
  children,
}: {
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-surface-2 text-sm transition hover:border-border-strong"
    >
      {children}
    </button>
  );
}
