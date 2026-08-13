"use client";

import { useState } from "react";
import { Bell, Bookmark, CreditCard, User, type LucideIcon } from "lucide-react";
import type { Deal } from "@/lib/types";
import { ALERTS_KEY, useSavedDealIds, useStoredState } from "@/lib/client-store";
import type { Alert } from "@/lib/types";
import { AlertsPanel } from "@/components/personal/AlertsPanel";
import { SavedDealsPanel } from "@/components/personal/SavedDealsPanel";
import { AccountPanel } from "@/components/personal/AccountPanel";
import { BillingPanel } from "@/components/personal/BillingPanel";

type TabKey = "alerts" | "saved" | "account" | "billing";

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "alerts", label: "ההתראות שלי", icon: Bell },
  { key: "saved", label: "עסקאות שמורות", icon: Bookmark },
  { key: "account", label: "פרטי חשבון", icon: User },
  { key: "billing", label: "מנוי ותשלום", icon: CreditCard },
];

const NO_ALERTS: Alert[] = [];

export function PersonalArea({ deals, cities }: { deals: Deal[]; cities: string[] }) {
  const [tab, setTab] = useState<TabKey>("alerts");
  const [alerts] = useStoredState<Alert[]>(ALERTS_KEY, NO_ALERTS);
  const [savedIds] = useSavedDealIds();

  const counts: Partial<Record<TabKey, number>> = {
    alerts: alerts.length,
    saved: savedIds.length,
  };

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-5">
      <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
        {/* Sidebar — a scrollable tab strip on phones */}
        {/* min-w-0: without it the grid item grows to the tab strip's full
            content width instead of letting the strip scroll inside it. */}
        <aside className="min-w-0 lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 hidden px-2 text-sm font-bold text-primary lg:block">אזור אישי</h2>
          <nav
            aria-label="אזור אישי"
            // No negative-margin bleed: it would make the strip wider than the
            // page and give the whole document a horizontal scrollbar.
            className="flex gap-1 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0"
          >
            {TABS.map(({ key, label, icon: Icon }) => {
              const active = tab === key;
              const count = counts[key];
              return (
                <button
                  key={key}
                  type="button"
                  aria-current={active ? "page" : undefined}
                  onClick={() => setTab(key)}
                  className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-start text-sm font-medium transition lg:w-full ${
                    active
                      ? "bg-accent-soft text-accent"
                      : "text-muted hover:bg-surface-2 hover:text-primary"
                  }`}
                >
                  <Icon size={15} className="shrink-0" />
                  <span className="whitespace-nowrap">{label}</span>
                  {count ? (
                    <span
                      className={`num ms-auto rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                        active ? "bg-accent text-white" : "bg-surface-2 text-muted"
                      }`}
                    >
                      {count}
                    </span>
                  ) : null}
                </button>
              );
            })}
          </nav>

          <div className="mt-4 hidden rounded-lg border border-border bg-surface p-3 text-xs lg:block">
            <div className="mb-1 font-semibold text-primary">מסלול: חינם</div>
            <div className="text-muted">
              בתקופת ההרצה כל היכולות פתוחות — ללא תשלום.
            </div>
            <button
              type="button"
              onClick={() => setTab("billing")}
              className="mt-2 font-semibold text-accent hover:underline"
            >
              השוואת מסלולים
            </button>
          </div>
        </aside>

        {/* `key` restarts the entrance animation on every tab switch. */}
        <div key={tab} className="panel-in min-w-0">
          {tab === "alerts" && <AlertsPanel cities={cities} />}
          {tab === "saved" && <SavedDealsPanel deals={deals} />}
          {tab === "account" && <AccountPanel />}
          {tab === "billing" && <BillingPanel />}
        </div>
      </div>
    </div>
  );
}
