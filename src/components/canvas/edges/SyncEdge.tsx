import { useState } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { AnalysysEdge } from '@/types/edges';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';

export function SyncEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
}: EdgeProps<AnalysysEdge>) {
  const [hovered, setHovered] = useState(false);
  const simState = useSimulationStore((s) => s.simState);
  const isRunning = simState === SimState.Running;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });

  return (
    <>
      {/* Invisible wider path for hover detection */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={14}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge
        id={id}
        path={edgePath}
        style={{
          ...style,
          stroke: '#6b7280',
          strokeWidth: 2,
        }}
        markerEnd={markerEnd}
      />

      {/* Animated packet dots when simulation is running */}
      {isRunning && (
        <>
          {/* Request packets (blue dots moving source → target) */}
          <path
            d={edgePath}
            fill="none"
            stroke="#3b82f6"
            strokeWidth={4}
            strokeDasharray="3 15"
            strokeLinecap="round"
            opacity={0.85}
            className="animate-packet-forward"
          />
          {/* Response packets (green dots moving target → source) */}
          <path
            d={edgePath}
            fill="none"
            stroke="#22c55e"
            strokeWidth={3}
            strokeDasharray="2 20"
            strokeLinecap="round"
            opacity={0.7}
            className="animate-packet-backward"
          />
        </>
      )}

      {/* Protocol label on hover */}
      {hovered && (
        <EdgeLabelRenderer>
          <div
            className="pointer-events-none absolute rounded bg-gray-800 px-1.5 py-0.5 text-[10px] font-medium text-gray-300 shadow-lg"
            style={{
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            }}
          >
            {data?.protocol ?? 'SYNC'}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  );
}
