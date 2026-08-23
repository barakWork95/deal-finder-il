"use client";

import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ExternalLink, MapPin, X } from "lucide-react";
import {
  MAX_ZOOM,
  MIN_ZOOM,
  TILES,
  TILE_ATTRIBUTION,
  pinHtml,
  useMapTheme,
} from "@/components/mapShared";

/** Tight enough to see the plot's surroundings, loose enough to keep context. */
const PARCEL_ZOOM = 16;
const CITY_ZOOM = 13;

export type DealLocation = {
  lat: number;
  lng: number;
  dealScore: number;
  geoPrecision?: "parcel" | "city";
  city: string;
  neighborhood?: string;
  gush?: string;
  helka?: string;
};

/**
 * "מפה" toggle on a tender page: opens an inline map of the plot itself.
 * A settlement-level location says so out loud rather than pointing at a
 * street corner the tender has nothing to do with.
 */
export default function DealLocationMap({ deal }: { deal: DealLocation }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const theme = useMapTheme();

  const exact = deal.geoPrecision === "parcel";
  const zoom = exact ? PARCEL_ZOOM : CITY_ZOOM;

  useEffect(() => {
    if (!open || mapRef.current || !containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [deal.lat, deal.lng],
      zoom,
      zoomControl: false,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM,
      scrollWheelZoom: false, // don't hijack the page scroll on a long page
    });
    L.control.zoom({ position: "topleft" }).addTo(map);
    L.marker([deal.lat, deal.lng], {
      icon: L.divIcon({
        html: pinHtml({
          label: String(Math.round(deal.dealScore)),
          score: deal.dealScore,
          many: false,
        }),
        className: "map-pin-icon",
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      }),
      title: [deal.city, deal.neighborhood].filter(Boolean).join(" · "),
    }).addTo(map);
    mapRef.current = map;

    // The panel expands as the map mounts; a zero-sized map renders blank.
    const observer = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      map.remove();
      mapRef.current = null;
      tileRef.current = null;
    };
  }, [open, deal, zoom]);

  // Swap the basemap with the theme.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    tileRef.current?.remove();
    tileRef.current = L.tileLayer(TILES[theme], {
      attribution: TILE_ATTRIBUTION,
      maxZoom: MAX_ZOOM,
    }).addTo(map);
  }, [theme, open]);

  return (
    <>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold transition ${
          open
            ? "border-accent bg-accent-soft text-accent"
            : "border-border bg-surface text-primary hover:border-accent"
        }`}
      >
        {open ? <X size={14} /> : <MapPin size={14} />} מפה
      </button>

      {open && (
        <div className="mt-3 w-full basis-full overflow-hidden rounded-lg border border-border">
          <div ref={containerRef} dir="ltr" className="h-[320px] w-full" aria-label="מפת המגרש" />
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-surface px-3 py-2 text-[11px] text-faint">
            <span>
              {exact ? (
                <>
                  מרכז החלקה הרשומה
                  {deal.gush && (
                    <>
                      {" · "}
                      <span className="num">
                        גוש {deal.gush} חלקה {deal.helka}
                      </span>
                    </>
                  )}
                </>
              ) : (
                <span className="text-warning">
                  מיקום מקורב — מרכז היישוב {deal.city}, לא מיקום המגרש עצמו
                </span>
              )}
            </span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${deal.lat},${deal.lng}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 font-semibold text-accent hover:underline"
            >
              פתיחה ב-Google Maps <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </>
  );
}
