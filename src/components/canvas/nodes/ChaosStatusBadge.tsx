import { useSimulationStore } from '@/store/simulationStore';
import { NodeType } from '@/types/nodes';

// ─── Types ───────────────────────────────────────────────────────

interface ChaosStatusBadgeProps {
  nodeId: string;
  nodeType: NodeType;
}

// ─── Badge Config ────────────────────────────────────────────────

interface ChaosBadgeConfig {
  label: string;
  bgColor: string;
  textColor: string;
  borderColor: string;
}

function getBadgeConfig(chaosType: string): ChaosBadgeConfig {
  switch (chaosType) {
    case 'FLUSH_CACHE':
      return {
        label: 'FLUSHED',
        bgColor: 'bg-amber-900/80',
        textColor: 'text-amber-200',
        borderColor: 'border-amber-500',
      };
    case 'DROP_DB':
      return {
        label: 'PARTITIONED',
        bgColor: 'bg-red-900/80',
        textColor: 'text-red-200',
        borderColor: 'border-red-500',
      };
    case 'SPIKE_TRAFFIC':
      return {
        label: '5\u00d7 LOAD',
        bgColor: 'bg-amber-900/80',
        textColor: 'text-amber-200',
        borderColor: 'border-amber-500',
      };
    default:
      return {
        label: 'CHAOS',
        bgColor: 'bg-red-900/80',
        textColor: 'text-red-200',
        borderColor: 'border-red-500',
      };
  }
}

/**
 * Determines which chaos types affect a given node type.
 */
function isNodeAffectedByChaos(
  chaosType: string,
  nodeType: NodeType,
  targetNodeId: string | undefined,
  nodeId: string,
): boolean {
  switch (chaosType) {
    case 'FLUSH_CACHE':
      return nodeType === NodeType.Cache;
    case 'DROP_DB':
      // Affects only the targeted DB node (or all DB nodes if no target specified)
      if (nodeType !== NodeType.Database) return false;
      return targetNodeId ? targetNodeId === nodeId : true;
    case 'SPIKE_TRAFFIC':
      return nodeType === NodeType.TrafficGenerator;
    default:
      return false;
  }
}

// ─── Component ───────────────────────────────────────────────────

export function ChaosStatusBadge({ nodeId, nodeType }: ChaosStatusBadgeProps) {
  const activeChaosEffects = useSimulationStore((s) => s.activeChaosEffects);

  const activeEffect = activeChaosEffects.find((effect) =>
    isNodeAffectedByChaos(effect.chaosType, nodeType, effect.targetNodeId, nodeId),
  );

  if (!activeEffect) return null;

  const config = getBadgeConfig(activeEffect.chaosType);
  const isPartitioned = activeEffect.chaosType === 'DROP_DB';

  return (
    <>
      {/* Chaos border pulse overlay */}
      <div
        className="pointer-events-none absolute inset-0 rounded-lg border-2 border-red-500 animate-[chaos-pulse_1s_ease-in-out_infinite]"
        style={{
          animation: 'chaos-pulse 1s ease-in-out infinite',
        }}
      />

      {/* Badge */}
      <div
        className={`absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-sm border px-1 py-px text-[8px] font-bold uppercase tracking-wider whitespace-nowrap ${config.bgColor} ${config.textColor} ${config.borderColor}`}
      >
        {config.label}
      </div>

      {/* Gray-out / slash overlay for partitioned DB */}
      {isPartitioned && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-gray-900/60">
          <svg
            className="h-8 w-8 text-red-500 opacity-70"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          >
            <line x1="4" y1="4" x2="20" y2="20" />
          </svg>
        </div>
      )}
    </>
  );
}
