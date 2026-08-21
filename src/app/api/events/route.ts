import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { recordEvent } from "@/lib/event-repository";

/**
 * Product events.
 *
 * **Unauthenticated on purpose.** The single most valuable thing this endpoint
 * records is a signed-out visitor pressing the upgrade button — that click is
 * the product's conversion question, and it happens before anyone has an
 * account. Requiring a session would leave us measuring only the people who
 * already converted enough to sign up.
 *
 * What replaces the session as a defence is spelled out in event-repository.ts:
 * a fixed allowlist of event names, props rebuilt key by key with hard caps, a
 * per-subject rate limit, and a dedup key that collapses repeats. There are no
 * CORS headers, so browsers only let same-origin pages post here.
 *
 * It answers 202 for anything it accepted *or* deliberately dropped. A tracking
 * call that returns an error status teaches the browser to retry, and a retry
 * storm on the analytics endpoint is a self-inflicted outage on a table nobody
 * reads in real time.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Vercel puts the client address first in x-forwarded-for. */
function clientIp(request: NextRequest): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return request.headers.get("x-real-ip");
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as {
    name?: unknown;
    anonId?: unknown;
    path?: unknown;
    props?: unknown;
  } | null;

  if (!body || typeof body.name !== "string") {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }

  // Signed in, the event is attributed to the account; signed out it carries
  // only the browser's own anon id. Clerk failing here must not cost the event,
  // so the session is best-effort.
  let clerkUserId: string | null = null;
  if (isAuthConfigured()) {
    try {
      clerkUserId = (await auth()).userId;
    } catch {
      clerkUserId = null;
    }
  }

  const result = await recordEvent({
    name: body.name,
    clerkUserId,
    anonId: typeof body.anonId === "string" ? body.anonId : null,
    path: typeof body.path === "string" ? body.path : null,
    props: body.props,
    ipHint: clientIp(request),
  });

  // An unknown name is the one case worth reporting honestly: it means a call
  // site and the allowlist have drifted, and that is a bug to find in
  // development rather than a silent hole in the funnel.
  if (!result.ok && result.reason === "unknown_event") {
    return NextResponse.json({ ok: false, error: "unknown_event" }, { status: 400 });
  }

  return new NextResponse(null, { status: 202, headers: { "cache-control": "no-store" } });
}
