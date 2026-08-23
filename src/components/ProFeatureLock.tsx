"use client";

import { Crown, Lock } from "lucide-react";
import type { ProFeature } from "@/lib/limits";
import { useUpgradeGate } from "@/components/UpgradeGate";
import { trackEvent } from "@/lib/events";

/**
 * The panel that stands where a PRO-only number would be.
 *
 * Small and client-side so the surrounding component can stay a server render:
 * only the button needs a hook, not the calculation around it.
 *
 * It deliberately does not blur a real value out of the DOM. Overlaying a
 * "locked" filter on top of the actual answer leaves the answer in the page
 * for anyone who opens devtools, which is worse than not sending it — so the
 * server never renders the number for a free account at all, and this stands
 * in its place.
 */
export function ProFeatureLock({
  feature,
  label,
}: {
  feature: ProFeature;
  /** What is behind the lock, named so the teaser is honest about it. */
  label: string;
}) {
  const { show } = useUpgradeGate();

  return (
    <button
      type="button"
      onClick={() => {
        trackEvent("limit_hit", { kind: feature, tier: "free" });
        show({ feature });
      }}
      className="group w-full rounded-lg border border-dashed border-accent/40 bg-accent-soft/40 p-3 text-center transition hover:border-accent hover:bg-accent-soft"
    >
      <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted">
        <Lock size={11} /> {label}
      </div>
      <div className="num mt-1 text-2xl font-black tracking-widest text-faint select-none">••••</div>
      <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] font-bold text-accent group-hover:underline">
        <Crown size={12} />
        פתיחה עם PRO
      </div>
    </button>
  );
}
