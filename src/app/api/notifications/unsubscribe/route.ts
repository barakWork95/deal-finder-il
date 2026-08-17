import { NextResponse, type NextRequest } from "next/server";
import { unsubscribeByToken } from "@/lib/notifications/repository";

/**
 * One-click unsubscribe, reached from the footer of every message and from the
 * List-Unsubscribe header.
 *
 * No session is required — people read mail on devices they are not signed in
 * on, and an unsubscribe link that demands a login is an unsubscribe link that
 * gets replaced by a spam report. The token is a per-account random value, so
 * knowing it only lets someone stop mail, never read anything.
 *
 * POST exists because mailbox providers fire One-Click as a POST.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PAGE = (title: string, body: string) => `<!doctype html>
<html lang="he" dir="rtl"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${title}</title></head>
<body style="font-family:Assistant,Arial,sans-serif;background:#f7f8fc;color:#0f0f24;
             display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0">
  <main style="max-width:420px;padding:32px;text-align:center">
    <h1 style="font-size:20px;margin:0 0 12px">${title}</h1>
    <p style="font-size:14px;color:#5b5b73;margin:0 0 20px">${body}</p>
    <a href="/alerts" style="color:#6f6dee;font-size:14px">חזרה להתראות שלי</a>
  </main>
</body></html>`;

async function handle(request: NextRequest) {
  const token = request.nextUrl.searchParams.get("token");
  if (!token) {
    return new NextResponse(PAGE("קישור לא תקין", "חסר מזהה בקישור ההסרה."), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const removed = await unsubscribeByToken(token);

  // An already-used token is not an error: the person asked to stop, and they
  // are stopped. Saying "not found" would just make them click again.
  return new NextResponse(
    PAGE(
      "הוסרת מרשימת ההתראות",
      removed
        ? "לא יישלחו אליך יותר התראות באימייל או ב-WhatsApp. אפשר להפעיל אותן מחדש בכל רגע מאזור ההתראות."
        : "הבקשה כבר טופלה — אינך מקבל התראות.",
    ),
    { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
