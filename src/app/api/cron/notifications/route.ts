import { NextResponse, type NextRequest } from "next/server";
import { notificationSettings, notificationStatus } from "@/lib/notifications/config";
import { recentRuns } from "@/lib/notifications/repository";
import { runNotificationWorker, type WorkerMode } from "@/lib/notifications/worker";

/**
 * The alert worker's trigger.
 *
 *   GET  ?mode=instant|digest|both[&dryRun=1]   — what Vercel Cron calls
 *   POST (same query)                           — manual runs and CI
 *   GET  ?status=1                              — configuration + last runs
 *
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is
 * set on the project, so that is the check. Without the secret set, the route
 * runs in development and refuses in production — a publicly triggerable
 * mailer is a way to get a sending domain blocked.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // postgres.js needs Node, not the edge runtime
export const maxDuration = 60;

function authorise(request: NextRequest): NextResponse | null {
  const secret = notificationSettings.cronSecret;

  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
    }
    return null; // local development
  }

  const header = request.headers.get("authorization") ?? "";
  const alternative = request.headers.get("x-cron-secret") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : alternative;

  if (provided !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

function parseModes(value: string | null): WorkerMode[] {
  if (value === "digest") return ["digest"];
  if (value === "both") return ["instant", "digest"];
  return ["instant"];
}

async function handle(request: NextRequest) {
  const denied = authorise(request);
  if (denied) return denied;

  const params = request.nextUrl.searchParams;

  if (params.get("status") === "1") {
    return NextResponse.json({ status: notificationStatus(), runs: await recentRuns() });
  }

  const dryRun = params.get("dryRun") === "1";
  const modes = parseModes(params.get("mode"));

  try {
    const summaries = [];
    for (const mode of modes) {
      summaries.push(await runNotificationWorker({ mode, dryRun }));
    }
    return NextResponse.json({ ok: true, runs: summaries });
  } catch (error) {
    // A crashed cron is invisible unless it says so; 500 makes Vercel mark the
    // invocation failed instead of quietly recording a success.
    console.error("[notifications] worker failed", error);
    return NextResponse.json({ ok: false, error: (error as Error).message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
