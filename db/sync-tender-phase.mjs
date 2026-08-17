/**
 * Backfill/refresh submission_opens_at + source_status for tenders we already
 * have. `npm run db:sync-phase`
 *
 * Why this is separate from db:ingest:rami:
 *
 * Both facts come from the SEARCH endpoint, which returns all ~10,600 tenders
 * in one call. The ingester, though, needs the per-tender DETAIL endpoint for
 * plot geometry and prices, and skips a tender entirely when that call fails.
 * The portal is intermittently flaky — a run right after it recovered fetched
 * 136 of 470 details — so phase data we already held was left unwritten for
 * two thirds of the feed purely because a *different* endpoint was down.
 *
 * This pass needs one request, no detail calls, and is idempotent. Run it
 * after db:ingest:rami (like db:geocode), or on its own whenever the feed
 * looks stale: a tender crossing from טרם החל to פתוח להגשה is a change in
 * רמ"י's data, not in ours, and nothing else notices it.
 */

import postgres from "postgres";
import { getJson, warmSession, RAMI_API } from "./rami-http.mjs";

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  max: 3,
  idle_timeout: 20,
  prepare: false,
  onnotice: () => {},
});

/**
 * The portal's API tier goes down for stretches while the site itself keeps
 * serving — a valid session cookie still gets a 404 HTML page. `--file` lets a
 * sync run from a previously saved search response, which is enough because
 * every fact this script writes is a date: a snapshot an hour old derives the
 * same phase as a live one.
 */
async function fetchTenders() {
  const fileArg = process.argv.indexOf("--file");
  if (fileArg !== -1 && process.argv[fileArg + 1]) {
    const path = process.argv[fileArg + 1];
    console.log(`→ reading cached search response: ${path}`);
    const { readFileSync } = await import("node:fs");
    return JSON.parse(readFileSync(path, "utf8"));
  }

  console.log("→ warming session…");
  await warmSession();

  console.log("→ fetching tender list…");
  // Retries through the portal's flapping rather than failing the run; --file
  // remains the escape hatch for a window long enough to outlast the budget.
  return getJson(
    `${RAMI_API}/SearchApi/Search`,
    { method: "POST", body: "{}" },
    {
      label: "SearchApi/Search",
      attempts: 6,
      onRetry: ({ attempt, attempts, delay, reason }) =>
        console.log(`  retry ${attempt}/${attempts} in ${delay}ms — ${reason}`),
    },
  );
}

async function main() {
  const body = await fetchTenders();
  const tenders = Array.isArray(body) ? body : Object.values(body).find(Array.isArray);
  console.log(`  ${tenders.length} tenders in the feed`);

  // deals.id is `rami-<MichrazID>-<plotIndex>`, so one tender maps to many
  // rows. The feed carries ~10,600 tenders and we hold a few hundred, so this
  // is one bulk statement joined on the id prefix rather than a query per
  // tender: the latter is ten thousand round trips to Frankfurt for a few
  // hundred updates, which took minutes and hammered the pooler.
  const payload = tenders
    .filter((t) => t.PtichaDate || t.StatusMichraz != null)
    .map((t) => ({
      prefix: `rami-${t.MichrazID}-`,
      opensAt: t.PtichaDate ? new Date(t.PtichaDate).toISOString() : null,
      status: t.StatusMichraz ?? null,
    }));

  const rows = await sql`
    WITH feed AS (
      SELECT * FROM unnest(
        ${payload.map((p) => p.prefix)}::text[],
        ${payload.map((p) => p.opensAt)}::timestamptz[],
        ${payload.map((p) => p.status)}::smallint[]
      ) AS f(prefix, opens_at, source_status)
    )
    UPDATE deals d SET
      submission_opens_at = f.opens_at,
      source_status       = f.source_status,
      -- Badges are stored, so a tender that has since opened must lose the
      -- טרם החל chip here or the feed keeps showing it. Removing first makes
      -- the write idempotent across repeated runs.
      badges = CASE WHEN f.opens_at > now()
                 THEN array_append(
                        array_remove(array_remove(d.badges, 'not_started'), 'deadline_soon'),
                        'not_started')
                 ELSE array_remove(d.badges, 'not_started')
               END,
      last_updated_at = now()
    FROM feed f
    WHERE d.id LIKE f.prefix || '%'
    RETURNING d.id, (f.opens_at > now()) AS not_started`;

  const updated = rows.length;
  const notStarted = rows.filter((r) => r.not_started).length;
  console.log(`\n✓ updated ${updated} plot rows (${notStarted} טרם החל)`);

  const [summary] = await sql`
    SELECT count(*)::int AS active,
           count(submission_opens_at)::int AS with_opens_at,
           count(*) FILTER (WHERE submission_opens_at > now())::int AS not_started
    FROM deals WHERE status = 'active'`;
  console.log(
    `  active: ${summary.active} · with opening date: ${summary.with_opens_at} · טרם החל: ${summary.not_started}`,
  );

  await sql.end();
}

main().catch(async (error) => {
  console.error("✗", error.message);
  await sql.end();
  process.exit(1);
});
