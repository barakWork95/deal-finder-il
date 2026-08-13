"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Tiny localStorage-backed store for the personal area (saved deals, alerts,
 * profile). Everything here is per-browser and unauthenticated — Phase 1 has
 * no accounts, so there is nothing to sync to a server yet.
 *
 * Written against useSyncExternalStore rather than useState+useEffect: the
 * server render has no localStorage, and React needs to know that the first
 * client snapshot may differ from the server one. It also keeps the hydration
 * out of an effect, which this repo's lint rules (rightly) reject.
 */

type Listener = () => void;

const listeners = new Map<string, Set<Listener>>();
/** Last parsed value per key, so getSnapshot keeps a stable identity. */
const cache = new Map<string, { raw: string | null; value: unknown }>();

function read<T>(key: string, fallback: T): T {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Private mode / storage disabled — behave like an empty store.
  }
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T;

  let value = fallback;
  if (raw != null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  cache.set(key, { raw, value });
  return value;
}

function write<T>(key: string, value: T) {
  const raw = JSON.stringify(value);
  cache.set(key, { raw, value });
  try {
    window.localStorage.setItem(key, raw);
  } catch {
    // Keep the in-memory value even when persistence fails.
  }
  listeners.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, listener: Listener) {
  let set = listeners.get(key);
  if (!set) listeners.set(key, (set = new Set()));
  set.add(listener);
  // Keep other tabs in step.
  const onStorage = (e: StorageEvent) => {
    if (e.key === key) {
      cache.delete(key);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    set.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export type Setter<T> = (next: T | ((prev: T) => T)) => void;

/**
 * `fallback` is also the server snapshot, so the first paint always shows the
 * empty state and the stored value appears once React hydrates.
 */
export function useStoredState<T>(key: string, fallback: T): [T, Setter<T>] {
  const value = useSyncExternalStore(
    useCallback((listener: Listener) => subscribe(key, listener), [key]),
    () => read(key, fallback),
    () => fallback,
  );

  const set = useCallback<Setter<T>>(
    (next) => {
      const prev = read(key, fallback);
      write(key, typeof next === "function" ? (next as (p: T) => T)(prev) : next);
    },
    [key, fallback],
  );

  return [value, set];
}

// ── Saved deals ────────────────────────────────────────────
// Only tender ids are stored; the deal itself is re-read from the database on
// every page load, so a saved deal never shows a stale price or deadline.

export const SAVED_DEALS_KEY = "karkahot:saved-deals";
const NO_IDS: string[] = [];

export function useSavedDealIds() {
  return useStoredState<string[]>(SAVED_DEALS_KEY, NO_IDS);
}

export function useIsDealSaved(id: string): [boolean, () => void] {
  const [ids, setIds] = useSavedDealIds();
  const toggle = useCallback(
    () => setIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [id, ...prev])),
    [id, setIds],
  );
  return [ids.includes(id), toggle];
}

// ── Alerts ─────────────────────────────────────────────────
// Saved locally until there are real accounts. Nothing is delivered yet —
// the UI says so rather than implying WhatsApp messages are going out.

export const ALERTS_KEY = "karkahot:alerts";

// ── Profile ────────────────────────────────────────────────

export type Profile = {
  fullName: string;
  email: string;
  /** Israeli mobile, used as the WhatsApp destination. */
  phone: string;
};

export const PROFILE_KEY = "karkahot:profile";
export const EMPTY_PROFILE: Profile = { fullName: "", email: "", phone: "" };

export function useProfile() {
  return useStoredState<Profile>(PROFILE_KEY, EMPTY_PROFILE);
}

/** Wipes everything this browser stores for the personal area. */
export function clearLocalData() {
  for (const key of [SAVED_DEALS_KEY, ALERTS_KEY, PROFILE_KEY]) {
    cache.delete(key);
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* nothing to clear */
    }
    listeners.get(key)?.forEach((fn) => fn());
  }
}
