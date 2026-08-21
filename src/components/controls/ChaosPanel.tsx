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

// ─── Icons ───────────────────────────────────────────────────────

function FlameIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M12 23c-3.866 0-7-2.686-7-6 0-1.665.68-3.17 1.8-4.27C8.1 11.44 9.5 10 10 8c.667 1.333 1 2.667 1 4 1.333-1.333 2-3.333 2-6 2 2.667 3.333 5 4 7 .667-1 1-2.333 1-4 .667 2 1 4 1 6 0 3.314-3.134 6-7 6z" />
    </svg>
  );
}

function DatabaseOffIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      <line x1="2" y1="2" x2="22" y2="22" />
    </svg>
  );
}

function ZapIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z" />
    </svg>
  );
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
      <div className="flex items-center gap-2">
        {/* Flush Cache */}
        <Button
          variant="outline"
          size="sm"
          disabled={chaosDisabled}
          onClick={handleFlushCache}
          title={CHAOS_TOOLTIPS.flushCache}
          className="border-amber-700 text-amber-400 hover:bg-amber-900/30 hover:text-amber-300 disabled:border-gray-700 disabled:text-gray-500"
        >
          <FlameIcon />
          <span>Flush Cache</span>
        </Button>

        {/* Drop DB Node */}
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
            <DatabaseOffIcon />
            <span>Drop DB</span>
          </Button>
        </div>

        {/* Spike Traffic */}
        <Button
          variant="outline"
          size="sm"
          disabled={chaosDisabled}
          onClick={handleSpikeTraffic}
          title={CHAOS_TOOLTIPS.spikeTraffic}
          className="border-amber-700 text-amber-400 hover:bg-amber-900/30 hover:text-amber-300 disabled:border-gray-700 disabled:text-gray-500"
        >
          <ZapIcon />
          <span>5× Traffic</span>
        </Button>
      </div>

      {/* Active Chaos Effects */}
      {visibleEffects.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {visibleEffects.map((effect) => (
            <span
              key={effect.id}
              className="inline-flex items-center gap-1 rounded-md bg-amber-900/40 px-2 py-0.5 text-[10px] font-medium text-amber-300"
            >
              <span className="inline-block size-1.5 animate-pulse rounded-full bg-amber-400" />
              {effect.label}
              <span className="ml-1 font-mono text-amber-400">{effect.remainingSec}s</span>
            </span>
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
