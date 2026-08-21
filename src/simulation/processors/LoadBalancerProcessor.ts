import type { LoadBalancerConfig } from '@/types/nodes';
import { LBAlgorithm } from '@/types/nodes';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType } from '../types';

export class LoadBalancerProcessor implements NodeProcessor {
  private config: LoadBalancerConfig;
  private roundRobinIndex = 0;
  private targetHealthy: Map<string, boolean> = new Map();

  constructor(config: LoadBalancerConfig) {
    this.config = { ...config };
  }

  onRequestArrived(
    event: SimEvent,
    request: SimRequest,
    context: ProcessorContext,
  ): void {
    const state = context.getNodeState(event.nodeId);

    context.recordArrival(event.nodeId, request.id, event.timestamp);

    const edges = context.getOutgoingEdges(event.nodeId);
    const healthyEdges = edges.filter(
      (e) => this.targetHealthy.get(e.target) !== false,
    );

    if (healthyEdges.length === 0) {
      // No healthy targets — drop the request
      request.status = 'DROPPED' as never;
      if (state) state.totalDropped++;
      context.recordDeparture(event.nodeId, request.id, event.timestamp);
      return;
    }

    const target = this.selectTarget(healthyEdges.map((e) => e.target), context);

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
      this.targetHealthy.set(params['targetNodeId'], false);
    }
  }

  onChaosReverted(): void {
    this.targetHealthy.clear();
  }

  getUtilization(): number {
    // The LB has no capacity constraint of its own; report the fraction of
    // known targets that are unhealthy as a stress proxy.
    const total = this.targetHealthy.size;
    if (total === 0) return 0;
    let unhealthy = 0;
    for (const healthy of this.targetHealthy.values()) {
      if (!healthy) unhealthy++;
    }
    return unhealthy / total;
  }
}
