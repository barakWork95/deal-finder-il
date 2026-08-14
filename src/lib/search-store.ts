"use client";

import { useSyncExternalStore } from "react";

/**
 * The header search box and the feed live in different trees — the header is
 * rendered by the layout, the feed by the page — so they talk through a store
 * rather than props, the same way saved deals and alerts already do.
 *
 * Two values on purpose: `input` is what the field shows and updates on every
 * keystroke, `query` is what the feed filters by and lags behind by
 * DEBOUNCE_MS. Keeping both here means there is still exactly one source of
 * truth, so the "clear" button in the feed can empty the header field too.
 */

const DEBOUNCE_MS = 250;

let input = "";
let query = "";
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setSearchInput(value: string) {
  input = value;
  emit();

  if (timer) clearTimeout(timer);
  // An empty box should feel instant; there is nothing to debounce.
  if (value.trim() === "") {
    query = "";
    emit();
    return;
  }
  timer = setTimeout(() => {
    query = value;
    timer = null;
    emit();
  }, DEBOUNCE_MS);
}

export function clearSearch() {
  if (timer) clearTimeout(timer);
  timer = null;
  input = "";
  query = "";
  emit();
}

/** What the field shows. */
export function useSearchInput(): string {
  return useSyncExternalStore(
    subscribe,
    () => input,
    () => "",
  );
}

/** What the feed filters by (debounced). */
export function useSearchQuery(): string {
  return useSyncExternalStore(
    subscribe,
    () => query,
    () => "",
  );
}
