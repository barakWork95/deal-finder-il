import type { Deal, TenderPhase } from "./types";
import { daysUntil, formatDate } from "./format";

/**
 * Where a tender is in its own timeline — published, open for bids, or over.
 *
 * Derived, never stored. A phase written into the database is correct only
 * until the next date passes, and nothing would recompute it; `deals` carries
 * the two facts (`submission_opens_at`, `submission_deadline`) and every
 * reader turns them into a phase here.
 *
 * `now` is a parameter rather than a call to the clock, for the same reason
 * `deadlineInfo` takes one: reading the time during render is impure, the
 * repo's lint rules reject it, and two components deciding "is this urgent"
 * a millisecond apart must not disagree.
 */

export type { TenderPhase };

/** Deadlines this close are worth colouring — matches format.ts's URGENT_DAYS. */
const URGENT_DAYS = 6;

export function tenderPhase(
  deal: Pick<Deal, "submissionOpensAt" | "submissionDeadline">,
  now: Date = new Date(),
): TenderPhase {
  const closesIn = daysUntil(deal.submissionDeadline, now);
  if (closesIn != null && closesIn < 0) return "closed";

  const opensIn = daysUntil(deal.submissionOpensAt, now);
  // No opening date at all (non-רמ"י sources, older rows before migration 012)
  // means we cannot claim it is closed to bidding — treat it as open, which is
  // how the whole feed behaved before this concept existed.
  if (opensIn != null && opensIn > 0) return "not_started";

  return closesIn != null && closesIn < URGENT_DAYS ? "closing_soon" : "open";
}

export const PHASE_LABEL: Record<TenderPhase, string> = {
  not_started: "טרם החל",
  open: "פתוח להגשה",
  closing_soon: "נסגר בקרוב",
  closed: "הסתיים",
};

/** Filter chips only offer the two states a live tender can be in. */
export const FILTERABLE_PHASES: TenderPhase[] = ["not_started", "open"];

/**
 * Treats "open" and "closing_soon" as one choice, so a filter for פתוח להגשה
 * does not quietly exclude the tenders closing this week.
 */
export function matchesPhase(phase: TenderPhase, wanted: TenderPhase[]): boolean {
  if (!wanted.length) return true;
  if (phase === "closing_soon") return wanted.includes("open") || wanted.includes("closing_soon");
  return wanted.includes(phase);
}

export type SubmissionInfo = {
  /** Standalone phrase for a compact cell, e.g. "נפתח להגשה בעוד 7 ימים". */
  label: string;
  /**
   * Just the interval, e.g. "בעוד 7 ימים". Used where `dateLabel` is already
   * on screen — "נפתח להגשה: 19.08 (נפתח להגשה בעוד 7 ימים)" says it twice.
   */
  relative: string;
  /** The date that label refers to, already formatted. */
  date: string;
  /** Prefix for the date line, e.g. "נפתח להגשה" / "מועד אחרון להגשה". */
  dateLabel: string;
  phase: TenderPhase;
  urgent: boolean;
};

/**
 * The *actionable* line for a tender.
 *
 * A tender that opens in a week and closes in eleven has two dates, and the
 * one that matters is the opening. Counting down to the deadline instead reads
 * as "plenty of time" precisely when the answer is "you cannot bid yet" — the
 * same species of misleading-but-true as calling the appraisal gap a discount.
 */
export function submissionInfo(
  deal: Pick<Deal, "submissionOpensAt" | "submissionDeadline">,
  now: Date = new Date(),
): SubmissionInfo {
  const phase = tenderPhase(deal, now);

  if (phase === "not_started") {
    const days = daysUntil(deal.submissionOpensAt, now) ?? 0;
    const relative = days <= 1 ? "מחר" : `בעוד ${days} ימים`;
    return {
      label: days <= 1 ? "נפתח להגשה מחר" : `נפתח להגשה בעוד ${days} ימים`,
      relative,
      date: formatDate(deal.submissionOpensAt),
      dateLabel: "נפתח להגשה",
      phase,
      urgent: false,
    };
  }

  const days = daysUntil(deal.submissionDeadline, now);
  const label =
    days == null
      ? "ללא מועד"
      : days < 0
        ? "הסתיים"
        : days === 0
          ? "היום!"
          : days === 1
            ? "מחר"
            : `בעוד ${days} ימים`;

  return {
    label,
    relative: label, // already just the interval once the tender is open
    date: formatDate(deal.submissionDeadline),
    dateLabel: "מועד אחרון להגשה",
    phase,
    urgent: phase === "closing_soon",
  };
}
