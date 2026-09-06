import { useState } from 'react';
import type { EdgeRenderContext } from '@/canvas';
import { getBezierPath } from '@/canvas/path';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';

export function AsyncEdge(ctx: EdgeRenderContext): React.ReactElement {
  const [hovered, setHovered] = useState(false);
  const simState = useSimulationStore((s) => s.simState);
  const isRunning = simState === SimState.Running;

  const d = getBezierPath(ctx.source, ctx.target, 'right', 'left');
  const midX = (ctx.source.x + ctx.target.x) / 2;
  const midY = (ctx.source.y + ctx.target.y) / 2;
  const stroke = ctx.selected ? '#b8402e' : '#5b5347';
  const strokeWidth = ctx.selected ? 3 : 2;

  return (
    <>
      {/* Invisible wider path for hover detection */}
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />

      {/* Selected glow beneath the main path */}
      {ctx.selected && (
        <path
          d={d}
          fill="none"
          stroke="#b8402e"
          opacity={0.3}
          strokeWidth={6}
        />
      )}

      {/* Main visible path */}
      <path
        d={d}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeDasharray="6 4"
        style={isRunning ? { animation: 'async-flow 1s linear infinite' } : undefined}
        markerEnd="url(#edge-arrow)"
      />

      {/* Animated packet dots when simulation is running */}
      {isRunning && (
        <>
          {/* Request packets moving source → target, slower for async */}
          <path
            d={d}
            fill="none"
            stroke="#b8402e"
            strokeWidth={4}
            strokeDasharray="3 20"
            strokeLinecap="round"
            opacity={0.85}
            className="animate-packet-forward-slow"
          />
          {/* Response packets moving target → source */}
          <path
            d={d}
            fill="none"
            stroke="#6b8f71"
            strokeWidth={3}
            strokeDasharray="2 25"
            strokeLinecap="round"
            opacity={0.7}
            className="animate-packet-backward-slow"
          />
        </>
      )}

      {/* Protocol label chip on hover */}
      {hovered && (
        <>
          <rect
            x={midX - 20}
            y={midY - 8}
            width={40}
            height={16}
            rx={8}
            fill="#5b5347"
          />
          <text
            x={midX}
            y={midY + 3.5}
            textAnchor="middle"
            fill="#f3ede2"
            fontSize="10"
          >
            {ctx.data.protocol}
          </text>
        </>
      )}

      {/* CSS animations for edge effects */}
      <style>{`
        @keyframes async-flow {
          0% { stroke-dashoffset: 0; }
          100% { stroke-dashoffset: -20; }
        }
      `}</style>
    </>
  );
}
