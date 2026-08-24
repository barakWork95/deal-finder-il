"use client";

import { useId, useState } from "react";

export type DetailTab = {
  id: string;
  label: string;
  /** Server-rendered. This component never sees the deal behind it. */
  content: React.ReactNode;
};

/**
 * Tabs over the deep analytics.
 *
 * A shell, like DealDrawer, and for the same reason: every panel arrives
 * already rendered from a server component, so the PRO projection is decided
 * where it cannot be read off the wire. Handing this component a `Deal` and
 * letting it build the panels would serialise the gated numbers into the page
 * and undo the whole arrangement — see DealDetailBody.
 *
 * Every panel stays mounted and inactive ones are `hidden`, rather than being
 * swapped out. The calculator on the tools tab holds state a visitor has typed
 * into it, and unmounting it to look at the comparables would throw that away.
 */
export function DealDetailTabs({ tabs }: { tabs: DetailTab[] }) {
  const [active, setActive] = useState(tabs[0]?.id);
  const base = useId();

  return (
    <div>
      <div
        role="tablist"
        aria-label="ניתוח העסקה"
        className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-surface p-1"
      >
        {tabs.map((t) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              onClick={() => setActive(t.id)}
              className={`shrink-0 rounded-lg px-4 py-2 text-sm font-semibold transition ${
                selected
                  ? "bg-accent text-white"
                  : "text-muted hover:bg-surface-2 hover:text-primary"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          className="mt-4 space-y-5"
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
