import type { Phase } from "@trailblazer/shared";
import { useLayoutEffect, useRef, useState } from "react";
import { fmtDate, fmtDuration, fmtNumber, PHASE_LABEL } from "../lib/format";
import { Segmented } from "./ui";

export interface ChartWeek {
  weekStart: string;
  phase: Phase;
  isRecovery: boolean;
  targetHours: number;
  targetVerticalM: number;
  targetLongMin: number;
}

type Metric = "hours" | "vertical" | "long";
const METRICS: { value: Metric; label: string }[] = [
  { value: "hours", label: "Hours" },
  { value: "vertical", label: "Vertical" },
  { value: "long", label: "Long day" },
];
const value = (w: ChartWeek, m: Metric) => (m === "hours" ? w.targetHours : m === "vertical" ? w.targetVerticalM : w.targetLongMin);
const fmtValue = (v: number, m: Metric) => (m === "hours" ? `${fmtNumber(v)} h` : m === "vertical" ? `${fmtNumber(v)} m` : fmtDuration(v));

function niceMax(v: number) {
  if (v <= 0) return 1;
  const mag = 10 ** Math.floor(Math.log10(v));
  const n = v / mag;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => e && setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Rounded top corners only, anchored to the baseline. */
function barPath(x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`;
}

export function LoadChart({
  weeks,
  currentIndex,
  selectedIndex,
  onSelect,
  height = 180,
}: {
  weeks: ChartWeek[];
  currentIndex?: number;
  selectedIndex?: number;
  onSelect?: (index: number) => void;
  height?: number;
}) {
  const [metric, setMetric] = useState<Metric>("hours");
  const [hover, setHover] = useState<number | null>(null);
  const [ref, width] = useWidth<HTMLDivElement>();

  const pad = { top: 8, right: 4, bottom: 22, left: 36 };
  const innerW = Math.max(10, width - pad.left - pad.right);
  const innerH = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...weeks.map((w) => value(w, metric))));
  const band = innerW / weeks.length;
  const gap = Math.min(2, band * 0.25);
  const barW = Math.max(1, band - gap);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  // Month labels at the first week of each month, thinned to avoid collisions.
  const monthTicks: { i: number; label: string }[] = [];
  let lastMonth = "";
  let lastX = -Infinity;
  weeks.forEach((w, i) => {
    const mo = w.weekStart.slice(0, 7);
    if (mo !== lastMonth) {
      lastMonth = mo;
      const x = pad.left + i * band;
      if (x - lastX >= 34) {
        monthTicks.push({ i, label: fmtDate(w.weekStart, { month: "short" }) });
        lastX = x;
      }
    }
  });

  const phasesPresent = (["base", "build", "specific", "taper"] as Phase[]).filter((p) => weeks.some((w) => w.phase === p));
  const hw = hover !== null ? weeks[hover] : undefined;

  return (
    <div className="viz-root space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--viz-text)]" aria-label="Phases">
          {phasesPresent.map((p) => (
            <li key={p} className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--phase-${p})` }} aria-hidden />
              {PHASE_LABEL[p]}
            </li>
          ))}
        </ul>
        <Segmented label="Metric" value={metric} onChange={setMetric} options={METRICS} />
      </div>

      <div ref={ref} className="relative">
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={`Weekly ${METRICS.find((m) => m.value === metric)!.label.toLowerCase()} across the plan`}
          onMouseLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" />
              <text x={pad.left - 6} y={y(t)} dy="0.32em" textAnchor="end" fontSize={10} fill="var(--viz-text)">
                {metric === "long" ? fmtDuration(t) : fmtNumber(t)}
              </text>
            </g>
          ))}

          {weeks.map((w, i) => {
            const v = value(w, metric);
            const x = pad.left + i * band + gap / 2;
            const top = y(v);
            const h = pad.top + innerH - top;
            const selected = selectedIndex === i;
            return (
              <g key={w.weekStart}>
                {h > 0 && (
                  <path
                    d={barPath(x, top, barW, h, 4)}
                    fill={`var(--phase-${w.phase})`}
                    opacity={hover === null || hover === i ? 1 : 0.55}
                    stroke={selected ? "currentColor" : "none"}
                    strokeWidth={selected ? 2 : 0}
                  />
                )}
                {/* hit target: the full column */}
                <rect
                  x={pad.left + i * band}
                  y={pad.top}
                  width={band}
                  height={innerH}
                  fill="transparent"
                  style={{ cursor: onSelect ? "pointer" : "default" }}
                  onMouseEnter={() => setHover(i)}
                  onClick={() => onSelect?.(i)}
                />
              </g>
            );
          })}

          {currentIndex !== undefined && currentIndex >= 0 && currentIndex < weeks.length && (
            <g pointerEvents="none">
              <line
                x1={pad.left + (currentIndex + 0.5) * band}
                x2={pad.left + (currentIndex + 0.5) * band}
                y1={pad.top}
                y2={pad.top + innerH}
                stroke="currentColor"
                strokeDasharray="3 3"
                opacity={0.6}
              />
            </g>
          )}

          {monthTicks.map((t) => (
            <text key={t.i} x={pad.left + t.i * band} y={height - 6} fontSize={10} fill="var(--viz-text)">
              {t.label}
            </text>
          ))}
        </svg>

        {hw && hover !== null && (
          <div
            className="pointer-events-none absolute top-0 z-10 rounded-lg border border-black/10 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-white/10 dark:bg-neutral-800"
            style={{
              left: Math.min(Math.max(pad.left + hover * band + band / 2 - 70, 0), width - 140),
              width: 140,
            }}
          >
            <div className="font-medium">
              Week {hover + 1} · {fmtDate(hw.weekStart, { day: "numeric", month: "short" })}
            </div>
            <div className="text-rock">
              {PHASE_LABEL[hw.phase]}
              {hw.isRecovery ? " · recovery" : ""}
              {currentIndex === hover ? " · this week" : ""}
            </div>
            <div className="mt-0.5 font-medium">{fmtValue(value(hw, metric), metric)}</div>
          </div>
        )}
      </div>
    </div>
  );
}
