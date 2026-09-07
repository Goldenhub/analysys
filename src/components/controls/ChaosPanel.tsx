import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSimulationStore, useTopologyStore } from '@/store';
import type { ActiveChaosEffect, ChaosMetricsSnapshot } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import { NodeType } from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { Button } from '@/components/ui/button';
import { computeSpofsSync } from '@/analysis/reachability';

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
    'Resets cache hit ratio to 0% for the chosen duration. All requests bypass cache and hit the database directly, modeling a cold cache after a restart.',
  dropDb:
    'Makes the target database node unreachable for the chosen duration. Queries to it timeout immediately, and load balancers eject it from rotation.',
  spikeTraffic:
    'Multiplies incoming request rate by 5× for the chosen duration. Models a sudden traffic surge like a marketing event or DDoS attack.',
  disableNode:
    'Takes the target node completely offline. All arriving requests timeout and held requests are terminated. Models hardware failure or network partition.',
  redriveDlq:
    'Manually triggers a redrive of retained dead-lettered messages in the target Dead Letter Queue.',
} as const;

const NOT_RUNNING_TITLE = 'Start a simulation first — chaos applies to a running system.';

// ─── Active Effect Descriptions ──────────────────────────────────

function getActiveEffectMessage(effect: ActiveChaosEffect, remainingSec: number): string {
  switch (effect.chaosType) {
    case 'FLUSH_CACHE':
      return `Cache is FLUSHED — all requests hit the database directly. ${remainingSec}s remaining.`;
    case 'DROP_DB':
      return `Database is DOWN — queries timing out, load balancers routing away. ${remainingSec}s remaining.`;
    case 'SPIKE_TRAFFIC':
      return `Traffic at 5× normal rate. ${remainingSec}s remaining.`;
    case 'DISABLE_NODE':
      return `${effect.label} — all requests timing out. ${remainingSec}s remaining.`;
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
    case 'DISABLE_NODE':
      return '🔌';
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
  const addChaosMetricsSnapshot = useSimulationStore((s) => s.addChaosMetricsSnapshot);
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);

  const [isOpen, setIsOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const [selectedDbNodeId, setSelectedDbNodeId] = useState<string>('');
  const [impactSummaries, setImpactSummaries] = useState<ChaosImpactSummary[]>([]);
  const [selectedDisableNodeId, setSelectedDisableNodeId] = useState<string>('');
  const [disableDurationMs, setDisableDurationMs] = useState<number>(10_000);
  const [selectedDlqNodeId, setSelectedDlqNodeId] = useState<string>('');

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(event: MouseEvent) {
      if (panelRef.current && !panelRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // ─── Derived ─────────────────────────────────────────────────

  const dbNodes = useMemo(
    () => nodes.filter((n) => (n.data as { nodeType: string }).nodeType === NodeType.Database),
    [nodes],
  );

  const allNodes = useMemo(
    () =>
      nodes.filter((n) => {
        const nt = (n.data as { nodeType: string }).nodeType;
        // All 15 node types are eligible for DISABLE_NODE
        return Object.values(NodeType).includes(nt as NodeType);
      }),
    [nodes],
  );

  const dlqNodes = useMemo(
    () =>
      nodes.filter((n) => (n.data as { nodeType: string }).nodeType === NodeType.DeadLetterQueue),
    [nodes],
  );

  // SPOF reachability status (task 522)
  const spofStatus = useMemo(() => {
    if (nodes.length === 0) return null;
    const simNodes = nodes.map((n) => n.data as SimulationNode);
    const edgeData = edges.map((e) => e.data as EdgeData);
    try {
      const result = computeSpofsSync(simNodes, edgeData);
      return result;
    } catch {
      return null;
    }
  }, [nodes, edges]);

  const chaosDisabled = simState === SimState.Idle || simState === SimState.Complete;
  const disableNodeDisabled = simState !== SimState.Running; // Only while Running, not Paused
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

  // ─── Effect Expiry (simulated time — never wall-clock) ───────
  //
  // The engine reverts each chaos effect via ChaosEnd events scheduled at
  // startTimeMs + durationMs in SIMULATED time. The UI mirrors that boundary:
  // expired effects are filtered out of the display during render, and the
  // underlying store entries are reaped by subscribing to simulation-store
  // updates (an external system) rather than by setState-inside-effect.

  const expiredEffectsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return useSimulationStore.subscribe((state, prevState) => {
      const newTime = state.metrics?.simulatedTimeMs;
      const oldTime = prevState.metrics?.simulatedTimeMs;
      if (newTime === undefined || newTime === oldTime) return;
      if (state.activeChaosEffects.length === 0) {
        expiredEffectsRef.current.clear();
        return;
      }

      for (const effect of state.activeChaosEffects) {
        if (expiredEffectsRef.current.has(effect.id)) continue;
        if (effect.durationMs > 0 && newTime >= effect.startTimeMs + effect.durationMs) {
          expiredEffectsRef.current.add(effect.id);

          // Impact summary from the pre-chaos snapshot vs now.
          const beforeSnapshot = state.chaosMetricsSnapshots.find((s) => s.effectId === effect.id);
          if (beforeSnapshot && state.metrics) {
            const latencyChange =
              beforeSnapshot.latencyP99 > 0
                ? ((state.metrics.systemWide.endToEndLatency.p99 - beforeSnapshot.latencyP99) /
                    beforeSnapshot.latencyP99) *
                  100
                : 0;
            const throughputChange =
              beforeSnapshot.throughput > 0
                ? ((state.metrics.systemWide.totalThroughput - beforeSnapshot.throughput) /
                    beforeSnapshot.throughput) *
                  100
                : 0;
            const summary: ChaosImpactSummary = {
              label: effect.label,
              latencyChange: Math.round(latencyChange),
              errorRateBefore: Math.round(beforeSnapshot.errorRate * 100),
              errorRateAfter: Math.round(state.metrics.systemWide.totalErrorRate * 100),
              throughputChange: Math.round(throughputChange),
            };
            setImpactSummaries((prev) => [...prev.slice(-2), summary]);
            // Cosmetic only: dismiss the summary line after a few real seconds.
            setTimeout(() => {
              setImpactSummaries((prev) => prev.filter((s) => s.label !== summary.label));
            }, 8000);
          }
          state.removeChaosEffect(effect.id);
          state.removeChaosMetricsSnapshot(effect.id);
        }
      }
    });
  }, []);

  // Auto-select when exactly one target exists so selectors always show intent —
  // derived during render rather than synced via effect.
  const effectiveDbNodeId = dbNodes.some((n) => n.id === selectedDbNodeId)
    ? selectedDbNodeId
    : (dbNodes[0]?.id ?? '');
  const effectiveDlqNodeId = dlqNodes.some((n) => n.id === selectedDlqNodeId)
    ? selectedDlqNodeId
    : (dlqNodes[0]?.id ?? '');

  // ─── Chaos Handlers ──────────────────────────────────────────

  const handleFlushCache = useCallback(() => {
    const effect: ActiveChaosEffect = {
      id: `flush-cache-${Date.now()}`,
      chaosType: 'FLUSH_CACHE',
      label: 'Cold Cache (0% hit rate)',
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
  }, [sendToWorker, addChaosEffect, captureMetricsSnapshot, currentSimTime]);

  const handleDropDb = useCallback(() => {
    const targetId = effectiveDbNodeId;
    if (!targetId) return;

    // Prefer the node's label for the chip so users see which DB died.
    const targetNode = dbNodes.find((n) => n.id === targetId);
    const label = targetNode
      ? (targetNode.data as { label?: string }).label || targetId.slice(0, 8)
      : targetId.slice(0, 8);

    const effect: ActiveChaosEffect = {
      id: `drop-db-${Date.now()}`,
      chaosType: 'DROP_DB',
      targetNodeId: targetId,
      label: `DB Outage (${label})`,
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
        // Forwarded to LoadBalancer processors so they eject the DB instantly.
        params: { targetNodeId: targetId },
      },
    });

    addChaosEffect(effect);
    captureMetricsSnapshot(effect.id);
  }, [
    sendToWorker,
    dbNodes,
    effectiveDbNodeId,
    addChaosEffect,
    captureMetricsSnapshot,
    currentSimTime,
  ]);

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
  }, [sendToWorker, addChaosEffect, captureMetricsSnapshot, currentSimTime]);

  const handleDisableNode = useCallback(() => {
    if (!selectedDisableNodeId) return;
    const targetNode = allNodes.find((n) => n.id === selectedDisableNodeId);
    const label = targetNode
      ? (targetNode.data as { label?: string }).label || targetNode.id.slice(0, 8)
      : selectedDisableNodeId.slice(0, 8);

    const effect: ActiveChaosEffect = {
      id: `disable-node-${Date.now()}`,
      chaosType: 'DISABLE_NODE',
      targetNodeId: selectedDisableNodeId,
      label: `Node Failure (${label})`,
      description: CHAOS_TOOLTIPS.disableNode,
      startTimeMs: currentSimTime,
      durationMs: disableDurationMs,
    };

    sendToWorker({
      type: 'CHAOS_EVENT',
      payload: {
        chaosType: 'DISABLE_NODE',
        targetNodeId: selectedDisableNodeId,
        durationMs: disableDurationMs,
        params: {},
      },
    });

    addChaosEffect(effect);
    captureMetricsSnapshot(effect.id);
  }, [
    sendToWorker,
    selectedDisableNodeId,
    disableDurationMs,
    allNodes,
    addChaosEffect,
    captureMetricsSnapshot,
    currentSimTime,
  ]);

  const handleRedriveDlq = useCallback(() => {
    const targetId = effectiveDlqNodeId;
    if (!targetId) return;

    sendToWorker({
      type: 'CHAOS_EVENT',
      payload: {
        chaosType: 'REDRIVE_DLQ',
        targetNodeId: targetId,
        durationMs: 0,
        params: {},
      },
    });
  }, [sendToWorker, effectiveDlqNodeId]);

  // ─── Active Effects Display ──────────────────────────────────

  // Expired effects drop out of the display during render; the store reap
  // happens in the subscription above.
  const visibleEffects = activeChaosEffects
    .filter(
      (effect) => effect.durationMs <= 0 || currentSimTime < effect.startTimeMs + effect.durationMs,
    )
    .map((effect) => {
      const elapsed = currentSimTime - effect.startTimeMs;
      const remaining = Math.max(0, effect.durationMs - elapsed);
      const remainingSec = Math.ceil(remaining / 1000);
      return { ...effect, remainingSec };
    });

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="relative" ref={panelRef}>
      {/* Toggle Button */}
      <Button
        variant="outline"
        size="sm"
        onClick={() => setIsOpen((prev) => !prev)}
        className={`border-[#8a6418]/60 text-[#8a6418] hover:bg-[#8a6418]/15 hover:text-[#8a6418] ${
          activeChaosEffects.length > 0 ? 'animate-pulse' : ''
        }`}
        aria-expanded={isOpen}
        aria-haspopup="true"
        data-tour="chaos"
      >
        <span>⚡</span>
        <span>Chaos</span>
        {activeChaosEffects.length > 0 && (
          <span className="ml-1 rounded-full bg-[#c49a3c] px-1.5 text-[10px] text-[#211e1a]">
            {activeChaosEffects.length}
          </span>
        )}
      </Button>

      {/* Floating Panel */}
      {isOpen && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[480px] max-w-[90vw] rounded-lg border border-[#5b5347]/30 bg-[#5b5347] p-4 shadow-xl">
          <div className="flex flex-col gap-2">
            {/* Section Header */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs">🔬</span>
              <span className="text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/80">
                Chaos Engineering
              </span>
              <span className="text-[10px] text-[#f3ede2]/75">
                — Inject failures to test resilience
              </span>
            </div>

            {/* Chaos Buttons with Descriptions */}
            <div className="flex flex-wrap items-start gap-3">
              {/* Flush Cache */}
              <div className="flex flex-col items-center gap-0.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={chaosDisabled}
                  onClick={handleFlushCache}
                  title={chaosDisabled ? NOT_RUNNING_TITLE : CHAOS_TOOLTIPS.flushCache}
                  className="border-[#dfb357]/70 text-[#dfb357] hover:bg-[#dfb357]/15 hover:text-[#dfb357] disabled:border-[#5b5347]/30 disabled:text-[#f3ede2]/70"
                >
                  <span>🔥</span>
                  <span>Flush Cache</span>
                </Button>
                <span className="text-[9px] text-[#f3ede2]/75">
                  Cold cache: 0% hit rate for 30s sim
                </span>
              </div>

              {/* Drop DB Node */}
              <div className="flex flex-col items-center gap-0.5">
                <div className="flex items-center gap-1">
                  {dbNodes.length > 0 && (
                    <select
                      value={effectiveDbNodeId}
                      onChange={(e) => setSelectedDbNodeId(e.target.value)}
                      disabled={chaosDisabled}
                      title={
                        dbNodes.length === 1
                          ? 'The only database in this topology'
                          : 'Which database to take down'
                      }
                      className="h-7 max-w-[9rem] rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-1.5 text-xs text-[#f3ede2] outline-none focus:border-[#8b2e1e] disabled:opacity-50"
                    >
                      {dbNodes.length === 1 && <option value="">Any DB (1 in topology)</option>}
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
                    disabled={
                      chaosDisabled ||
                      (dbNodes.length > 1 && !effectiveDbNodeId) ||
                      dbNodes.length === 0
                    }
                    onClick={handleDropDb}
                    title={
                      chaosDisabled
                        ? NOT_RUNNING_TITLE
                        : dbNodes.length === 0
                          ? 'No database nodes in the topology — drag one onto the canvas.'
                          : CHAOS_TOOLTIPS.dropDb
                    }
                    className="border-[#ef9a8b]/60 text-[#ef9a8b] hover:bg-[#8b2e1e]/30 hover:text-[#ef9a8b] disabled:border-[#5b5347]/30 disabled:text-[#f3ede2]/70"
                  >
                    <span>💀</span>
                    <span>Drop DB</span>
                  </Button>
                </div>
                <span className="text-[9px] text-[#f3ede2]/75">
                  Node outage: DB unreachable for 30s sim
                </span>
              </div>

              {/* Spike Traffic */}
              <div className="flex flex-col items-center gap-0.5">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={chaosDisabled}
                  onClick={handleSpikeTraffic}
                  title={chaosDisabled ? NOT_RUNNING_TITLE : CHAOS_TOOLTIPS.spikeTraffic}
                  className="border-[#dfb357]/70 text-[#dfb357] hover:bg-[#dfb357]/15 hover:text-[#dfb357] disabled:border-[#5b5347]/30 disabled:text-[#f3ede2]/70"
                >
                  <span>⚡</span>
                  <span>5× Traffic</span>
                </Button>
                <span className="text-[9px] text-[#f3ede2]/75">Surge: 5× request rate for 15s sim</span>
              </div>
            </div>

            {/* Node Failure (DISABLE_NODE) */}
            <div className="flex flex-wrap items-start gap-3">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-1">
                  <select
                    value={selectedDisableNodeId}
                    onChange={(e) => setSelectedDisableNodeId(e.target.value)}
                    disabled={disableNodeDisabled}
                    title={disableNodeDisabled ? NOT_RUNNING_TITLE : 'Which node to take offline'}
                    className="h-7 max-w-[10rem] rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-1.5 text-xs text-[#f3ede2] outline-none focus:border-[#8b2e1e] disabled:opacity-50"
                  >
                    <option value="">Select node…</option>
                    {allNodes.map((node) => (
                      <option key={node.id} value={node.id}>
                        {(node.data as { label: string }).label || node.id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={100}
                    max={600000}
                    value={disableDurationMs}
                    onChange={(e) =>
                      setDisableDurationMs(Math.max(100, Math.min(600000, Number(e.target.value))))
                    }
                    disabled={disableNodeDisabled}
                    className="h-7 w-20 rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-1.5 text-xs text-[#f3ede2] outline-none focus:border-[#8b2e1e] disabled:opacity-50"
                    title="Duration in simulated ms (100–600,000)"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={disableNodeDisabled || !selectedDisableNodeId}
                    onClick={handleDisableNode}
                    title={CHAOS_TOOLTIPS.disableNode}
                    className="border-[#ef9a8b]/60 text-[#ef9a8b] hover:bg-[#8b2e1e]/30 hover:text-[#ef9a8b] disabled:border-[#5b5347]/30 disabled:text-[#f3ede2]/70"
                  >
                    <span>🔌</span>
                    <span>Disable</span>
                  </Button>
                </div>
                <span className="text-[9px] text-[#f3ede2]/75">
                  Node failure: all requests timeout for duration
                </span>
              </div>

              {/* Manual DLQ Redrive */}
              {dlqNodes.length > 0 && (
                <div className="flex flex-col items-center gap-0.5">
                  <div className="flex items-center gap-1">
                    <select
                      value={effectiveDlqNodeId}
                      onChange={(e) => setSelectedDlqNodeId(e.target.value)}
                      disabled={chaosDisabled}
                      title={
                        dlqNodes.length === 1
                          ? 'The only dead letter queue in this topology'
                          : 'Which dead letter queue to redrive'
                      }
                      className="h-7 max-w-[9rem] rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-1.5 text-xs text-[#f3ede2] outline-none focus:border-[#8b2e1e] disabled:opacity-50"
                    >
                      {dlqNodes.length === 1 && <option value="">Any DLQ (1 in topology)</option>}
                      {dlqNodes.map((node) => (
                        <option key={node.id} value={node.id}>
                          {(node.data as { label: string }).label || node.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={chaosDisabled || (dlqNodes.length > 1 && !effectiveDlqNodeId)}
                      onClick={handleRedriveDlq}
                      title={chaosDisabled ? NOT_RUNNING_TITLE : CHAOS_TOOLTIPS.redriveDlq}
                      className="border-[#ef9a8b]/60 text-[#f3ede2] hover:bg-[#8b2e1e]/40 hover:text-[#f3ede2] disabled:border-[#5b5347]/30 disabled:text-[#f3ede2]/60"
                    >
                      <span>🔄</span>
                      <span>Redrive DLQ</span>
                    </Button>
                  </div>
                  <span className="text-[9px] text-[#f3ede2]/75">
                    Manual redrive of dead-lettered messages
                  </span>
                </div>
              )}
            </div>

            {/* Active Chaos Effects — Clear Sentences */}
            {visibleEffects.length > 0 && (
              <div className="flex flex-col gap-1.5 rounded-md border border-[#c49a3c]/50/50 bg-[#c49a3c]/10 p-2">
                {visibleEffects.map((effect) => (
                  <div key={effect.id} className="flex items-start gap-1.5 text-xs text-[#dfb357]/90">
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
                    className="rounded-md border border-[#c49a3c]/60/50 bg-[#c49a3c]/10 px-2.5 py-1.5 text-[10px] text-[#dfb357]/90"
                  >
                    <span className="font-semibold text-[#dfb357]">{summary.label} Impact:</span>{' '}
                    Latency {summary.latencyChange >= 0 ? '+' : ''}
                    {summary.latencyChange}%, Error rate {summary.errorRateBefore}% →{' '}
                    {summary.errorRateAfter}%
                    {summary.throughputChange !== 0 && (
                      <>
                        , Throughput {summary.throughputChange >= 0 ? '+' : ''}
                        {summary.throughputChange}%
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* SPOF Reachability Status (task 522) */}
            {spofStatus && (
              <div className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/50 p-2 text-[10px]">
                <span className="font-semibold text-[#f3ede2]/80">SPOF Analysis:</span>{' '}
                {spofStatus.spofs.length === 0 ? (
                  <span className="text-[#8fbf97]">
                    Every source retains a path to a reachable terminal under any single removal.
                    {spofStatus.unreachableSources.length > 0 && (
                      <>
                        {' '}
                        Sources reaching 0 terminals before any removal:{' '}
                        {spofStatus.unreachableSources
                          .map((id) => {
                            const n = nodes.find((node) => node.id === id);
                            return n
                              ? (n.data as { label?: string }).label || id.slice(0, 8)
                              : id.slice(0, 8);
                          })
                          .join(', ')}
                        .
                      </>
                    )}
                    {spofStatus.excludedFromCandidates.length > 0 && (
                      <>
                        {' '}
                        Excluded as sources:{' '}
                        {spofStatus.excludedFromCandidates
                          .map((id) => {
                            const n = nodes.find((node) => node.id === id);
                            return n
                              ? (n.data as { label?: string }).label || id.slice(0, 8)
                              : id.slice(0, 8);
                          })
                          .join(', ')}
                        .
                      </>
                    )}
                  </span>
                ) : (
                  <span className="text-[#dfb357]">
                    {spofStatus.spofs.length} node{spofStatus.spofs.length > 1 ? 's' : ''}{' '}
                    designated as Single Point{spofStatus.spofs.length > 1 ? 's' : ''} of Failure.
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Active Chaos Strip (always visible in the toolbar) ──────────

const SHORT_EFFECT_LABELS: Record<string, string> = {
  FLUSH_CACHE: 'Cold cache',
  DROP_DB: 'DB outage',
  SPIKE_TRAFFIC: '5× traffic',
  DISABLE_NODE: 'Node down',
};

/**
 * Compact always-visible indicator of running chaos effects, driven by
 * simulated time. Lives in the App header so active failures are legible
 * without opening the chaos popover.
 */
export function ActiveChaosStrip() {
  const activeChaosEffects = useSimulationStore((s) => s.activeChaosEffects);
  const currentSimTime = useSimulationStore((s) => s.metrics?.simulatedTimeMs ?? 0);

  if (activeChaosEffects.length === 0) return null;

  return (
    <div
      className="flex items-center gap-2 rounded-md border border-[#8a6418]/50 bg-[#8a6418]/10 px-2 py-1"
      aria-label="Active chaos effects"
    >
      <span className="flex animate-pulse items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-[#8a6418]">
        Chaos
      </span>
      {activeChaosEffects.map((effect) => {
        const remainingSec = Math.max(
          0,
          Math.ceil((effect.startTimeMs + effect.durationMs - currentSimTime) / 1000),
        );
        return (
          <span
            key={effect.id}
            title={effect.description}
            className="flex items-center gap-1 rounded bg-[#8a6418]/15 px-1.5 py-0.5 text-[10px] text-[#8a6418]/90"
          >
            {getActiveEffectIcon(effect.chaosType)}
            <span>{SHORT_EFFECT_LABELS[effect.chaosType] ?? effect.label}</span>
            {effect.durationMs > 0 && (
              <span className="font-mono text-[#8a6418]/90">{remainingSec}s</span>
            )}
          </span>
        );
      })}
    </div>
  );
}
