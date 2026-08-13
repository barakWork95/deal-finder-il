<img src="public/brand/karkahot-logo.png" alt="קרקעHOT" width="260">

# קרקעHOT — מכרזי קרקע ומגרשים בישראל

Hebrew-first, RTL PropTech platform that aggregates Israeli real-estate
opportunities (foreclosures / כונסי נכסים, רמ״י tenders, price drops), benchmarks
them against historical tax-authority transactions (נדל״ן-נט), computes a **Deal
Score**, and sends alerts.

Stack: **Next.js 16** (App Router) · **React 19** · **Tailwind v4** · **Postgres**
(local now, **Supabase**-ready) with `earthdistance` proximity (PostGIS optional).

---

## Quick start

```bash
npm install
cp .env.example .env.local        # set DATABASE_URL
npm run db:reset                  # migrate + seed (needs psql on PATH)
npm run dev                       # http://localhost:3000
```

Pages: `/` deal feed · `/deal/[id]` deal detail (CMA + ROI calculator) · `/alerts`.

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

## CI

`.github/workflows/ci.yml` runs `npm ci`, `npm run lint` and `npm run build` on
every push and pull request. It needs **no secrets**: without `DATABASE_URL` the
repository layer falls back to mock data, and every page that reads tenders is
`force-dynamic`, so nothing touches Postgres at build time.

## Auth (Clerk) — prepared, not switched on

`src/components/AuthProvider.tsx` wraps the app and is a pass-through today.
`@clerk/nextjs` is deliberately **not** installed: `ClerkProvider` throws
without a publishable key, so wrapping the app before the keys exist would break
production rather than prepare it. That file carries the full switch-on
checklist (install, env vars, middleware, header buttons); Google and email
sign-in are enabled in the Clerk dashboard, not in code.

Until then the personal area is per-browser — alerts, saved deals and profile
live in `localStorage` (`src/lib/client-store.ts`). Accounts are what will let
that data follow a user across devices, and what makes actually *sending* an
alert possible.

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
