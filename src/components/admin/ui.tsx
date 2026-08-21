import type { LucideIcon } from "lucide-react";

/**
 * Presentational bits shared by the admin panels.
 *
 * Plain components with no client boundary — the dashboard is mostly a server
 * render of numbers, and only the two tables that mutate anything are clients.
 */

/**
 * Dates are formatted with an explicit locale and timezone rather than the
 * runtime's. A Vercel lambda runs in UTC and the person reading this is in
 * Israel, and a dashboard where "last run" is three hours off is worse than one
 * with no clock at all.
 */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return "—";
  return new Intl.DateTimeFormat("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value);
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("he-IL").format(value);
}

export function Section({
  title,
  hint,
  icon: Icon,
  action,
  children,
}: {
  title: string;
  hint?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-surface p-4 shadow-[var(--shadow)]">
      <div className="mb-3 flex items-start gap-2">
        {Icon && <Icon size={16} className="mt-0.5 shrink-0 text-accent" />}
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold text-primary">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] leading-relaxed text-muted">{hint}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "positive" | "warning" | "negative" | "accent";
}) {
  const toneClass =
    tone === "positive"
      ? "text-positive"
      : tone === "warning"
        ? "text-warning"
        : tone === "negative"
          ? "text-negative"
          : tone === "accent"
            ? "text-accent"
            : "text-primary";

  return (
    <div className="rounded-xl border border-border bg-surface p-3.5 shadow-[var(--shadow)]">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className={`num mt-1 text-2xl font-black ${toneClass}`}>
        {typeof value === "number" ? formatCount(value) : value}
      </div>
      {sub && <div className="mt-0.5 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

export function Pill({
  children,
  tone = "muted",
}: {
  children: React.ReactNode;
  tone?: "muted" | "accent" | "positive" | "warning" | "negative";
}) {
  const styles = {
    muted: "bg-surface-2 text-muted",
    accent: "bg-accent-soft text-accent",
    positive: "bg-positive-soft text-positive",
    warning: "bg-warning-soft text-warning",
    negative: "bg-negative-soft text-negative",
  } as const;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${styles[tone]}`}
    >
      {children}
    </span>
  );
}

/** Clerk ids and email addresses are Latin text inside an RTL page. */
export function Mono({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span className="num text-[11px] text-muted" dir="ltr" title={title}>
      {children}
    </span>
  );
}

/**
 * Horizontal scrolling lives on the table's own wrapper. Without it a wide
 * table stretches the grid item and gives the whole document a sideways
 * scrollbar — the same trap the personal area's tab strip fell into.
 */
export function TableWrap({ children }: { children: React.ReactNode }) {
  return <div className="-mx-1 overflow-x-auto px-1">{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-lg border border-dashed border-border bg-surface-2 px-3 py-4 text-center text-xs text-muted">
      {children}
    </p>
  );
}

/**
 * Fourteen bars, drawn with divs. A chart library for one sparkline would cost
 * more bundle than the whole dashboard.
 */
export function MiniBars({ data }: { data: { day: string; total: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.total));
  return (
    <div className="flex h-16 items-end gap-1" dir="ltr">
      {data.map((point) => (
        <div key={point.day} className="flex flex-1 flex-col items-center gap-1">
          <div
            className={`w-full rounded-t ${point.total > 0 ? "bg-accent" : "bg-surface-2"}`}
            style={{ height: `${Math.max(2, (point.total / max) * 52)}px` }}
            title={`${point.day}: ${point.total}`}
          />
          <span className="num text-[9px] text-faint">{point.day.slice(8)}</span>
        </div>
      ))}
    </div>
  );
}
