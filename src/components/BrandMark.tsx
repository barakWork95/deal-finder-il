import Image from "next/image";

/**
 * קרקעHOT wordmark. The flame is the brand asset itself (it replaces the O in
 * HOT); the lettering is set in the app font and inherits `text-primary`, so
 * the mark stays legible on both the dark and the light theme — the supplied
 * PNG wordmark is slate grey and would sink into the dark canvas.
 * The full-colour original lives at /brand/karkahot-logo.png (used for social
 * cards and the README).
 */
export function BrandMark({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-baseline font-black tracking-tight text-primary ${className}`}
      aria-label="קרקעHOT"
      dir="rtl"
    >
      <span>קרקע</span>
      <span dir="ltr" className="inline-flex items-center">
        H
        <Image
          src="/brand/karkahot-flame.png"
          alt=""
          width={133}
          height={184}
          priority
          className="mx-[0.02em] inline-block h-[1.15em] w-auto -translate-y-[0.06em]"
        />
        T
      </span>
    </span>
  );
}
