import { isAuthConfigured } from "@/lib/auth";

/**
 * Seam for Clerk authentication.
 *
 * Deliberately a pass-through today: `@clerk/nextjs` is NOT installed and
 * ClerkProvider throws at runtime without a publishable key, so wrapping the
 * app before the keys exist would take production down rather than prepare it.
 * Everything Clerk needs to slot in lives here, so switching it on is one file
 * plus one install.
 *
 * To enable:
 *
 *   1. npm install @clerk/nextjs
 *   2. Put the keys in .env.local (and in Vercel → Settings → Environment
 *      Variables):
 *        NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_...
 *        CLERK_SECRET_KEY=sk_...
 *   3. Replace the body of this component with:
 *
 *        import { ClerkProvider } from "@clerk/nextjs";
 *        import { heIL } from "@clerk/localizations";
 *
 *        return (
 *          <ClerkProvider
 *            localization={heIL}
 *            appearance={{
 *              variables: {
 *                colorPrimary: "#5a6bff",       // --accent
 *                colorBackground: "#101334",    // --surface
 *                colorText: "#edeffb",          // --text-primary
 *                borderRadius: "0.5rem",
 *              },
 *            }}
 *          >
 *            {children}
 *          </ClerkProvider>
 *        );
 *
 *   4. Add src/middleware.ts:
 *
 *        import { clerkMiddleware } from "@clerk/nextjs/server";
 *        export default clerkMiddleware();
 *        export const config = {
 *          matcher: ["/((?!_next|brand|.*\\.(?:png|svg|ico)).*)", "/(api|trpc)(.*)"],
 *        };
 *
 *   5. Swap the header's placeholder avatar for <SignedIn>/<SignedOut> with
 *      <UserButton /> and <SignInButton mode="modal" />.
 *
 * Google and email/password are enabled in the Clerk dashboard (User &
 * Authentication → Social connections / Email), not in this file.
 *
 * Until then the personal area stays per-browser: everything it stores lives in
 * localStorage (see src/lib/client-store.ts). Signing in is what will let those
 * alerts and saved deals follow a user across devices — and what makes actually
 * sending an alert possible.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Setting the key alone doesn't switch auth on — say so loudly in dev rather
  // than leaving someone to wonder why nothing happened.
  if (process.env.NODE_ENV !== "production" && isAuthConfigured()) {
    console.warn(
      "[auth] NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY is set, but Clerk is not wired up yet. " +
        "Follow the steps in src/components/AuthProvider.tsx.",
    );
  }
  return <>{children}</>;
}
