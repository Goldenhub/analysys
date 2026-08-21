import { useCallback, useMemo, useState } from 'react';
import { useSimulationStore, useTopologyStore } from '@/store';
import type { ActiveChaosEffect, ChaosMetricsSnapshot } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import { NodeType } from '@/types/nodes';
import { Button } from '@/components/ui/button';

// ─── Types ───────────────────────────────────────────────────────

interface ChaosImpactSummary {
  label: string;
  latencyChange: number; // percentage
  errorRateBefore: number;
  errorRateAfter: number;
  throughputChange: number; // percentage
}

// ─── Tooltip Descriptions ────────────────────────────────────────

const CHAOS_TOOLTIPS = {
  flushCache:
    'Resets cache hit ratio to 0% for 30s. All requests bypass cache and hit the database directly, simulating a cache stampede after a cold restart.',
  dropDb:
    'Makes the target database unreachable for 30s. All queries to this node will timeout, simulating a network partition or hardware failure.',
  spikeTraffic:
    'Multiplies incoming request rate by 5× for 15s. Simulates a sudden traffic surge like a marketing event or DDoS attack.',
} as const;

// ─── Active Effect Descriptions ──────────────────────────────────

function getActiveEffectMessage(effect: ActiveChaosEffect, remainingSec: number): string {
  switch (effect.chaosType) {
    case 'FLUSH_CACHE':
      return `Cache is FLUSHED — all requests hitting database directly. ${remainingSec}s remaining.`;
    case 'DROP_DB':
      return `Database is DOWN — all queries timing out. ${remainingSec}s remaining.`;
    case 'SPIKE_TRAFFIC':
      return `Traffic at 5× normal rate. ${remainingSec}s remaining.`;
    default:
      return `${effect.label} active. ${remainingSec}s remaining.`;
  }
}

function getActiveEffectIcon(chaosType: string): string {
  switch (chaosType) {
    case 'FLUSH_CACHE':
      return '🔥';
    case 'DROP_DB':
      return '💀';
    case 'SPIKE_TRAFFIC':
      return '⚡';
    default:
      return '⚠️';
  }
}

// ─── Component ───────────────────────────────────────────────────

export function ChaosPanel() {
  const simState = useSimulationStore((s) => s.simState);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);
  const metrics = useSimulationStore((s) => s.metrics);
  const activeChaosEffects = useSimulationStore((s) => s.activeChaosEffects);
  const addChaosEffect = useSimulationStore((s) => s.addChaosEffect);
  const removeChaosEffect = useSimulationStore((s) => s.removeChaosEffect);
  const addChaosMetricsSnapshot = useSimulationStore((s) => s.addChaosMetricsSnapshot);
  const removeChaosMetricsSnapshot = useSimulationStore((s) => s.removeChaosMetricsSnapshot);
  const chaosMetricsSnapshots = useSimulationStore((s) => s.chaosMetricsSnapshots);
  const nodes = useTopologyStore((s) => s.nodes);

  const [selectedDbNodeId, setSelectedDbNodeId] = useState<string>('');
  const [impactSummaries, setImpactSummaries] = useState<ChaosImpactSummary[]>([]);

  // ─── Derived ─────────────────────────────────────────────────

  const dbNodes = useMemo(
    () => nodes.filter((n) => (n.data as { nodeType: string }).nodeType === NodeType.Database),
    [nodes],
  );

  const chaosDisabled = simState === SimState.Idle || simState === SimState.Complete;
  const currentSimTime = metrics?.simulatedTimeMs ?? 0;

  // ─── Helpers ─────────────────────────────────────────────────

  const captureMetricsSnapshot = useCallback(
    (effectId: string) => {
      if (!metrics) return;
      const snapshot: ChaosMetricsSnapshot = {
        effectId,
        latencyP50: metrics.systemWide.endToEndLatency.p50,
        latencyP99: metrics.systemWide.endToEndLatency.p99,
        errorRate: metrics.systemWide.totalErrorRate,
        throughput: metrics.systemWide.totalThroughput,
      };
      addChaosMetricsSnapshot(snapshot);
    },
    [metrics, addChaosMetricsSnapshot],
  );

  const computeImpactSummary = useCallback(
    (effect: ActiveChaosEffect): ChaosImpactSummary | null => {
      const beforeSnapshot = chaosMetricsSnapshots.find((s) => s.effectId === effect.id);
      if (!beforeSnapshot || !metrics) return null;

      const latencyChange =
        beforeSnapshot.latencyP99 > 0
          ? ((metrics.systemWide.endToEndLatency.p99 - beforeSnapshot.latencyP99) / beforeSnapshot.latencyP99) * 100
          : 0;

      const throughputChange =
        beforeSnapshot.throughput > 0
          ? ((metrics.systemWide.totalThroughput - beforeSnapshot.throughput) / beforeSnapshot.throughput) * 100
          : 0;

      return {
        label: effect.label,
        latencyChange: Math.round(latencyChange),
        errorRateBefore: Math.round(beforeSnapshot.errorRate * 100),
        errorRateAfter: Math.round(metrics.systemWide.totalErrorRate * 100),
        throughputChange: Math.round(throughputChange),
      };
    },
    [chaosMetricsSnapshots, metrics],
  );

  const scheduleEffectRemoval = useCallback(
    (effect: ActiveChaosEffect) => {
      setTimeout(() => {
        // Compute impact before removing
        const summary = computeImpactSummary(effect);
        if (summary) {
          setImpactSummaries((prev) => [...prev.slice(-2), summary]);
          // Auto-dismiss after 8 seconds
          setTimeout(() => {
            setImpactSummaries((prev) => prev.filter((s) => s.label !== summary.label));
          }, 8000);
        }
        removeChaosEffect(effect.id);
        removeChaosMetricsSnapshot(effect.id);
      }, effect.durationMs);
    },
    [computeImpactSummary, removeChaosEffect, removeChaosMetricsSnapshot],
  );

  // ─── Chaos Handlers ──────────────────────────────────────────

  const handleFlushCache = useCallback(() => {
    const effect: ActiveChaosEffect = {
      id: `flush-cache-${Date.now()}`,
      chaosType: 'FLUSH_CACHE',
      label: 'Cache Stampede',
      description: CHAOS_TOOLTIPS.flushCache,
      startTimeMs: currentSimTime,
      durationMs: 30_000,
    };

    sendToWorker({
      type: 'CHAOS_EVENT',
      payload: {
        chaosType: 'FLUSH_CACHE',
        durationMs: 30_000,
        params: {},
      },
    });

    addChaosEffect(effect);
    captureMetricsSnapshot(effect.id);
    scheduleEffectRemoval(effect);
  }, [sendToWorker, addChaosEffect, captureMetricsSnapshot, scheduleEffectRemoval, currentSimTime]);

  const handleDropDb = useCallback(() => {
    const firstDb = dbNodes[0];
    const targetId = dbNodes.length === 1 && firstDb ? firstDb.id : selectedDbNodeId;
    if (!targetId) return;

    const effect: ActiveChaosEffect = {
      id: `drop-db-${Date.now()}`,
      chaosType: 'DROP_DB',
      targetNodeId: targetId,
      label: `DB Partition (${targetId.slice(0, 8)})`,
      description: CHAOS_TOOLTIPS.dropDb,
      startTimeMs: currentSimTime,
      durationMs: 30_000,
    };

    sendToWorker({
      type: 'CHAOS_EVENT',
      payload: {
        chaosType: 'DROP_DB',
        targetNodeId: targetId,
        durationMs: 30_000,
        params: {},
      },
    });

    addChaosEffect(effect);
    captureMetricsSnapshot(effect.id);
    scheduleEffectRemoval(effect);
  }, [sendToWorker, dbNodes, selectedDbNodeId, addChaosEffect, captureMetricsSnapshot, scheduleEffectRemoval, currentSimTime]);

  const handleSpikeTraffic = useCallback(() => {
    const effect: ActiveChaosEffect = {
      id: `spike-traffic-${Date.now()}`,
      chaosType: 'SPIKE_TRAFFIC',
      label: 'Traffic Spike (5×)',
      description: CHAOS_TOOLTIPS.spikeTraffic,
      startTimeMs: currentSimTime,
      durationMs: 15_000,
    };

    sendToWorker({
      type: 'CHAOS_EVENT',
      payload: {
        chaosType: 'SPIKE_TRAFFIC',
        durationMs: 15_000,
        params: { multiplier: 5 },
      },
    });

    addChaosEffect(effect);
    captureMetricsSnapshot(effect.id);
    scheduleEffectRemoval(effect);
  }, [sendToWorker, addChaosEffect, captureMetricsSnapshot, scheduleEffectRemoval, currentSimTime]);

  // ─── Active Effects Display ──────────────────────────────────

  const visibleEffects = activeChaosEffects.map((effect) => {
    const elapsed = currentSimTime - effect.startTimeMs;
    const remaining = Math.max(0, effect.durationMs - elapsed);
    const remainingSec = Math.ceil(remaining / 1000);
    return { ...effect, remainingSec };
  });

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-2">
      {/* Section Header */}
      <div className="flex items-center gap-1.5">
        <span className="text-xs">🔬</span>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
          Chaos Engineering
        </span>
        <span className="text-[10px] text-gray-500">— Inject failures to test resilience</span>
      </div>

      {/* Chaos Buttons with Descriptions */}
      <div className="flex items-start gap-3">
        {/* Flush Cache */}
        <div className="flex flex-col items-center gap-0.5">
          <Button
            variant="outline"
            size="sm"
            disabled={chaosDisabled}
            onClick={handleFlushCache}
            title={CHAOS_TOOLTIPS.flushCache}
            className="border-amber-700 text-amber-400 hover:bg-amber-900/30 hover:text-amber-300 disabled:border-gray-700 disabled:text-gray-500"
          >
            <span>🔥</span>
            <span>Flush Cache</span>
          </Button>
          <span className="text-[9px] text-gray-500">Stampede: 0% hit rate for 30s</span>
        </div>

        {/* Drop DB Node */}
        <div className="flex flex-col items-center gap-0.5">
          <div className="flex items-center gap-1">
            {dbNodes.length > 1 && (
              <select
                value={selectedDbNodeId}
                onChange={(e) => setSelectedDbNodeId(e.target.value)}
                disabled={chaosDisabled}
                className="h-7 rounded-md border border-gray-700 bg-gray-800 px-1.5 text-xs text-gray-200 outline-none focus:border-red-500 disabled:opacity-50"
              >
                <option value="">Select DB…</option>
                {dbNodes.map((node) => (
                  <option key={node.id} value={node.id}>
                    {(node.data as { label: string }).label || node.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={chaosDisabled || (dbNodes.length > 1 && !selectedDbNodeId) || dbNodes.length === 0}
              onClick={handleDropDb}
              title={CHAOS_TOOLTIPS.dropDb}
              className="border-red-700 text-red-400 hover:bg-red-900/30 hover:text-red-300 disabled:border-gray-700 disabled:text-gray-500"
            >
              <span>💀</span>
              <span>Drop DB</span>
            </Button>
          </div>
          <span className="text-[9px] text-gray-500">Partition: DB unreachable for 30s</span>
        </div>

        {/* Spike Traffic */}
        <div className="flex flex-col items-center gap-0.5">
          <Button
            variant="outline"
            size="sm"
            disabled={chaosDisabled}
            onClick={handleSpikeTraffic}
            title={CHAOS_TOOLTIPS.spikeTraffic}
            className="border-amber-700 text-amber-400 hover:bg-amber-900/30 hover:text-amber-300 disabled:border-gray-700 disabled:text-gray-500"
          >
            <span>⚡</span>
            <span>5× Traffic</span>
          </Button>
          <span className="text-[9px] text-gray-500">Surge: 5× request rate for 15s</span>
        </div>
      </div>

      {/* Active Chaos Effects — Clear Sentences */}
      {visibleEffects.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-amber-800/50 bg-amber-950/30 p-2">
          {visibleEffects.map((effect) => (
            <div
              key={effect.id}
              className="flex items-start gap-1.5 text-xs text-amber-200"
            >
              <span className="shrink-0">{getActiveEffectIcon(effect.chaosType)}</span>
              <span className="leading-tight">
                {getActiveEffectMessage(effect, effect.remainingSec)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Post-Chaos Impact Summaries */}
      {impactSummaries.length > 0 && (
        <div className="flex flex-col gap-1">
          {impactSummaries.map((summary, idx) => (
            <div
              key={`${summary.label}-${idx}`}
              className="rounded-md border border-amber-700/50 bg-amber-950/40 px-2.5 py-1.5 text-[10px] text-amber-200"
            >
              <span className="font-semibold text-amber-300">{summary.label} Impact:</span>{' '}
              Latency {summary.latencyChange >= 0 ? '+' : ''}
              {summary.latencyChange}%, Error rate {summary.errorRateBefore}% → {summary.errorRateAfter}%
              {summary.throughputChange !== 0 && (
                <>, Throughput {summary.throughputChange >= 0 ? '+' : ''}{summary.throughputChange}%</>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
