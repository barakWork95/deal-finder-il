// Geocode land deals so they can be plotted on the map view.
//
// The רמ"י tender API carries NO coordinates — only גוש/חלקה and a settlement
// name. Two open sources fill that in:
//
//   1. PARCEL-LEVEL (preferred): the national cadastral parcel layer published
//      by מרכז למיפוי ישראל as an open WFS —
//      https://open.govmap.gov.il/geoserver/opendata/wfs, layer
//      `opendata:PARCEL_ALL` (attributes GUSH_NUM / GUSH_SUFFI / PARCEL).
//      We take the area-weighted centroid of the parcel polygon.
//   2. SETTLEMENT-LEVEL (fallback): OSM Nominatim, one request per city,
//      cached in db/data/geo_cities.json so a re-run is offline.
//
// Provenance is written to deals.geo_precision ('parcel' | 'city') — the UI
// must not present a town centroid as if it were the plot.
//
// גוש format note: רמ"י writes a sub-גוש as one concatenated number
// (10022201 = גוש 100222 / תת-גוש 01). We try the value as-is first, then
// split off the last two digits as GUSH_SUFFI.
//
// Usage:
//   DATABASE_URL=... node db/geocode-deals.mjs            # only missing coords
//   DATABASE_URL=... node db/geocode-deals.mjs --all      # re-geocode everything
//   DATABASE_URL=... node db/geocode-deals.mjs --limit 20
import postgres from "postgres";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CITY_CACHE = join(HERE, "data", "geo_cities.json");
const PARCEL_CACHE = join(HERE, "data", "geo_parcels.json");

const WFS = "https://open.govmap.gov.il/geoserver/opendata/wfs";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "deal-finder-il/0.1 (Israeli land-tender research; barackv95@gmail.com)";

const args = process.argv.slice(2);
const ALL = args.includes("--all");
const LIMIT = args.includes("--limit") ? Number(args[args.indexOf("--limit") + 1]) : Infinity;

// A parcel centroid further than this from its settlement centroid means we
// matched the wrong גוש (numbers repeat across registration blocks in the
// data רמ"י publishes); fall back to the settlement instead of lying.
const MAX_KM_FROM_CITY = 30;

const sql = postgres(process.env.DATABASE_URL || "postgres://localhost/deal_finder", {
  prepare: false,
  onnotice: () => {},
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadCache(path) {
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return {};
  }
}
const cityCache = loadCache(CITY_CACHE);
const parcelCache = loadCache(PARCEL_CACHE);
const saveCache = (path, obj) => writeFileSync(path, JSON.stringify(obj, null, 0) + "\n");

async function getJson(url, attempts = 3) {
  for (let a = 1; a <= attempts; a++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.ok) {
        const text = await res.text();
        if (text.trim().startsWith("{") || text.trim().startsWith("[")) return JSON.parse(text);
      }
    } catch {
      /* network hiccup — retried below */
    }
    if (a < attempts) await sleep(600 * a);
  }
  return null;
}

/** Haversine distance in km. */
function distKm(a, b) {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Area-weighted centroid (shoelace) of a GeoJSON ring of [lng, lat] pairs. */
function ringCentroid(ring) {
  let twiceArea = 0;
  let x = 0;
  let y = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x0, y0] = ring[j];
    const [x1, y1] = ring[i];
    const f = x0 * y1 - x1 * y0;
    twiceArea += f;
    x += (x0 + x1) * f;
    y += (y0 + y1) * f;
  }
  if (twiceArea === 0) {
    // Degenerate ring — plain average is close enough for a map pin.
    const avg = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return { lng: avg[0] / ring.length, lat: avg[1] / ring.length };
  }
  return { lng: x / (3 * twiceArea), lat: y / (3 * twiceArea) };
}

/** Largest outer ring of a (Multi)Polygon, then its centroid. */
function geometryCentroid(geom) {
  if (!geom) return null;
  const polys = geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates];
  let best = null;
  for (const poly of polys) {
    const ring = poly?.[0];
    if (!ring || ring.length < 3) continue;
    if (!best || ring.length > best.length) best = ring;
  }
  return best ? ringCentroid(best) : null;
}

/** גוש variants to try, widest match first: as-is, then 6+2 sub-גוש split. */
function gushVariants(gush) {
  const digits = String(gush ?? "").replace(/\D/g, "");
  if (!digits) return [];
  const out = [{ num: Number(digits) }];
  if (digits.length >= 6) {
    out.push({ num: Number(digits.slice(0, -2)), suffix: Number(digits.slice(-2)) });
  }
  return out;
}

async function lookupParcel(gush, helka) {
  const parcel = Number(String(helka ?? "").replace(/\D/g, ""));
  if (!parcel) return null;
  const key = `${gush}/${helka}`;
  if (key in parcelCache) return parcelCache[key];

  let found = null;
  for (const v of gushVariants(gush)) {
    const cql =
      `GUSH_NUM=${v.num} AND PARCEL=${parcel}` +
      (v.suffix != null ? ` AND GUSH_SUFFI=${v.suffix}` : "");
    const url =
      `${WFS}?service=WFS&version=2.0.0&request=GetFeature&typeNames=opendata:PARCEL_ALL` +
      `&outputFormat=application/json&srsName=EPSG:4326&count=1&CQL_FILTER=${encodeURIComponent(cql)}`;
    const json = await getJson(url);
    const feature = json?.features?.[0];
    const centroid = geometryCentroid(feature?.geometry);
    if (centroid) {
      found = { ...centroid, locality: feature.properties?.LOCALITY_N || null };
      break;
    }
    await sleep(120);
  }
  parcelCache[key] = found;
  return found;
}

/** Settlement centroid via Nominatim (cached; 1 req/s per their usage policy). */
async function lookupCity(city) {
  if (city in cityCache) return cityCache[city];
  // "מ.א. בני שמעון" is a regional council, not a place name Nominatim knows.
  const q = city.replace(/^מ\.?\s*א\.?\s*/, "").trim();
  const url = `${NOMINATIM}?format=json&limit=1&countrycodes=il&accept-language=he&q=${encodeURIComponent(q)}`;
  const json = await getJson(url);
  await sleep(1100);
  const hit = json?.[0];
  const result = hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
  cityCache[city] = result;
  saveCache(CITY_CACHE, cityCache);
  if (!result) console.warn(`  ⚠ no settlement match for "${city}"`);
  return result;
}

async function main() {
  const rows = await sql`
    SELECT id, city, gush, helka
    FROM deals
    WHERE status = 'active' ${ALL ? sql`` : sql`AND lat IS NULL`}
    ORDER BY id`;
  const todo = rows.slice(0, LIMIT === Infinity ? undefined : LIMIT);
  console.log(`Geocoding ${todo.length} deals (${ALL ? "all active" : "missing coords only"})…`);

  // Settlement centroids first: they double as the sanity check on parcels.
  const cities = [...new Set(todo.map((r) => r.city).filter(Boolean))];
  console.log(`Resolving ${cities.length} settlements…`);
  for (const c of cities) await lookupCity(c);

  const stats = { parcel: 0, city: 0, none: 0, rejected: 0 };
  let n = 0;
  for (const row of todo) {
    n++;
    const cityPoint = cityCache[row.city] ?? null;
    let point = null;
    let precision = null;

    const parcel = row.gush ? await lookupParcel(row.gush, row.helka) : null;
    if (parcel) {
      if (cityPoint && distKm(parcel, cityPoint) > MAX_KM_FROM_CITY) {
        // Wrong גוש match — keep the honest, coarser answer.
        stats.rejected++;
      } else {
        point = parcel;
        precision = "parcel";
      }
    }
    if (!point && cityPoint) {
      point = cityPoint;
      precision = "city";
    }

    if (point) {
      await sql`
        UPDATE deals SET lat = ${point.lat}, lng = ${point.lng}, geo_precision = ${precision}
        WHERE id = ${row.id}`;
      stats[precision]++;
    } else {
      stats.none++;
    }
    if (n % 25 === 0 || n === todo.length) {
      saveCache(PARCEL_CACHE, parcelCache);
      console.log(
        `  ${n}/${todo.length} — parcel ${stats.parcel} · city ${stats.city} · none ${stats.none}`,
      );
    }
  }
  saveCache(PARCEL_CACHE, parcelCache);

  const [summary] = await sql`
    SELECT count(*) FILTER (WHERE geo_precision = 'parcel') AS parcel,
           count(*) FILTER (WHERE geo_precision = 'city')   AS city,
           count(*) FILTER (WHERE lat IS NULL)              AS missing,
           count(*)                                          AS total
    FROM deals WHERE status = 'active'`;
  console.log(
    `\nDone. parcel ${stats.parcel} · city ${stats.city} · unmatched ${stats.none} · rejected-as-far ${stats.rejected}`,
  );
  console.log(
    `Active deals now: ${summary.parcel} parcel-accurate, ${summary.city} settlement-only, ${summary.missing} without coordinates (of ${summary.total}).`,
  );
  await sql.end();
}

main().catch(async (err) => {
  console.error(err);
  saveCache(PARCEL_CACHE, parcelCache);
  await sql.end();
  process.exit(1);
});
