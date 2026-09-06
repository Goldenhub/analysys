import type { NodeRendererProps } from '@/canvas/CanvasEngine';
import type { CanvasNodeData } from '@/canvas/types';
import type { LoadBalancerConfig, SimulationNode } from '@/types/nodes';
import { LBAlgorithm, NodeType } from '@/types/nodes';
import { useSimulationStore } from '@/store/simulationStore';
import { useTopologyStore } from '@/store/topologyStore';
import { NodeFrame, MetricRow } from './NodeFrame';

const algorithmLabels: Record<LBAlgorithm, string> = {
  [LBAlgorithm.RoundRobin]: 'RR',
  [LBAlgorithm.LeastConnections]: 'LC',
};

export function LoadBalancerNode({ id, data, selected, onEdit, onConnectStart }: { id: string; data: CanvasNodeData; selected: boolean; onEdit: NodeRendererProps['onEdit']; onConnectStart: NodeRendererProps['onConnectStart']; }) {
  const sim = data as SimulationNode;
  const nodeStatus = useSimulationStore((s) => s.nodeStatuses.get(id));
  const edges = useTopologyStore((s) => s.edges);
  const isDisconnected = !edges.some((e) => e.source === id || e.target === id);

  const config = sim.config as LoadBalancerConfig;
  const healthLabel = nodeStatus ?? 'nominal';

  return (
    <NodeFrame
      id={id}
      nodeType={NodeType.LoadBalancer}
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
          <path d="M12 3v18" />
          <path d="M3 12h18" />
          <path d="M7 7l-4 5 4 5" />
          <path d="M17 7l4 5-4 5" />
        </svg>
      }
      selected={selected}
      status={nodeStatus}
      isDisconnected={isDisconnected}
      ariaLabel={`Load Balancer: ${sim.label}, health: ${healthLabel}`}
      onEdit={onEdit}
      onConnectStart={onConnectStart}
    >
      <MetricRow label="Algorithm" value={algorithmLabels[config.algorithm]} valueClass="text-[#211e1a]" />
    </NodeFrame>
  );
}