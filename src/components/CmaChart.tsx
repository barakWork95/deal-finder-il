import type { HistoricalTransaction } from "@/lib/types";

/**
 * ₪/sqm trend over time from comparable transactions, with the subject
 * property plotted as a reference dot and the area average as a baseline.
 * Pure SVG — no chart dependency, RTL-aware (time flows right→left).
 */
export function CmaChart({
  comps,
  subjectPerSqm,
  areaAvgPerSqm,
}: {
  comps: HistoricalTransaction[];
  subjectPerSqm: number;
  areaAvgPerSqm: number;
}) {
  const W = 520;
  const H = 220;
  const pad = { top: 20, right: 16, bottom: 28, left: 52 };

  const points = [...comps]
    .sort((a, b) => new Date(a.saleDate).getTime() - new Date(b.saleDate).getTime())
    .map((c) => ({ date: new Date(c.saleDate).getTime(), value: c.pricePerSqm }));

  const allValues = [...points.map((p) => p.value), subjectPerSqm, areaAvgPerSqm];
  const minV = Math.min(...allValues) * 0.96;
  const maxV = Math.max(...allValues) * 1.04;
  const minT = points[0]?.date ?? 0;
  const maxT = points[points.length - 1]?.date ?? 1;

  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  // RTL: newest date on the LEFT, oldest on the RIGHT.
  const x = (t: number) => pad.left + (1 - (t - minT) / (maxT - minT || 1)) * innerW;
  const y = (v: number) => pad.top + (1 - (v - minV) / (maxV - minV || 1)) * innerH;

  const linePath = points.map((p, i) => `${i === 0 ? "M" : "L"} ${x(p.date)} ${y(p.value)}`).join(" ");
  const avgY = y(areaAvgPerSqm);
  const subjectY = y(subjectPerSqm);
  const belowAvg = subjectPerSqm < areaAvgPerSqm;

  const gridVals = [minV, (minV + maxV) / 2, maxV];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="מגמת מחיר למ״ר">
      {/* gridlines + y labels */}
      {gridVals.map((gv, i) => (
        <g key={i}>
          <line
            x1={pad.left}
            x2={W - pad.right}
            y1={y(gv)}
            y2={y(gv)}
            stroke="var(--border)"
            strokeWidth="1"
          />
          <text x={pad.left - 8} y={y(gv) + 4} textAnchor="end" fontSize="10" fill="var(--text-faint)">
            {`₪${Math.round(gv / 1000)}K`}
          </text>
        </g>
      ))}

      {/* area average baseline */}
      <line
        x1={pad.left}
        x2={W - pad.right}
        y1={avgY}
        y2={avgY}
        stroke="var(--text-muted)"
        strokeWidth="1.5"
        strokeDasharray="5 4"
      />
      <text x={W - pad.right} y={avgY - 5} textAnchor="end" fontSize="10" fill="var(--text-muted)">
        חציון אזורי
      </text>

      {/* comps line */}
      <path d={linePath} fill="none" stroke="var(--accent)" strokeWidth="2.5" />
      {points.map((p, i) => (
        <circle key={i} cx={x(p.date)} cy={y(p.value)} r="3.5" fill="var(--accent)" />
      ))}

      {/* subject property marker */}
      <line
        x1={pad.left}
        x2={W - pad.right}
        y1={subjectY}
        y2={subjectY}
        stroke={belowAvg ? "var(--positive)" : "var(--negative)"}
        strokeWidth="1"
        strokeDasharray="2 3"
        opacity="0.6"
      />
      <circle
        cx={pad.left + 12}
        cy={subjectY}
        r="6"
        fill={belowAvg ? "var(--positive)" : "var(--negative)"}
        stroke="var(--surface)"
        strokeWidth="2"
      />
      <text
        x={pad.left + 24}
        y={subjectY + 4}
        fontSize="10"
        fontWeight="700"
        fill={belowAvg ? "var(--positive)" : "var(--negative)"}
      >
        הנכס
      </text>
    </svg>
  );
}
