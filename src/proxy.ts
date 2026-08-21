import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";
import { isAdminUserId } from "@/lib/admin";

/**
 * Clerk's request handler. Next 16 renamed the `middleware` convention to
 * `proxy`, so this file is src/proxy.ts with a default export.
 *
 * Almost nothing is protected here: the whole app stays publicly readable, and
 * clerkMiddleware only attaches the session so that server components and
 * /api/user/sync can read it. Without a publishable key it is skipped
 * entirely — Clerk would otherwise throw on every request.
 *
 * The exception is /admin, and it has to be here rather than only in the page.
 *
 * The page calls notFound(), which renders the not-found segment correctly —
 * but a Suspense boundary above it (the route's loading.tsx) means the shell
 * has already been flushed by the time the guard resolves, so the response was
 * observed going out as **HTTP 200** with `<title>לוח בקרה</title>` in the
 * head. No data leaked — the dashboard body never rendered — but a 200 and a
 * title are enough to tell a stranger the page exists, which is the entire
 * thing notFound() was chosen to avoid. A middleware decision is made before
 * any byte is streamed, so the status it sets is the real one.
 */
async function guardAdmin(
  isAdmin: boolean,
  request: NextRequest,
): Promise<NextResponse | undefined> {
  if (isAdmin) return undefined;

  // Rewritten to a path that does not exist, rather than answering 403 or a
  // bare 404: the visitor gets the site's ordinary not-found page, at the
  // ordinary 404 status, exactly as they would for any mistyped URL.
  return NextResponse.rewrite(new URL("/_not-an-admin", request.url));
}

const handler = isAuthConfigured()
  ? clerkMiddleware(async (auth, request) => {
      if (request.nextUrl.pathname.startsWith("/admin")) {
        const { userId } = await auth();
        const blocked = await guardAdmin(isAdminUserId(userId), request);
        if (blocked) return blocked;
      }
      return NextResponse.next();
    })
  : // No Clerk: the page's own guard still applies, and it lets nobody in
    // unless this is local development (see isDevOpenAccess).
    () => NextResponse.next();

export default function proxy(request: NextRequest, event: unknown) {
  return (handler as (req: NextRequest, ev: unknown) => unknown)(request, event);
}

export const config = {
  // Skip static assets and Next internals; run on pages and API routes.
  matcher: ["/((?!_next|brand|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)", "/(api|trpc)(.*)"],
};
