import { memo, useCallback } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { AnalysysNode } from '@/types/nodes';
import { useTopologyStore } from '@/store/topologyStore';
import type { SubsystemGroupFrameData } from './useCollapsedTopologyView';

/**
 * Non-interactive dashed container drawn behind an expanded group's members.
 * Auto-fits the member bounding box (positions are recomputed on every topology
 * change). The only interactive element is the header chip, which collapses the
 * group into its single named box.
 */
function SubsystemGroupFrameNodeInner({ data }: NodeProps<AnalysysNode>) {
  const frameData = data as unknown as SubsystemGroupFrameData;
  const setGroupCollapsed = useTopologyStore((s) => s.setGroupCollapsed);

  const handleCollapse = useCallback(() => {
    setGroupCollapsed(frameData.groupId, true);
  }, [setGroupCollapsed, frameData.groupId]);

  return (
    <div
      className="pointer-events-none h-full w-full rounded-xl border-2 border-dashed border-indigo-400 bg-indigo-500/15"
      aria-label={`Subsystem group: ${frameData.groupName}, ${frameData.memberCount} nodes`}
    >
      <button
        onClick={handleCollapse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') handleCollapse();
        }}
        className="pointer-events-auto absolute -top-3 left-3 flex items-center gap-1.5 rounded-md border border-indigo-500 bg-indigo-950 px-2 py-0.5 text-[10px] font-semibold text-indigo-100 shadow-md hover:bg-indigo-800 focus:outline-none focus:ring-1 focus:ring-indigo-300"
        title="Collapse this group into a single box"
        aria-label={`Collapse group ${frameData.groupName}`}
      >
        <svg
          className="h-3 w-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="max-w-[12rem] truncate">{frameData.groupName}</span>
        <span className="text-gray-500">
          · {frameData.memberCount} node{frameData.memberCount === 1 ? '' : 's'}
        </span>
      </button>
    </div>
  );
}

export const SubsystemGroupFrameNode = memo(SubsystemGroupFrameNodeInner);
