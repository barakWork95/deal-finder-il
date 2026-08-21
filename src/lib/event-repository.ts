import "server-only";
import { createHash } from "node:crypto";
import { sql, hasDb } from "./db";
import { isEventName, type EventName, type EventProps } from "./events";

/**
 * Product events — the server half (db/017_admin.sql).
 *
 * POST /api/events is deliberately **open to signed-out visitors**: the event
 * the product most needs to count is someone pressing "upgrade" before they
 * have an account, and requiring a session to record it would erase exactly the
 * population the pricing question is about.
 *
 * Open means two obligations, both handled here rather than at the call site:
 *
 *   1. Nothing arbitrary reaches the database. The event name must be on the
 *      allowlist in events.ts, and props are rebuilt key by key with hard caps.
 *   2. Volume is bounded, twice over — an in-process rate limit that stops a
 *      flood cheaply, and a durable dedup key that stops the same intention
 *      being counted twice however many instances are serving.
 */

// ── Rate limiting ──────────────────────────────────────────
//
// Per-instance and in-memory, which on serverless means it is a floor, not a
// ceiling: a burst spread across ten cold lambdas gets ten buckets. That is
// fine for what this defends against — a stuck retry loop or a bored visitor
// holding down a button — and the durable half of the defence is the dedup key
// below, which no amount of instance fan-out gets around. A shared counter
// would mean a Redis dependency for a table nobody reads in real time.

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
/** Beyond this many tracked keys the map is dropped rather than grown. */
const MAX_TRACKED = 5_000;

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

export function rateLimit(key: string, now = Date.now()): boolean {
  if (buckets.size > MAX_TRACKED) buckets.clear();

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (bucket.count >= MAX_PER_WINDOW) return false;
  bucket.count += 1;
  return true;
}

// ── Deduplication ──────────────────────────────────────────

/**
 * How close together two identical events have to be to count as one. Ten
 * minutes: long enough to absorb a double click, a strict-mode remount and a
 * back-navigation, short enough that someone who comes back after lunch and
 * tries to pay again is counted as having tried again.
 */
const DEDUPE_WINDOW_MS = 10 * 60_000;

/**
 * (name, subject, time bucket), hashed.
 *
 * Hashed rather than stored plainly because the subject falls back to the
 * caller's IP when there is no id at all, and an IP is the one identifier a
 * visitor cannot clear. A hash still collapses repeats — that is all the column
 * is for — while leaving nothing in the table that points back at a person.
 */
function dedupeKey(name: string, subject: string, now: number): string {
  const bucket = Math.floor(now / DEDUPE_WINDOW_MS);
  return createHash("sha256").update(`${name}|${subject}|${bucket}`).digest("hex").slice(0, 32);
}

// ── Sanitising ─────────────────────────────────────────────

const MAX_PROP_KEYS = 12;
const MAX_KEY_LEN = 40;
const MAX_VALUE_LEN = 200;

/** Rebuilt field by field: this arrives from an unauthenticated browser. */
function sanitiseProps(input: unknown): EventProps {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out: EventProps = {};

  for (const [rawKey, rawValue] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROP_KEYS) break;
    const key = rawKey.slice(0, MAX_KEY_LEN);
    if (!/^[a-z0-9_]+$/i.test(key)) continue;

    if (typeof rawValue === "string") out[key] = rawValue.slice(0, MAX_VALUE_LEN);
    else if (typeof rawValue === "number" && Number.isFinite(rawValue)) out[key] = rawValue;
    else if (typeof rawValue === "boolean" || rawValue === null) out[key] = rawValue;
    // Objects, arrays and functions are dropped rather than stringified: the
    // props column is for facets to group by, not for a payload.
  }

  return out;
}

const idish = (value: unknown, max = 64): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, max);
  return /^[A-Za-z0-9_.:-]+$/.test(trimmed) ? trimmed : null;
};

// ── Writing ────────────────────────────────────────────────

export type RecordEventInput = {
  name: string;
  clerkUserId?: string | null;
  anonId?: string | null;
  path?: string | null;
  props?: unknown;
  /** Only used to identify a subject that has no id at all; never stored. */
  ipHint?: string | null;
};

export type RecordEventResult =
  | { ok: true; deduped: boolean }
  | { ok: false; reason: "unknown_event" | "rate_limited" | "no_db" | "write_failed" };

export async function recordEvent(input: RecordEventInput): Promise<RecordEventResult> {
  if (!isEventName(input.name)) return { ok: false, reason: "unknown_event" };

  const clerkUserId = idish(input.clerkUserId);
  const anonId = idish(input.anonId);
  // A signed-in visitor is rate-limited as themselves so that a shared office
  // IP does not throttle everyone behind it; everyone else falls back to the IP.
  const subject = clerkUserId ?? anonId ?? idish(input.ipHint, 64) ?? "unknown";

  if (!rateLimit(`${subject}:${input.name}`)) return { ok: false, reason: "rate_limited" };
  if (!hasDb) return { ok: false, reason: "no_db" };

  const name: EventName = input.name;
  const path = typeof input.path === "string" ? input.path.split("?")[0].slice(0, 200) : null;
  const props = sanitiseProps(input.props);
  const key = dedupeKey(name, subject, Date.now());

  // ON CONFLICT DO NOTHING against the unique index is the whole dedup
  // mechanism: whichever instance gets there first owns the count, and the
  // second one is told nothing was written rather than failing.
  //
  // The `WHERE` clause is not optional. The index is partial, and Postgres
  // refuses to infer a partial index as the conflict arbiter unless the
  // statement repeats its predicate — without it every insert fails with
  // 42P10 ("no unique or exclusion constraint matching the ON CONFLICT
  // specification"), which is a run-time error, not one the types catch.
  try {
    const rows = await sql`
      INSERT INTO app_events (name, clerk_user_id, anon_id, path, props, dedupe_key)
      VALUES (${name}, ${clerkUserId}, ${anonId}, ${path}, ${sql.json(props)}, ${key})
      ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
      RETURNING id`;

    return { ok: true, deduped: rows.length === 0 };
  } catch (error) {
    // A missing table (migration 017 not applied to this database yet) or a
    // transient database fault must not become a 500 on a tracking beacon:
    // browsers retry failed beacons, and a retry storm aimed at the analytics
    // endpoint would be an outage caused entirely by measuring. Logged, so it
    // is still visible to whoever is looking at the server.
    console.error("[events] insert failed:", (error as Error).message);
    return { ok: false, reason: "write_failed" };
  }
}
