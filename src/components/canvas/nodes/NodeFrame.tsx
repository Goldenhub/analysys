import { useMemo, type ReactNode } from 'react';
import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import { NodeHandles } from '@/canvas/NodeHandles';
import { EditableLabel } from '@/canvas/EditableLabel';
import { useCanvas } from '@/canvas/CanvasContext';
import { useTopologyStore } from '@/store/topologyStore';
import { ChaosStatusBadge } from './ChaosStatusBadge';
import type { NodeType } from '@/types/nodes';
import { canBeParent } from '@/utils/parenting';

// ─── Theme palette (earthy, high-contrast) ───────────────────────
// Nodes render as light cards on the cream canvas so dark ink text and the burnt-red
// accent both read with strong contrast (unlike the previous dark-on-dark scheme).

export const palette = {
  canvas: '#f3ede2',
  surface: '#5b5347',
  ink: '#211e1a',
  accent: '#b8402e',
  healthy: '#6b8f71',
  degraded: '#c49a3c',
  critical: '#8b2e1e',
} as const;

// ─── Shared shell ────────────────────────────────────────────────
// Every processing node uses this frame so the header, handles, chaos badge, selection
// ring, and health border stay consistent across all 15 node types.

export type HealthStatus = 'green' | 'yellow' | 'red';

interface NodeFrameProps {
  id: string;
  nodeType: NodeType;
  label: string;
  icon: ReactNode;
  selected: boolean;
  status?: HealthStatus;
  isDisconnected?: boolean;
  ariaLabel?: string;
  onEdit: NodeRendererProps['onEdit'];
  onConnectStart: NodeRendererProps['onConnectStart'];
  children?: ReactNode;
}

const healthBorder: Record<HealthStatus, string> = {
  green: 'border-[#5f8a66] shadow-[0_0_10px_rgba(107,143,113,0.4)]',
  yellow: 'border-[#b8912f] shadow-[0_0_10px_rgba(196,154,60,0.45)]',
  red: 'border-[#8b2e1e] shadow-[0_0_10px_rgba(139,46,30,0.5)]',
};

export function NodeFrame({
  id,
  nodeType,
  label,
  icon,
  selected,
  status,
  isDisconnected,
  ariaLabel,
  onEdit,
  onConnectStart,
  children,
}: NodeFrameProps) {
  const borderClass = status ? healthBorder[status] : 'border-[#5b5347]/70';
  const enterComponent = useCanvas().enterComponent;
  const nodes = useTopologyStore((s) => s.nodes);
  const childCount = useMemo(
    () => nodes.filter((n) => (n.data.parentNodeId ?? null) === id).length,
    [nodes, id],
  );
  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-[#f3ede2] px-2.5 py-2 shadow-md transition-all duration-300 ease-in-out ${borderClass} ${
        isDisconnected ? 'opacity-70 border-dashed' : ''
      } ${selected ? 'ring-2 ring-[#b8402e] ring-offset-2 ring-offset-[#f3ede2]' : ''}`}
      aria-label={ariaLabel ?? label}
    >
      <ChaosStatusBadge nodeId={id} nodeType={nodeType} />
      {enterComponent && canBeParent(nodeType) && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            enterComponent(id);
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          aria-label={`Open component ${label}`}
          title={
            childCount > 0
              ? `Open ${label} — ${childCount} child node${childCount === 1 ? '' : 's'} inside`
              : `Open ${label} — its layer is empty, drag components in to build it`
          }
          className={`absolute -top-2 left-1/2 z-10 flex h-4 min-w-4 -translate-x-1/2 items-center justify-center rounded-sm border px-1 text-[9px] font-bold tracking-wider transition-colors ${
            childCount > 0
              ? 'border-[#b8402e]/40 bg-[#b8402e] text-[#f3ede2] hover:bg-[#8b2e1e]'
              : 'border-[#5b5347]/25 bg-[#f3ede2]/80 text-[#5b5347]/60 hover:border-[#b8402e]/50 hover:text-[#b8402e]'
          }`}
        >
          {childCount > 0 ? `\u2193${childCount}` : '\u2193'}
        </button>
      )}
      <div className="flex items-center gap-2">
        <span className="shrink-0 text-[#b8402e]">{icon}</span>
        <EditableLabel
          value={label}
          className="truncate text-xs font-semibold text-[#211e1a]"
          onCommit={(next) => onEdit(id, { label: next })}
        />
      </div>
      {children}
      <NodeHandles
        nodeType={nodeType}
        width={140}
        height={80}
        selected={selected}
        onConnectStart={onConnectStart}
      />
    </div>
  );
}

// ─── Metric row ──────────────────────────────────────────────────

interface MetricRowProps {
  label: string;
  value: string;
  valueClass?: string;
}

export function MetricRow({ label, value, valueClass = 'text-[#b8402e]' }: MetricRowProps) {
  return (
    <div className="mt-1.5 flex items-center justify-between gap-2">
      <span className="text-[10px] font-medium uppercase tracking-wide text-[#211e1a]/50">
        {label}
      </span>
      <span className={`text-xs font-bold ${valueClass}`}>{value}</span>
    </div>
  );
}

// ─── Inline progress bar ─────────────────────────────────────────

interface ProgressBarProps {
  pct: number;
  fillClass?: string;
}

export function ProgressBar({ pct, fillClass = 'bg-[#b8402e]' }: ProgressBarProps) {
  return (
    <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-[#5b5347]/20">
      <div
        className={`h-full rounded-full ${fillClass} transition-all`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
