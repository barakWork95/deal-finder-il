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
        // connection.
        //
        // `max` used to be 3, which deadlocked. A request that runs two
        // queries with Promise.all holds two slots at once, so two concurrent
        // signed-in page loads want four and the third connection is held by
        // a request waiting for a fourth that will never come free. Nothing
        // times out, so the pool stays wedged until the process restarts.
        // Keep headroom above 2 × the queries any single request fans out to.
        max: 10,
        idle_timeout: 20,
        // A connection that has been alive this long is replaced rather than
        // reused, so a socket the pooler quietly dropped cannot sit in the
        // pool forever pretending to be usable.
        max_lifetime: 60 * 30,
        // Never block a render waiting for a socket that is not coming.
        connect_timeout: 10,
        prepare: false,
        onnotice: () => {},
      })
    : (null as unknown as ReturnType<typeof postgres>));

if (process.env.NODE_ENV !== "production") globalThis.__sql = sql;
