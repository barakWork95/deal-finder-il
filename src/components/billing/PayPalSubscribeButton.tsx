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

    const fail = (reason: string) => {
      window.clearTimeout(timer);
      // Let a later attempt retry rather than caching the failure forever.
      sdkLoads.delete(key);
      console.error(`[paypal] SDK load failed: ${reason}`, script.src);
      reject(new Error(reason));
    };

    /**
     * Neither onload nor onerror is guaranteed to fire. A Content-Security-
     * Policy refusal, and some blocking extensions, drop the request in a way
     * that settles nothing — and a promise that never settles leaves the
     * button showing "loading" forever, with no error anywhere and no network
     * request to inspect. Ten seconds is far longer than the SDK needs and far
     * shorter than a visitor's patience.
     */
    const timer = window.setTimeout(() => fail("sdk_timeout"), 10_000);

    script.onload = () => {
      window.clearTimeout(timer);
      if (window.paypal) {
        resolve(window.paypal);
      } else {
        // The script ran but installed nothing — almost always a client-id the
        // SDK rejected, which it reports only in the console.
        fail("sdk_loaded_without_namespace");
      }
    };
    script.onerror = () => fail("sdk_load_failed");

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
            if (!response.ok || !json.id) {
              // PayPal's own callback swallows this into a generic message, so
              // the specific reason — unauthenticated, billing_not_configured,
              // create_failed — is logged and kept for our own error text.
              const reason = json.error ?? `http_${response.status}`;
              console.error("[paypal] could not create subscription:", reason);
              setError(reason);
              throw new Error(reason);
            }
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
            // Fires for anything inside PayPal's own flow, including a
            // createSubscription that threw — in which case `error` already
            // holds the specific reason and must not be flattened.
            console.error("[paypal] checkout error:", err);
            if (cancelled) return;
            setError((current) => current ?? "checkout_error");
            setStatus("error");
          },
        });

        return buttons.render(container.current).then(() => {
          if (!cancelled) setStatus("ready");
        });
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        const code = reason instanceof Error ? reason.message : "sdk_error";
        console.error("[paypal] checkout unavailable:", code);
        setError(code);
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
          {errorMessage(error)}
          <span className="mt-1 block text-[10px] text-faint" dir="ltr">
            {error}
          </span>
        </div>
      )}

      <p className="mt-2 flex items-center justify-center gap-1.5 text-[11px] text-faint">
        <ShieldCheck size={12} /> התשלום מתבצע בדפי PayPal · פרטי האשראי לא נשמרים אצלנו
      </p>
    </div>
  );
}

/** Turns a failure code into something a person can act on. */
function errorMessage(code: string | null): string {
  switch (code) {
    case "sdk_timeout":
    case "sdk_load_failed":
      return "מסך התשלום של PayPal לא נטען. חוסם פרסומות או תוסף פרטיות חוסם אותו לרוב — נסו לכבות אותו ולרענן.";
    case "sdk_loaded_without_namespace":
      return "PayPal טען אך לא אתחל. ככל הנראה מזהה לקוח (client id) שגוי בהגדרות.";
    case "unauthenticated":
      return "צריך להתחבר מחדש כדי להשלים את המנוי.";
    case "billing_not_configured":
      return "הסליקה עדיין לא מוגדרת בצד השרת.";
    case "create_failed":
      return "PayPal לא הצליח לפתוח את המנוי. לא בוצע חיוב — אפשר לנסות שוב.";
    default:
      return "משהו השתבש בתהליך התשלום. לא בוצע חיוב — אפשר לנסות שוב.";
  }
}
