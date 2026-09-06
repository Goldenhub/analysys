import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import type { CanvasNodeData } from '@/canvas/types';
import type { AuthServiceConfig, SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeFrame, MetricRow } from './NodeFrame';

export function AuthServiceNode({ id, data, selected, onEdit, onConnectStart }: { id: string; data: CanvasNodeData; selected: boolean; onEdit: NodeRendererProps['onEdit']; onConnectStart: NodeRendererProps['onConnectStart']; }) {
  const sim = data as SimulationNode;
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = sim.config as AuthServiceConfig;
  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <NodeFrame
      id={id}
      nodeType={NodeType.AuthService}
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
          <path d="M15.75 5.25a3 3 0 0 1 3 3m3 0a6 6 0 0 1-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1 1 21.75 8.25Z" />
        </svg>
      }
      selected={selected}
      status={nodeStatus}
      isDisconnected={isDisconnected}
      ariaLabel={`Auth Service: ${sim.label}, health: ${healthLabel}`}
      onEdit={onEdit}
      onConnectStart={onConnectStart}
    >
      <MetricRow label="Concurrency" value={`${config.concurrencyLimit}`} />
    </NodeFrame>
  );
}