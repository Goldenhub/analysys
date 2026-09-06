import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import type { CanvasNodeData } from '@/canvas/types';
import type { AuthzServiceConfig, SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeFrame, MetricRow } from './NodeFrame';

export function AuthzServiceNode({ id, data, selected, onEdit, onConnectStart }: { id: string; data: CanvasNodeData; selected: boolean; onEdit: NodeRendererProps['onEdit']; onConnectStart: NodeRendererProps['onConnectStart']; }) {
  const sim = data as SimulationNode;
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = sim.config as AuthzServiceConfig;
  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <NodeFrame
      id={id}
      nodeType={NodeType.AuthzService}
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
          <path d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
        </svg>
      }
      selected={selected}
      status={nodeStatus}
      isDisconnected={isDisconnected}
      ariaLabel={`Authz Service: ${sim.label}, health: ${healthLabel}`}
      onEdit={onEdit}
      onConnectStart={onConnectStart}
    >
      <MetricRow label="Deny Rate" value={`${(config.denyRate * 100).toFixed(0)}%`} />
    </NodeFrame>
  );
}