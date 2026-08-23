import { useTopologyStore } from '@/store/topologyStore';
import type { SimulationNode } from '@/types/nodes';

/**
 * Resolves node IDs to their user-facing labels. Falls back to a short ID
 * fragment for nodes no longer in the topology (e.g. deleted mid-run).
 */
export function useNodeLabels(): (nodeId: string) => string {
  const nodes = useTopologyStore((s) => s.nodes);
  return (nodeId: string) => {
    const node = nodes.find((n) => n.id === nodeId);
    const label = (node?.data as SimulationNode | undefined)?.label;
    return label ?? `${nodeId.slice(0, 8)}…`;
  };
}
