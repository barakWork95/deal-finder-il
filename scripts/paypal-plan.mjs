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
 * (price changes need a new plan), so this is deliberately not idempotent for
 * plans — it will happily create a second one, which is why it prints what it
 * made and asks you to copy the id rather than writing any file itself. The
 * *product* is reused when one already exists, because PayPal cannot delete a
 * product and a stranded duplicate is forever.
 *
 * Use `--dry-run` to check credentials without creating anything.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ── Environment ────────────────────────────────────────────
// No dotenv dependency, same as the db/ scripts.
//
// Which variable a credential came from matters here in a way it does not
// elsewhere, so it is tracked rather than just read. A shell that supplies the
// live secret while .env.local supplies the sandbox client id produces a
// perfectly formed request that PayPal rejects as "invalid_client" — an error
// about neither the environment nor the endpoint, and the reason is invisible
// unless something says where each half came from.

/** Variables present before any file was read — i.e. from the shell. */
const fromShell = new Set(Object.keys(process.env));

function loadEnvFile(path) {
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return false;
  }
  for (const line of text.split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    // Anything already exported wins, so a shell one-liner overrides the file.
    if (process.env[key] !== undefined) continue;
    process.env[key] = rawValue.trim().replace(/^["']|["']$/g, "");
  }
  return true;
}

const ENV_FILE = fileURLToPath(new URL("../.env.local", import.meta.url));
const envFileLoaded = loadEnvFile(ENV_FILE);

/** First name that has a value, with a note of where it came from. */
function resolve(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim() !== "") {
      return { name, value: value.trim(), source: fromShell.has(name) ? "command line" : ".env.local" };
    }
  }
  return null;
}

// PAYPAL_CLIENT_ID first: it is the obvious thing to type on a command line,
// and requiring the NEXT_PUBLIC_ name here — which exists because the *browser*
// needs it — is a trap. Both are accepted.
const clientId = resolve("PAYPAL_CLIENT_ID", "NEXT_PUBLIC_PAYPAL_CLIENT_ID");
const clientSecret = resolve("PAYPAL_CLIENT_SECRET");

const ENVIRONMENT = process.env.PAYPAL_ENV?.toLowerCase() === "live" ? "live" : "sandbox";
const CURRENCY = (process.env.PAYPAL_CURRENCY ?? "ILS").toUpperCase();
const PRICE = Number(process.env.PAYPAL_PRICE ?? 99);

const API =
  ENVIRONMENT === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";

const PRODUCT_NAME = "קרקעHOT PRO";

/**
 * `--dry-run` resolves credentials, authenticates and reports what it would
 * create, without creating it.
 *
 * This script makes objects that cannot be taken back — PayPal has no delete
 * for catalog products, and a plan can only be deactivated, never removed. So
 * "just run it and see" costs something permanent every time, which is a poor
 * property for the one command people reach for when a credential is not
 * working. (Added after two accidental runs left debris in the sandbox.)
 */
const DRY_RUN = process.argv.includes("--dry-run");

if (!clientId || !clientSecret) {
  console.error(
    "✗ missing credentials.\n" +
      "  client id: PAYPAL_CLIENT_ID (or NEXT_PUBLIC_PAYPAL_CLIENT_ID)\n" +
      "  secret:    PAYPAL_CLIENT_SECRET\n" +
      `  Set them in the shell, or in ${ENV_FILE}${envFileLoaded ? "" : " (not found)"}.`,
  );
  process.exit(1);
}

/**
 * The failure this script exists to make impossible.
 *
 * Half the credentials from the shell and half from .env.local means a live
 * secret paired with a sandbox client id — which is not a wrong endpoint, not a
 * wrong environment, and not a typo. PayPal answers "invalid_client" and there
 * is nothing in the output to suggest the two halves disagree.
 */
if (clientId.source !== clientSecret.source) {
  console.error(
    "✗ the client id and the secret came from different places:\n" +
      `    ${clientId.name.padEnd(28)} — ${clientId.source}\n` +
      `    ${clientSecret.name.padEnd(28)} — ${clientSecret.source}\n\n` +
      "  That almost always pairs one environment's id with another's secret,\n" +
      '  which PayPal rejects as "invalid_client". Pass both on the command\n' +
      "  line, or put both in .env.local — not one of each.",
  );
  process.exit(1);
}

/** Public identifier, but shown abbreviated — it is here to be recognised, not read. */
const shortId = `${clientId.value.slice(0, 6)}…${clientId.value.slice(-4)}`;

// ILS rejects decimal amounts outright — "if you pass a decimal amount, an
// error occurs" — so a plan priced at 99.00 fails with a message that does not
// mention decimals at all. Caught here rather than at checkout.
const ZERO_DECIMAL = new Set(["ILS", "HUF", "JPY", "TWD"]);

if (ZERO_DECIMAL.has(CURRENCY) && !Number.isInteger(PRICE)) {
  console.error(`✗ ${CURRENCY} does not support decimals — PAYPAL_PRICE must be a whole number`);
  process.exit(1);
}

const value = ZERO_DECIMAL.has(CURRENCY) ? String(Math.round(PRICE)) : PRICE.toFixed(2);

// ── PayPal ─────────────────────────────────────────────────
async function token() {
  const credentials = Buffer.from(`${clientId.value}:${clientSecret.value}`).toString("base64");
  const response = await fetch(`${API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${credentials}`,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 300);
    if (response.status === 401) {
      // The single most likely cause, and the one the error text never names.
      throw new Error(
        `oauth 401: ${detail}\n` +
          `  These are ${clientId.source} credentials being used against the ` +
          `${ENVIRONMENT.toUpperCase()} API.\n` +
          "  Sandbox and live credentials are not interchangeable: a sandbox key\n" +
          "  against api-m.paypal.com fails exactly like this. Check that the id\n" +
          `  starting ${shortId.slice(0, 7)} is the one from the ` +
          `${ENVIRONMENT === "live" ? "Live" : "Sandbox"} toggle in the PayPal dashboard.`,
      );
    }
    throw new Error(`oauth ${response.status}: ${detail}`);
  }
  return (await response.json()).access_token;
}

async function get(path, accessToken) {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
  });
  if (!response.ok) {
    throw new Error(`${path} ${response.status}: ${(await response.text()).slice(0, 300)}`);
  }
  return response.json();
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
  console.log(`→ ${ENVIRONMENT} · ${value} ${CURRENCY}/month · ${API}${DRY_RUN ? "  [dry run]" : ""}`);
  console.log(`  ${clientId.name} = ${shortId} (${clientId.source})`);
  console.log(`  ${clientSecret.name} = ******** (${clientSecret.source})`);
  const accessToken = await token();
  console.log("✓ authenticated");

  // Reuse the product if one already exists under this name.
  //
  // A *plan* has to be new for a price change — plans are immutable in the ways
  // that matter — but a product is just a catalog entry, and PayPal has no way
  // to delete one. So a second run of this script used to strand a duplicate
  // product in the account forever, permanently, with nothing pointing at it.
  // (Written after doing exactly that.)
  const existing = await get("/v1/catalogs/products?page_size=20", accessToken);
  const found = (existing.products ?? []).find((candidate) => candidate.name === PRODUCT_NAME);

  if (DRY_RUN) {
    console.log(`✓ product ${found ? `${found.id} (would reuse)` : "(would create)"}`);
    console.log(`✓ plan (would create) — ${value} ${CURRENCY}/month, cancel any time\n`);
    console.log("Nothing was created. Drop --dry-run to do it for real.");
    return;
  }

  const product =
    found ??
    (await post(
      "/v1/catalogs/products",
      {
        name: PRODUCT_NAME,
        description: "התראות מיידיות על מכרזי קרקע, ללא הגבלה",
        type: "SERVICE",
        category: "SOFTWARE",
      },
      accessToken,
    ));
  console.log(`✓ product ${product.id}${found ? " (reused)" : ""}`);

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

  const site = process.env.NEXT_PUBLIC_SITE_URL ?? "https://deal-finder-il.vercel.app";

  console.log(`✓ plan ${plan.id}\n`);
  console.log("Set on Vercel (and .env.local for local testing):\n");
  console.log(`  PAYPAL_PLAN_ID=${plan.id}`);

  if (ENVIRONMENT === "live") {
    // Going live is not one variable. Every credential has a live counterpart,
    // and the plan and webhook ids created in sandbox do not exist here.
    console.log("  PAYPAL_ENV=live");
    console.log("  NEXT_PUBLIC_PAYPAL_CLIENT_ID=<the LIVE client id>");
    console.log("  PAYPAL_CLIENT_SECRET=<the LIVE secret>");
    console.log("  PAYPAL_WEBHOOK_ID=<the LIVE webhook id, created below>\n");
    console.log("  ⚠ NEXT_PUBLIC_* is inlined at BUILD time — setting it is not");
    console.log("    enough, the deployment has to be rebuilt afterwards.");
    console.log("  ⚠ PAYPAL_ENV=live also makes checkout visible to every visitor");
    console.log("    (the sandbox build shows it to admins only) and switches the");
    console.log("    pricing banner to its live wording.\n");
  } else {
    console.log("");
  }

  console.log("Then create the webhook at developer.paypal.com → Apps & Credentials →");
  console.log(`  your app (${ENVIRONMENT}) → Webhooks, pointing at:\n`);
  console.log(`  ${site}/api/webhooks/paypal\n`);
  console.log("  Subscribe it to: BILLING.SUBSCRIPTION.ACTIVATED, .CANCELLED, .SUSPENDED,");
  console.log("  .EXPIRED, .PAYMENT.FAILED and PAYMENT.SALE.COMPLETED");
  console.log("  then copy the webhook id into PAYPAL_WEBHOOK_ID.");
}

main().catch((error) => {
  console.error(`✗ ${error.message}`);
  process.exit(1);
});
