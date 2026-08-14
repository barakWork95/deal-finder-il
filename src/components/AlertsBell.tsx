"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { usePersonalAlerts } from "@/lib/personal-data";

/**
 * Bell with a live count of *active* alerts — paused ones aren't waiting to
 * tell you anything, so they don't belong in the badge. No alerts, no badge.
 *
 * Reads through the same interface as the personal area, so it counts the
 * account's alerts when signed in and the browser's when not.
 */
export function AlertsBell() {
  const { alerts } = usePersonalAlerts();
  const active = alerts.filter((a) => a.isActive).length;

  return (
    <Link
      href="/alerts"
      aria-label={active > 0 ? `התראות — ${active} פעילות` : "התראות"}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-surface text-muted transition hover:text-primary"
    >
      <Bell size={18} />
      {active > 0 && (
        <span className="num absolute -end-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-negative px-1 text-[10px] font-bold text-white">
          {active > 9 ? "9+" : active}
        </span>
      )}
    </Link>
  );
}
