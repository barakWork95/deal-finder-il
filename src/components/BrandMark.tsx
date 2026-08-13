/**
 * קרקעHOT wordmark — inline SVG so each half of the mark can take its own
 * paint: "קרקע" is filled with `currentColor` (so it inherits text-primary and
 * stays readable on both themes) while "HOT" and the flame keep a vibrant
 * orange gradient.
 *
 * Why the letterforms come from the artwork's alpha rather than <path> data:
 * the supplied karkahot-wordmark.svg is an *outline* trace — its 100 paths are
 * thin bands around the glyph edges, so rendering them draws a hollow outline
 * of the logo rather than solid letters. Masking the original artwork keeps the
 * exact letterforms instead of approximating them. Drop a real vector wordmark
 * in and this component can switch to <path fill="currentColor"> unchanged in
 * every other respect.
 *
 * Order is baked into the geometry below, not left to the page's `dir`: the two
 * halves are translated past each other so the mark always reads קרקע on the
 * right, HOT + flame on the left.
 */

// Ink boundaries measured off /brand/karkahot-logo.png (420×114, 1 unit = 1px).
// The viewBox is cropped to the ink box so `height` sizes the mark itself
// rather than the artwork's transparent margins.
const ART = { left: 21, right: 400, top: 6, bottom: 99, hebRight: 219, hotLeft: 232 };
const FLAME = { left: 290, right: 349, top: 6, bottom: 88 };

// Swap the halves: HOT starts where the art starts, קרקע ends where it ended.
const DX_HOT = ART.left - ART.hotLeft; // -211
const DX_HEB = ART.right - ART.hebRight; // +181

type Variant = "full" | "flame";

/**
 * `flame` is the compact mark for narrow headers — the same artwork and the
 * same gradient, cropped to the flame.
 */
export function BrandMark({
  variant = "full",
  className = "",
}: {
  variant?: Variant;
  className?: string;
}) {
  // Both variants can be in the DOM at once (one hidden by a breakpoint), so
  // every id is scoped to the variant to keep them unique.
  const id = (name: string) => `karkahot-${variant}-${name}`;
  const box =
    variant === "flame"
      ? `${FLAME.left} ${FLAME.top} ${FLAME.right - FLAME.left} ${FLAME.bottom - FLAME.top}`
      : `${ART.left} ${ART.top} ${ART.right - ART.left} ${ART.bottom - ART.top}`;

  return (
    <svg
      viewBox={box}
      role="img"
      aria-label="קרקעHOT"
      className={`h-[1.5em] w-auto text-primary ${className}`}
    >
      <defs>
        <linearGradient id={id("grad")} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fbab3b" />
          <stop offset="0.45" stopColor="#f97518" />
          <stop offset="1" stopColor="#e8590c" />
        </linearGradient>

        {/*
         * Paints the artwork white while keeping its alpha, so the masks below
         * work whether the browser reads them as luminance or as alpha.
         */}
        <filter id={id("alpha")} x="0" y="0" width="100%" height="100%">
          <feColorMatrix type="matrix" values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 1 0" />
        </filter>

        <image
          id={id("art")}
          href="/brand/karkahot-logo.png"
          x="0"
          y="0"
          width="420"
          height="114"
          filter={`url(#${id("alpha")})`}
        />

        {/* Each mask holds the whole wordmark, shifted to its new position;
            the painted rect below picks out just that half. */}
        <mask
          id={id("mask-hot")}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="420"
          height="114"
          style={{ maskType: "alpha" }}
        >
          <use href={`#${id("art")}`} x={variant === "flame" ? 0 : DX_HOT} />
        </mask>
        {variant === "full" && (
          <mask
            id={id("mask-heb")}
            maskUnits="userSpaceOnUse"
            x="0"
            y="0"
            width="420"
            height="114"
            style={{ maskType: "alpha" }}
          >
            <use href={`#${id("art")}`} x={DX_HEB} />
          </mask>
        )}
      </defs>

      {variant === "flame" ? (
        <rect
          x={FLAME.left}
          y={FLAME.top}
          width={FLAME.right - FLAME.left}
          height={FLAME.bottom - FLAME.top}
          fill={`url(#${id("grad")})`}
          mask={`url(#${id("mask-hot")})`}
        />
      ) : (
        <>
          {/* HOT + flame — left. Stops short of x=8, where the shifted קרקע ends. */}
          <rect
            x="15"
            y="0"
            width="180"
            height="114"
            fill={`url(#${id("grad")})`}
            mask={`url(#${id("mask-hot")})`}
          />
          {/* קרקע — right. Stops short of x=413, where the shifted H begins. */}
          <rect
            x="195"
            y="0"
            width="217"
            height="114"
            fill="currentColor"
            mask={`url(#${id("mask-heb")})`}
          />
        </>
      )}
    </svg>
  );
}
