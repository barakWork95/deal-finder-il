"use client";

import { Bookmark } from "lucide-react";
import { useSavedDeals } from "@/lib/personal-data";
import { useUpgradeGate } from "@/components/UpgradeGate";

/**
 * Bookmark toggle. Cards and table rows are wrapped in a <Link>, so the click
 * has to be stopped from navigating to the tender.
 */
export function SaveDealButton({
  dealId,
  variant = "icon",
  className = "",
}: {
  dealId: string;
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const { ids, toggle } = useSavedDeals();
  const { show } = useUpgradeGate();
  const saved = ids.includes(dealId);

  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition";
  const tone = saved
    ? "border-accent bg-accent-soft text-accent"
    : "border-border bg-surface text-muted hover:border-border-strong hover:text-primary";

  return (
    <button
      type="button"
      aria-pressed={saved}
      title={saved ? "הסרה מהעסקאות השמורות" : "שמירה לאזור האישי"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        // The gate is checked before anything changes, so the bookmark never
        // fills in and then empties again — that reads as a broken button
        // rather than as a plan boundary.
        void toggle(dealId).then((result) => {
          if (!result.ok) show(result);
        });
      }}
      className={`${base} ${tone} ${variant === "icon" ? "h-8 w-8" : "px-3 py-1.5"} ${className}`}
    >
      <Bookmark size={14} fill={saved ? "currentColor" : "none"} />
      {variant === "labelled" && (saved ? "נשמר" : "שמירה")}
    </button>
  );
}
