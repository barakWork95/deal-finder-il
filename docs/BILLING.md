# Billing — PayPal subscriptions

PRO is a monthly subscription (₪99, cancel any time), so this uses PayPal's
**Subscriptions** API, not Orders. Orders are for one-off payments; a recurring
charge needs a plan, and "ביטול בכל עת" needs something to cancel.

## The shape of it

```
browser                     our server                    PayPal
  │  press Subscribe            │                            │
  ├────────────────────────────>│  POST /v1/billing/subscriptions
  │                             ├───────────────────────────>│
  │                             │<───────────────────────────┤ id
  │                             │  write billing_subscriptions row  ← the mapping
  │<────────────────────────────┤  { id }
  │  approve inside PayPal ─────────────────────────────────>│
  │  onApprove                  │                            │
  ├────────────────────────────>│ /confirm → GET subscription│
  │                             │  (fast path, for the page) │
  │                             │<───────────────────────────┤
  │                             │                            │
  │                             │<─── BILLING.SUBSCRIPTION.ACTIVATED (webhook)
  │                             │  verify → claim → tier=pro │  ← the authority
```

The subscription is created **server-side**, not with the SDK's
`actions.subscription.create`. Two things follow, and both matter:

- `custom_id` (the payer's Clerk id) is set by code the page cannot influence,
  so a subscription cannot be attributed to someone else's account.
- The row mapping PayPal's id to a Clerk user exists **before** the payer
  approves, so no webhook can arrive about a subscription we cannot attribute.
  Payload fields differ by event type — `BILLING.SUBSCRIPTION.*` carry
  `custom_id`, `PAYMENT.SALE.COMPLETED` carries `billing_agreement_id` — and an
  account upgrade is a poor thing to hang on a payload shape. We look it up in
  our own table; `custom_id` is only a fallback.

`/confirm` is for latency, not correctness. The webhook decides.

## Security

The webhook handler sets `tier = 'pro'`. An unverified one is a public endpoint
for granting yourself a paid plan.

- **No `PAYPAL_WEBHOOK_ID`, no writes.** The handler answers 503 and does
  nothing — not "assume valid", not "log and continue".
- The signature is checked against the **raw bytes**, before the body is used.
  Re-serialising a parsed object can reorder keys and invalidate the signature.
- `cert_url` is checked against `*.paypal.com`. Unchecked, that header is an
  instruction to fetch the verification key from wherever the caller likes.
- Every event is **claimed before it is acted on** (`billing_events`, event id
  as primary key), so a redelivery cannot grant the same plan twice. A row left
  `failed` is re-claimable, because PayPal's retry is the recovery path and our
  own deduplication must not swallow it.

## Who wins when sources disagree

| Situation | Result |
| --- | --- |
| Payment activates | `tier=pro`, `tier_source=billing` — always |
| Renewal payment | Re-asserts PRO, so a missed ACTIVATED event self-heals monthly |
| Subscription cancelled/expired/suspended | Downgrade **only** if no other subscription is ACTIVE |
| …and the account was comped from `/admin` | **No downgrade.** `tier_source='admin'` is a decision a person made; a lapsed subscription is not grounds for reversing it |

## Currency

**ILS does not support decimals at PayPal** — "if you pass a decimal amount, an
error occurs". The plan is priced in whole shekels and `formatAmount()` rounds
for zero-decimal currencies. If you ever price something at ₪99.90, change
currency first. `PAYPAL_CURRENCY` and `PAYPAL_PRICE` are the knobs.

## Setup

```bash
npm run paypal:plan
```

Creates the product and plan, prints `PAYPAL_PLAN_ID`, and tells you which
webhook events to subscribe to. Then, in the PayPal dashboard: Apps &
Credentials → your app → Webhooks → add `https://<site>/api/webhooks/paypal`,
subscribed to `BILLING.SUBSCRIPTION.ACTIVATED`, `.CANCELLED`, `.SUSPENDED`,
`.EXPIRED`, `.PAYMENT.FAILED` and `PAYMENT.SALE.COMPLETED`. Copy the webhook id
into `PAYPAL_WEBHOOK_ID`.

Env vars are in `.env.example`. `PAYPAL_ENV` defaults to **sandbox**; `live`
has to be typed out.

## Testing in sandbox

1. Set the four variables in `.env.local` (`PAYPAL_ENV=sandbox`), run
   `npm run paypal:plan`, add the plan id.
2. Webhooks cannot reach localhost. Either point the webhook at a Vercel
   preview deployment, or tunnel (`cloudflared tunnel --url http://localhost:3000`)
   and register the tunnel URL. Without this, checkout completes and nobody
   becomes PRO — the `/confirm` fast path grants it, the webhook never lands,
   and you learn nothing about the path that matters in production.
3. Pay with a sandbox personal account from developer.paypal.com → Testing
   Tools → Sandbox Accounts.
4. Check `billing_events` for a `processed` row and `user_contacts.tier_source`
   = `billing`.

PayPal's webhook simulator does **not** work for verification — postback
verification is not supported for mock events, so a simulated event will always
fail the signature check. Test with a real sandbox subscription.

## Not done

- Free-tier limits (2 alerts, 3 saved) are still **not enforced** anywhere. The
  only thing PRO actually changes today is notification timing and WhatsApp,
  which the worker does gate on `tier`. The billing panel says so in as many
  words once checkout is live; if you enforce the limits later, that paragraph
  needs revisiting.
- No proration, no plan changes, no invoices/receipts page beyond what PayPal
  emails.
- No dunning: after three failed payments PayPal suspends the subscription and
  the webhook downgrades the account, but nobody is told why.
