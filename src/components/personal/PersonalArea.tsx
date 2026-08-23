"use client";

import { useState } from "react";
import { Bell, Bookmark, CreditCard, User, type LucideIcon } from "lucide-react";
import type { Deal } from "@/lib/types";
import type { AlertPrefill, PersonalTab } from "@/lib/alert-prefill";
import { usePersonalAlerts, useSavedDeals, useServerTier } from "@/lib/personal-data";
import type { UserData } from "@/lib/user-repository";
import type { BillingOffer, BillingSummary, PlanTier } from "@/lib/types";
import { trackEvent } from "@/lib/events";
import { AlertsPanel } from "@/components/personal/AlertsPanel";
import { SavedDealsPanel } from "@/components/personal/SavedDealsPanel";
import { AccountPanel } from "@/components/personal/AccountPanel";
import { BillingPanel } from "@/components/personal/BillingPanel";
import { UserSync } from "@/components/personal/UserSync";

type TabKey = PersonalTab;

const TABS: { key: TabKey; label: string; icon: LucideIcon }[] = [
  { key: "alerts", label: "ההתראות שלי", icon: Bell },
  { key: "saved", label: "עסקאות שמורות", icon: Bookmark },
  { key: "account", label: "פרטי חשבון", icon: User },
  { key: "billing", label: "מנוי ותשלום", icon: CreditCard },
];

export function PersonalArea({
  deals,
  cities,
  initialTab = "alerts",
  prefill = {},
  account,
  delivery,
  tier = "free",
  billing,
  subscriptions,
}: {
  deals: Deal[];
  cities: string[];
  initialTab?: TabKey;
  prefill?: AlertPrefill;
  /** The signed-in user's rows, already fetched server-side. */
  account?: UserData;
  /** Which notification channels the server can send on — decided server-side. */
  delivery?: { email: boolean; whatsapp: boolean };
  /**
   * The plan on the account, read from user_contacts.tier on the server. A
   * guest is always "free" — there is no account to carry a plan.
   */
  tier?: PlanTier;
  /** Whether checkout can be offered — decided server-side, like `delivery`. */
  billing?: BillingOffer;
  subscriptions?: BillingSummary[];
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);

  // Server-resolved on every request, so it is the authority over anything the
  // shared store cached earlier in this tab.
  useServerTier(tier);

  /**
   * Keep the URL in step so the current tab can be shared or reloaded. This
   * uses the History API directly (which Next syncs with its router) rather
   * than router.replace: the page is force-dynamic, so a router navigation
   * would re-run the tender queries on every tab click. replaceState also
   * leaves the back button pointing at wherever the user came from instead of
   * walking back through each tab they opened.
   */
  function selectTab(next: TabKey) {
    setTab(next);
    const params = new URLSearchParams(window.location.search);
    params.set("tab", next);
    window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
  }
  const { alerts } = usePersonalAlerts(account);
  const { ids: savedIds } = useSavedDeals(account);

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
                  onClick={() => selectTab(key)}
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
            <div className={`mb-1 font-semibold ${tier === "pro" ? "text-accent" : "text-primary"}`}>
              מסלול: {tier === "pro" ? "PRO" : "חינם"}
            </div>
            <div className="text-muted">
              בתקופת ההרצה כל היכולות פתוחות — ללא תשלום.
            </div>
            <button
              type="button"
              onClick={() => {
                // Separate from pricing_view: arriving at the table from here
                // is deliberate interest, arriving by deep link is not.
                trackEvent("plan_compare_click", { tier });
                selectTab("billing");
              }}
              className="mt-2 font-semibold text-accent hover:underline"
            >
              השוואת מסלולים
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <UserSync />
          {/* `key` restarts the entrance animation on every tab switch. */}
          <div key={tab} className="panel-in">
          {tab === "alerts" && (
              <AlertsPanel
                deals={deals}
                cities={cities}
                prefill={prefill}
                account={account}
                delivery={delivery}
              />
            )}
          {tab === "saved" && <SavedDealsPanel deals={deals} account={account} />}
          {tab === "account" && <AccountPanel />}
            {tab === "billing" && (
              <BillingPanel tier={tier} billing={billing} subscriptions={subscriptions} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
