/**
 * Product events — the browser half.
 *
 * No "use client" and no server-only: this module is imported by client
 * components and every browser API it touches is inside a function body, so it
 * is harmless if it ever gets pulled into a server render (trackEvent simply
 * does nothing there).
 *
 * The design rule: **tracking never affects the thing it is tracking.** Every
 * call is fire-and-forget, nothing here throws, nothing is awaited, and a
 * blocked or failing endpoint is silently ignored. A PayPal button that stops
 * working because analytics is down would be a far worse bug than a missing
 * data point.
 */

/**
 * The allowlist. The API rejects anything not on it — an open endpoint with a
 * free-text name column is a free write to our database for anyone who finds
 * it, and the dashboard can only chart names it knows about anyway.
 *
 * To add a step: put the name here, wire the call site, and give it a Hebrew
 * label in EVENT_LABEL below so it shows up on the dashboard readably.
 */
export const EVENT_NAMES = [
  /** The pricing table came into view (billing tab opened). */
  "pricing_view",
  /** The PRO checkout button was pressed. The number the roadmap hangs on. */
  "upgrade_click",
  /** The "billing isn't live yet" notice was shown — an upgrade_click we lost. */
  "billing_notice_view",
  /** Someone opened the pricing table from the sidebar's plan card. */
  "plan_compare_click",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

export function isEventName(value: unknown): value is EventName {
  return typeof value === "string" && (EVENT_NAMES as readonly string[]).includes(value);
}

/** Dashboard labels. Hebrew, like the rest of the product. */
export const EVENT_LABEL: Record<EventName, string> = {
  pricing_view: "צפייה בטבלת המסלולים",
  upgrade_click: "לחיצה על שדרוג ל-PRO",
  billing_notice_view: "הצגת הודעת ״הסליקה לא נפתחה״",
  plan_compare_click: "פתיחת השוואת מסלולים",
};

/** Small, scalar, and short — see the same limits enforced server-side. */
export type EventProps = Record<string, string | number | boolean | null>;

const ANON_KEY = "karkahot:anon";

/**
 * A per-browser id, so a signed-out visitor's pricing_view and their
 * upgrade_click can be recognised as one person without knowing who they are.
 * Generated locally, stored in localStorage, cleared whenever they clear site
 * data — it identifies a browser, not a human, and there is no directory
 * anywhere that maps it to one.
 */
export function anonId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    let id = window.localStorage.getItem(ANON_KEY);
    if (!id) {
      id = `a_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
      window.localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    // Private mode / storage disabled. The event still counts, it just cannot
    // be tied to the visitor's other events.
    return undefined;
  }
}

/**
 * Events already sent by this page. The server deduplicates too (it has to —
 * this map dies with the tab), but stopping a repeat here saves the request
 * entirely, which matters for the ones that fire on mount: React 19 runs
 * effects twice in development, and a remount is not a second visit.
 */
const sentThisPage = new Set<string>();

export function trackEvent(name: EventName, props: EventProps = {}, options: { once?: boolean } = {}) {
  if (typeof window === "undefined") return;

  if (options.once) {
    if (sentThisPage.has(name)) return;
    sentThisPage.add(name);
  }

  const body = JSON.stringify({
    name,
    anonId: anonId(),
    path: window.location.pathname,
    props,
  });

  try {
    // sendBeacon survives the page being closed by the very click we are
    // recording — which for an outbound checkout button is the normal case.
    if (navigator.sendBeacon?.(("/api/events"), new Blob([body], { type: "application/json" }))) {
      return;
    }
  } catch {
    // Some browsers throw on a Blob beacon; fall through to fetch.
  }

  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => {});
}
