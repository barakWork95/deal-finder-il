import Link from "next/link";
import { Flame, Clock, TrendingDown, Sprout, type LucideIcon } from "lucide-react";
import type { BadgeKind, DealType } from "@/lib/types";
import { BADGE_LABEL, DEAL_TYPE_LABEL, scoreTone } from "@/lib/format";

const BADGE_STYLE: Record<BadgeKind, string> = {
  motivated_seller: "bg-negative-soft text-negative",
  deadline_soon: "bg-warning-soft text-warning",
  below_average: "bg-positive-soft text-positive",
  rezoning_potential: "bg-accent-soft text-accent",
};

const BADGE_ICON: Record<BadgeKind, LucideIcon> = {
  motivated_seller: Flame,
  deadline_soon: Clock,
  below_average: TrendingDown,
  rezoning_potential: Sprout,
};

export function DealBadge({ kind }: { kind: BadgeKind }) {
  const Icon = BADGE_ICON[kind];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium whitespace-nowrap ${BADGE_STYLE[kind]}`}
    >
      <Icon size={12} aria-hidden />
      {BADGE_LABEL[kind]}
    </span>
  );
}

export function DealTypeChip({ type }: { type: DealType }) {
  const isRami = type === "rami_tender";
  const isForeclosure = type === "foreclosure";
  const tone = isForeclosure
    ? "border-accent/40 text-accent bg-accent-soft"
    : isRami
      ? "border-border-strong text-primary bg-surface-2"
      : "border-border text-muted bg-surface-2";
  return (
    <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${tone}`}>
      {DEAL_TYPE_LABEL[type]}
    </span>
  );
}

/** Deal Score as a conic progress ring (HUD), color-graded and score-filled. */
export function ScoreChip({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const tone = scoreTone(score);
  const toneVar =
    tone === "positive" ? "var(--positive)" : tone === "warning" ? "var(--warning)" : "var(--negative)";
  const dims =
    size === "lg"
      ? { box: 60, ring: 5, font: "text-2xl" }
      : size === "sm"
        ? { box: 34, ring: 3, font: "text-sm" }
        : { box: 44, ring: 4, font: "text-lg" };
  return (
    <span
      className="score-ring shrink-0"
      style={
        {
          width: dims.box,
          height: dims.box,
          "--tone": toneVar,
          "--pct": `${Math.max(0, Math.min(100, score))}%`,
          "--ring-w": `${dims.ring}px`,
        } as React.CSSProperties
      }
      title={`ציון עסקה: ${score}`}
    >
      <span className={`score-ring-inner num font-extrabold ${dims.font}`}>{score}</span>
    </span>
  );
}

export function DiscountTag({ pct }: { pct: number }) {
  const good = pct > 0;
  return (
    <span className={`num font-semibold ${good ? "text-positive" : "text-negative"}`}>
      {good ? "-" : "+"}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export function PrimaryButton({
  children,
  href,
  onClick,
  className = "",
  type = "button",
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
}) {
  const cls = `btn-primary inline-flex items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 ${className}`;
  if (href) {
    return (
      <Link href={href} className={cls}>
        {children}
      </Link>
    );
  }
  return (
    <button type={type} onClick={onClick} className={cls}>
      {children}
    </button>
  );
}
