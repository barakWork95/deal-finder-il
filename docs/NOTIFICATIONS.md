# Notification engine — email + WhatsApp

How a newly ingested רמ"י tender turns into a message, what has to be
configured for that to happen, and how to check it without mailing anybody.

## The shape of it

```
db/ingest-rami.mjs ──► deals.first_seen_at = now()
                              │
        cron ─► /api/cron/notifications?mode=instant|digest
                              │
                 lib/notifications/worker.ts
                    │  listDealsSince(lookback)      ← new tenders
                    │  listRecipients()              ← active user_alerts + contacts
                    │  matchesAlert(deal, alert)     ← the SAME function the feed uses
                    │  claimDeliveries(...)          ← the dedup ledger, written FIRST
                    ▼
        email.ts (Resend)          whatsapp.ts (Twilio | Green API)
                    │
                    ▼
        markDeliveries(sent | failed) · notification_runs
```

Files:

| Path | What it owns |
| --- | --- |
| `src/lib/notifications/config.ts` | every env var, read in one place |
| `src/lib/notifications/email.ts` | Resend transport |
| `src/lib/notifications/whatsapp.ts` | Twilio / Green API transport |
| `src/lib/notifications/templates.ts` | Hebrew RTL bodies for both channels |
| `src/lib/notifications/repository.ts` | contacts, delivery ledger, run log |
| `src/lib/notifications/worker.ts` | matching, tiering, batching, retries |
| `src/app/api/cron/notifications/route.ts` | the trigger |
| `src/app/api/notifications/unsubscribe/route.ts` | one-click unsubscribe |
| `db/011_notifications.sql` | `user_contacts`, `notification_deliveries`, `notification_runs` |

## Environment variables

Nothing here is required for the app to build or run. With none of it set the
worker still matches tenders against alerts and reports what it *would* have
sent — which is how it should be tested first.

### Required before anything actually sends

| Variable | Notes |
| --- | --- |
| `NOTIFICATIONS_ENABLED` | Master switch, default `false`. Leave it off until a provider is verified. |
| `CRON_SECRET` | Protects the cron route. Vercel sends it automatically as `Authorization: Bearer` once the variable exists on the project. **In production the route refuses to run without it.** |
| `DATABASE_URL` | Already set. Migration `011` must be applied. |

### Email (Resend)

| Variable | Notes |
| --- | --- |
| `RESEND_API_KEY` | `re_...` |
| `NOTIFY_EMAIL_FROM` | e.g. `קרקעHOT <alerts@karkahot.co.il>`. The domain must be verified in Resend (SPF + DKIM), or every send fails 403. |
| `NOTIFY_EMAIL_REPLY_TO` | Optional. |

### WhatsApp (pick one)

| Variable | Notes |
| --- | --- |
| `WHATSAPP_PROVIDER` | `twilio` or `green`. Unset = channel off. |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | Official Business API. |
| `TWILIO_WHATSAPP_CONTENT_SID` | **Read this before choosing Twilio.** An alert *starts* a conversation, and Meta only allows that with a pre-approved template. Without a Content SID, messages reach the Twilio sandbox and people who wrote to us in the last 24h — nobody else. Template approval takes days. |
| `GREEN_API_INSTANCE_ID` / `GREEN_API_TOKEN` / `GREEN_API_URL` | Green API drives a real WhatsApp account: no template approval, works immediately, and is unofficial — fine for staging, a business decision for production. |

### Tuning (all optional, defaults in `config.ts`)

| Variable | Default | Meaning |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | production alias | Origin for links inside messages. |
| `NOTIFY_INSTANT_LOOKBACK_HOURS` | `26` | How far back an instant run looks. |
| `NOTIFY_DIGEST_LOOKBACK_HOURS` | `72` | Wider, so a missed day still lands. |
| `NOTIFY_FREE_DELAY_HOURS` | `24` | The free tier's delay — the product's main upgrade lever. |
| `NOTIFY_MAX_ITEMS_PER_MESSAGE` | `5` | Rest becomes "ועוד N". |
| `NOTIFY_MAX_SENDS_PER_RUN` | `200` | Safety cap per invocation. |
| `NOTIFY_MAX_ATTEMPTS` | `3` | Retries of a *retryable* failure. |
| `NOTIFY_PRO_USER_IDS` | — | Comma-separated Clerk ids granted PRO by hand. Billing is not live, so this is the only way the instant path runs at all. |

## Tiering

| | Free | PRO |
| --- | --- | --- |
| Email | daily digest, delayed by `NOTIFY_FREE_DELAY_HOURS` | instant, per alert |
| WhatsApp | — | instant |

A free account's `instant` alert is not dropped by the instant run — it is left
for the digest, which is exactly what the pricing table promises. A free
account whose alert only asked for WhatsApp still gets the digest email:
silence would be a worse answer.

## Scheduling

`vercel.json` carries the **digest** cron only:

```json
{ "path": "/api/cron/notifications?mode=digest", "schedule": "0 5 * * *" }
```

05:00 UTC = 08:00 in Israel during IDT, 07:00 in winter. Vercel crons are UTC
and there is no per-project timezone.

The **instant** run is triggered hourly by `.github/workflows/notifications.yml`
instead, because **Vercel's Hobby plan runs cron jobs once per day** — enough
for a digest, useless for instant alerts. The workflow needs two repository
secrets (`NOTIFY_CRON_URL`, `NOTIFY_CRON_SECRET`) and skips itself cleanly
without them. On a Vercel Pro plan, delete the workflow and add:

```json
{ "path": "/api/cron/notifications?mode=instant", "schedule": "0 * * * *" }
```

## Testing it without mailing anyone

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  "$SITE/api/cron/notifications?mode=both&dryRun=1"
```

A dry run matches, batches and reports every message it would send, and writes
**nothing** — no ledger rows, no run log. Configuration state and the last five
runs:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" "$SITE/api/cron/notifications?status=1"
```

Asking for a real run while no provider is configured downgrades to a dry run
rather than marking everything failed.

## Rules the implementation depends on

- **Nothing sends twice.** `notification_deliveries` has `(alert_id, deal_id,
  channel)` as its primary key, and the row is claimed *before* the provider is
  called. Two overlapping cron runs cannot both win the insert. This is why a
  cron that fires more often than intended is harmless.
- **A skipped send releases its claim.** "WhatsApp is not configured yet" must
  not consume the one chance that tender had; a *failed* send keeps the row so
  it can be retried, a *skipped* one deletes it.
- **Non-retryable failures are not retried.** A 401 or a malformed address
  fails identically forever; only 429 and 5xx come back.
- **Missing configuration degrades, never throws.** Same contract as
  `hasDb` in the repository and `isAuthConfigured()` for Clerk. A forgotten env
  var on a preview deploy must not turn the cron route into a 500.
- **Matching is `matchesAlert`** — the function the feed and the alert cards
  already use. If the message and the "נמצאו N מכרזים תואמים" count on the card
  disagreed, the product would be lying about its own filters.
- **Wording.** Messages say **עלות כניסה**, **פער משומה**, **שומה רשמית**, and
  carry the caveat that רמ"י tenders are competitive and final prices exceed the
  opening minimum. Never "discount" — the median winning bid runs +369% above
  the minimum.

## Where addresses come from

`user_contacts` (migration 011), written by the account form through
`saveContactAction`. Email falls back to the verified address on the Clerk
profile, so alerts work without anyone retyping it; the phone number has to be
entered, and entering it is the WhatsApp opt-in (clearing it withdraws consent).
Every message carries an unsubscribe link backed by a per-account random token,
which works without a session — an unsubscribe link that demands a login gets
replaced by a spam report.

## Not done yet (Step 2 candidates)

- Tier comes from `user_contacts.tier` / `NOTIFY_PRO_USER_IDS`. Real billing
  (PayPal) still has to write that column.
- `AlertsPanel` shows `triggeredThisMonth: 0` — the count is in the ledger now
  and could be read for real.
- No admin view over `notification_runs`; `?status=1` is the whole story.
- Quiet hours / per-alert send caps do not exist. A broad alert on a heavy
  ingestion day can produce several WhatsApp messages in an hour.

## The pipeline that feeds this

`.github/workflows/pipeline.yml` runs `ingest → sync-phase → geocode →
refresh-premium → notify` on GitHub-hosted runners. A reachability probe
(`.github/workflows/rami-reachability.yml`, local control `npm run probe:rami`)
confirmed a Wyoming runner pulls all 10,612 tenders on the first attempt —
there is no geo-fence, so none of this needs an Israeli IP.

**Two schedules.** Hourly is incremental: the search endpoint lists every
tender in one call, so only genuinely new or status-changed ones cost a
per-tender detail fetch. Nightly (02:40 UTC) is a full pass that refreshes
prices, deadlines and appraisals, then the winning-premium signal. A full pass
is ~470 detail calls; hourly that would be 11,000 requests a day at a
government portal.

**The portal flaps on a minutes timescale** — 404 → 200 → 404 → 200 inside ten
minutes, identically from curl and Node, cookie or not. It is not an outage to
wait out, so every call goes through `db/rami-http.mjs`, which retries with
exponential backoff and jitter. The flap signature is an **HTML body**, not a
status code: during a window the API answers 404 with the SPA error page, so
anything that should be JSON and starts with `<` is retried, while a real 4xx
with a JSON body is not. Adding this took a run from **244 failed detail
fetches to 0**.

**`rami_tenders_seen` (migration 013) is what keeps the hourly run cheap.**
Most active tenders produce no `deals` rows at all — apartment tenders, no
minimum price, aggregate areas the parser rejects — so "is it in `deals`?" would
mark ~376 tenders permanently new and re-fetch them every hour. The table
records the examination, including `plots = 0`.

Secrets: `DATABASE_URL`, `NOTIFY_CRON_URL`, `NOTIFY_CRON_SECRET`. Missing ones
make steps skip rather than fail — a half-configured pipeline should be quiet,
not a red X every hour. The old standalone `notifications.yml` was folded in as
this workflow's notify step.
