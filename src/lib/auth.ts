/**
 * Auth configuration state. Clerk is the chosen provider (Google + email);
 * see src/components/AuthProvider.tsx for the switch-on steps.
 *
 * The publishable key is NEXT_PUBLIC_*, so this is safe to call from either
 * side of the app — but it must be read as a full literal expression, not
 * `process.env[name]`, for Next to inline it into the client bundle.
 */
export function isAuthConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
}

/** Where per-user data will live once accounts exist (today: this browser). */
export const AUTH_STATUS: "local-only" | "clerk" = "local-only";
