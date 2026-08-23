"use client";

import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  createAlertAction,
  deleteAlertAction,
  fetchUserDataAction,
  setAlertActiveAction,
  setDealSavedAction,
} from "@/app/actions/personal";
import { useAuthState } from "@/components/AuthState";
import { ALERTS_KEY, useSavedDealIds, useStoredState } from "@/lib/client-store";
import type { UserData } from "@/lib/user-repository";
import type { Alert, PlanTier } from "@/lib/types";
import { isAlertScoreLocked, isAtLimit, limitFor, type LimitKind, type ProFeature } from "@/lib/limits";
import { trackEvent } from "@/lib/events";

/**
 * One interface over two homes for the same data.
 *
 * Signed in  → PostgreSQL (user_alerts / user_saved_deals), through server
 *              actions, with the client holding a mirror it updates
 *              optimistically so a click never waits on a round trip.
 * Signed out → localStorage, exactly as guest mode always worked.
 *
 * The mirror is a module-level singleton rather than component state because
 * the bookmark button renders 146 times on the feed: they must all agree, and
 * only one of them should ever fetch.
 */

const EMPTY: UserData = { alerts: [], savedDealIds: [], tier: "free" };

/**
 * What a blocked write tells the caller.
 *
 * The check happens here rather than in each button, so the wall is hit
 * *before* anything changes on screen. Doing it optimistically and reverting
 * would flash a filled bookmark and then take it away, which reads as a bug
 * rather than a plan boundary — and the server still refuses independently, so
 * this is a courtesy, not the enforcement.
 */
export type MutationResult =
  | { ok: true }
  | { ok: false; kind: LimitKind; limit: number; current: number }
  | { ok: false; feature: ProFeature };

const ALLOWED: MutationResult = { ok: true };

/** One place decides, and one place reports it to the funnel. */
function block(kind: LimitKind, tier: PlanTier, current: number): MutationResult {
  trackEvent("limit_hit", { kind, tier, current });
  return { ok: false, kind, limit: limitFor(tier, kind) ?? 0, current };
}

/** The same, for a capability the plan does not include at all. */
function blockFeature(feature: ProFeature, tier: PlanTier): MutationResult {
  trackEvent("limit_hit", { kind: feature, tier });
  return { ok: false, feature };
}

let account: UserData | null = null; // null = not loaded yet
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * The server payload this mirror was last built from.
 *
 * Without it the mirror was written once per tab and never again — `load()`
 * returns early whenever `account` is set, and `seed()` only ran when it was
 * empty. That was survivable while the mirror held only alerts and saved ids,
 * which the client mutates itself and therefore keeps current. It stopped
 * being survivable when the plan moved in here: an account upgraded in another
 * tab kept its old `tier` for the life of this one, so the billing panel (which
 * reads the fresh server prop) said PRO while the alerts panel (which reads
 * this) still enforced the free limit.
 *
 * A server render is by definition newer than anything cached here, so its
 * payload is adopted whenever it is a different one.
 */
let seededFrom: UserData | null = null;

/**
 * The plan, as last resolved by a server render — on any page, not only the
 * ones that hand down a full UserData. The feed knows the tier (it gates the
 * score filter with it) but passes no account data, and the bookmark button
 * there still has to know whether the saved-deals limit applies.
 *
 * Written only from an effect. This module is evaluated during SSR too, where
 * module scope is shared between requests, so a value written during render
 * would leak one visitor's plan into another's page.
 */
let knownTier: PlanTier | null = null;

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Server-rendered pages hand their already-fetched copy straight in. */
function seed(data: UserData) {
  account = data;
  emit();
}

function reset() {
  account = null;
  inFlight = null;
  seededFrom = null;
  knownTier = null;
  emit();
}

function load() {
  if (account || inFlight) return;
  inFlight = fetchUserDataAction()
    .then((data) => {
      account = data ?? EMPTY;
    })
    .catch(() => {
      account = EMPTY; // a failed load shows an empty account, never a crash
    })
    .finally(() => {
      inFlight = null;
      emit();
    });
}

/**
 * Applies a change locally first, then lets the server confirm it.
 *
 * A refusal is not only an exception. The server re-checks every limit against
 * the real rows, so it can legitimately say no when this browser's mirror is
 * stale — two tabs, or another device. That answer has to revert the optimistic
 * update exactly as a thrown error does, or the screen keeps showing something
 * the database never accepted.
 */
async function mutate(
  change: (prev: UserData) => UserData,
  action: () => Promise<{ ok: boolean; reason?: string } | unknown>,
): Promise<MutationResult> {
  const before = account ?? EMPTY;
  account = change(before);
  emit();
  try {
    const result = (await action()) as
      | { ok: false; reason: "limit"; kind: LimitKind; limit: number; current: number }
      | { ok: false; reason: "pro_feature"; feature: ProFeature }
      | { ok: boolean; reason?: string };

    if (result && result.ok === false) {
      account = before;
      emit();
      if ("kind" in result && result.reason === "limit") {
        trackEvent("limit_hit", { kind: result.kind, tier: before.tier, current: result.current });
        return { ok: false, kind: result.kind, limit: result.limit, current: result.current };
      }
      if ("feature" in result && result.reason === "pro_feature") {
        trackEvent("limit_hit", { kind: result.feature, tier: before.tier });
        return { ok: false, feature: result.feature };
      }
    }
  } catch {
    account = before; // put the UI back rather than lie about what was saved
    emit();
  }
  return ALLOWED;
}

function useAccount(initial?: UserData): UserData | null {
  const { signedIn } = useAuthState();
  const snapshot = useSyncExternalStore(
    subscribe,
    () => account,
    () => null,
  );

  useEffect(() => {
    if (!signedIn) {
      if (account) reset();
      return;
    }
    // A server render is newer than the mirror, always. Adopt it whenever it
    // is one we have not adopted yet — identity is enough, since each render
    // produces a fresh object — and otherwise leave the optimistic state be.
    if (initial) {
      if (initial !== seededFrom) {
        seededFrom = initial;
        seed(initial);
      }
      return;
    }
    load();
  }, [signedIn, initial]);

  return signedIn ? snapshot : null;
}

// ── Alerts ─────────────────────────────────────────────────

const NO_ALERTS: Alert[] = [];

export function usePersonalAlerts(initial?: UserData) {
  const { signedIn } = useAuthState();
  const [localAlerts, setLocalAlerts] = useStoredState<Alert[]>(ALERTS_KEY, NO_ALERTS);
  const accountData = useAccount(initial);

  // Both hooks always run; only the result is chosen.
  const alerts = signedIn ? (accountData?.alerts ?? initial?.alerts ?? NO_ALERTS) : localAlerts;

  // A signed-out visitor is on the free plan too — the limits are the product's,
  // not the account system's, so guest mode is held to the same numbers.
  // Freshest first: this render's server payload, then whatever the last
  // server render told us, then the mirror. Nothing client-side ever changes a
  // plan, so a server answer is never staler than a cached one.
  const tier: PlanTier = signedIn
    ? (initial?.tier ?? knownTier ?? accountData?.tier ?? "free")
    : "free";
  const activeCount = alerts.filter((a) => a.isActive !== false).length;

  const create = useCallback(
    async (alert: Alert): Promise<MutationResult> => {
      if (isAtLimit(tier, "alerts", activeCount)) return block("alerts", tier, activeCount);
      // Checked before the quota is spent, so a refused alert costs nothing.
      if (isAlertScoreLocked(tier, alert.filters?.minScore)) {
        return blockFeature("score_filter", tier);
      }

      if (!signedIn) {
        setLocalAlerts((prev) => [alert, ...prev]);
        return ALLOWED;
      }
      return mutate(
        (prev) => ({ ...prev, alerts: [alert, ...prev.alerts] }),
        () => createAlertAction(alert),
      );
    },
    [signedIn, setLocalAlerts, tier, activeCount],
  );

  const setActive = useCallback(
    async (id: string, isActive: boolean): Promise<MutationResult> => {
      // Pausing is always allowed — it is how someone gets back under the line.
      // Un-pausing is the same act as adding one, and is gated the same way.
      if (isActive && isAtLimit(tier, "alerts", activeCount)) {
        return block("alerts", tier, activeCount);
      }

      if (!signedIn) {
        setLocalAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isActive } : a)));
        return ALLOWED;
      }
      return mutate(
        (prev) => ({ ...prev, alerts: prev.alerts.map((a) => (a.id === id ? { ...a, isActive } : a)) }),
        () => setAlertActiveAction(id, isActive),
      );
    },
    [signedIn, setLocalAlerts, tier, activeCount],
  );

  const remove = useCallback(
    (id: string) => {
      if (!signedIn) return setLocalAlerts((prev) => prev.filter((a) => a.id !== id));
      return mutate(
        (prev) => ({ ...prev, alerts: prev.alerts.filter((a) => a.id !== id) }),
        () => deleteAlertAction(id),
      );
    },
    [signedIn, setLocalAlerts],
  );

  return { alerts, create, setActive, remove, signedIn, tier, activeCount };
}

// ── Saved tenders ──────────────────────────────────────────

const NO_IDS: string[] = [];

export function useSavedDeals(initial?: UserData) {
  const { signedIn } = useAuthState();
  const [localIds, setLocalIds] = useSavedDealIds();
  const accountData = useAccount(initial);

  const ids = signedIn ? (accountData?.savedDealIds ?? initial?.savedDealIds ?? NO_IDS) : localIds;
  const tier: PlanTier = signedIn
    ? (initial?.tier ?? knownTier ?? accountData?.tier ?? "free")
    : "free";

  const toggle = useCallback(
    async (dealId: string): Promise<MutationResult> => {
      const current = signedIn ? (account?.savedDealIds ?? NO_IDS) : localIds;
      const saved = !current.includes(dealId);

      // Removing is never blocked; only adding one more can be.
      if (saved && isAtLimit(tier, "saved", current.length)) {
        return block("saved", tier, current.length);
      }

      if (!signedIn) {
        setLocalIds((prev) =>
          prev.includes(dealId) ? prev.filter((x) => x !== dealId) : [dealId, ...prev],
        );
        return ALLOWED;
      }
      return mutate(
        (prev) => ({
          ...prev,
          savedDealIds: saved
            ? [dealId, ...prev.savedDealIds]
            : prev.savedDealIds.filter((x) => x !== dealId),
        }),
        () => setDealSavedAction(dealId, saved),
      );
    },
    [signedIn, localIds, setLocalIds, tier],
  );

  const remove = useCallback(
    (dealId: string) => {
      if (!signedIn) return setLocalIds((prev) => prev.filter((x) => x !== dealId));
      return mutate(
        (prev) => ({ ...prev, savedDealIds: prev.savedDealIds.filter((x) => x !== dealId) }),
        () => setDealSavedAction(dealId, false),
      );
    },
    [signedIn, setLocalIds],
  );

  return { ids, toggle, remove, signedIn, tier };
}

/** Lets UserSync drop the stale mirror after its one-time upload merge. */
export function refreshAccount() {
  account = null;
  inFlight = null;
  seededFrom = null;
  load();
}

/**
 * Tells the store the plan a server render resolved.
 *
 * Call it from any page that already knows — it costs nothing when the answer
 * has not changed, and it is what keeps the bookmark button on the feed from
 * enforcing a limit the visitor is no longer subject to.
 */
export function useServerTier(tier?: PlanTier) {
  useEffect(() => {
    if (!tier || tier === knownTier) return;
    knownTier = tier;
    if (account) account = { ...account, tier };
    emit();
  }, [tier]);
}
