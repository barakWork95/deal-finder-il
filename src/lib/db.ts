import postgres from "postgres";

// Single Postgres client. Works against local Postgres now and Supabase later —
// just point DATABASE_URL at your Supabase connection string. If DATABASE_URL is
// unset, the repository falls back to in-memory mock data.
declare global {
  var __sql: ReturnType<typeof postgres> | undefined;
}

export const hasDb = Boolean(process.env.DATABASE_URL);

export const sql =
  globalThis.__sql ??
  (process.env.DATABASE_URL
    ? postgres(process.env.DATABASE_URL, {
        // Supabase's transaction pooler (:6543) is pgbouncer in transaction
        // mode — it cannot hold named prepared statements across a pooled
        // connection, and serverless wants a small pool.
        max: 3,
        idle_timeout: 20,
        prepare: false,
        onnotice: () => {},
      })
    : (null as unknown as ReturnType<typeof postgres>));

if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
