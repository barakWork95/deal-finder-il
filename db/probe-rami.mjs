/**
 * The local control for the GitHub Actions reachability probe.
 * `npm run probe:rami`
 *
 * Runs exactly the same requests as .github/workflows/rami-reachability.yml,
 * from wherever you are. The Actions result is only interpretable next to
 * this one: the portal's API tier goes down for long stretches while the site
 * itself keeps serving 200, so a failure there means "we are blocked" only if
 * a probe from an Israeli IP succeeds at the same moment.
 *
 *   both JSON             → reachable from Actions; host the pipeline there
 *   local JSON, CI 404    → geo/IP restricted; ingestion stays on an IL IP
 *   both 404              → portal outage; inconclusive, re-run later
 *
 * Read-only: touches no database and needs no secrets.
 */

const BASE = "https://apps.land.gov.il/MichrazimSite";
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140 Safari/537.36";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};

const attempts = arg("attempts", 10);
const interval = arg("interval", 60);
const sleep = (s) => new Promise((r) => setTimeout(r, s * 1000));

async function probe() {
  const warm = await fetch(`${BASE}/`, { headers: { "User-Agent": UA } });
  const cookie = warm.headers.getSetCookie?.().join("; ") ?? "";
  console.log(`  site                 -> ${warm.status}`);

  const res = await fetch(`${BASE}/api/SearchApi/Search`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": UA,
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: "{}",
  });

  const text = await res.text();
  const isJson = res.ok && !text.trimStart().startsWith("<");
  console.log(`  SearchApi/Search     -> ${res.status} (${text.length} bytes)`);

  if (!isJson) return false;

  const rows = JSON.parse(text);
  const list = Array.isArray(rows) ? rows : Object.values(rows).find(Array.isArray);
  console.log(`  parsed tenders       -> ${list.length}`);

  const mid = list[0]?.MichrazID;
  const det = await fetch(`${BASE}/api/MichrazDetailsApi/Get?michrazID=${mid}`, {
    headers: { Accept: "application/json", "User-Agent": UA, ...(cookie ? { Cookie: cookie } : {}) },
  });
  console.log(`  MichrazDetailsApi    -> ${det.status} (tender ${mid})`);
  return true;
}

for (let i = 1; i <= attempts; i++) {
  console.log(`──────── attempt ${i}/${attempts} ────────`);
  try {
    if (await probe()) {
      console.log("\nVERDICT (local): REACHABLE.");
      process.exit(0);
    }
    console.log("  (HTML or non-200 — API tier down here too)");
  } catch (error) {
    console.log(`  request failed: ${error.message}`);
  }
  if (i < attempts) await sleep(interval);
}

console.log("\nVERDICT (local): NOT REACHABLE in this window — the portal's API is down.");
console.log("  A matching failure in Actions is therefore an outage, not a block.");
process.exit(1);
