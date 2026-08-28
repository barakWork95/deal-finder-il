<img src="public/brand/karkahot-logo.png" alt="קרקעHOT" width="260">

# קרקעHOT — Israeli land-tender intelligence

A Hebrew-first, RTL PropTech platform that aggregates Israeli land
opportunities — רמ״י tenders, foreclosures (כונסי נכסים), price drops — scores
them against real historical transaction data, and tells you which ones are
actually worth bidding on.

**Live:** https://deal-finder-il.vercel.app · **Status:** archived, feature-complete

> Built solo as a full-stack product, not a demo: real ingestion from government
> sources, a real Postgres schema, real auth, real subscription billing, and a
> paid analytics tier with a gate that holds up to a network tab.

---

## What it does

Israeli land tenders are published as raw tables of numbers. The opening bid is
not the price you pay, the "discount" is not a discount, and roughly half of
what is listed cannot be bid on today. This app turns that into something a
buyer can scan.

- **~355 live tenders**, ingested from the Israel Land Authority portal and
  benchmarked against genuine tax-authority comparables.
- **A Deal Score (0–100)** per plot, from the gap to the official appraisal
  (שומה), rezoning upside, and submission urgency.
- **An honest gap.** `asking_price` is the minimum bid **plus** development
  costs, and the headline number is a gap versus appraisal — never presented as
  a guaranteed discount, because tenders are competitive and winning bids land
  higher.

## Key features

### Progressive-disclosure UI
The feed opens on cards carrying four things — where the plot is, how it
scores, what it costs, and the single strongest reason to look closer. Filters
collapse to one row and summarise themselves when active. Clicking a tender
opens it **over** the feed, led by a verdict panel (the score, the three
numbers behind it, and why it is worth the time) with the deep analysis behind
tabs.

The drawer is a Next.js **parallel + intercepting route**, not a client modal,
so `/deal/[id]` remains a real URL: shareable, refreshable, and fully rendered
without JavaScript.

### Tender feed
Card, table and map views over the same filtered set. Filters for city, budget,
gap to appraisal, Deal Score, tender phase and deal type — with phase derived
from the dates at render time rather than a stored flag that would go stale.
Full-text search across city, area and גוש/חלקה. Any filter combination can be
saved directly as an alert.

### PRO analytics, and a gate that actually holds
The paid feature is the **winning-premium projection**: how much past winners
in the same city and zoning paid over the minimum bid, and what that implies
this plot will actually cost.

The interesting part is the gate. Every surface that could serve the projection
**strips it server-side before it reaches the client**, because a value merely
*styled* as locked is still sitting in the RSC payload for anyone who opens
devtools. Free accounts still see the basis of the calculation — minimum bid,
appraisal, sample size — so the offer is legible, but the two numbers that are
the product never leave the server. The client components that render the
drawer and its tabs are deliberately shells: they receive markup and never see
a `Deal`.

### Alerts, billing, admin
Saved searches deliver over **WhatsApp and email**, including a second message
when a not-yet-open tender starts accepting bids. **PayPal subscriptions** for
PRO, with webhook signatures verified locally rather than trusting the
callback's own `SUCCESS`. An `/admin` dashboard covering users, plans,
ingestion failures and a conversion funnel.

### Map
Leaflet view of every geocoded plot. The tender API carries no coordinates, so
plots are resolved via their גוש/חלקה against the national parcel layer;
`geo_precision` records whether a pin is a true parcel centroid or a settlement
fallback, and the map labels the latter as approximate rather than passing it
off as the plot.

## Tech stack

| Layer | Choice |
|---|---|
| Framework | **Next.js 16** (App Router, RSC, parallel + intercepting routes) |
| Language | **TypeScript** (strict) |
| UI | **React 19**, **Tailwind CSS v4**, lucide-react, RTL Hebrew-first |
| Database | **PostgreSQL** (Supabase in production) |
| DB access | **postgres.js** — raw tagged-template SQL, no ORM |
| Migrations | 18 hand-written `.sql` files in `db/`, applied via `psql` |
| Auth | **Clerk** (Google + email), fully optional at runtime |
| Billing | **PayPal** subscriptions with self-verified webhooks |
| Maps | **Leaflet** + open national parcel data |
| Hosting | **Vercel** (production + per-branch previews) |
| CI | GitHub Actions — lint, tests, build on every PR |

There is **no ORM**. Queries are written as SQL through `postgres.js`, and
`src/lib/types.ts` mirrors the schema by hand. Tests are `node --test`.

## Running locally

Requires Node 20+ and, optionally, `psql` on your PATH.

```bash
git clone https://github.com/barakWork95/deal-finder-il.git
cd deal-finder-il
npm install
cp .env.example .env.local
npm run dev                       # http://localhost:3000
```

**It runs with no configuration at all.** With no `DATABASE_URL`, the
repository layer falls back to in-memory mock tenders; with no Clerk keys,
`isAuthConfigured()` disables every auth touchpoint and the header shows an
inert avatar. Nothing crashes, nothing blanks — you get a browsable app
immediately. This is also why CI needs no secrets.

For the full dataset:

```bash
# set DATABASE_URL in .env.local first
npm run db:reset                  # migrate + seed
npm run db:ingest:rami            # live tenders from the Israel Land Authority
npm run db:geocode                # resolve גוש/חלקה → coordinates for the map
```

Checks:

```bash
npm run lint
npm test
npm run build
```

Routes: `/` feed · `/deal/[id]` tender detail · `/alerts` · `/account` · `/admin`.

## Engineering notes worth reading

A few decisions in this codebase are documented at length in the source, where
the reasoning matters more than the code:

- `src/app/page.tsx` — why the PRO fields are stripped from the payload rather
  than hidden in the component.
- `src/components/DealDetailBody.tsx` — why the tender's deep view is a server
  component, and what breaks if it is not.
- `src/components/DealDrawer.tsx` — why "open in full page" is a plain `<a>`
  and not a `<Link>`.
- `src/lib/limits.ts` — why an unknown plan falls back to the free *plan* and
  not a free *value* (a `??` here once held every PRO account to the free
  limits).
- `src/lib/tender-phase.ts` — why a tender's phase is derived from the clock at
  render time instead of stored.

## Data layer

The app reads through `src/lib/repository.ts`. If `DATABASE_URL` is set it queries
Postgres; otherwise it falls back to in-memory mock data (`src/lib/mock-data.ts`).
Types in `src/lib/types.ts` mirror the SQL schema exactly.

```
db/001_schema.sql     tables (deals, historical_transactions, users, alerts, …)
db/002_functions.sql  get_comps() + area_avg_price_per_sqm()  (portable, earthdistance)
db/003_postgis.sql    OPTIONAL — native PostGIS geometry (run on Supabase only)
db/seed.mjs           seeds REAL Holon transactions + demo opportunities
db/ingest-nadlan.mjs  live ingestion from nadlan.gov.il (see caveat below)
```

### Provenance
`sources.is_real` distinguishes **real** data (the נדל״ן-נט historical
transactions) from **demo** opportunities. The current deal listings are
illustrative; the historical comps for the Holon area (גוש 7166) are genuine
records captured from the gov API.

## Real data: רמ"י land tenders

`db/ingest-rami.mjs` pulls **live land tenders** from the Israel Land Authority
portal (`apps.land.gov.il/MichrazimSite`). Endpoints were discovered by
inspecting the portal's own XHR calls:

| Step | Endpoint | Gives |
|---|---|---|
| 1 | `GET /MichrazimSite/` | session cookie (**required**) |
| 2 | `GET /api/GeneralTablesApi` | code→Hebrew lookups (ייעוד, סוג מכרז, סטטוס) |
| 3 | `GET /api/YeshuvimApi/Get` | settlement code → city name (1,421) |
| 4 | `POST /api/SearchApi/Search` `{}` | every tender (~10.6k, all years) |
| 5 | `GET /api/MichrazDetailsApi/Get?michrazID=N` | per-plot area, prices, גוש/חלקה |

All calls need `Accept: application/json` or the portal returns an HTML error page.

```bash
npm run db:ingest:rami              # active tenders only (~466 → ~335 plots)
npm run db:ingest:rami -- --limit 20
```

**Pricing model (important).** `MechirSaf` is only the *opening minimum bid*; the
winner also pays `HotzaotPituach` (development costs). So the stored
`asking_price` = **minimum bid + development costs**, and `est_market_value` =
`mechirShuma` (the official appraisal, שומה). The gap between them is what the
UI shows — it is a gap vs. appraisal, **not** a guaranteed discount, since
tenders are competitive and final prices land higher.

## Geocoding (map view)

The רמ"י tender API carries no coordinates, so `db/geocode-deals.mjs` resolves
each plot's גוש/חלקה against the open national parcel layer published by מרכז
למיפוי ישראל (`open.govmap.gov.il/geoserver/opendata/wfs`, layer
`opendata:PARCEL_ALL`) and stores the parcel polygon's centroid. Settlement
centroids from OSM Nominatim are the fallback, and `deals.geo_precision`
records which of the two a row got — the map labels settlement-level pins as
approximate rather than passing them off as the plot.

```bash
npm run db:geocode              # only rows still missing coordinates
npm run db:geocode -- --all     # re-geocode everything
```

Run it after `db:ingest:rami`, otherwise new tenders won't appear on the map.
Lookups are cached in `db/data/geo_parcels.json` / `geo_cities.json`, so a
re-run is nearly offline. A parcel that resolves more than 30 km from its
settlement is rejected as a bad גוש match and falls back to the settlement.

## CI & branching

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint`, `npm test` and
`npm run build` on every pull request and on pushes to `main` and `staging`. It needs **no
secrets**: without `DATABASE_URL` the repository layer falls back to mock data,
auth is guarded by `isAuthConfigured`, and every page that reads tenders is
`force-dynamic`, so nothing touches Postgres at build time.

Work flows `feature → staging → main`; `main` is Production on Vercel and every
other branch gets a Preview. **Preview needs its own copy of the environment
variables** or it silently serves mock data with no sign-in — see
[docs/BRANCHING.md](docs/BRANCHING.md) for the flow, the variables, and how to
enforce it once branch protection is available on this repo.

## Auth (Clerk)

Sign-in is Clerk (Google + email), wired through `src/components/AuthProvider.tsx`,
`src/components/AuthButtons.tsx` and `src/proxy.ts` (Next 16 renamed the
`middleware` convention to `proxy`).

**Every Clerk touchpoint is guarded by `isAuthConfigured()`** (`src/lib/auth.ts`),
which checks `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`. Without the key the app runs
exactly as it did before auth: the header shows an inert avatar, the proxy skips
Clerk, and `/api/user/sync` answers `501 auth_not_configured`. That keeps CI,
forks and local previews working without secrets — and means a missing variable
degrades to "no sign-in" instead of a blank site.

```bash
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...   # pk_live_... in production
CLERK_SECRET_KEY=sk_test_...                    # sk_live_... in production
```

Set both in `.env.local` **and** in Vercel → Settings → Environment Variables.
Google, email and the application name shown in the sign-in modal are configured
in the Clerk dashboard, not in code.

### Local data → account

The personal area starts per-browser: alerts, saved deals and profile live in
`localStorage` (`src/lib/client-store.ts`). On the first sign-in in a given
browser, `src/components/personal/UserSync.tsx` posts that data to
`POST /api/user/sync`, which merges it into `user_alerts` / `user_saved_deals`
(`db/010_user_data.sql`) and returns the union, which the client then adopts.

The merge never replaces: signing in on a second device with different local
data adds to the account rather than overwriting the first device. Alerts upsert
by id (re-syncing the same browser is a no-op) and saved ids that no longer
match a live tender are dropped. `GET /api/user/sync` returns the account's
current data.

## Scheduled backfill job (macOS)

Historic comps are backfilled by a launchd agent that retries every 2 hours
until it succeeds, then becomes a no-op:

```bash
npm run backfill:stage          # sync the job's staging copy from this repo
cp scripts/com.dealfinder.backfill.plist ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.dealfinder.backfill.plist
```

Status / logs / removal:

```bash
launchctl list | grep dealfinder                                  # 2nd column = last exit code
tail -f ~/Library/Application\ Support/deal-finder/backfill.log
launchctl bootout gui/$(id -u)/com.dealfinder.backfill            # stop it
```

**Why it runs from `~/Library/Application Support/deal-finder` and not this
repo:** macOS TCC blocks launchd-spawned processes from reading
`~/Desktop`/`~/Documents` (`Operation not permitted`). Staging the job outside
those directories avoids having to grant Full Disk Access to `/bin/bash`.
`npm run backfill:stage` re-syncs the staged copy — run it after editing
`db/ingest-land-comps.mjs` or rotating `DATABASE_URL`. The staged copy includes
`.env.local` (mode `600`).

## ⚠️ The real gate: data access

- **nadlan.gov.il / רשות המסים is geo-blocked to Israeli IPs.** From outside
  Israel its REST API 302-redirects to `?view=status` and returns nothing. Run
  `db:ingest` from an Israeli IP or egress proxy. The field mapping is already
  correct (see `db/data/nadlan_holon_real.json` for the real response shape).
- **data.gov.il does NOT host the transactions dataset** — only tangential
  registries (appraisers, etc.).
- Confirm each source's ToS / Israeli data-protection rules before scaling
  automated ingestion. Prefer official open data where it exists.

## Switching to Supabase

1. Create a Supabase project; copy the connection string (Settings → Database →
   URI). Use the **pooled** connection (`:6543`) for Vercel/serverless.
2. Put it in `.env.local` as `DATABASE_URL`.
3. Run migrations against it:
   ```bash
   DATABASE_URL="<supabase-uri>" npm run db:migrate
   DATABASE_URL="<supabase-uri>" npm run db:postgis   # enable native PostGIS
   DATABASE_URL="<supabase-uri>" npm run db:seed
   ```

No app code changes — the repository layer is provider-agnostic.
