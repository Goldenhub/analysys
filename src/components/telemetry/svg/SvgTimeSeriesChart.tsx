import { useEffect, useMemo, useRef, useState } from 'react';

// ─── Types ───────────────────────────────────────────────────────

export interface SeriesConfig {
  key: string;
  name: string;
  color: string;
  /** When set, series participate in cumulative stacking (area charts). */
  stackId?: string;
  /** Render as a filled area under the line. */
  area?: boolean;
  areaOpacity?: number;
}

export interface ChartDatum {
  /** Numeric x position in ms (used for scale). */
  time: number;
  timeLabel: string;
  [key: string]: unknown;
}

export interface ReferenceLine {
  id: string;
  x: number;
  label: string;
  color: string;
  labelColor: string;
}

export interface SvgTimeSeriesChartProps {
  data: ChartDatum[];
  series: SeriesConfig[];
  referenceLines?: ReferenceLine[];
  /** Y-axis unit suffix (e.g. 'ms', 'req/s'). */
  unit?: string;
  /** Enable the brush zoom bar at the bottom. */
  brush?: boolean;
  height?: number;
}

// ─── Palette & layout constants ──────────────────────────────────

const GRID = '#f3ede21f';
const AXIS_TEXT = '#f3ede2e6';
const TOOLTIP_BG = '#211e1a';
const TOOLTIP_TEXT = '#f3ede2';
const TOOLTIP_BORDER = '#5b5347';

const CHART_PAD = { top: 8, right: 12, bottom: 20, left: 34 };

// ─── Helpers ─────────────────────────────────────────────────────

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1, 2, 3, 4];
  const step = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step)));
  const norm = step / mag;
  let niceStep: number;
  if (norm < 1.5) niceStep = 1;
  else if (norm < 3) niceStep = 2;
  else if (norm < 7) niceStep = 5;
  else niceStep = 10;
  niceStep *= mag;
  const ticks: number[] = [];
  for (let v = 0; v <= max + niceStep * 0.5; v += niceStep) {
    ticks.push(Math.round(v * 100) / 100);
  }
  return ticks;
}

function formatAxisValue(v: number): string {
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v % 1 !== 0) return v.toFixed(1);
  return String(v);
}

function monotonePoints(points: [number, number][], smooth = true): string {
  return points
    .map((p, i) => {
      if (i === 0) return `M${p[0]},${p[1]}`;
      if (!smooth || i === 1) return ` L${p[0]},${p[1]}`;
      const prev = points[i - 1]!;
      return ` C${prev[0]},${(prev[1] + p[1]) / 2} ${p[0]},${(prev[1] + p[1]) / 2} ${p[0]},${p[1]}`;
    })
    .join('');
}

function areaPath(
  points: [number, number][],
  baseY: number,
): string {
  if (points.length === 0) return '';
  const line = monotonePoints(points);
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${line} L${last[0]},${baseY} L${first[0]},${baseY} Z`;
}

// ─── Component ───────────────────────────────────────────────────

export function SvgTimeSeriesChart({
  data,
  series,
  referenceLines = [],
  unit = '',
  brush = false,
  height = 200,
}: SvgTimeSeriesChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [brushRange, setBrushRange] = useState<[number, number] | null>(null);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number } | null>(null);
  const brushDrag = useRef<{ start: number } | null>(null);
  const [brushActive, setBrushActive] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const plotW = Math.max(0, width - CHART_PAD.left - CHART_PAD.right);
  const plotH = Math.max(0, height - CHART_PAD.top - CHART_PAD.bottom);
  const brushH = brush ? 18 : 0;

  // Visible data (respect brush range)
  const visibleData = useMemo(() => {
    if (!brushRange) return data;
    return data.filter((d) => d.time >= brushRange[0] && d.time <= brushRange[1]);
  }, [data, brushRange]);

  // Scale domains
  const xDomain: readonly [number, number] = useMemo(() => {
    if (visibleData.length === 0) return [0, 1] as const;
    return [visibleData[0]!.time, visibleData[visibleData.length - 1]!.time] as const;
  }, [visibleData]);

  const yMax = useMemo(() => {
    // For stacked areas, need cumulative max
    let max = 0;
    for (const d of visibleData) {
      let stackSum = 0;
      for (const s of series) {
        const v = Number(d[s.key] ?? 0);
        if (s.stackId) stackSum += v;
        else max = Math.max(max, v);
      }
      max = Math.max(max, stackSum);
    }
    return max || 1;
  }, [visibleData, series]);

  const xScale = (v: number) =>
    CHART_PAD.left +
    ((v - xDomain[0]) / Math.max(1, xDomain[1] - xDomain[0])) * plotW;
  const yScale = (v: number) =>
    CHART_PAD.top + plotH - (v / yMax) * plotH;

  // Stacked render: compute cumulative offsets per datum per series
  const stackedOffsets = useMemo(() => {
    const offsets: Record<string, number>[] = [];
    for (const d of visibleData) {
      const acc: Record<string, number> = {};
      const totalStack: Record<string, number> = {};
      for (const s of series) {
        const v = Number(d[s.key] ?? 0);
        if (s.stackId) {
          acc[s.key] = totalStack[s.stackId] ?? 0;
          totalStack[s.stackId] = (totalStack[s.stackId] ?? 0) + v;
        } else {
          acc[s.key] = 0;
        }
      }
      offsets.push(acc);
    }
    return offsets;
  }, [visibleData, series]);

  const yTicks = useMemo(() => niceTicks(yMax), [yMax]);

  const xTicks = useMemo(() => {
    if (visibleData.length <= 1) return visibleData;
    const count = Math.min(visibleData.length, 6);
    const step = Math.max(1, Math.floor(visibleData.length / (count - 1)));
    const out: ChartDatum[] = [];
    visibleData.forEach((d, i) => {
      if (i % step === 0) out.push(d);
    });
    if (out[out.length - 1] !== visibleData[visibleData.length - 1]) {
      out.push(visibleData[visibleData.length - 1]!);
    }
    return out;
  }, [visibleData]);

  // Hover handling
  const xRef = useRef<SVGSVGElement>(null);
  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    if (!xRef.current) return;
    const rect = xRef.current.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;
    if (localX < CHART_PAD.left - 6 || localX > width - CHART_PAD.right + 6) {
      return;
    }
    // nearest datum in fluid coordinates
    if (visibleData.length === 0) return;
    const ratio = (localX - CHART_PAD.left) / plotW;
    const time = xDomain[0] + ratio * (xDomain[1] - xDomain[0]);
    let best = 0;
    let bestDist = Infinity;
    visibleData.forEach((d, i) => {
      const dist = Math.abs(d.time - time);
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
      }
    });
    setHoverIndex(best);
    setHoverPos({ x: localX, y: localY });
  };

  const handleMouseLeave = () => {
    setHoverIndex(null);
    setHoverPos(null);
  };

  // Brush handlers
  const handleBrushDown = (e: React.MouseEvent<SVGRectElement>) => {
    if (!xRef.current) return;
    const rect = xRef.current.getBoundingClientRect();
    brushDrag.current = { start: e.clientX - rect.left };
    setBrushActive(true);
  };
  const handleBrushMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!brushDrag.current || !xRef.current) return;
    const rect = xRef.current.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const lo = Math.min(brushDrag.current.start, px);
    const hi = Math.max(brushDrag.current.start, px);
    const tlo = xDomain[0] + ((lo - CHART_PAD.left) / plotW) * (xDomain[1] - xDomain[0]);
    const thi = xDomain[0] + ((hi - CHART_PAD.left) / plotW) * (xDomain[1] - xDomain[0]);
    setBrushRange([tlo, thi]);
  };
  const handleBrushUp = () => {
    brushDrag.current = null;
    setBrushActive(false);
  };

  if (width === 0) {
    return (
      <div
        ref={containerRef}
        style={{ height }}
        className="flex w-full items-center justify-center text-xs text-[#f3ede2]/70"
      >
        …
      </div>
    );
  }

  const hovered = hoverIndex != null ? visibleData[hoverIndex] : null;

  return (
    <div ref={containerRef} style={{ height }} className="w-full">
      <svg
        ref={xRef}
        width={width}
        height={height}
        className="select-none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        cursor="crosshair"
      >
        {/* Grid + Y axis */}
        {yTicks.map((t) => {
          const y = yScale(t);
          return (
            <g key={t}>
              <line
                x1={CHART_PAD.left}
                x2={width - CHART_PAD.right}
                y1={y}
                y2={y}
                stroke={GRID}
                strokeDasharray="3 3"
              />
              <text
                x={CHART_PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                fontSize="9"
                fill={AXIS_TEXT}
              >
                {formatAxisValue(t)}
              </text>
            </g>
          );
        })}

        {/* X axis ticks */}
        {xTicks.map((d) => (
          <text
            key={d.time}
            x={xScale(d.time)}
            y={height - 6}
            textAnchor="middle"
            fontSize="9"
            fill={AXIS_TEXT}
          >
            {d.timeLabel}
          </text>
        ))}

        {/* Y axis unit label */}
        {unit && (
          <text
            x={6}
            y={CHART_PAD.top + 4}
            fontSize="9"
            fill={AXIS_TEXT}
          >
            {unit}
          </text>
        )}

        {/* Reference (chaos) lines */}
        {referenceLines.map((ref) => {
          const x = xScale(ref.x);
          if (x < CHART_PAD.left || x > width - CHART_PAD.right) return null;
          return (
            <g key={ref.id}>
              <line
                x1={x}
                x2={x}
                y1={CHART_PAD.top}
                y2={height - brushH - 4}
                stroke={ref.color}
                strokeDasharray="4 2"
                strokeWidth={1.5}
              />
              <text
                x={x + 3}
                y={CHART_PAD.top + 8}
                fontSize="8"
                fill={ref.labelColor}
                transform={`rotate(90 ${x + 3} ${CHART_PAD.top + 8})`}
              >
                {ref.label}
              </text>
            </g>
          );
        })}

        {/* Series */}
        {series.map((s) => {
          const pts: [number, number][] = visibleData.map((d, i) => [
            xScale(d.time),
            yScale(Number(d[s.key] ?? 0) + (stackedOffsets[i]?.[s.key] ?? 0)),
          ]);
          if (s.area) {
            const baseY = CHART_PAD.top + plotH;
            return (
              <path
                key={s.key}
                d={areaPath(pts, baseY)}
                fill={s.color}
                fillOpacity={s.areaOpacity ?? 0.4}
                stroke={s.color}
                strokeWidth={1.5}
              />
            );
          }
          return (
            <path
              key={s.key}
              d={monotonePoints(pts)}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          );
        })}

        {/* Brush bar */}
        {brush && (
          <g onMouseDown={handleBrushDown} onMouseMove={handleBrushMove} onMouseUp={handleBrushUp}>
            <rect
              x={CHART_PAD.left}
              y={height - brushH}
              width={plotW}
              height={brushH}
              fill="#f3ede2"
              fillOpacity={0.15}
              rx={2}
            />
            {/* full-range line rendering */}
            {visibleData.length > 0 && (
              <>
                {series.map((s) => {
                  const pts = visibleData.map((d) => xScale(d.time));
                  return pts.map((x, i) => (
                    <line
                      key={`${s.key}-${i}`}
                      x1={x}
                      x2={x + (pts[i + 1] !== undefined ? pts[i + 1]! - x : 2)}
                      y1={height - brushH + 3}
                      y2={height - brushH + 3}
                      stroke={s.color}
                      strokeWidth={2}
                    />
                  ));
                })}
              </>
            )}
            {brushActive && brushRange && (
              <rect
                x={xScale(brushRange[0])}
                y={height - brushH}
                width={Math.abs(xScale(brushRange[1]) - xScale(brushRange[0]))}
                height={brushH}
                fill="#dfb357"
                fillOpacity={0.35}
              />
            )}
          </g>
        )}

        {/* Hover crosshair + tooltip */}
        {hovered && hoverIndex != null && (
          <g>
            <line
              x1={xScale(hovered.time)}
              x2={xScale(hovered.time)}
              y1={CHART_PAD.top}
              y2={height - brushH - 4}
              stroke="#f3ede2"
              strokeOpacity={0.45}
              strokeDasharray="2 2"
            />
            {series.map((s) => (
              <circle
                key={s.key}
                cx={xScale(hovered.time)}
                cy={yScale(Number(hovered[s.key] ?? 0) + (stackedOffsets[hoverIndex]?.[s.key] ?? 0))}
                r={3}
                fill={s.color}
                stroke="#f3ede2"
                strokeWidth={1}
              />
            ))}
          </g>
        )}

        {/* Tooltip (HTML overlay) */}
        {hovered && hoverPos && (
          <foreignObject
            x={hoverPos.x + 12}
            y={Math.max(4, hoverPos.y - 40)}
            width={150}
            height={series.length * 16 + 22}
            style={{ overflow: 'visible' }}
          >
            <div
              className="pointer-events-none rounded border px-2 py-1 shadow-lg"
              style={{ background: TOOLTIP_BG, borderColor: TOOLTIP_BORDER, color: TOOLTIP_TEXT }}
            >
              <div className="mb-0.5 text-[10px] font-medium" style={{ color: '#f3ede2' }}>
                {hovered.timeLabel}
              </div>
              {series.map((s) => (
                <div key={s.key} className="flex items-center gap-1.5 text-[10px]">
                  <span className="inline-block h-2 w-2 rounded-full" style={{ background: s.color }} />
                  <span style={{ color: '#f3ede2' }}>{s.name}:</span>
                  <span className="font-mono text-[#f3ede2]">
                    {Number(hovered[s.key] ?? 0).toFixed(2)}
                  </span>
                </div>
              ))}
              {hovered.chaosAnnotation ? (
                <div className="text-[9px]" style={{ color: '#dfb357' }}>
                  {String(hovered.chaosAnnotation)}
                </div>
              ) : null}
            </div>
          </foreignObject>
        )}
      </svg>
    </div>
  );
}
