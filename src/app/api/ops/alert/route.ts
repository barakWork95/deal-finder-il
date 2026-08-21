import { NextResponse, type NextRequest } from "next/server";
import { notificationSettings, opsConfig } from "@/lib/notifications/config";
import { sendOpsAlert } from "@/lib/notifications/ops";

/**
 * Operational alerts, posted by CI when a pipeline run fails.
 *
 * The workflow could call Green API directly, but then the provider
 * credentials would live in two places — Vercel and GitHub — and drift. This
 * endpoint keeps them in one, and reuses transports that are exercised every
 * hour rather than a second code path only executed when something is already
 * broken.
 *
 * Protected by the same CRON_SECRET the workflow already holds, so no new
 * secret is needed on either side.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const secret = notificationSettings.cronSecret;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
    }
  } else {
    const header = request.headers.get("authorization") ?? "";
    const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (provided !== secret) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const body = (await request.json().catch(() => ({}))) as { kind?: string; text?: string };
  const kind = String(body.kind ?? "pipeline").slice(0, 64);
  const text = String(body.text ?? "").slice(0, 1500);

  if (!text) return NextResponse.json({ error: "text_required" }, { status: 400 });

  const result = await sendOpsAlert(kind, text);

  // Always 200 unless the request itself was wrong. A notifier that returns an
  // error status turns "the pipeline failed" into "the pipeline failed and so
  // did the thing telling you about it", which buries the original fault.
  return NextResponse.json({ ok: result.status !== "failed", ...result });
}

/** Configuration check, same shape as the notifications status endpoint. */
export async function GET(request: NextRequest) {
  const secret = notificationSettings.cronSecret;
  const header = request.headers.get("authorization") ?? "";
  if (secret && (!header.startsWith("Bearer ") || header.slice(7) !== secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const config = opsConfig();
  return NextResponse.json({
    configured: config.to.length > 0,
    whatsapp: Boolean(config.phone),
    email: Boolean(config.email),
    minGapHours: config.minGapHours,
  });
}
