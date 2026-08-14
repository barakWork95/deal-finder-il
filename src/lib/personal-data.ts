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
import type { Alert } from "@/lib/types";

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

const EMPTY: UserData = { alerts: [], savedDealIds: [] };

let account: UserData | null = null; // null = not loaded yet
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

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

/** Applies a change locally first, then lets the server confirm it. */
async function mutate(change: (prev: UserData) => UserData, action: () => Promise<unknown>) {
  const before = account ?? EMPTY;
  account = change(before);
  emit();
  try {
    await action();
  } catch {
    account = before; // put the UI back rather than lie about what was saved
    emit();
  }
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
    if (initial && !account) seed(initial);
    else load();
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

  const create = useCallback(
    (alert: Alert) => {
      if (!signedIn) return setLocalAlerts((prev) => [alert, ...prev]);
      return mutate(
        (prev) => ({ ...prev, alerts: [alert, ...prev.alerts] }),
        () => createAlertAction(alert),
      );
    },
    [signedIn, setLocalAlerts],
  );

  const setActive = useCallback(
    (id: string, isActive: boolean) => {
      if (!signedIn) {
        return setLocalAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, isActive } : a)));
      }
      return mutate(
        (prev) => ({ ...prev, alerts: prev.alerts.map((a) => (a.id === id ? { ...a, isActive } : a)) }),
        () => setAlertActiveAction(id, isActive),
      );
    },
    [signedIn, setLocalAlerts],
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

  return { alerts, create, setActive, remove, signedIn };
}

// ── Saved tenders ──────────────────────────────────────────

const NO_IDS: string[] = [];

export function useSavedDeals(initial?: UserData) {
  const { signedIn } = useAuthState();
  const [localIds, setLocalIds] = useSavedDealIds();
  const accountData = useAccount(initial);

  const ids = signedIn ? (accountData?.savedDealIds ?? initial?.savedDealIds ?? NO_IDS) : localIds;

  const toggle = useCallback(
    (dealId: string) => {
      const saved = !(signedIn ? (account?.savedDealIds ?? NO_IDS) : localIds).includes(dealId);

      if (!signedIn) {
        return setLocalIds((prev) =>
          prev.includes(dealId) ? prev.filter((x) => x !== dealId) : [dealId, ...prev],
        );
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
    [signedIn, localIds, setLocalIds],
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

  return { ids, toggle, remove, signedIn };
}

/** Lets UserSync drop the stale mirror after its one-time upload merge. */
export function refreshAccount() {
  account = null;
  inFlight = null;
  load();
}
