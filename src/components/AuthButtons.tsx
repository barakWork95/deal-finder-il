import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { LogIn } from "lucide-react";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Header account control. Clerk 7 replaced <SignedIn>/<SignedOut> with
 * <Show when="signed-in">, which reads the session server-side — so it needs
 * both a ClerkProvider above it and clerkMiddleware to have run. Without a
 * publishable key neither exists, hence the same guard used everywhere else;
 * the app then shows a plain, inert avatar exactly as it did before auth.
 */
export function AuthButtons() {
  if (!isAuthConfigured()) {
    return (
      <div
        title="התחברות תיפתח בקרוב"
        className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-sm font-bold text-primary"
      >
        ב
      </div>
    );
  }

  return (
    <Show
      when="signed-in"
      fallback={
        <SignInButton mode="modal">
          <button
            type="button"
            className="btn-primary inline-flex h-9 items-center gap-1.5 rounded-lg bg-accent px-3 text-xs font-semibold text-white transition hover:brightness-110"
          >
            <LogIn size={15} />
            <span className="hidden sm:inline">התחברות</span>
          </button>
        </SignInButton>
      }
    >
      <UserButton
        appearance={{ elements: { avatarBox: "h-9 w-9" } }}
        userProfileProps={{ appearance: { variables: { colorPrimary: "#5a6bff" } } }}
      />
    </Show>
  );
}
