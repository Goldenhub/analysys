import type { TrafficGeneratorConfig } from '@/types/nodes';
import { Distribution } from '@/types/nodes';
import type { UtilizationReading } from '@/types/metrics';
import type { NodeProcessor, SimEvent, SimRequest, ProcessorContext } from '../types';
import { SimEventType } from '../types';

export class TrafficGeneratorProcessor implements NodeProcessor {
  private config: TrafficGeneratorConfig;
  private spikeActive = false;

  constructor(config: TrafficGeneratorConfig) {
    this.config = { ...config };
  }

  onRequestArrived(
    _event: SimEvent,
    _request: SimRequest,
    _context: ProcessorContext,
  ): void {
    // Traffic generators don't receive requests from upstream — they generate them.
    // This is a no-op; request generation is handled by the engine's arrival scheduling.
  }

  onChaosApplied(chaosType: string, params: Record<string, unknown>): void {
    if (chaosType === 'SPIKE_TRAFFIC') {
      this.spikeActive = true;
      if (typeof params['multiplier'] === 'number') {
        this.config.spikeMultiplier = params['multiplier'];
      }
    }
  }

  onChaosReverted(): void {
    this.spikeActive = false;
  }

  getUtilization(): UtilizationReading {
    // Generators don't have utilization. The Activity view already short-circuits source
    // nodes with its own "not capacity-bound" note, so this stays the numeric variant to
    // keep the reading identical to what the panel rendered before.
    // TODO(task 392): `idle` mirrors the pre-existing `utilization === 0` derivation.
    return { kind: 'value', value: 0, idle: true };
  }

  /** Compute inter-arrival time in ms */
  computeInterArrival(rng: ProcessorContext['getRNG'] extends () => infer R ? R : never): number {
    const effectiveRps = this.spikeActive
      ? this.config.rps * this.config.spikeMultiplier
      : this.config.rps;

    if (effectiveRps <= 0) return Infinity;

    switch (this.config.distribution) {
      case Distribution.Poisson:
        // Exponential inter-arrival time (memoryless property of Poisson process)
        return rng.exponential(effectiveRps / 1000) * 1000; // convert from per-ms rate
      case Distribution.Uniform:
        return 1000 / effectiveRps;
    }
  }

  /** Schedule the next arrival event from this generator */
  scheduleNextArrival(
    nodeId: string,
    currentTime: number,
    context: ProcessorContext,
  ): void {
    const rng = context.getRNG();
    const interArrival = this.computeInterArrival(rng);
    if (!isFinite(interArrival)) return;

    context.scheduleEvent({
      type: SimEventType.RequestArrival,
      timestamp: currentTime + interArrival,
      nodeId,
      requestId: '', // Will be assigned by engine
      payload: {},
    });

    // Count emitted requests so the generator reports non-zero throughput.
    const state = context.getNodeState(nodeId);
    if (state) {
      state.totalProcessed++;
    }
  }
}
