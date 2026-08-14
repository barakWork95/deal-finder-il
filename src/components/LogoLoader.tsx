import { BrandMark } from "@/components/BrandMark";

/**
 * Branded wait state: the wordmark breathing over a sweeping progress line.
 *
 * Used where something genuinely takes time — a route's server render (the
 * tender queries run on every request) and the map's code-split chunk. Client
 * filtering is instant, so it deliberately does *not* appear there: a loader
 * that flashes for 8ms reads as jank, not polish.
 */
export function LogoLoader({ label = "טוען…", className = "" }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`flex flex-col items-center justify-center gap-4 ${className}`}
    >
      <BrandMark className="logo-loader text-3xl sm:text-4xl" />

      <div className="h-0.5 w-32 overflow-hidden rounded-full bg-surface-2">
        <div className="logo-loader-bar h-full w-1/3 rounded-full bg-accent" />
      </div>

      <span className="text-xs text-faint">{label}</span>
    </div>
  );
}

/** Full-height variant for route-level loading files. */
export function PageLoader({ label }: { label?: string }) {
  return <LogoLoader label={label} className="min-h-[60vh] px-4" />;
}
