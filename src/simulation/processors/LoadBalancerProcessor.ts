import type { LoadBalancerConfig } from '@/types/nodes';
import { LBAlgorithm } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { RequestStatus, SimEventType } from '../types';

export class LoadBalancerProcessor implements NodeProcessor {
  private config: LoadBalancerConfig;
  private roundRobinIndex = 0;

  /**
   * Target health is tracked in two independent sets so chaos-driven ejections
   * and probe-driven ejections can be reverted independently:
   *  - `chaosEjected`: set instantly by DROP_DB chaos; cleared on revert.
   *  - `probeEjected`: set after `evictionThreshold` consecutive failed probes;
   *    cleared only by a passing probe.
   */
  private readonly chaosEjected = new Set<string>();
  private readonly probeEjected = new Set<string>();
  private readonly consecutiveFailures = new Map<string, number>();
  private readonly knownTargets = new Set<string>();
  private healthCheckScheduled = false;

  constructor(config: LoadBalancerConfig) {
    this.config = { ...config };
  }

  onRequestArrived(event: SimEvent, request: SimRequest, context: ProcessorContext): void {
    const state = context.getNodeState(event.nodeId);

    context.recordArrival(event.nodeId, request.id, event.timestamp);

    // Lazy-init: schedule the first probe on first traffic (virtual-time event,
    // so pause/resume and reset are handled by the ordinary event lifecycle).
    if (!this.healthCheckScheduled && this.config.healthCheckIntervalMs > 0) {
      this.healthCheckScheduled = true;
      this.scheduleNextCheck(
        event.nodeId,
        event.timestamp + this.config.healthCheckIntervalMs,
        context,
      );
    }

    const edges = context.getOutgoingEdges(event.nodeId);
    for (const edge of edges) this.knownTargets.add(edge.target);
    const healthyEdges = edges.filter((e) => this.isTargetHealthy(e.target));

    if (healthyEdges.length === 0) {
      // No healthy targets — drop the request with full terminal accounting
      context.markTerminal(request, RequestStatus.Dropped, event.nodeId, event.timestamp);
      if (state) state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      return;
    }

    const target = this.selectTarget(
      healthyEdges.map((e) => e.target),
      context,
    );

    // Route to selected target with small LB forwarding latency
    const lbLatency = 0.5;
    context.scheduleEvent({
      type: SimEventType.RequestRoute,
      timestamp: event.timestamp + lbLatency,
      nodeId: target,
      requestId: request.id,
      payload: { fromNodeId: event.nodeId },
    });

    request.accumulatedLatencyMs += lbLatency;

    if (state) {
      state.totalProcessed++;
      state.latencySamples.push(lbLatency);
      state.activeConnections = healthyEdges.length;
    }

    context.recordDeparture(event.nodeId, request.id, event.timestamp + lbLatency);
  }

  /**
   * One periodic probe pass over every downstream target. A target whose
   * processor reports unhealthy accumulates a failure; once failures reach
   * `evictionThreshold` it is ejected from rotation. Any passing probe resets
   * the streak and returns an ejected target to rotation.
   */
  onHealthCheck(nodeId: string, now: number, context: ProcessorContext): void {
    for (const edge of context.getOutgoingEdges(nodeId)) {
      const targetId = edge.target;
      this.knownTargets.add(targetId);
      const targetState = context.getNodeState(targetId);
      const alive = targetState ? targetState.processor.isHealthy?.(now) !== false : true;

      if (!alive) {
        const failures = (this.consecutiveFailures.get(targetId) ?? 0) + 1;
        this.consecutiveFailures.set(targetId, failures);
        if (failures >= Math.max(1, Math.ceil(this.config.evictionThreshold))) {
          this.probeEjected.add(targetId);
        }
      } else {
        this.consecutiveFailures.delete(targetId);
        this.probeEjected.delete(targetId);
      }
    }

    this.scheduleNextCheck(nodeId, now + this.config.healthCheckIntervalMs, context);
  }

  private isTargetHealthy(targetId: string): boolean {
    return !this.chaosEjected.has(targetId) && !this.probeEjected.has(targetId);
  }

  private scheduleNextCheck(nodeId: string, atMs: number, context: ProcessorContext): void {
    context.scheduleEvent({
      type: SimEventType.LbHealthCheck,
      timestamp: atMs,
      nodeId,
      requestId: '',
      payload: {},
    });
  }

  private selectTarget(targets: string[], context: ProcessorContext): string {
    switch (this.config.algorithm) {
      case LBAlgorithm.RoundRobin: {
        const target = targets[this.roundRobinIndex % targets.length]!;
        this.roundRobinIndex++;
        return target;
      }
      case LBAlgorithm.LeastConnections: {
        let minConns = Infinity;
        let selected = targets[0]!;
        for (const t of targets) {
          const state = context.getNodeState(t);
          const conns = state ? state.queuedRequests.length + state.activeConnections : 0;
          if (conns < minConns) {
            minConns = conns;
            selected = t;
          }
        }
        return selected;
      }
    }
  }

  onChaosApplied(chaosType: string, params: Record<string, unknown>): void {
    if (chaosType === 'DROP_DB' && typeof params['targetNodeId'] === 'string') {
      this.chaosEjected.add(params['targetNodeId']);
    }
  }

  onChaosReverted(): void {
    // Only undo chaos-driven ejections. Probe-driven ejections persist until a
    // probe actually observes the target healthy again.
    this.chaosEjected.clear();
  }

  onNodeDisabled(_context: ProcessorContext): string[] {
    return []; // LB is stateless pass-through
  }

  onNodeRestored(_context: ProcessorContext): void {
    // No-op
  }

  getUtilization(): UtilizationReading {
    // The LB has no capacity constraint of its own; report the fraction of
    // known targets that are currently ejected as a stress proxy.
    const total = this.knownTargets.size;
    let unhealthy = 0;
    for (const target of this.knownTargets) {
      if (!this.isTargetHealthy(target)) unhealthy++;
    }
    const value = total === 0 ? 0 : unhealthy / total;
    // TODO(task 392): `idle` mirrors the pre-existing `utilization === 0` derivation because
    // there is no per-window arrival counter here, so all-healthy targets read as idle
    // regardless of traffic. Refine once an arrival count exists.
    return { kind: 'value', value, idle: value === 0 };
  }
}
