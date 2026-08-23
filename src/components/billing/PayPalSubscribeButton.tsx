"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Loader2, ShieldCheck } from "lucide-react";
import { useAuthState } from "@/components/AuthState";
import { trackEvent } from "@/lib/events";

/**
 * PayPal's own button, rendered by PayPal's SDK.
 *
 * The card details never touch this page or our servers — the payer completes
 * the flow inside PayPal's iframe. That is the entire reason for using their
 * button rather than building a form: a payment form on our origin would make
 * this application something that handles card numbers, with everything that
 * follows from that.
 *
 * The SDK is loaded by hand rather than with @paypal/react-paypal-js. The
 * wrapper is one provider and one component around what is written below, and
 * a dependency in the payment path is a dependency to audit on every release.
 */

type PayPalButtonsInstance = { render: (el: HTMLElement) => Promise<void>; close: () => void };
type PayPalNamespace = {
  Buttons: (options: Record<string, unknown>) => PayPalButtonsInstance;
};

declare global {
  interface Window {
    paypal?: PayPalNamespace;
  }
}

/**
 * One load per page, however many buttons ask for it. Keyed by the parameters
 * that are baked into the script URL, since changing currency means a
 * different SDK build rather than a different call.
 */
const sdkLoads = new Map<string, Promise<PayPalNamespace>>();

function loadSdk(clientId: string, currency: string): Promise<PayPalNamespace> {
  const key = `${clientId}:${currency}`;
  const existing = sdkLoads.get(key);
  if (existing) return existing;

  const promise = new Promise<PayPalNamespace>((resolve, reject) => {
    if (window.paypal) return resolve(window.paypal);

    const script = document.createElement("script");
    const params = new URLSearchParams({
      "client-id": clientId,
      // Both are required for subscriptions: without them the SDK builds a
      // one-off order button that ignores createSubscription entirely.
      vault: "true",
      intent: "subscription",
      currency,
      locale: "he_IL",
      components: "buttons",
    });
    script.src = `https://www.paypal.com/sdk/js?${params}`;
    script.async = true;
    script.onload = () =>
      window.paypal ? resolve(window.paypal) : reject(new Error("sdk_loaded_without_namespace"));
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever.
      sdkLoads.delete(key);
      reject(new Error("sdk_load_failed"));
    };
    document.head.appendChild(script);
  });

  sdkLoads.set(key, promise);
  return promise;
}

type Status = "loading" | "ready" | "working" | "done" | "error";

export function PayPalSubscribeButton({
  clientId,
  currency,
  sandbox,
}: {
  clientId: string;
  currency: string;
  /** Shown to us, never to a paying customer — see the notice below. */
  sandbox: boolean;
}) {
  const { signedIn, loaded } = useAuthState();
  const router = useRouter();
  const container = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded || !signedIn) return;

    let cancelled = false;
    let buttons: PayPalButtonsInstance | null = null;

    // Every setState below runs from an async continuation, never from the
    // effect body — this repo's lint rules reject the latter, and rightly.
    loadSdk(clientId, currency)
      .then((paypal) => {
        if (cancelled || !container.current) return;

        buttons = paypal.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "subscribe" },

          // Fires on click, which is as close to the button press as an
          // iframe lets us get — and keeps upgrade_click continuous with the
          // number the pricing page was already recording before checkout
          // existed.
          createSubscription: async () => {
            trackEvent("upgrade_click", { tier: "free", live: !sandbox });
            const response = await fetch("/api/billing/paypal/subscription", { method: "POST" });
            const json = (await response.json().catch(() => ({}))) as {
              id?: string;
              error?: string;
            };
            if (!response.ok || !json.id) throw new Error(json.error ?? "create_failed");
            return json.id;
          },

          onApprove: async (data: { subscriptionID?: string }) => {
            if (!data.subscriptionID) return;
            setStatus("working");
            // Confirmation is for the page, not for the account: the webhook
            // is what actually grants PRO. So a failure here is not reported
            // as a failed payment — the money has already moved.
            await fetch(`/api/billing/paypal/subscription/${data.subscriptionID}/confirm`, {
              method: "POST",
            }).catch(() => {});
            if (cancelled) return;
            setStatus("done");
            // Re-render the server components so the plan shown on this page
            // matches what the database now says. refresh() is the half that
            // matters: the route is force-dynamic, and without it the tier
            // would come from the render that happened before they paid.
            router.replace("/account?tab=billing&subscribed=1");
            router.refresh();
          },

          onCancel: () => {
            if (!cancelled) setStatus("ready");
          },

          onError: (err: unknown) => {
            console.error("[paypal]", err);
            if (cancelled) return;
            setError("checkout_error");
            setStatus("error");
          },
        });

        return buttons.render(container.current).then(() => {
          if (!cancelled) setStatus("ready");
        });
      })
      .catch(() => {
        if (cancelled) return;
        setError("sdk_error");
        setStatus("error");
      });

    return () => {
      cancelled = true;
      try {
        buttons?.close();
      } catch {
        // The SDK throws if it has already torn itself down.
      }
    };
  }, [clientId, currency, sandbox, signedIn, loaded, router]);

  if (loaded && !signedIn) {
    return (
      <div className="rounded-lg border border-border bg-surface-2 px-4 py-3 text-center text-sm text-muted">
        כדי לשדרג יש להתחבר תחילה — המנוי נשמר בחשבון שלך.
      </div>
    );
  }

  return (
    <div>
      {sandbox && (
        <p className="mb-2 flex items-center justify-center gap-1.5 rounded-lg border border-warning/40 bg-warning-soft px-3 py-1.5 text-[11px] font-semibold text-warning">
          <AlertTriangle size={12} /> מצב בדיקה (Sandbox) — לא מתבצע חיוב אמיתי
        </p>
      )}

      <div ref={container} className={status === "error" ? "hidden" : ""} />

      {status === "loading" && (
        <div className="flex items-center justify-center gap-2 rounded-lg border border-border bg-surface-2 px-4 py-3 text-sm text-muted">
          <Loader2 size={14} className="animate-spin" /> טוען את מסך התשלום…
        </div>
      )}

      {status === "working" && (
        <div className="mt-2 flex items-center justify-center gap-2 text-xs text-muted">
          <Loader2 size={13} className="animate-spin" /> מאשרים את המנוי…
        </div>
      )}

      {status === "error" && (
        <div className="rounded-lg border border-negative/40 bg-negative-soft px-4 py-3 text-center text-sm text-negative">
          {error === "sdk_error"
            ? "לא הצלחנו לטעון את מסך התשלום של PayPal. בדקו חוסם פרסומות ונסו לרענן."
            : "משהו השתבש בתהליך התשלום. לא בוצע חיוב — אפשר לנסות שוב."}
        </div>
      )}

      <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-faint">
        <ShieldCheck size={12} /> התשלום מתבצע בדפי PayPal · פרטי האשראי לא נשמרים אצלנו
      </p>
    </div>
  );
}
