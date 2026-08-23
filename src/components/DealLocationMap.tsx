"use client";

import dynamic from "next/dynamic";
import { LogoLoader } from "@/components/LogoLoader";
import type { DealLocation } from "@/components/DealLocationMapImpl";

/**
 * Client-only wrapper around the plot map.
 *
 * Leaflet reads `window` at import time, so merely *importing* the map
 * evaluated it during SSR and threw — which made React abandon the server
 * render of the whole tender page and redo it in the browser. The page still
 * worked, so nothing surfaced it beyond a console error, but the most
 * content-heavy page in the app was giving up its server rendering to draw a
 * map most visitors never open.
 *
 * The feed already avoided this by loading DealMap through next/dynamic with
 * ssr: false. The tender page could not do the same, because it is a server
 * component and `ssr: false` is only allowed in client ones — hence this
 * wrapper: the page imports something safe, and the leaflet module is reached
 * only from the browser.
 */
const DealLocationMapImpl = dynamic(() => import("@/components/DealLocationMapImpl"), {
  ssr: false,
  loading: () => (
    <div className="grid h-[320px] place-items-center rounded-xl border border-border bg-surface">
      <LogoLoader label="טוען מפה…" />
    </div>
  ),
});

export type { DealLocation };

export default function DealLocationMap({ deal }: { deal: DealLocation }) {
  return <DealLocationMapImpl deal={deal} />;
}
