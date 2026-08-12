# מאתר עסקאות נדל״ן — Deal Finder IL

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
