import type { ReactNode } from 'react';
import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import { NodeHandles } from '@/canvas/NodeHandles';
import { EditableLabel } from '@/canvas/EditableLabel';
import { ChaosStatusBadge } from './ChaosStatusBadge';
import type { NodeType } from '@/types/nodes';

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
  return (
    <div
      className={`relative w-[140px] rounded-lg border-2 bg-[#f3ede2] px-2.5 py-2 shadow-md transition-all duration-300 ease-in-out ${borderClass} ${
        isDisconnected ? 'opacity-70 border-dashed' : ''
      } ${selected ? 'ring-2 ring-[#b8402e] ring-offset-2 ring-offset-[#f3ede2]' : ''}`}
      aria-label={ariaLabel ?? label}
    >
      <ChaosStatusBadge nodeId={id} nodeType={nodeType} />
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
