import "server-only";

/**
 * PayPal configuration, in one place, on the same contract as the notification
 * engine: **missing configuration degrades, it never throws.** With no keys the
 * checkout button is simply not offered and the billing panel says billing is
 * not open yet — which is exactly what it said before this existed.
 *
 * The client id is NEXT_PUBLIC_ because the browser SDK needs it; it is public
 * by design and identifies the merchant, not the account. The secret is not,
 * and this module is server-only so it cannot be dragged into a client bundle.
 */

const str = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() !== "" ? value.trim() : undefined;
};

export type PayPalEnvironment = "sandbox" | "live";

export type PayPalConfig = {
  clientId: string;
  clientSecret: string;
  environment: PayPalEnvironment;
  apiBase: string;
  planId?: string;
  webhookId?: string;
  currency: string;
  /** Display price, in whole currency units. */
  price: number;
};

/**
 * Sandbox unless something explicitly says otherwise.
 *
 * Defaulting the other way is how a misconfigured preview deployment takes a
 * real payment. "live" has to be typed out.
 */
function environment(): PayPalEnvironment {
  return str("PAYPAL_ENV")?.toLowerCase() === "live" ? "live" : "sandbox";
}

export function paypalConfig(): PayPalConfig | null {
  // Read as a full literal expression, not process.env[name] — Next only
  // inlines NEXT_PUBLIC_* into the client bundle when it can see the whole
  // reference, and isPayPalPublicallyConfigured() below relies on it.
  const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID?.trim();
  const clientSecret = str("PAYPAL_CLIENT_SECRET");
  if (!clientId || !clientSecret) return null;

  const env = environment();
  return {
    clientId,
    clientSecret,
    environment: env,
    apiBase: env === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com",
    planId: str("PAYPAL_PLAN_ID"),
    webhookId: str("PAYPAL_WEBHOOK_ID"),
    // ILS is supported but carries a restriction worth knowing about: it does
    // not accept decimals. The plan is therefore priced in whole shekels, and
    // anything charging cents must switch currency first.
    currency: str("PAYPAL_CURRENCY") ?? "ILS",
    price: Number(str("PAYPAL_PRICE") ?? 99),
  };
}

/** Currencies PayPal rejects a decimal amount for. */
const ZERO_DECIMAL = new Set(["ILS", "HUF", "JPY", "TWD"]);

/**
 * Formats an amount the way PayPal's `value` field wants it for a currency.
 * Getting this wrong is not a rounding bug — it is a hard error from their API
 * that reads like a malformed request.
 */
export function formatAmount(amount: number, currency: string): string {
  return ZERO_DECIMAL.has(currency.toUpperCase())
    ? String(Math.round(amount))
    : amount.toFixed(2);
}

/**
 * Whether checkout can actually be offered. A client id alone is not enough:
 * without a plan there is nothing to subscribe to, and a button that fails on
 * click is worse than no button.
 */
export function canCheckout(config: PayPalConfig | null): config is PayPalConfig {
  return Boolean(config?.planId);
}

/** Setup summary for the admin dashboard. Names only, never secrets. */
export function billingStatus() {
  const config = paypalConfig();
  const missing: string[] = [];

  if (!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID) missing.push("NEXT_PUBLIC_PAYPAL_CLIENT_ID");
  if (!str("PAYPAL_CLIENT_SECRET")) missing.push("PAYPAL_CLIENT_SECRET");
  if (!str("PAYPAL_PLAN_ID")) missing.push("PAYPAL_PLAN_ID (run: npm run paypal:plan)");
  // Without this, webhooks cannot be verified — and an unverified webhook that
  // grants PRO is a public endpoint for granting yourself PRO. The handler
  // refuses to act at all when it is missing.
  if (!str("PAYPAL_WEBHOOK_ID")) missing.push("PAYPAL_WEBHOOK_ID");

  return {
    configured: canCheckout(config),
    environment: config?.environment ?? environment(),
    currency: config?.currency ?? "ILS",
    price: config?.price ?? 99,
    planId: config?.planId ? `${config.planId.slice(0, 8)}…` : null,
    webhooksVerifiable: Boolean(config?.webhookId),
    missing,
  };
}
