import { NextResponse, type NextRequest } from "next/server";
import { clerkMiddleware } from "@clerk/nextjs/server";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Clerk's request handler. Next 16 renamed the `middleware` convention to
 * `proxy`, so this file is src/proxy.ts with a default export.
 *
 * Nothing is protected here: the whole app stays publicly readable, and
 * clerkMiddleware only attaches the session so that server components and
 * /api/user/sync can read it. Without a publishable key it is skipped
 * entirely — Clerk would otherwise throw on every request.
 */
const handler = isAuthConfigured() ? clerkMiddleware() : () => NextResponse.next();

export default function proxy(request: NextRequest, event: unknown) {
  return (handler as (req: NextRequest, ev: unknown) => unknown)(request, event);
}

export const config = {
  // Skip static assets and Next internals; run on pages and API routes.
  matcher: ["/((?!_next|brand|.*\\.(?:png|jpg|jpeg|svg|ico|webp|css|js)$).*)", "/(api|trpc)(.*)"],
};
