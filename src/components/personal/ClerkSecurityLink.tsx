"use client";

import { useClerk } from "@clerk/nextjs";
import { KeyRound } from "lucide-react";
import { isAuthConfigured } from "@/lib/auth";
import { useAuthState } from "@/components/AuthState";

/**
 * Way through to Clerk's own profile screen.
 *
 * "נהל חשבון" now lands on our פרטי חשבון page, but that page only owns the
 * alert destinations — password, connected Google account and active sessions
 * live with Clerk. Without this the redirect would take those away with nothing
 * offered in return.
 *
 * Split so the Clerk hook is only ever called under a ClerkProvider.
 */
export function ClerkSecurityLink() {
  if (!isAuthConfigured()) return null;
  return <SecurityLink />;
}

function SecurityLink() {
  const { signedIn } = useAuthState();
  const clerk = useClerk();
  if (!signedIn) return null;

  return (
    <button
      type="button"
      onClick={() => clerk.openUserProfile()}
      className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-semibold text-muted transition hover:border-border-strong hover:text-primary"
    >
      <KeyRound size={14} /> אבטחה, סיסמה וחשבונות מקושרים
    </button>
  );
}
