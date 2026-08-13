"use client";

import { useEffect, useState } from "react";
import { scoreTone } from "@/lib/format";

/** Basemaps, one per app theme. Attribution below is required by both. */
export const TILES = {
  dark: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
  light: "https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png",
};

export const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>';

export const MIN_ZOOM = 6;
export const MAX_ZOOM = 18;

/** Whole-country view, used before anything is plotted. */
export const ISRAEL_CENTER: [number, number] = [31.6, 34.95];
export const ISRAEL_ZOOM = 7;

export function toneVar(tone: ReturnType<typeof scoreTone>) {
  return tone === "positive"
    ? "var(--positive)"
    : tone === "warning"
      ? "var(--warning)"
      : "var(--negative)";
}

/**
 * Pin markup for Leaflet's divIcon, styled with the app's own CSS variables so
 * it tracks the theme without a second palette. A lone plot is an outlined disc
 * holding its Deal Score; several plots become a *filled* disc with a halo
 * holding the count — the fill is what tells "score 4" apart from "4 plots".
 */
export function pinHtml({ label, score, many }: { label: string; score: number; many: boolean }) {
  const color = toneVar(scoreTone(score));
  const size = many ? 38 : 32;
  return `
    <div class="map-pin ${many ? "map-pin-many" : ""}" style="--pin-tone:${color};--pin-size:${size}px">
      <span class="map-pin-dot num">${label}</span>
      ${many ? '<span class="map-pin-ring"></span>' : ""}
    </div>`;
}

/** Follows the app theme, which ThemeToggle writes to <html data-theme>. */
export function useMapTheme(): "dark" | "light" {
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  useEffect(() => {
    const read = () =>
      setTheme(document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark");
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);
  return theme;
}
