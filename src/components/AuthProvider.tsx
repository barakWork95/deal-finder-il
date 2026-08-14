import { ClerkProvider } from "@clerk/nextjs";
import { heIL } from "@clerk/localizations";
import { isAuthConfigured } from "@/lib/auth";
import { AuthStateProvider } from "@/components/AuthState";

/**
 * Wraps the app in Clerk — but only when a publishable key is present.
 *
 * ClerkProvider throws without one, so an unconditional wrap would turn a
 * missing environment variable into a blank site. With this guard the app runs
 * exactly as it did before auth existed when the key is absent: local previews,
 * CI builds and forks all keep working, and adding the key is what switches
 * sign-in on. Every other Clerk touchpoint (AuthButtons, proxy.ts,
 * /api/user/sync) is guarded by the same flag, so they can never disagree about
 * whether auth is live.
 *
 * Google and email/password are enabled in the Clerk dashboard (User &
 * Authentication → Social connections), not here.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured()) return <AuthStateProvider>{children}</AuthStateProvider>;

  return (
    <ClerkProvider
      // The whole product is Hebrew-first; an English sign-in modal would be
      // the only English surface in the app.
      localization={heIL}
      appearance={{
        variables: {
          colorPrimary: "#5a6bff", // --accent
          colorBackground: "#101334", // --surface
          colorForeground: "#edeffb", // --text-primary
          colorInput: "#171b3e", // --surface-2
          borderRadius: "0.5rem",
        },
      }}
    >
      <AuthStateProvider>{children}</AuthStateProvider>
    </ClerkProvider>
  );
}
