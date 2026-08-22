import { memo, useState, useCallback } from 'react';
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react';
import type { AnalysysEdge } from '@/types/edges';
import type { MergedBoundaryEdgeData } from './useCollapsedTopologyView';

function MergedBoundaryEdgeInner({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
}: EdgeProps<AnalysysEdge>) {
  const [showDetails, setShowDetails] = useState(false);
  const mergedData = data as unknown as MergedBoundaryEdgeData;
  const count = mergedData?.underlyingCount ?? 1;

  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
  });

  const handleFocus = useCallback(() => setShowDetails(true), []);
  const handleBlur = useCallback(() => setShowDetails(false), []);

  return (
    <>
      <BaseEdge id={id} path={edgePath} className="stroke-indigo-400 stroke-[2]" />
      <EdgeLabelRenderer>
        <div
          className="absolute pointer-events-auto"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
          }}
          onMouseEnter={handleFocus}
          onMouseLeave={handleBlur}
          onFocus={handleFocus}
          onBlur={handleBlur}
          tabIndex={0}
          role="button"
          aria-label={`Merged edge: ${count} underlying edge${count > 1 ? 's' : ''}`}
          aria-expanded={showDetails}
        >
          {/* Badge showing count */}
          <span className="inline-flex items-center justify-center rounded-full bg-indigo-700 px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm">
            {count}×
          </span>

          {/* Detail tooltip on hover/focus */}
          {showDetails && mergedData && (
            <div
              className="absolute left-1/2 top-full z-50 mt-1 -translate-x-1/2 whitespace-nowrap rounded bg-gray-800 px-2 py-1.5 text-[10px] text-gray-200 shadow-lg border border-gray-700"
              role="tooltip"
            >
              <div className="font-medium text-gray-100 mb-0.5">
                {count} merged edge{count > 1 ? 's' : ''}
              </div>
              {mergedData.memberLabels.map((label, i) => (
                <div key={`${label}-${i}`} className="flex items-center gap-1">
                  <span className="text-gray-300">{label}</span>
                  <span className="text-gray-500">({mergedData.memberProtocols[i]})</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

export const MergedBoundaryEdge = memo(MergedBoundaryEdgeInner);
