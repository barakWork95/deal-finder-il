"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import Link from "next/link";
import { Crown, X } from "lucide-react";
import { FEATURE_COPY, LIMIT_COPY, type LimitKind, type ProFeature } from "@/lib/limits";
import { trackEvent } from "@/lib/events";

/**
 * The wall a free account runs into, and the one place it is drawn.
 *
 * Mounted once in the layout rather than per button: the bookmark renders 146
 * times on the feed, and 146 copies of a modal that is almost never open is
 * both wasteful and a good way to end up with two of them on screen.
 *
 * Nothing here decides anything. It is told that a limit was hit, by whichever
 * component was refused, and says so.
 */

/**
 * Two reasons to be stopped, and they read differently.
 *
 * A quota carries numbers — "three of three" is the whole explanation. A
 * capability has none: it is simply not in the free plan, and inventing a
 * count for it would make the copy worse.
 */
type Blocked =
  | { kind: LimitKind; limit: number; current: number }
  | { feature: ProFeature };

type GateApi = { show: (blocked: Blocked) => void };

const UpgradeGateContext = createContext<GateApi>({ show: () => {} });

export function useUpgradeGate(): GateApi {
  return useContext(UpgradeGateContext);
}

export function UpgradeGateProvider({ children }: { children: React.ReactNode }) {
  const [blocked, setBlocked] = useState<Blocked | null>(null);

  const show = useCallback((next: Blocked) => setBlocked(next), []);

  return (
    <UpgradeGateContext.Provider value={{ show }}>
      {children}
      {blocked && <UpgradeModal blocked={blocked} onClose={() => setBlocked(null)} />}
    </UpgradeGateContext.Provider>
  );
}

function UpgradeModal({ blocked, onClose }: { blocked: Blocked; onClose: () => void }) {
  // Narrowed inline rather than through a helper variable: TypeScript only
  // discriminates the union at the point of the `in` check.
  const copy =
    "kind" in blocked
      ? { title: LIMIT_COPY[blocked.kind].title, body: LIMIT_COPY[blocked.kind].body(blocked.limit) }
      : FEATURE_COPY[blocked.feature];

  const quota = "kind" in blocked ? blocked : null;
  const reason = "kind" in blocked ? blocked.kind : blocked.feature;

  // Escape closes it. A modal that can only be dismissed by finding the small
  // × is a modal people resent.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-gate-title"
      onClick={onClose}
    >
      <div
        className="panel-in relative w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-[var(--shadow)]"
        // The backdrop closes; the card must not close when clicked through.
        onClick={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="סגירה"
          className="absolute end-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-surface-2 hover:text-primary"
        >
          <X size={16} />
        </button>

        <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-accent-soft">
          <Crown size={20} className="text-accent" />
        </div>

        <h2 id="upgrade-gate-title" className="text-lg font-bold text-primary">
          {copy.title}
        </h2>

        <p className="mt-2 text-sm leading-relaxed text-muted">{copy.body}</p>

        {/* Only a quota has a count worth showing. */}
        {quota && (
          <div className="mt-4 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
            כרגע יש לך{" "}
            <span className="num font-bold text-primary">{quota.current}</span>
            {quota.kind === "alerts" ? " התראות פעילות" : " עסקאות שמורות"} · מגבלת המסלול:{" "}
            <span className="num font-bold text-primary">{quota.limit}</span>
          </div>
        )}

        <div className="mt-5 flex flex-col gap-2 sm:flex-row-reverse">
          <Link
            href="/account?tab=billing"
            onClick={() => {
              // Reaching the pricing table from a wall is a different intent
              // from browsing to it, and the funnel should be able to tell.
              trackEvent("plan_compare_click", { from: "limit_gate", kind: reason });
              onClose();
            }}
            className="btn-primary inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-110"
          >
            <Crown size={15} />
            שדרוג ל-PRO
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-lg border border-border px-4 py-2.5 text-sm font-semibold text-muted transition hover:text-primary"
          >
            לא עכשיו
          </button>
        </div>
      </div>
    </div>
  );
}
