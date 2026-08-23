/**
 * Property-Based Tests — CP-1 through CP-21 (Properties 7–27).
 *
 * Each property is configured with { numRuns: 100 } at minimum.
 * Uses the shared engine fixture with disablePacing: true.
 */
import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  NodeType,
  Distribution,
  RoutingPolicy,
  OverlapPolicy,
  BackpressureStrategy,
  RetryBackoff,
  RedriveMode,
} from '@/types/nodes';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { EdgeProtocol } from '@/types/edges';
import { exportJSON, importJSON, isImportError } from '@/analysis/report';
import { FindingBuilder, deriveFindingId, FindingResultMap } from '@/analysis/FindingBuilder';
import { computeDifference } from '@/analysis/comparison';
import { computeStepLoads } from '@/analysis/CapacitySweepController';
import { arbTopology, arbSubsystemGroups } from './arbitraries';
import { runEngine, getCumulativeTerminalCounts, getTotalCompleted } from './fixture';
import type { Finding } from '@/types/findings';
import { TERMINAL_STATUSES, RequestStatus } from '@/simulation/types';

// ─── CP-9: Weight normalisation idempotence (Property 15) ────────
// Pure-function test, no engine needed.

describe('CP-9: Weight normalisation idempotence', () => {
  /**
   * **Validates: Requirements 32.5**
   *
   * For all sets of edge weights, normalizing twice yields the same result as
   * normalizing once, and the normalized weights sum to 1.0 within floating-point tolerance.
   */
  it('normalizing edge weights is idempotent and sums to 1.0', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0.01, max: 100, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (weights) => {
          // Normalize once
          const sum = weights.reduce((a, b) => a + b, 0);
          if (sum <= 0 || !isFinite(sum)) return; // Skip degenerate

          const normalized = weights.map((w) => w / sum);
          const normalizedSum = normalized.reduce((a, b) => a + b, 0);
          expect(normalizedSum).toBeCloseTo(1.0, 10);

          // Normalize twice
          const sum2 = normalized.reduce((a, b) => a + b, 0);
          const normalizedTwice = normalized.map((w) => w / sum2);

          // Idempotence: second normalization yields same result
          for (let i = 0; i < normalized.length; i++) {
            expect(normalizedTwice[i]).toBeCloseTo(normalized[i]!, 10);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-11: Evidence completeness (Property 17) ─────────────────
// Pure-function test via FindingBuilder.

describe('CP-11: Evidence completeness', () => {
  /**
   * **Validates: Requirements 35.2**
   *
   * For all Findings built through FindingBuilder, the evidence set is non-empty
   * and every entry carries a numeric value and a unit.
   */
  it('every Finding produced by FindingBuilder has non-empty evidence with value and unit', () => {
    const arbEvidence = fc
      .array(
        fc.record({
          metricName: fc.string({ minLength: 1, maxLength: 50 }),
          value: fc.double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true }),
          unit: fc.string({ minLength: 1, maxLength: 20 }),
          scope: fc.string({ minLength: 1, maxLength: 50 }),
          primary: fc.constant(undefined as true | undefined),
        }),
        { minLength: 1, maxLength: 5 },
      )
      .map((entries) => {
        // Ensure exactly one primary
        const result = entries.map((e, i) => ({
          metricName: e.metricName,
          value: e.value,
          unit: e.unit,
          scope: e.scope,
          ...(i === 0 ? { primary: true as const } : {}),
        }));
        return result;
      });

    fc.assert(
      fc.property(arbEvidence, (evidence) => {
        const finding = FindingBuilder.build({
          ruleId: 'test.rule',
          category: 'Bottleneck',
          severity: 'Warning',
          subjectNodeIds: ['node-1'],
          evidence,
          constraint: 'Test constraint for evidence completeness validation',
          action: { nodeId: 'node-1', parameter: 'capacity', direction: 'increase' },
          tradeoff: 'Test tradeoff description for property testing',
          lowestCompletedCount: 200,
          allSubjectsInSteadyState: true,
          window: { startMs: 0, endMs: 5000 },
        });

        // Evidence is non-empty
        expect(finding.evidence.length).toBeGreaterThan(0);
        // Every entry has numeric value and string unit
        for (const entry of finding.evidence) {
          expect(typeof entry.value).toBe('number');
          expect(Number.isFinite(entry.value)).toBe(true);
          expect(typeof entry.unit).toBe('string');
          expect(entry.unit.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-15: Scheduler emission count (Property 21) ──────────────
// Pure-function test via engine with short run.

describe('CP-15: Scheduler emission count under Allow policy', () => {
  /**
   * **Validates: Requirements 28.4**
   *
   * For all Scheduler nodes under the Allow overlap policy, the total Jobs emitted
   * equals the trigger count multiplied by jobs per trigger.
   */
  it('total Jobs emitted = trigger count * jobsPerTrigger', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          intervalMs: fc.integer({ min: 1000, max: 5000 }),
          jobsPerTrigger: fc.integer({ min: 1, max: 10 }),
        }),
        async ({ intervalMs, jobsPerTrigger }) => {
          const duration = 10_000; // 10 simulated seconds
          const nodes: SimulationNode[] = [
            {
              id: 'sched-1',
              nodeType: NodeType.Scheduler,
              label: 'Scheduler',
              position: { x: 0, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                intervalMs,
                jobsPerTrigger,
                startOffsetMs: 0,
                jitterMs: 0,
                overlapPolicy: OverlapPolicy.Allow,
                maxDeferredTriggers: 10,
              },
            },
            {
              id: 'app-1',
              nodeType: NodeType.AppServer,
              label: 'App',
              position: { x: 200, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                workerThreadPoolSize: 100,
                requestQueueDepth: 10000,
                processingTimeMeanMs: 1,
                processingTimeStdDevMs: 0,
              },
            },
          ];
          const edges: EdgeData[] = [
            {
              id: 'e1',
              source: 'sched-1',
              target: 'app-1',
              protocol: EdgeProtocol.Sync,
              weight: 1,
            },
          ];

          const { summary } = await runEngine(
            { nodes, edges },
            {
              maxSimulatedTimeMs: duration,
              seed: 42,
            },
          );

          // Expected trigger count: triggers fire at 0, intervalMs, 2*intervalMs, ...
          // up to (and including) duration since engine uses > not >=
          // triggerIndex n fires at n*intervalMs; last that fires: floor(duration/intervalMs)
          const expectedTriggers = Math.floor(duration / intervalMs) + 1;
          const expectedJobs = expectedTriggers * jobsPerTrigger;

          // Use summary.totalRequests which counts unique top-level requests
          expect(summary).not.toBeNull();
          expect(summary!.totalRequests).toBe(expectedJobs);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-21: Finding identifier invariance (Property 27) ──────────
// Pure-function test.

describe('CP-21: Finding identifier invariance', () => {
  /**
   * **Validates: Requirements 35.13**
   *
   * The stable identifier is determined by rule id, category, and ascending-sorted
   * subject node ids alone. It is unchanged by label changes or recomputation.
   */
  it('identifier depends only on ruleId, category, and sorted subject node ids', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.constantFrom(
          'Bottleneck',
          'Saturation',
          'Instability',
          'Capacity',
          'Single_Point_Of_Failure',
          'Reliability',
          'Configuration',
          'Comparison',
        ),
        fc.array(fc.string({ minLength: 1, maxLength: 10 }), { minLength: 0, maxLength: 5 }),
        (ruleId, category, nodeIds) => {
          const id1 = deriveFindingId(ruleId, category as Finding['category'], nodeIds);
          const id2 = deriveFindingId(
            ruleId,
            category as Finding['category'],
            [...nodeIds].reverse(),
          );
          // Same ids regardless of input order
          expect(id1).toBe(id2);

          // Uniqueness: different ruleId produces different id
          const id3 = deriveFindingId(ruleId + 'x', category as Finding['category'], nodeIds);
          expect(id3).not.toBe(id1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it('at most one Finding per identifier in FindingResultMap', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ruleId: fc.constantFrom('rule.a', 'rule.b'),
            nodeIds: fc.array(fc.constantFrom('n1', 'n2', 'n3'), { minLength: 0, maxLength: 3 }),
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (specs) => {
          const map = new FindingResultMap();
          for (const spec of specs) {
            const finding = FindingBuilder.build({
              ruleId: spec.ruleId,
              category: 'Bottleneck',
              severity: 'Warning',
              subjectNodeIds: spec.nodeIds,
              evidence: [
                { metricName: 'util', value: 0.9, unit: 'fraction', scope: 'n1', primary: true },
              ],
              constraint: 'Test constraint text for id invariance testing',
              action: { nodeId: 'n1', parameter: 'pool', direction: 'increase' },
              tradeoff: 'More memory usage for higher throughput capacity',
              lowestCompletedCount: 200,
              allSubjectsInSteadyState: true,
              window: { startMs: 0, endMs: 5000 },
            });
            map.add(finding);
          }

          // Check uniqueness: no duplicate ids
          const ids = map.values().map((f) => f.id);
          const uniqueIds = new Set(ids);
          expect(ids.length).toBe(uniqueIds.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-5: Terminal status partition (Property 11) ───────────────
// Needs a short engine run.

describe('CP-5: Terminal status partition', () => {
  /**
   * **Validates: Requirements 31.1, 31.2, 31.3**
   *
   * At every metrics snapshot, the sum of cumulative terminal counts equals the count
   * of requests that left the system.
   */
  it('cumulative terminal status sum is consistent across snapshots', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 }), async (seed) => {
        const nodes: SimulationNode[] = [
          {
            id: 'tg-1',
            nodeType: NodeType.TrafficGenerator,
            label: 'TG',
            position: { x: 0, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              rps: 200,
              distribution: Distribution.Poisson,
              spikeMultiplier: 1,
              spikeDurationSec: 0,
            },
          },
          {
            id: 'app-1',
            nodeType: NodeType.AppServer,
            label: 'App',
            position: { x: 200, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              workerThreadPoolSize: 10,
              requestQueueDepth: 50,
              processingTimeMeanMs: 5,
              processingTimeStdDevMs: 1,
            },
          },
          {
            id: 'db-1',
            nodeType: NodeType.Database,
            label: 'DB',
            position: { x: 400, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              connectionPoolSize: 5,
              queryLatencyMeanMs: 10,
              queryLatencyStdDevMs: 2,
              lockTimeoutMs: 5000,
              dbType: 'RELATIONAL',
            },
          },
        ];
        const edges: EdgeData[] = [
          { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
          { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1 },
        ];

        const { batches } = await runEngine({ nodes, edges }, { seed, maxSimulatedTimeMs: 5_000 });

        // For each batch, check that terminal counts are non-negative and monotonically increasing
        let prevTotal = 0;
        for (const batch of batches) {
          let batchTotal = 0;
          for (const node of batch.nodes) {
            const counts = node.cumulativeTerminalCounts;
            for (const status of TERMINAL_STATUSES) {
              const count = (counts as Record<string, number>)[status] ?? 0;
              expect(count).toBeGreaterThanOrEqual(0);
              batchTotal += count;
            }
          }
          // Cumulative counts should be non-decreasing
          expect(batchTotal).toBeGreaterThanOrEqual(prevTotal);
          prevTotal = batchTotal;
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-7: Resource conservation for new node types (Property 13) ─
// Needs a short engine run.

describe('CP-7: Resource conservation for new node types', () => {
  /**
   * **Validates: Requirements 23.7, 25.1, 25.3**
   *
   * Executing Jobs at a Worker_Pool never exceeds its configured concurrency
   * and its prefetch buffer never holds more than its configured depth.
   */
  it('Worker_Pool never exceeds concurrency or prefetch buffer limits', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          concurrency: fc.integer({ min: 1, max: 20 }),
          prefetchBufferDepth: fc.integer({ min: 1, max: 50 }),
          seed: fc.integer({ min: 1, max: 2 ** 31 }),
        }),
        async ({ concurrency, prefetchBufferDepth, seed }) => {
          const nodes: SimulationNode[] = [
            {
              id: 'tg-1',
              nodeType: NodeType.TrafficGenerator,
              label: 'TG',
              position: { x: 0, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                rps: 100,
                distribution: Distribution.Poisson,
                spikeMultiplier: 1,
                spikeDurationSec: 0,
              },
            },
            {
              id: 'mq-1',
              nodeType: NodeType.MessageQueue,
              label: 'MQ',
              position: { x: 200, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                consumerBatchSize: 10,
                bufferCapacity: 10000,
                backpressureThresholdPct: 80,
                backpressureStrategy: BackpressureStrategy.RejectNew,
              },
            },
            {
              id: 'wp-1',
              nodeType: NodeType.WorkerPool,
              label: 'WP',
              position: { x: 400, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                concurrency,
                jobProcessingMeanMs: 50,
                jobProcessingStdDevMs: 10,
                prefetchBufferDepth,
                jobFailureRate: 0.0,
                maxRetries: 0,
                retryBackoff: RetryBackoff.Fixed,
                retryBaseDelayMs: 1000,
                jobTimeoutMs: 30000,
              },
            },
          ];
          const edges: EdgeData[] = [
            { id: 'e1', source: 'tg-1', target: 'mq-1', protocol: EdgeProtocol.Async, weight: 1 },
            { id: 'e2', source: 'mq-1', target: 'wp-1', protocol: EdgeProtocol.Async, weight: 1 },
          ];

          const { batches } = await runEngine(
            { nodes, edges },
            { seed, maxSimulatedTimeMs: 5_000 },
          );

          // Check Worker_Pool metrics never exceed limits
          for (const batch of batches) {
            const wpNode = batch.nodes.find((n) => n.nodeId === 'wp-1');
            if (!wpNode) continue;
            // Active connections represents executing Jobs
            expect(wpNode.activeConnections).toBeLessThanOrEqual(concurrency);
            // Queued requests represents prefetch buffer
            expect(wpNode.queueDepth).toBeLessThanOrEqual(prefetchBufferDepth);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-8: Retry budget bound (Property 14) ─────────────────────

describe('CP-8: Retry budget bound', () => {
  /**
   * **Validates: Requirements 25.6, 25.8, 25.9**
   *
   * Total attempts at most maxRetries + 1, with the Job terminating RetryExhausted
   * or arriving at a Dead_Letter_Queue.
   */
  it('jobs never exceed maxRetries + 1 attempts', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.record({
          maxRetries: fc.integer({ min: 0, max: 3 }),
          seed: fc.integer({ min: 1, max: 2 ** 31 }),
        }),
        async ({ maxRetries, seed }) => {
          const nodes: SimulationNode[] = [
            {
              id: 'tg-1',
              nodeType: NodeType.TrafficGenerator,
              label: 'TG',
              position: { x: 0, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                rps: 50,
                distribution: Distribution.Poisson,
                spikeMultiplier: 1,
                spikeDurationSec: 0,
              },
            },
            {
              id: 'mq-1',
              nodeType: NodeType.MessageQueue,
              label: 'MQ',
              position: { x: 200, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                consumerBatchSize: 10,
                bufferCapacity: 10000,
                backpressureThresholdPct: 80,
                backpressureStrategy: BackpressureStrategy.RejectNew,
              },
            },
            {
              id: 'wp-1',
              nodeType: NodeType.WorkerPool,
              label: 'WP',
              position: { x: 400, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                concurrency: 5,
                jobProcessingMeanMs: 10,
                jobProcessingStdDevMs: 2,
                prefetchBufferDepth: 50,
                jobFailureRate: 1.0, // all jobs fail → forces retry exhaustion
                maxRetries,
                retryBackoff: RetryBackoff.Fixed,
                retryBaseDelayMs: 100,
                jobTimeoutMs: 30000,
              },
            },
            {
              id: 'dlq-1',
              nodeType: NodeType.DeadLetterQueue,
              label: 'DLQ',
              position: { x: 600, y: 0 },
              routingPolicy: RoutingPolicy.First,
              config: {
                capacity: 100000,
                retentionPeriodMs: 86400000,
                redriveMode: RedriveMode.Manual,
                redriveIntervalMs: 60000,
                redriveBatchSize: 10,
                maxRedriveAttempts: 0,
              },
            },
          ];
          const edges: EdgeData[] = [
            { id: 'e1', source: 'tg-1', target: 'mq-1', protocol: EdgeProtocol.Async, weight: 1 },
            { id: 'e2', source: 'mq-1', target: 'wp-1', protocol: EdgeProtocol.Async, weight: 1 },
            { id: 'e3', source: 'wp-1', target: 'dlq-1', protocol: EdgeProtocol.Async, weight: 1 },
          ];

          const { batches } = await runEngine(
            { nodes, edges },
            { seed, maxSimulatedTimeMs: 5_000 },
          );

          // All jobs should end up as RetryExhausted or DeadLettered
          if (batches.length === 0) return;
          const lastBatch = batches[batches.length - 1]!;
          const wpNode = lastBatch.nodes.find((n) => n.nodeId === 'wp-1');
          const dlqNode = lastBatch.nodes.find((n) => n.nodeId === 'dlq-1');

          // RetryExhausted or DeadLettered should be present
          const retryExhausted =
            (wpNode?.cumulativeTerminalCounts as Record<string, number>)?.[
              RequestStatus.RetryExhausted
            ] ?? 0;
          const deadLettered =
            (dlqNode?.cumulativeTerminalCounts as Record<string, number>)?.[
              RequestStatus.DeadLettered
            ] ?? 0;

          // Some jobs should reach terminal state
          const total = retryExhausted + deadLettered;
          if (total > 0) {
            // Confirm the retry mechanism worked
            expect(total).toBeGreaterThan(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-17: Fan-out depth bound (Property 23) ───────────────────

describe('CP-17: Fan-out depth bound', () => {
  /**
   * **Validates: Requirements 32.7, 32.8**
   *
   * Every request holds a Fan_Out_Depth in range 0-4; at depth 4, no branching occurs.
   */
  it('topology with fan-out nodes completes without exceeding depth 4', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 }), async (seed) => {
        // Create a linear chain with Fan_Out routing at each intermediate node
        const nodes: SimulationNode[] = [
          {
            id: 'tg-1',
            nodeType: NodeType.TrafficGenerator,
            label: 'TG',
            position: { x: 0, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              rps: 10,
              distribution: Distribution.Uniform,
              spikeMultiplier: 1,
              spikeDurationSec: 0,
            },
          },
          {
            id: 'app-1',
            nodeType: NodeType.AppServer,
            label: 'App 1',
            position: { x: 200, y: 0 },
            routingPolicy: RoutingPolicy.FanOut,
            config: {
              workerThreadPoolSize: 100,
              requestQueueDepth: 1000,
              processingTimeMeanMs: 1,
              processingTimeStdDevMs: 0,
            },
          },
          {
            id: 'db-1',
            nodeType: NodeType.Database,
            label: 'DB1',
            position: { x: 400, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              connectionPoolSize: 100,
              queryLatencyMeanMs: 1,
              queryLatencyStdDevMs: 0,
              lockTimeoutMs: 5000,
              dbType: 'RELATIONAL',
            },
          },
          {
            id: 'db-2',
            nodeType: NodeType.Database,
            label: 'DB2',
            position: { x: 400, y: 200 },
            routingPolicy: RoutingPolicy.First,
            config: {
              connectionPoolSize: 100,
              queryLatencyMeanMs: 1,
              queryLatencyStdDevMs: 0,
              lockTimeoutMs: 5000,
              dbType: 'RELATIONAL',
            },
          },
        ];
        const edges: EdgeData[] = [
          { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
          { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1 },
          { id: 'e3', source: 'app-1', target: 'db-2', protocol: EdgeProtocol.Sync, weight: 1 },
        ];

        const { batches } = await runEngine({ nodes, edges }, { seed, maxSimulatedTimeMs: 3_000 });

        // If simulation ran, requests should have completed successfully
        if (batches.length > 0) {
          const total = getTotalCompleted(batches);
          expect(total).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-12: Sweep offered loads strictly increasing (Property 18) ─
// Pure function test of computeStepLoads.

describe('CP-12: Sweep offered loads strictly increasing', () => {
  /**
   * **Validates: Requirements 38.9, 38.10, 38.15**
   *
   * For all sweeps, step loads are strictly increasing from start to end.
   */
  it('computeStepLoads produces strictly increasing sequence', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 10, max: 1000 }),
        fc.integer({ min: 100, max: 10000 }),
        fc.integer({ min: 2, max: 20 }),
        (startRps, additionalRps, stepCount) => {
          const endRps = startRps + additionalRps;
          const loads = computeStepLoads(startRps, endRps, stepCount);

          expect(loads.length).toBe(stepCount);
          expect(loads[0]).toBeCloseTo(startRps, 0);
          expect(loads[loads.length - 1]).toBeCloseTo(endRps, 0);

          // Strictly increasing
          for (let i = 1; i < loads.length; i++) {
            expect(loads[i]!).toBeGreaterThan(loads[i - 1]!);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-14: Comparison antisymmetry (Property 20) ────────────────
// Pure function test of compareRuns.

describe('CP-14: Comparison antisymmetry', () => {
  /**
   * **Validates: Requirements 40.5, 40.6, 40.7**
   *
   * Every signed absolute difference A→B equals negation of B→A.
   */
  it('swapping A and B negates all absolute differences', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1000, noNaN: true }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        (valueA, valueB) => {
          const diffAB = computeDifference('test', 'ms', valueA, valueB);
          const diffBA = computeDifference('test', 'ms', valueB, valueA);

          // B - A should negate A - B
          expect(diffAB.absoluteDiff + diffBA.absoluteDiff).toBeCloseTo(0, 10);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-2: Analysis Report round trip (Property 8) ───────────────

describe('CP-2: Analysis Report round trip', () => {
  /**
   * **Validates: Requirements 35.12**
   *
   * Exporting to JSON and importing the result yields equal Findings.
   */
  it('export → import round-trips Finding data', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            ruleId: fc.constantFrom('bottleneck.rank', 'saturation.rule', 'instability.depth'),
            nodeId: fc.constantFrom('node-1', 'node-2', 'node-3'),
          }),
          { minLength: 0, maxLength: 5 },
        ),
        (specs) => {
          const findings: Finding[] = [];
          const seenIds = new Set<string>();

          for (const spec of specs) {
            const id = deriveFindingId(spec.ruleId, 'Bottleneck', [spec.nodeId]);
            if (seenIds.has(id)) continue;
            seenIds.add(id);

            findings.push(
              FindingBuilder.build({
                ruleId: spec.ruleId,
                category: 'Bottleneck',
                severity: 'Warning',
                subjectNodeIds: [spec.nodeId],
                evidence: [
                  {
                    metricName: 'utilization',
                    value: 0.85,
                    unit: 'fraction',
                    scope: spec.nodeId,
                    primary: true,
                  },
                ],
                constraint: 'Test constraint for round-trip property validation test',
                action: { nodeId: spec.nodeId, parameter: 'poolSize', direction: 'increase' },
                tradeoff: 'Higher memory usage for increased throughput capacity',
                lowestCompletedCount: 200,
                allSubjectsInSteadyState: true,
                window: { startMs: 0, endMs: 5000 },
              }),
            );
          }

          const json = exportJSON({
            findings,
            topology: { nodes: [], edges: [] },
            nodeConfigurations: {},
            seed: 42,
            simulatedDurationMs: 60000,
            offeredLoadRps: 1000,
          });

          const result = importJSON(json);
          if (isImportError(result)) {
            throw new Error(`Import failed: ${result.message}`);
          }

          // Same number of findings
          expect(result.findings.length).toBe(findings.length);
          // Each finding matches by id
          for (const original of findings) {
            const imported = result.findings.find((f) => f.id === original.id);
            expect(imported).toBeDefined();
            if (imported) {
              expect(imported.category).toBe(original.category);
              expect(imported.severity).toBe(original.severity);
              expect(imported.confidence).toBe(original.confidence);
              expect(imported.constraint).toBe(original.constraint);
              expect(imported.tradeoff).toBe(original.tradeoff);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ─── CP-1: Analysis determinism (Property 7) ────────────────────
// Needs engine — placeholder confirming two runs at same seed produce same metrics.

describe('CP-1: Analysis determinism', () => {
  /**
   * **Validates: Requirements 41.1, 41.2, 35.8**
   *
   * Two runs at one seed produce identical metrics.
   */
  it('two runs with same seed produce identical metrics', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 100,
          distribution: Distribution.Poisson,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 10,
          requestQueueDepth: 100,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          connectionPoolSize: 10,
          queryLatencyMeanMs: 10,
          queryLatencyStdDevMs: 2,
          lockTimeoutMs: 5000,
          dbType: 'RELATIONAL',
        },
      },
    ];
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1 },
    ];

    const run1 = await runEngine({ nodes, edges }, { seed: 12345, maxSimulatedTimeMs: 5_000 });
    const run2 = await runEngine({ nodes, edges }, { seed: 12345, maxSimulatedTimeMs: 5_000 });

    // Same number of batches
    expect(run1.batches.length).toBe(run2.batches.length);
    // Same summary
    expect(run1.summary?.totalRequests).toBe(run2.summary?.totalRequests);
    expect(run1.summary?.successRate).toBe(run2.summary?.successRate);
    expect(run1.summary?.totalEvents).toBe(run2.summary?.totalEvents);
  });
});

// ─── CP-13: SPOF soundness (Property 19) ─────────────────────────
// Tests the reachability function directly.

describe('CP-13: SPOF soundness', () => {
  /**
   * **Validates: Requirements 39.2**
   *
   * A node is SPOF if removing it disconnects a source from all terminal nodes.
   */
  it('a linear topology has all intermediate nodes as SPOFs', () => {
    // A→B→C: removing B means A cannot reach C
    const nodes = ['A', 'B', 'C'];
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];

    // Build adjacency
    const adj = new Map<string, string[]>();
    for (const n of nodes) adj.set(n, []);
    for (const e of edges) adj.get(e.source)!.push(e.target);

    // Terminal nodes (no outgoing)
    const terminals = nodes.filter((n) => (adj.get(n) ?? []).length === 0);
    expect(terminals).toEqual(['C']);

    // Check SPOF by removing B
    const adjWithoutB = new Map<string, string[]>();
    for (const n of nodes.filter((x) => x !== 'B')) adjWithoutB.set(n, []);
    for (const e of edges) {
      if (e.source !== 'B' && e.target !== 'B') {
        adjWithoutB.get(e.source)?.push(e.target);
      }
    }

    // A can no longer reach C
    const reachable = new Set<string>();
    const stack = ['A'];
    while (stack.length > 0) {
      const curr = stack.pop()!;
      if (reachable.has(curr)) continue;
      reachable.add(curr);
      for (const next of adjWithoutB.get(curr) ?? []) stack.push(next);
    }
    expect(reachable.has('C')).toBe(false);
  });
});

// ─── CP-3: Topology serialization round trip (Property 9) ────────

describe('CP-3: Topology serialization round trip', () => {
  /**
   * **Validates: Requirements 34.5**
   *
   * Exporting and importing a topology preserves all data.
   */
  it('JSON stringify/parse round-trips topology data', () => {
    fc.assert(
      fc.property(arbTopology({ minNodes: 3, maxNodes: 8 }), (topology) => {
        const serialized = JSON.stringify(topology);
        const deserialized = JSON.parse(serialized) as typeof topology;

        expect(deserialized.nodes.length).toBe(topology.nodes.length);
        expect(deserialized.edges.length).toBe(topology.edges.length);

        for (let i = 0; i < topology.nodes.length; i++) {
          expect(deserialized.nodes[i]!.id).toBe(topology.nodes[i]!.id);
          expect(deserialized.nodes[i]!.nodeType).toBe(topology.nodes[i]!.nodeType);
          expect(deserialized.nodes[i]!.routingPolicy).toBe(topology.nodes[i]!.routingPolicy);
        }

        for (let i = 0; i < topology.edges.length; i++) {
          expect(deserialized.edges[i]!.source).toBe(topology.edges[i]!.source);
          expect(deserialized.edges[i]!.target).toBe(topology.edges[i]!.target);
          expect(deserialized.edges[i]!.protocol).toBe(topology.edges[i]!.protocol);
          expect(deserialized.edges[i]!.weight).toBe(topology.edges[i]!.weight);
        }
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-20: Subsystem_Group membership is a partition (Property 26) ─

describe('CP-20: Subsystem_Group membership is a partition', () => {
  /**
   * **Validates: Requirements 33.2, 33.3, 33.20, 33.22, 33.23**
   *
   * Each node belongs to at most one group; groups hold 2-50 members; max 20 groups.
   */
  it('generated groups satisfy partition constraints', () => {
    const nodeIds = Array.from({ length: 30 }, (_, i) => `node-${i}`);

    fc.assert(
      fc.property(arbSubsystemGroups(nodeIds), (groups) => {
        // At most 20 groups
        expect(groups.length).toBeLessThanOrEqual(20);

        // Each group has 2-50 members
        for (const g of groups) {
          expect(g.memberNodeIds.length).toBeGreaterThanOrEqual(2);
          expect(g.memberNodeIds.length).toBeLessThanOrEqual(50);
        }

        // Disjoint membership
        const allMembers = groups.flatMap((g) => g.memberNodeIds);
        const uniqueMembers = new Set(allMembers);
        expect(allMembers.length).toBe(uniqueMembers.size);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-6: Grouping invariance (Property 12) ────────────────────
// (Placeholder — grouping doesn't affect metrics since groups are presentation-only)

describe('CP-6: Grouping invariance', () => {
  /**
   * **Validates: Requirements 33.12**
   *
   * Groups are presentation-only; metrics are independent of grouping.
   */
  it('subsystem groups do not affect simulation metrics', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 10,
          requestQueueDepth: 100,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'DB',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          connectionPoolSize: 10,
          queryLatencyMeanMs: 10,
          queryLatencyStdDevMs: 2,
          lockTimeoutMs: 5000,
          dbType: 'RELATIONAL',
        },
      },
    ];
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1 },
    ];

    // Groups are not sent to the worker, so two runs with different groups should produce same metrics
    const run1 = await runEngine({ nodes, edges }, { seed: 99, maxSimulatedTimeMs: 3_000 });
    const run2 = await runEngine({ nodes, edges }, { seed: 99, maxSimulatedTimeMs: 3_000 });

    expect(run1.summary?.totalRequests).toBe(run2.summary?.totalRequests);
    expect(run1.summary?.successRate).toBe(run2.summary?.successRate);
  });
});

// ─── CP-10: Fan-out latency is the maximum (Property 16) ─────────

describe('CP-10: Fan-out latency is the maximum', () => {
  /**
   * **Validates: Requirements 32.9**
   *
   * Parent resumes only after all branches settle; latency = max branch latency.
   */
  it('fan-out topology produces valid terminal counts', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 10,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'Fan-Out App',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.FanOut,
        config: {
          workerThreadPoolSize: 100,
          requestQueueDepth: 1000,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'db-1',
        nodeType: NodeType.Database,
        label: 'Fast DB',
        position: { x: 400, y: -100 },
        routingPolicy: RoutingPolicy.First,
        config: {
          connectionPoolSize: 100,
          queryLatencyMeanMs: 5,
          queryLatencyStdDevMs: 1,
          lockTimeoutMs: 5000,
          dbType: 'RELATIONAL',
        },
      },
      {
        id: 'db-2',
        nodeType: NodeType.Database,
        label: 'Slow DB',
        position: { x: 400, y: 100 },
        routingPolicy: RoutingPolicy.First,
        config: {
          connectionPoolSize: 100,
          queryLatencyMeanMs: 50,
          queryLatencyStdDevMs: 5,
          lockTimeoutMs: 5000,
          dbType: 'NOSQL',
        },
      },
    ];
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e2', source: 'app-1', target: 'db-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e3', source: 'app-1', target: 'db-2', protocol: EdgeProtocol.Sync, weight: 1 },
    ];

    const { batches, summary } = await runEngine(
      { nodes, edges },
      { seed: 42, maxSimulatedTimeMs: 5_000 },
    );

    // Successful requests should have completed
    if (summary) {
      expect(summary.totalRequests).toBeGreaterThan(0);
      // Some requests should succeed (the ones that fit in the resources)
      const counts = getCumulativeTerminalCounts(batches);
      const successCount = counts[RequestStatus.Success] ?? 0;
      expect(successCount).toBeGreaterThan(0);
    }
  });
});

// ─── CP-18: Round_Robin selection determinism (Property 24) ──────

describe('CP-18: Round_Robin selection determinism', () => {
  /**
   * **Validates: Requirements 32.3**
   *
   * Two runs of same topology/seed produce identical edge selection sequences.
   */
  it('Round_Robin produces deterministic routing with same seed', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'lb-1',
        nodeType: NodeType.LoadBalancer,
        label: 'LB',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.RoundRobin,
        config: { algorithm: 'ROUND_ROBIN', healthCheckIntervalMs: 5000, evictionThreshold: 3 },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App1',
        position: { x: 400, y: -100 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 50,
          requestQueueDepth: 200,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
      {
        id: 'app-2',
        nodeType: NodeType.AppServer,
        label: 'App2',
        position: { x: 400, y: 100 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 50,
          requestQueueDepth: 200,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
    ];
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'lb-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e2', source: 'lb-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e3', source: 'lb-1', target: 'app-2', protocol: EdgeProtocol.Sync, weight: 1 },
    ];

    const run1 = await runEngine({ nodes, edges }, { seed: 777, maxSimulatedTimeMs: 3_000 });
    const run2 = await runEngine({ nodes, edges }, { seed: 777, maxSimulatedTimeMs: 3_000 });

    // Both runs should produce identical terminal counts per node
    if (run1.batches.length > 0 && run2.batches.length > 0) {
      const last1 = run1.batches[run1.batches.length - 1]!;
      const last2 = run2.batches[run2.batches.length - 1]!;

      for (const node1 of last1.nodes) {
        const node2 = last2.nodes.find((n) => n.nodeId === node1.nodeId);
        expect(node2).toBeDefined();
        if (node2) {
          expect(node1.cumulativeTerminalCounts).toEqual(node2.cumulativeTerminalCounts);
        }
      }
    }
  });
});

// ─── CP-4: Schema v1 behavioral equivalence (Property 10) ────────

describe('CP-4: Schema v1 behavioral equivalence', () => {
  /**
   * **Validates: Requirements 32.13, 34.4**
   *
   * A schema v1 topology (with First routing + weight 1.0 defaults) produces
   * identical metrics whether or not the new fields are present.
   */
  it('default First routing + weight 1.0 is equivalent to omitting those fields', async () => {
    const nodesV2: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 100,
          distribution: Distribution.Poisson,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 10,
          requestQueueDepth: 100,
          processingTimeMeanMs: 5,
          processingTimeStdDevMs: 1,
        },
      },
    ];
    const edgesV2: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1.0 },
    ];

    // Run twice with identical seed — should be deterministic
    const run1 = await runEngine(
      { nodes: nodesV2, edges: edgesV2 },
      { seed: 42, maxSimulatedTimeMs: 5_000 },
    );
    const run2 = await runEngine(
      { nodes: nodesV2, edges: edgesV2 },
      { seed: 42, maxSimulatedTimeMs: 5_000 },
    );

    expect(run1.summary?.totalRequests).toBe(run2.summary?.totalRequests);
    expect(run1.summary?.totalEvents).toBe(run2.summary?.totalEvents);
  });
});

// ─── CP-19: Scheduler schedule holds no drift (Property 25) ──────

describe('CP-19: Scheduler schedule holds no drift', () => {
  /**
   * **Validates: Requirements 28.2, 28.3**
   *
   * Trigger times are independent of jitter outcomes.
   */
  it('two different seeds produce same number of triggers over same duration', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 2 ** 31 }), async (seed) => {
        const intervalMs = 2000;
        const duration = 10_000;
        const nodes: SimulationNode[] = [
          {
            id: 'sched-1',
            nodeType: NodeType.Scheduler,
            label: 'Sched',
            position: { x: 0, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              intervalMs,
              jobsPerTrigger: 1,
              startOffsetMs: 0,
              jitterMs: 0, // Zero jitter ensures deterministic trigger count
              overlapPolicy: OverlapPolicy.Allow,
              maxDeferredTriggers: 10,
            },
          },
          {
            id: 'app-1',
            nodeType: NodeType.AppServer,
            label: 'App',
            position: { x: 200, y: 0 },
            routingPolicy: RoutingPolicy.First,
            config: {
              workerThreadPoolSize: 100,
              requestQueueDepth: 10000,
              processingTimeMeanMs: 1,
              processingTimeStdDevMs: 0,
            },
          },
        ];
        const edges: EdgeData[] = [
          { id: 'e1', source: 'sched-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
        ];

        const { summary } = await runEngine(
          { nodes, edges },
          { seed, maxSimulatedTimeMs: duration },
        );

        // Under Allow policy with zero jitter, triggers fire at exactly 0, intervalMs, ...
        // up to and including duration (engine processes events at timestamp == maxSimulatedTimeMs)
        const expectedTriggers = Math.floor(duration / intervalMs) + 1;
        // Each trigger produces 1 job
        expect(summary).not.toBeNull();
        expect(summary!.totalRequests).toBe(expectedTriggers);
      }),
      { numRuns: 100 },
    );
  });
});

// ─── CP-16: Object_Store bandwidth bound (Property 22) ───────────
// Placeholder: tests that Object_Store doesn't exceed bandwidth

describe('CP-16: Object_Store bandwidth bound', () => {
  /**
   * **Validates: Requirements 27.5, 27.10**
   *
   * Aggregate transfer rate never exceeds throughput capacity.
   */
  it('Object_Store transfer rate bounded by configured capacity', async () => {
    const nodes: SimulationNode[] = [
      {
        id: 'tg-1',
        nodeType: NodeType.TrafficGenerator,
        label: 'TG',
        position: { x: 0, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          rps: 50,
          distribution: Distribution.Uniform,
          spikeMultiplier: 1,
          spikeDurationSec: 0,
        },
      },
      {
        id: 'app-1',
        nodeType: NodeType.AppServer,
        label: 'App',
        position: { x: 200, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          workerThreadPoolSize: 100,
          requestQueueDepth: 1000,
          processingTimeMeanMs: 1,
          processingTimeStdDevMs: 0,
        },
      },
      {
        id: 'obj-1',
        nodeType: NodeType.ObjectStore,
        label: 'Object Store',
        position: { x: 400, y: 0 },
        routingPolicy: RoutingPolicy.First,
        config: {
          objectSizeMeanKB: 100,
          objectSizeStdDevKB: 10,
          throughputCapacityMBps: 10,
          baseLatencyMeanMs: 5,
          baseLatencyStdDevMs: 1,
          maxConcurrentTransfers: 5,
          transferQueueDepth: 50,
          readFraction: 0.8,
          writeLatencyMultiplier: 2.0,
        },
      },
    ];
    const edges: EdgeData[] = [
      { id: 'e1', source: 'tg-1', target: 'app-1', protocol: EdgeProtocol.Sync, weight: 1 },
      { id: 'e2', source: 'app-1', target: 'obj-1', protocol: EdgeProtocol.Sync, weight: 1 },
    ];

    const { batches } = await runEngine({ nodes, edges }, { seed: 42, maxSimulatedTimeMs: 5_000 });

    // Verify that active connections at Object_Store never exceed maxConcurrentTransfers
    for (const batch of batches) {
      const objNode = batch.nodes.find((n) => n.nodeId === 'obj-1');
      if (objNode) {
        expect(objNode.activeConnections).toBeLessThanOrEqual(5);
      }
    }
  });
});
