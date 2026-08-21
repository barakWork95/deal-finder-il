# לוח בקרה — the admin dashboard (`/admin`)

One internal page that answers, in order: who is using this, is anyone trying
to pay, did the alerts go out, is the pipeline still feeding it. Everything on
it is a live query — nothing is cached.

## Getting in

Access is `ADMIN_USER_IDS`: a comma-separated list of Clerk user ids, read on
the server (`src/lib/admin.ts`).

```bash
ADMIN_USER_IDS=user_3Hrkt0YemnQrC4LXdwMY5VvZyoP
```

- **Unset in production → nobody gets in.** The route answers `notFound()`, so
  to everyone else `/admin` is not a route rather than a forbidden one.
- **Unset in local development → open**, so the page can be worked on without
  Clerk. The dashboard says so in a banner; it is not a mode production can
  reach, because the check is on `NODE_ENV`.
- There is deliberately **no admin flag in the database**. A column that grants
  access to everyone else's data is one careless `UPDATE` away from being set.

Every server action re-checks the session independently (`currentAdminId()`).
A server action is a public POST endpoint with an unguessable name, not a
private function — "the button is only rendered for admins" is not access
control.

## PRO is a database column now

`user_contacts.tier` is **the source of truth** for who is PRO, and the
dashboard's toggle is what sets it. `db/017_admin.sql` adds the provenance
around it: `tier_source`, `tier_updated_at`, `tier_set_by`, `tier_note`.

`NOTIFY_PRO_USER_IDS` is **deprecated**. It survives only as a one-way
bootstrap (`syncLegacyProGrants`, called at the top of a non-dry notification
run) so the changeover does not downgrade whoever it was carrying. It can never
overrule the dashboard: the upsert skips any row whose `tier_source` is
`'admin'`.

To retire it completely:

1. Open `/admin`, confirm the people listed as PRO are the ones you expect.
2. Delete `NOTIFY_PRO_USER_IDS` from Vercel (all environments) and `.env.local`.
3. Delete `notificationSettings.proUserIds` and `syncLegacyProGrants`, and the
   two lines in `worker.ts` that call them.

## Product events

`POST /api/events` is **open to unauthenticated visitors on purpose**. The
event the product most needs to count — someone pressing "upgrade" — usually
happens before that person has an account, so requiring a session would erase
exactly the population the pricing question is about.

What replaces the session as a defence (`src/lib/event-repository.ts`):

| Guard | What it stops |
| --- | --- |
| Allowlisted names (`EVENT_NAMES` in `src/lib/events.ts`) | Arbitrary rows written by anyone who finds the endpoint |
| Props rebuilt key by key: ≤12 keys, scalars only, 200 chars | The props column becoming a payload dump |
| Rate limit, 30/min per subject+event | A stuck retry loop or a held-down button |
| `dedupe_key` = hash(name, subject, 10-min bucket), unique | The same intention counted twice, across instances |
| No CORS headers | Cross-origin pages posting at all |

The endpoint answers **202 for anything it accepted or deliberately dropped**.
A tracking call that returns an error status teaches the browser to retry, and
a retry storm on the analytics endpoint is a self-inflicted outage. The one
exception is an unknown event name → 400, because that means a call site and
the allowlist have drifted and it should be loud in development.

No IP address is stored. The subject falls back to the caller's IP only to
build the (hashed) dedupe key, and a signed-out visitor is identified by an
`anon_id` their own browser generated and can clear.

### Adding an event

1. Add the name to `EVENT_NAMES` and a Hebrew label to `EVENT_LABEL`
   (`src/lib/events.ts`) — the dashboard renders whatever is in that list.
2. Call `trackEvent("name", { …facets })` from the call site. It is
   fire-and-forget, uses `sendBeacon`, and never throws: tracking must never
   affect the thing it is tracking.
3. Pass `{ once: true }` for anything that fires on mount, or React's
   development double-invoke counts it twice.

## Deploying this

The dashboard degrades per section, so a deploy that lands before the migration
shows a banner naming the missing migration instead of a 500. Still, do both:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f db/017_admin.sql
```

- [ ] `db/017_admin.sql` applied to Supabase (it is in `npm run db:migrate` too)
- [ ] `ADMIN_USER_IDS` set on Vercel — Production **and** Preview, since env
      vars are per-environment and a preview without it 404s the page
- [ ] `/admin` opens for you and 404s in a signed-out browser
