import "server-only";
import { createVerify, X509Certificate } from "node:crypto";
import { crc32 } from "node:zlib";
import { paypalConfig, formatAmount, type PayPalConfig } from "./config";

/**
 * The PayPal REST client — plain `fetch`, no SDK.
 *
 * Same reasoning as the Resend transport in the notification engine: this is
 * four endpoints and an OAuth token, and a dependency in the money path is a
 * dependency to audit on every release.
 */

// ── Auth ───────────────────────────────────────────────────

/**
 * Access tokens last about nine hours. Cached in module scope with a margin,
 * so a burst of checkouts does not mint a token per request — and re-minted
 * without ceremony when a cold lambda has none.
 */
let cachedToken: { value: string; expiresAt: number } | null = null;

async function accessToken(config: PayPalConfig): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;

  const credentials = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64");
  const response = await fetch(`${config.apiBase}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
    cache: "no-store",
  });

  if (!response.ok) {
    // The body carries PayPal's own error name; the credentials never appear
    // in it, so it is safe to surface.
    throw new PayPalError(`oauth failed (${response.status})`, response.status, await safeText(response));
  }

  const json = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: json.access_token,
    // 60s of slack, so a token cannot expire between the check and the call.
    expiresAt: Date.now() + Math.max(0, json.expires_in - 60) * 1000,
  };
  return cachedToken.value;
}

export class PayPalError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "PayPalError";
  }
}

async function safeText(response: Response): Promise<string> {
  try {
    return (await response.text()).slice(0, 600);
  } catch {
    return "";
  }
}

async function call<T>(
  config: PayPalConfig,
  path: string,
  init: RequestInit & { idempotencyKey?: string } = {},
): Promise<T> {
  const token = await accessToken(config);
  const { idempotencyKey, ...rest } = init;

  const response = await fetch(`${config.apiBase}${path}`, {
    ...rest,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      // PayPal's own replay protection on writes: the same key returns the
      // original result instead of creating a second subscription.
      ...(idempotencyKey ? { "PayPal-Request-Id": idempotencyKey } : {}),
      ...rest.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new PayPalError(
      `${init.method ?? "GET"} ${path} failed (${response.status})`,
      response.status,
      await safeText(response),
    );
  }

  // 204 on cancel.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

// ── Subscriptions ──────────────────────────────────────────

export type PayPalSubscription = {
  id: string;
  status: string;
  plan_id?: string;
  custom_id?: string;
  start_time?: string;
  billing_info?: {
    next_billing_time?: string;
    last_payment?: { time?: string; amount?: { value?: string; currency_code?: string } };
  };
  links?: { href: string; rel: string; method: string }[];
};

/**
 * Creates the subscription server-side rather than letting the browser SDK do
 * it with `actions.subscription.create`.
 *
 * Two things follow from that, and both matter. The `custom_id` is set by code
 * the payer cannot influence, so a subscription cannot be attributed to
 * somebody else's account by editing a request. And we get the id back before
 * the payer approves anything, which is what lets us write the row that maps it
 * to a Clerk user before any webhook can arrive.
 */
export async function createSubscription(params: {
  clerkUserId: string;
  returnUrl: string;
  cancelUrl: string;
  email?: string;
  requestId?: string;
}): Promise<PayPalSubscription> {
  const config = requireConfig();
  if (!config.planId) throw new PayPalError("PAYPAL_PLAN_ID is not set", 503);

  return call<PayPalSubscription>(config, "/v1/billing/subscriptions", {
    method: "POST",
    idempotencyKey: params.requestId,
    body: JSON.stringify({
      plan_id: config.planId,
      custom_id: params.clerkUserId,
      ...(params.email ? { subscriber: { email_address: params.email } } : {}),
      application_context: {
        brand_name: "קרקעHOT",
        locale: "he-IL",
        // Nothing is shipped, and asking for an address would be a checkout
        // step that exists only to collect data we have no use for.
        shipping_preference: "NO_SHIPPING",
        // The payer confirms on PayPal's side rather than being returned to us
        // in a pending state and confirming again.
        user_action: "SUBSCRIBE_NOW",
        return_url: params.returnUrl,
        cancel_url: params.cancelUrl,
      },
    }),
  });
}

export async function getSubscription(id: string): Promise<PayPalSubscription> {
  return call<PayPalSubscription>(requireConfig(), `/v1/billing/subscriptions/${encodeURIComponent(id)}`);
}

export async function cancelSubscription(id: string, reason: string): Promise<void> {
  await call<void>(requireConfig(), `/v1/billing/subscriptions/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason.slice(0, 128) }),
  });
}

// ── Webhook verification ───────────────────────────────────

export type WebhookHeaders = {
  authAlgo: string;
  certUrl: string;
  transmissionId: string;
  transmissionSig: string;
  transmissionTime: string;
};

/**
 * Certificates, cached by URL. PayPal rotates them rarely and signs every
 * webhook with one, so fetching per event would add a round trip to the
 * critical path for no benefit.
 */
const certCache = new Map<string, Promise<string>>();

/**
 * PayPal only ever serves its signing certs from its own domain. Without this
 * check, `cert_url` is an attacker-controlled instruction telling us where to
 * fetch the key that will validate their own signature — which is the entire
 * attack, handed over politely in a header.
 */
function isPayPalCertUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      (parsed.hostname === "paypal.com" || parsed.hostname.endsWith(".paypal.com"))
    );
  } catch {
    return false;
  }
}

async function fetchCert(certUrl: string): Promise<string> {
  const cached = certCache.get(certUrl);
  if (cached) return cached;

  const promise = (async () => {
    const response = await fetch(certUrl, { cache: "no-store" });
    if (!response.ok) throw new PayPalError(`cert fetch failed (${response.status})`, response.status);
    return response.text();
  })();

  certCache.set(certUrl, promise);
  // A failed fetch must not be cached as a permanent answer.
  promise.catch(() => certCache.delete(certUrl));
  return promise;
}

/**
 * Verifies a webhook signature **ourselves**, against PayPal's certificate.
 *
 * This used to post the event back to PayPal's /v1/notifications/
 * verify-webhook-signature endpoint and trust its verdict. That endpoint
 * answered `{"verification_status":"SUCCESS"}` for a request whose signature
 * was the literal string "forged-signature" — verified against the sandbox on
 * 2026-08-23 — so the endpoint that exists to authenticate webhooks
 * authenticated a webhook nobody had signed. A forged event granted PRO in
 * production, which is exactly the failure the check was there to prevent.
 *
 * PayPal's own documentation prefers this path ("faster and avoids extra API
 * dependency and latency"); it is also the only one that actually verifies.
 * The algorithm is theirs:
 *
 *     message   = transmission_id | transmission_time | webhook_id | crc32(raw body)
 *     signature = base64(RSA-SHA256(message, PayPal's private key))
 *
 * Note that the CRC is over the **raw bytes** as received. Re-serialising a
 * parsed object changes key order and number formatting, and the CRC with it,
 * which is why the caller passes the untouched body text.
 *
 * Returns false on any doubt at all — a missing header, a cert from the wrong
 * host, an unexpected algorithm, a fetch that failed. "We cannot confirm this
 * is genuine" and "this is forged" deserve the same answer.
 */
export async function verifyWebhook(params: {
  headers: WebhookHeaders;
  rawBody: string;
}): Promise<boolean> {
  const config = paypalConfig();
  if (!config?.webhookId) return false;

  const { authAlgo, certUrl, transmissionId, transmissionSig, transmissionTime } = params.headers;
  if (!authAlgo || !certUrl || !transmissionId || !transmissionSig || !transmissionTime) {
    return false;
  }
  if (!isPayPalCertUrl(certUrl)) return false;

  // The only algorithm PayPal signs with. Accepting whatever the header asks
  // for would let a caller nominate one we verify less carefully.
  if (authAlgo.toUpperCase() !== "SHA256WITHRSA") return false;

  try {
    const pem = await fetchCert(certUrl);
    const publicKey = new X509Certificate(pem).publicKey;

    const checksum = crc32(Buffer.from(params.rawBody, "utf8")) >>> 0;
    const message = `${transmissionId}|${transmissionTime}|${config.webhookId}|${checksum}`;

    return createVerify("RSA-SHA256")
      .update(message, "utf8")
      .verify(publicKey, transmissionSig, "base64");
  } catch {
    return false;
  }
}

// ── Helpers ────────────────────────────────────────────────

function requireConfig(): PayPalConfig {
  const config = paypalConfig();
  if (!config) throw new PayPalError("PayPal is not configured", 503);
  return config;
}

/** Exported for the plan-provisioning script's benefit. */
export { formatAmount };
