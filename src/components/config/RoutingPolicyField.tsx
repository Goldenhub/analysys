import { useMemo } from 'react';
import { RoutingPolicy } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { useTopologyStore } from '@/store/topologyStore';

// ─── Types ───────────────────────────────────────────────────────

interface RoutingPolicyFieldProps {
  nodeId: string;
  routingPolicy: RoutingPolicy;
}

// ─── Policy Options ──────────────────────────────────────────────

const POLICY_OPTIONS: { value: RoutingPolicy; label: string }[] = [
  { value: RoutingPolicy.First, label: 'First' },
  { value: RoutingPolicy.RoundRobin, label: 'Round Robin' },
  { value: RoutingPolicy.Weighted, label: 'Weighted' },
  { value: RoutingPolicy.FanOut, label: 'Fan Out' },
];

// ─── Component ───────────────────────────────────────────────────

/**
 * Routing policy select (R32) for any node type permitting two or more outgoing edges.
 * Displays the policy selector, and when Weighted is selected, shows per-edge weight
 * inputs alongside each configured and normalised weight (to 2 decimal places).
 */
export function RoutingPolicyField({ nodeId, routingPolicy }: RoutingPolicyFieldProps) {
  const edges = useTopologyStore((s) => s.edges);
  const updateNodeRoutingPolicy = useTopologyStore((s) => s.updateNodeRoutingPolicy);
  const updateEdgeWeight = useTopologyStore((s) => s.updateEdgeWeight);
  const nodes = useTopologyStore((s) => s.nodes);

  // Outgoing edges for this node
  const outgoingEdges: EdgeData[] = useMemo(() => {
    return edges
      .filter((e) => e.source === nodeId && e.data)
      .map((e) => e.data as EdgeData);
  }, [edges, nodeId]);

  // Only show this field if the node has 2+ outgoing edges
  if (outgoingEdges.length < 2) return null;

  // Compute normalised weights for display
  const weightSum = outgoingEdges.reduce((sum, e) => sum + (e.weight ?? 1), 0);
  const normalisedWeights = outgoingEdges.map((e) => {
    const w = e.weight ?? 1;
    if (weightSum <= 0 || !isFinite(weightSum)) {
      return 1 / outgoingEdges.length;
    }
    return w / weightSum;
  });

  // Look up target node labels for display
  const getTargetLabel = (targetId: string): string => {
    const targetNode = nodes.find((n) => n.id === targetId);
    const data = targetNode?.data as { label?: string } | undefined;
    return data?.label ?? targetId.slice(0, 8);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Policy selector */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Routing Policy</label>
        <select
          value={routingPolicy}
          onChange={(e) => updateNodeRoutingPolicy(nodeId, e.target.value as RoutingPolicy)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
          aria-label="Routing policy"
        >
          {POLICY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Per-edge weight inputs — shown only when Weighted is selected */}
      {routingPolicy === RoutingPolicy.Weighted && (
        <div className="flex flex-col gap-1.5 rounded-md border border-gray-700 bg-gray-900/50 p-2">
          <span className="text-xs font-medium text-gray-400">Edge Weights</span>
          {outgoingEdges.map((edge, idx) => (
            <div key={edge.id} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-xs text-gray-300" title={edge.target}>
                &rarr; {getTargetLabel(edge.target)}
              </span>
              <input
                type="number"
                value={edge.weight ?? 1}
                min={0}
                step={0.1}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (isFinite(val) && val >= 0) {
                    updateEdgeWeight(edge.id, val);
                  }
                }}
                className="w-16 rounded border border-gray-700 bg-gray-800 px-1.5 py-1 text-right text-xs text-gray-200 outline-none focus:border-indigo-500"
                aria-label={`Weight for edge to ${getTargetLabel(edge.target)}`}
              />
              <span className="w-12 text-right text-xs text-gray-500">
                ({normalisedWeights[idx]!.toFixed(2)})
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
