import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import type { CanvasNodeData } from '@/canvas/types';
import type { ApiGatewayConfig, SimulationNode } from '@/types/nodes';
import { NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeFrame, MetricRow } from './NodeFrame';

export function ApiGatewayNode({ id, data, selected, onEdit, onConnectStart }: { id: string; data: CanvasNodeData; selected: boolean; onEdit: NodeRendererProps['onEdit']; onConnectStart: NodeRendererProps['onConnectStart']; }) {
  const sim = data as SimulationNode;
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = sim.config as ApiGatewayConfig;
  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <NodeFrame
      id={id}
      nodeType={NodeType.ApiGateway}
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
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
          <path d="M10 17l5-5-5-5" />
          <path d="M15 12H3" />
        </svg>
      }
      selected={selected}
      status={nodeStatus}
      isDisconnected={isDisconnected}
      ariaLabel={`API Gateway: ${sim.label}, health: ${healthLabel}`}
      onEdit={onEdit}
      onConnectStart={onConnectStart}
    >
      <MetricRow label="Auth" value={`${config.authLatencyMeanMs}ms`} />
    </NodeFrame>
  );
}