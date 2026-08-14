"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudUpload, Check, TriangleAlert } from "lucide-react";
import type { Alert } from "@/lib/types";
import { ALERTS_KEY, SAVED_DEALS_KEY } from "@/lib/client-store";
import { refreshAccount } from "@/lib/personal-data";
import { useAuthState } from "@/components/AuthState";

/**
 * One-time upload of whatever this browser collected as a guest, on the first
 * sign-in per browser per account.
 *
 * Once signed in the account is the source of truth (see personal-data.ts), so
 * this only ever pushes *up* — it no longer writes the merged result back into
 * localStorage, which would leave two copies drifting apart. The guest copy is
 * left untouched so signing out still shows what the guest had.
 *
 * It reads storage directly rather than through the hooks: those now return the
 * account's rows while signed in, and what needs uploading is precisely the
 * browser's own leftovers.
 */
type Status = "idle" | "syncing" | "done" | "error";

function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function UserSync() {
  const { signedIn, loaded } = useAuthState();
  const [status, setStatus] = useState<Status>("idle");
  const router = useRouter();

  useEffect(() => {
    if (!loaded || !signedIn) return;

    let cancelled = false;

    (async () => {
      const alerts = readLocal<Alert[]>(ALERTS_KEY, []);
      const savedDealIds = readLocal<string[]>(SAVED_DEALS_KEY, []);

      // The marker is per browser; the server merge is idempotent anyway
      // (alerts upsert by id), so a double run costs nothing but a request.
      const doneKey = "karkahot:synced";
      if (window.localStorage.getItem(doneKey)) return;
      if (alerts.length === 0 && savedDealIds.length === 0) {
        window.localStorage.setItem(doneKey, new Date().toISOString());
        return;
      }

      // Inside the callback rather than the effect body: a synchronous
      // setState there would cascade an extra render before the fetch starts.
      setStatus("syncing");
      try {
        const res = await fetch("/api/user/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ alerts, savedDealIds }),
        });
        if (!res.ok) throw new Error(String(res.status));
        if (cancelled) return;

        window.localStorage.setItem(doneKey, new Date().toISOString());
        refreshAccount(); // drop the client mirror
        router.refresh(); // re-render the server copy with the merged rows
        setStatus("done");
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [signedIn, loaded, router]);

  if (status === "idle") return null;

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
          מעביר את ההתראות והעסקאות השמורות של הדפדפן הזה לחשבון…
        </>
      )}
      {status === "done" && (
        <>
          <Check size={14} className="shrink-0 text-positive" />
          הנתונים שנשמרו בדפדפן הזה הועברו לחשבון שלך.
        </>
      )}
      {status === "error" && (
        <>
          <TriangleAlert size={14} className="shrink-0" />
          ההעברה לחשבון נכשלה. הנתונים עדיין שמורים בדפדפן וננסה שוב בכניסה הבאה.
        </>
      )}
    </p>
  );
}
