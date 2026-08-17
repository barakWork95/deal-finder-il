/**
 * One HTTP client for every רמ"י call, with the retry policy the portal needs.
 *
 * What we learned the hard way (2026-08-17): the portal does not go "down for
 * the day". It flaps on a timescale of minutes — from one machine, inside ten
 * minutes, we logged 404 → 200 → 404 → 200, identically from curl and from
 * Node, with and without a session cookie. It is not geo-fenced either: a
 * GitHub runner in Wyoming pulled all 10,612 tenders on its first attempt.
 *
 * So a failure is almost never a reason to give up — it is a reason to wait a
 * few seconds and ask again. The ingester previously did the opposite: one
 * failed detail call and it skipped the tender, which is why a run fetched
 * 136 of 470.
 *
 * THE FLAP SIGNATURE IS AN HTML BODY, NOT A STATUS CODE. During an outage
 * window the API answers 404 with the SPA's error page, so `res.ok` and the
 * status alone cannot tell "this tender does not exist" from "the API is
 * having a moment". Anything that should be JSON and starts with '<' is
 * therefore treated as retryable.
 */

const BASE = "https://apps.land.gov.il/MichrazimSite";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The portal sets a session cookie on the SPA root. Module-level so every
// caller shares one session rather than re-warming per request.
let cookie = "";

export async function warmSession() {
  const res = await fetch(`${BASE}/`, { headers: { "User-Agent": UA } });
  const setCookie = res.headers.getSetCookie?.() ?? [];
  if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
  return res.status;
}

function headersFor(init) {
  return {
    "User-Agent": UA,
    Accept: "application/json, text/plain, */*",
    Referer: `${BASE}/`,
    ...(cookie ? { Cookie: cookie } : {}),
    ...(init.body ? { "Content-Type": "application/json" } : {}),
    ...init.headers,
  };
}

export class RamiError extends Error {
  constructor(message, { status, attempts } = {}) {
    super(message);
    this.name = "RamiError";
    this.status = status;
    this.attempts = attempts;
  }
}

/**
 * GET/POST a רמ"י endpoint and return parsed JSON, retrying through the
 * portal's flapping with exponential backoff and jitter.
 *
 * Jitter matters: the ingester fires hundreds of these in a loop, and without
 * it every in-flight request would back off in lockstep and retry as one
 * thundering herd against an endpoint that is already struggling.
 */
export async function getJson(url, init = {}, options = {}) {
  const {
    attempts = 5,
    baseDelayMs = 1000,
    maxDelayMs = 30_000,
    label = url,
    onRetry = null,
  } = options;

  let lastReason = "unknown";

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const res = await fetch(url, { ...init, headers: headersFor(init) });

      const setCookie = res.headers.getSetCookie?.() ?? [];
      if (setCookie.length) cookie = setCookie.map((c) => c.split(";")[0]).join("; ");

      const text = await res.text();
      const looksHtml = text.trimStart().startsWith("<");

      if (res.ok && !looksHtml) {
        try {
          return JSON.parse(text);
        } catch {
          lastReason = `unparseable JSON (${text.length} bytes)`;
        }
      } else if (looksHtml) {
        // The outage signature. Re-warm the session before trying again: a
        // dropped session presents the same way, and re-warming is one cheap
        // request against several wasted retries.
        lastReason = `HTML body with status ${res.status}`;
        await warmSession().catch(() => {});
      } else if (res.status === 429 || res.status >= 500) {
        lastReason = `HTTP ${res.status}`;
      } else {
        // A real 4xx with a non-HTML body is the endpoint telling us something
        // true — retrying it just repeats the same wrong request.
        throw new RamiError(`${label}: HTTP ${res.status} (not retryable)`, {
          status: res.status,
          attempts: attempt,
        });
      }
    } catch (error) {
      if (error instanceof RamiError) throw error;
      lastReason = `network: ${error.message}`;
    }

    if (attempt < attempts) {
      const backoff = Math.min(maxDelayMs, baseDelayMs * 2 ** (attempt - 1));
      const delay = Math.round(backoff * (0.5 + Math.random())); // ±50% jitter
      onRetry?.({ attempt, attempts, delay, reason: lastReason, label });
      await sleep(delay);
    }
  }

  throw new RamiError(`${label}: gave up after ${attempts} attempts (${lastReason})`, {
    attempts,
  });
}

export const RAMI_BASE = BASE;
export const RAMI_API = `${BASE}/api`;
