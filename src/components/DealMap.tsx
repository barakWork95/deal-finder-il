"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ArrowLeft, Crosshair, Gavel, MapPin, X } from "lucide-react";
import type { Deal } from "@/lib/types";
import { deadlineLabel, formatILS, formatLandArea } from "@/lib/format";
import { DealTypeChip, DiscountTag, ScoreChip } from "@/components/ui";
import {
  ISRAEL_CENTER,
  ISRAEL_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  TILES,
  TILE_ATTRIBUTION,
  pinHtml,
  useMapTheme,
} from "@/components/mapShared";
/** Cluster cell in screen pixels — roughly two pin widths. */
const CLUSTER_CELL_PX = 64;
/** Past this zoom, clicking a cluster opens it instead of zooming further. */
const CLUSTER_OPEN_ZOOM = 16;

/** Deals sharing a plot (one רמ"י tender often sells many מגרשים inside a
 *  single registered חלקה) resolve to the exact same coordinates. */
type Group = {
  key: string;
  lat: number;
  lng: number;
  deals: Deal[];
};

/** Groups merged by screen proximity at the current zoom — one pin each. */
type Cluster = {
  key: string;
  lat: number;
  lng: number;
  groups: Group[];
  deals: Deal[];
  /** True when no deal here is located better than its settlement centroid. */
  approx: boolean;
};

const byScoreDesc = (a: Deal, b: Deal) => b.dealScore - a.dealScore;

function groupByPoint(deals: Deal[]): Group[] {
  const byKey = new Map<string, Group>();
  for (const d of deals) {
    if (!d.lat || !d.lng) continue;
    const key = `${d.lat.toFixed(4)},${d.lng.toFixed(4)}`;
    const existing = byKey.get(key);
    if (existing) existing.deals.push(d);
    else byKey.set(key, { key, lat: d.lat, lng: d.lng, deals: [d] });
  }
  for (const g of byKey.values()) g.deals.sort(byScoreDesc);
  return [...byKey.values()];
}

/**
 * Grid-cluster the exact points by their projected pixel position, so pins
 * stop piling on top of each other at country zoom and separate as you zoom
 * in. Projection is the same Web Mercator Leaflet renders with, which keeps
 * this a pure function of (groups, zoom).
 */
function clusterAtZoom(groups: Group[], zoom: number): Cluster[] {
  const cells = new Map<string, Group[]>();
  for (const g of groups) {
    const p = L.CRS.EPSG3857.latLngToPoint(L.latLng(g.lat, g.lng), zoom);
    const key = `${Math.floor(p.x / CLUSTER_CELL_PX)}:${Math.floor(p.y / CLUSTER_CELL_PX)}`;
    const cell = cells.get(key);
    if (cell) cell.push(g);
    else cells.set(key, [g]);
  }

  const clusters: Cluster[] = [];
  for (const [key, members] of cells) {
    const deals = members.flatMap((m) => m.deals).sort(byScoreDesc);
    // Weight the pin toward where the plots actually are.
    const total = members.reduce((n, m) => n + m.deals.length, 0);
    const lat = members.reduce((s, m) => s + m.lat * m.deals.length, 0) / total;
    const lng = members.reduce((s, m) => s + m.lng * m.deals.length, 0) / total;
    clusters.push({
      key,
      lat,
      lng,
      groups: members,
      deals,
      approx: deals.every((d) => d.geoPrecision !== "parcel"),
    });
  }
  return clusters;
}

/**
 * Would zooming all the way in actually break this pin apart? רמ"י sells many
 * מגרשים inside one registered חלקה, so a "30" pin is usually 30 plots on one
 * coordinate — zooming those is a dead end, and the click should open the list
 * instead.
 */
function isSeparable(cluster: Cluster): boolean {
  if (cluster.groups.length < 2) return false;
  const points = cluster.groups.map((g) =>
    L.CRS.EPSG3857.latLngToPoint(L.latLng(g.lat, g.lng), CLUSTER_OPEN_ZOOM),
  );
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const spread = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return spread > CLUSTER_CELL_PX;
}

function citiesLabel(deals: Deal[]): string {
  const cities = [...new Set(deals.map((d) => d.city).filter(Boolean))];
  if (cities.length === 1) {
    const hoods = [...new Set(deals.map((d) => d.neighborhood).filter(Boolean))];
    return hoods.length === 1 ? `${cities[0]} · ${hoods[0]}` : cities[0];
  }
  if (cities.length === 2) return cities.join(" · ");
  return `${cities.length} יישובים`;
}

export default function DealMap({ deals }: { deals: Deal[] }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const layerRef = useRef<L.LayerGroup | null>(null);
  const markersRef = useRef<Map<string, L.Marker>>(new Map());
  const fitRef = useRef<() => void>(() => {});
  const fittedRef = useRef(false);
  const [zoom, setZoom] = useState(ISRAEL_ZOOM);
  // The open panel is anchored to a plot's coordinates rather than to a
  // cluster object: cluster identity changes with zoom and with the filters,
  // and re-deriving keeps the panel in step (and closes it by itself when the
  // filters drop that plot).
  const [anchor, setAnchor] = useState<{ lat: number; lng: number } | null>(null);
  const theme = useMapTheme();

  const groups = useMemo(() => groupByPoint(deals), [deals]);
  const clusters = useMemo(() => clusterAtZoom(groups, zoom), [groups, zoom]);
  const plotted = useMemo(() => groups.reduce((n, g) => n + g.deals.length, 0), [groups]);
  const missing = deals.length - plotted;
  const selected = anchor
    ? (clusters.find((c) => c.groups.some((g) => g.lat === anchor.lat && g.lng === anchor.lng)) ??
      null)
    : null;
  const approxCount = useMemo(
    () => deals.filter((d) => d.lat && d.lng && d.geoPrecision !== "parcel").length,
    [deals],
  );

  // Create the map once.
  useEffect(() => {
    if (mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: ISRAEL_CENTER,
      zoom: ISRAEL_ZOOM,
      zoomControl: false,
      // The data is Israel-only; no reason to let the view leave the country.
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
    });
    L.control.zoom({ position: "topleft" }).addTo(map);
    layerRef.current = L.layerGroup().addTo(map);
    map.on("click", () => setAnchor(null));
    map.on("zoomend", () => setZoom(map.getZoom()));
    mapRef.current = map;

    // The container is measured on creation but is still being laid out when
    // the map chunk mounts; a zero-sized map makes fitBounds pick maxZoom.
    const observer = new ResizeObserver(() => {
      map.invalidateSize({ animate: false });
      if (!fittedRef.current) fitRef.current();
    });
    observer.observe(containerRef.current);
    const markers = markersRef.current;

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
      tileRef.current = null;
      markers.clear();
    };
  }, []);

  // Swap the basemap with the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(TILES[theme], {
      attribution: TILE_ATTRIBUTION,
      maxZoom: MAX_ZOOM,
    }).addTo(map);
  }, [theme]);

  /**
   * Frame every plotted deal. Bails out while the container is unmeasured —
   * fitBounds on a zero-sized map silently falls back to maxZoom — and the
   * ResizeObserver retries once it has real dimensions.
   */
  const fitToDeals = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    map.invalidateSize({ animate: false });
    if (map.getSize().x === 0 || map.getSize().y === 0) {
      fittedRef.current = false;
      return;
    }
    if (groups.length) {
      map.fitBounds(L.latLngBounds(groups.map((g) => [g.lat, g.lng] as [number, number])), {
        padding: [48, 48],
        maxZoom: 13,
      });
    } else {
      map.setView(ISRAEL_CENTER, ISRAEL_ZOOM);
    }
    fittedRef.current = true;
  }, [groups]);

  // The ResizeObserver is installed once, so it reaches the current fit
  // through a ref rather than capturing the first one.
  useEffect(() => {
    fitRef.current = fitToDeals;
  }, [fitToDeals]);

  // Re-frame when the filtered set changes.
  useEffect(() => {
    fitToDeals();
  }, [fitToDeals]);

  // Rebuild pins on every filter or zoom change.
  useEffect(() => {
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!map || !layer) return;

    layer.clearLayers();
    markersRef.current.clear();

    for (const cluster of clusters) {
      const many = cluster.deals.length > 1;
      const size = many ? 38 : 32;
      const marker = L.marker([cluster.lat, cluster.lng], {
        icon: L.divIcon({
          html: pinHtml({
            label: many
              ? String(cluster.deals.length)
              : String(Math.round(cluster.deals[0].dealScore)),
            score: cluster.deals[0].dealScore,
            many,
          }),
          className: "map-pin-icon",
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        title: many
          ? `${citiesLabel(cluster.deals)} · ${cluster.deals.length} מגרשים`
          : citiesLabel(cluster.deals),
        riseOnHover: true,
      });
      marker.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        // A pin covering plots that zooming apart would separate zooms in
        // first; one that can't be split any further opens its list.
        if (map.getZoom() < CLUSTER_OPEN_ZOOM && isSeparable(cluster)) {
          map.flyToBounds(
            L.latLngBounds(cluster.groups.map((g) => [g.lat, g.lng] as [number, number])),
            { padding: [64, 64], maxZoom: CLUSTER_OPEN_ZOOM },
          );
          return;
        }
        setAnchor({ lat: cluster.groups[0].lat, lng: cluster.groups[0].lng });
        map.panTo([cluster.lat, cluster.lng], { animate: true });
      });
      marker.addTo(layer);
      markersRef.current.set(cluster.key, marker);
    }
  }, [clusters]);

  // Highlight the open pin.
  useEffect(() => {
    for (const [key, marker] of markersRef.current) {
      marker.getElement()?.classList.toggle("map-pin-active", key === selected?.key);
    }
  }, [selected, clusters]);

  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-surface shadow-[var(--shadow)]">
      <div
        ref={containerRef}
        dir="ltr"
        className="h-[clamp(420px,68vh,760px)] w-full"
        role="application"
        aria-label="מפת מכרזי קרקע"
      />

      {/* Top strip: what is on the map right now */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-[500] flex flex-wrap items-center gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-xs text-muted backdrop-blur">
          <MapPin size={13} className="text-accent" />
          <span>
            <span className="num font-bold text-primary">{plotted}</span> מגרשים על המפה
          </span>
          {missing > 0 && (
            <span className="text-faint" title="מכרזים ללא גוש/חלקה שניתן לאתר">
              · <span className="num">{missing}</span> ללא מיקום
            </span>
          )}
        </div>
        <button
          onClick={fitToDeals}
          className="pointer-events-auto ms-auto flex items-center gap-1.5 rounded-lg border border-border bg-surface/90 px-3 py-1.5 text-xs font-semibold text-muted backdrop-blur transition hover:text-primary"
        >
          <Crosshair size={13} /> מרכוז מחדש
        </button>
      </div>

      {/* Legend + accuracy disclaimer */}
      <div className="pointer-events-none absolute bottom-8 start-3 z-[500] hidden rounded-lg border border-border bg-surface/90 px-3 py-2 text-[11px] text-muted backdrop-blur sm:block">
        <div className="mb-1.5 flex items-center gap-3">
          <LegendDot color="var(--positive)" label="80+" />
          <LegendDot color="var(--warning)" label="60–79" />
          <LegendDot color="var(--negative)" label="<60" />
          <span className="text-faint">ציון עסקה</span>
        </div>
        <p className="mb-1 max-w-[15rem] leading-snug text-faint">
          סימון מרובה = מספר מגרשים באותה נקודה, בצבע הציון הגבוה שבהם.
        </p>
        <p className="max-w-[15rem] leading-snug text-faint">
          מיקום לפי מרכז החלקה הרשומה (גוש/חלקה).
          {approxCount > 0 && (
            <>
              {" "}
              <span className="num">{approxCount}</span> מכרזים ממוקמים לפי מרכז היישוב בלבד.
            </>
          )}
        </p>
      </div>

      {selected && <SelectionPanel cluster={selected} onClose={() => setAnchor(null)} />}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: color }} />
      <span className="num">{label}</span>
    </span>
  );
}

/** Slide-in list of the plots behind the clicked pin. */
function SelectionPanel({ cluster, onClose }: { cluster: Cluster; onClose: () => void }) {
  return (
    // Starts below the map's own top strip on desktop so the counters and the
    // re-centre button stay reachable while the panel is open.
    <div className="absolute inset-x-0 bottom-0 z-[600] max-h-[62%] overflow-y-auto border-t border-border bg-surface/95 backdrop-blur md:top-14 md:end-0 md:start-auto md:max-h-none md:w-[22rem] md:border-s md:border-t-0">
      <div className="sticky top-0 flex items-start gap-2 border-b border-border bg-surface/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0">
          <h3 className="truncate font-bold text-primary">{citiesLabel(cluster.deals)}</h3>
          <p className="text-xs text-muted">
            <span className="num">{cluster.deals.length}</span>{" "}
            {cluster.deals.length === 1 ? "מגרש" : "מגרשים"}
            {cluster.approx && " · מיקום מקורב (מרכז היישוב)"}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="סגירה"
          className="ms-auto rounded-md border border-border p-1 text-muted transition hover:text-primary"
        >
          <X size={14} />
        </button>
      </div>

      <div className="divide-y divide-border">
        {cluster.deals.map((d) => (
          <Link
            key={d.id}
            href={`/deal/${d.id}`}
            className="group flex gap-3 px-4 py-3 transition hover:bg-surface-2"
          >
            <ScoreChip score={d.dealScore} size="sm" />
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="num text-sm font-bold text-primary" dir="ltr">
                  {formatILS(d.askingPrice)}
                </span>
                <DiscountTag pct={d.discountPct} />
              </div>
              <p className="mt-0.5 truncate text-xs text-muted">
                {formatLandArea(d.areaSqm)} · {d.zoning}
              </p>
              {d.expectedGapPct != null && (
                <p
                  className={`mt-0.5 flex items-center gap-1 text-[11px] font-medium ${
                    d.expectedGapPct > 0 ? "text-positive" : "text-warning"
                  }`}
                >
                  <Gavel size={11} />
                  {d.expectedGapPct > 0
                    ? `חזוי ${Math.round(d.expectedGapPct)}% מתחת לשומה`
                    : `חזוי ${Math.abs(Math.round(d.expectedGapPct))}% מעל השומה`}
                </p>
              )}
              <div className="mt-1.5 flex items-center justify-between gap-2">
                <DealTypeChip type={d.dealType} />
                <span className="text-[11px] text-faint">{deadlineLabel(d.submissionDeadline)}</span>
              </div>
            </div>
            <ArrowLeft
              size={14}
              className="mt-1 shrink-0 text-faint transition group-hover:text-accent"
            />
          </Link>
        ))}
      </div>
    </div>
  );
}
