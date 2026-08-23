/**
 * Creates the PayPal product + billing plan that PRO subscribes to.
 * `npm run paypal:plan`
 *
 * A subscription needs something to subscribe *to*, and that object lives in
 * PayPal, not in this repo. Doing it here rather than clicking through their
 * dashboard means the plan's terms — price, currency, interval, what happens
 * after three failed payments — are reviewable in version control, and that
 * recreating them in the live environment later is one command rather than an
 * exercise in remembering which boxes were ticked in sandbox.
 *
 * Prints the plan id. Put it in PAYPAL_PLAN_ID; nothing charges anyone until
 * that variable exists.
 *
 * Run it once per environment. Plans are immutable in the ways that matter
 * (price changes need a new plan), so this is deliberately not idempotent —
 * it will happily create a second plan, which is why it prints what it made
 * and asks you to copy the id rather than writing any file itself.
 */

import { readFileSync } from "node:fs";

// ── Environment ────────────────────────────────────────────
// No dotenv dependency, same as the db/ scripts. Anything already exported
// wins, so CI and a shell one-liner both work without touching .env.local.
function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (process.env[key]) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
}

loadEnvFile(new URL("../.env.local", import.meta.url).pathname);

const CLIENT_ID = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
const CLIENT_SECRET = process.env.PAYPAL_CLIENT_SECRET;
const ENVIRONMENT = process.env.PAYPAL_ENV?.toLowerCase() === "live" ? "live" : "sandbox";
const CURRENCY = (process.env.PAYPAL_CURRENCY ?? "ILS").toUpperCase();
const PRICE = Number(process.env.PAYPAL_PRICE ?? 99);

const API =
  ENVIRONMENT === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error(
    "✗ NEXT_PUBLIC_PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET must be set\n" +
      "  (in .env.local, or exported in this shell)",
  );
  process.exit(1);
}

// ILS rejects decimal amounts outright — "if you pass a decimal amount, an
// error occurs" — so a plan priced at 99.00 fails with a message that does not
// mention decimals at all. Caught here rather than at checkout.
const ZERO_DECIMAL = new Set(["ILS", "HUF", "JPY", "TWD"]);
const value = ZERO_DECIMAL.has(CURRENCY) ? String(Math.round(PRICE)) : PRICE.toFixed(2);

if (ZERO_DECIMAL.has(CURRENCY) && !Number.isInteger(PRICE)) {
  console.error(`✗ ${CURRENCY} does not support decimals — PAYPAL_PRICE must be a whole number`);
  process.exit(1);
}

// ── PayPal ─────────────────────────────────────────────────
async function token() {
  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const response = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    throw new Error(`oauth ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return (await response.json()).access_token;
}

async function post(path, body, accessToken) {
  const response = await fetch(`${API}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "PayPal-Request-Id": `karkahot-${path.replace(/\W/g, "")}-${Date.now()}`,
      prefer: "return=representation",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${(await response.text()).slice(0, 500)}`);
  }
  return response.json();
}

async function main() {
  console.log(`→ ${ENVIRONMENT} · ${value} ${CURRENCY}/month`);
  const accessToken = await token();
  console.log("✓ authenticated");

  const product = await post(
    "/v1/catalogs/products",
    {
      name: "קרקעHOT PRO",
      description: "התראות מיידיות על מכרזי קרקע, ללא הגבלה",
      type: "SERVICE",
      category: "SOFTWARE",
    },
    accessToken,
  );
  console.log(`✓ product ${product.id}`);

  const plan = await post(
    "/v1/billing/plans",
    {
      product_id: product.id,
      name: "קרקעHOT PRO — חודשי",
      description: `${value} ${CURRENCY} לחודש, ביטול בכל עת`,
      status: "ACTIVE",
      billing_cycles: [
        {
          frequency: { interval_unit: "MONTH", interval_count: 1 },
          tenure_type: "REGULAR",
          sequence: 1,
          // 0 = until cancelled. The pricing table promises "ביטול בכל עת",
          // which only means anything if the plan does not end on its own.
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value, currency_code: CURRENCY } },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        // Three failures then suspend, rather than cancelling on the first.
        // A declined card is usually a card problem, not a decision to leave.
        payment_failure_threshold: 3,
      },
    },
    accessToken,
  );

  console.log(`✓ plan ${plan.id}\n`);
  console.log("Add to Vercel (and .env.local for local testing):\n");
  console.log(`  PAYPAL_PLAN_ID=${plan.id}\n`);
  console.log("Then create the webhook at developer.paypal.com → Apps & Credentials →");
  console.log("  your app → Webhooks, pointing at:\n");
  console.log(`  ${process.env.NEXT_PUBLIC_SITE_URL ?? "https://deal-finder-il.vercel.app"}/api/webhooks/paypal\n`);
  console.log("  Subscribe it to: BILLING.SUBSCRIPTION.ACTIVATED, .CANCELLED, .SUSPENDED,");
  console.log("  .EXPIRED, .PAYMENT.FAILED and PAYMENT.SALE.COMPLETED");
  console.log("  then copy the webhook id into PAYPAL_WEBHOOK_ID.");
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
