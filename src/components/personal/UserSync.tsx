"use client";

import { useEffect, useState } from "react";
import { useUser } from "@clerk/nextjs";
import { CloudUpload, Check, TriangleAlert } from "lucide-react";
import type { Alert } from "@/lib/types";
import { ALERTS_KEY, useSavedDealIds, useStoredState } from "@/lib/client-store";
import { isAuthConfigured } from "@/lib/auth";

const NO_ALERTS: Alert[] = [];

/**
 * Moves this browser's alerts and saved tenders into the signed-in account,
 * once per browser per user, then adopts whatever the account already had.
 *
 * Split in two on purpose: useUser() needs a ClerkProvider above it, so the
 * hook lives in a component that is only ever mounted when auth is configured.
 */
export function UserSync() {
  if (!isAuthConfigured()) return null;
  return <ClerkUserSync />;
}

type Status = "idle" | "syncing" | "done" | "error";

function ClerkUserSync() {
  const { isSignedIn, user } = useUser();
  const [alerts, setAlerts] = useStoredState<Alert[]>(ALERTS_KEY, NO_ALERTS);
  const [savedIds, setSavedIds] = useSavedDealIds();
  const [status, setStatus] = useState<Status>("idle");

  useEffect(() => {
    if (!isSignedIn || !user) return;
    const doneKey = `karkahot:synced:${user.id}`;
    if (window.localStorage.getItem(doneKey)) return;

    let cancelled = false;

    (async () => {
      // Inside the callback rather than the effect body: a synchronous
      // setState there would cascade an extra render before the fetch starts.
      setStatus("syncing");
      try {
        const res = await fetch("/api/user/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          // Read straight from storage: this runs once, and the merge has to
          // carry everything in the browser, not just what a panel has read.
          body: JSON.stringify({ alerts, savedDealIds: savedIds }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const merged = (await res.json()) as { alerts: Alert[]; savedDealIds: string[] };
        if (cancelled) return;

        // Adopt the account's view so a second device converges instead of
        // fighting the first one.
        setAlerts(merged.alerts);
        setSavedIds(merged.savedDealIds);
        window.localStorage.setItem(doneKey, new Date().toISOString());
        setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
    // Runs on sign-in only; the stored values are read inside on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn, user?.id]);

  if (status === "idle" || !isSignedIn) return null;

  return (
    <p
      className={`mb-4 flex items-center gap-2 rounded-lg border p-3 text-[11px] ${
        status === "error"
          ? "border-negative/40 bg-negative-soft text-negative"
          : "border-border bg-surface-2 text-muted"
      }`}
    >
      {status === "syncing" && (
        <>
          <CloudUpload size={14} className="shrink-0 animate-pulse text-accent" />
          מסנכרן את ההתראות והעסקאות השמורות לחשבון…
        </>
      )}
      {status === "done" && (
        <>
          <Check size={14} className="shrink-0 text-positive" />
          הנתונים של הדפדפן הזה סונכרנו לחשבון שלך.
        </>
      )}
      {status === "error" && (
        <>
          <TriangleAlert size={14} className="shrink-0" />
          הסנכרון לחשבון נכשל. הנתונים נשמרו בדפדפן הזה וננסה שוב בכניסה הבאה.
        </>
      )}
    </p>
  );
}
