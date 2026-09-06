import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import type { CanvasNodeData } from '@/canvas/types';
import type { MessageQueueConfig, SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeFrame, MetricRow, ProgressBar } from './NodeFrame';

export function MessageQueueNode({ id, data, selected, onEdit, onConnectStart }: { id: string; data: CanvasNodeData; selected: boolean; onEdit: NodeRendererProps['onEdit']; onConnectStart: NodeRendererProps['onConnectStart']; }) {
  const sim = data as SimulationNode;
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = sim.config as MessageQueueConfig;
  const bufferPct = Math.min(100, (config.backpressureThresholdPct / 100) * 100);
  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <NodeFrame
      id={id}
      nodeType={NodeType.MessageQueue}
      label={sim.label}
      icon={
        <svg
          className="h-5 w-5"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="4" rx="1" />
          <rect x="3" y="10" width="18" height="4" rx="1" />
          <rect x="3" y="17" width="18" height="4" rx="1" />
        </svg>
      }
      selected={selected}
      status={nodeStatus}
      isDisconnected={isDisconnected}
      ariaLabel={`Message Queue: ${sim.label}, health: ${healthLabel}`}
      onEdit={onEdit}
      onConnectStart={onConnectStart}
    >
      <MetricRow label="Buffer" value={`${config.bufferCapacity.toLocaleString()}`} />
      <ProgressBar pct={bufferPct} />
    </NodeFrame>
  );
}