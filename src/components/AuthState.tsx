"use client";

import { createContext, useContext } from "react";
import { useAuth } from "@clerk/nextjs";
import { isAuthConfigured } from "@/lib/auth";

/**
 * Sign-in state as plain context, so components deep in the tree (the bookmark
 * button on every feed row) can branch on it without importing Clerk.
 *
 * Clerk's useAuth throws outside a ClerkProvider and hooks can't be called
 * conditionally — so the branch happens at the component level here, once, and
 * everything below reads a context that is always present.
 */
type AuthState = { signedIn: boolean; loaded: boolean };

const AuthStateContext = createContext<AuthState>({ signedIn: false, loaded: true });

export function useAuthState(): AuthState {
  return useContext(AuthStateContext);
}

export function AuthStateProvider({ children }: { children: React.ReactNode }) {
  if (!isAuthConfigured()) {
    return (
      <AuthStateContext.Provider value={{ signedIn: false, loaded: true }}>
        {children}
      </AuthStateContext.Provider>
    );
  }
  return <ClerkAuthState>{children}</ClerkAuthState>;
}

function ClerkAuthState({ children }: { children: React.ReactNode }) {
  const { isSignedIn, isLoaded } = useAuth();
  return (
    <AuthStateContext.Provider value={{ signedIn: Boolean(isSignedIn), loaded: isLoaded }}>
      {children}
    </AuthStateContext.Provider>
  );
}
