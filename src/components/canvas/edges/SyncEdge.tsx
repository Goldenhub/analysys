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
          {/* Request packets (blue, source → target) */}
          {[0, 0.4, 0.8].map((delay) => (
            <circle
              key={`req-${delay}`}
              r={3}
              fill="#3b82f6"
              opacity={0.85}
            >
              <animateMotion
                dur="1.8s"
                repeatCount="indefinite"
                begin={`${delay * 1.8}s`}
                path={edgePath}
              />
            </circle>
          ))}
          {/* Response packets (green, target → source) */}
          {[0.2, 0.6].map((delay) => (
            <circle
              key={`resp-${delay}`}
              r={2.5}
              fill="#22c55e"
              opacity={0.75}
            >
              <animateMotion
                dur="2.2s"
                repeatCount="indefinite"
                begin={`${delay * 2.2}s`}
                path={edgePath}
                keyPoints="1;0"
                keyTimes="0;1"
              />
            </circle>
          ))}
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
