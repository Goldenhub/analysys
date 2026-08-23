import { describe, it, expect } from 'vitest';
import {
  roundHalfUp,
  computeStepLoads,
  maxWorkableStepCount,
  validateSweepConfig,
  splitAcrossGenerators,
  evaluateVerdict,
  determineSweepResults,
  buildSweepConfirmation,
  processCancellation,
  validateTopologyForSweep,
  CapacitySweepController,
  DEFAULT_SWEEP_CONFIG,
  MAX_GENERATOR_RPS,
} from './CapacitySweepController';
import type {
  SweepConfig,
  SweepStepResult,
  GeneratorInfo,
} from './CapacitySweepController';

// ─── roundHalfUp ────────────────────────────────────────────────

describe('roundHalfUp', () => {
  it('rounds 2.5 up to 3', () => {
    expect(roundHalfUp(2.5)).toBe(3);
  });

  it('rounds 3.5 up to 4', () => {
    expect(roundHalfUp(3.5)).toBe(4);
  });

  it('rounds 2.4 down to 2', () => {
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it('rounds 2.6 up to 3', () => {
    expect(roundHalfUp(2.6)).toBe(3);
  });

  it('handles integer values', () => {
    expect(roundHalfUp(5)).toBe(5);
  });
});

// ─── computeStepLoads (Task 491) ────────────────────────────────

describe('computeStepLoads', () => {
  it('computes correct step loads for a simple range', () => {
    const loads = computeStepLoads(100, 200, 3);
    expect(loads).toEqual([100, 150, 200]);
  });

  it('returns strictly increasing loads', () => {
    const loads = computeStepLoads(10, 20, 10);
    expect(loads).not.toBeNull();
    for (let i = 1; i < loads!.length; i++) {
      expect(loads![i]!).toBeGreaterThan(loads![i - 1]!);
    }
  });

  it('applies half-up rounding correctly', () => {
    // With 5 steps from 100 to 103: step size = 0.75
    // n=0: 100, n=1: 100.75 → 101, n=2: 101.5 → 102, n=3: 102.25 → 102 → raised to 103
    const loads = computeStepLoads(100, 103, 4);
    expect(loads).toEqual([100, 101, 102, 103]);
  });

  it('raises a step by 1 RPS when rounding makes it equal its predecessor', () => {
    // Range of 1-3, 3 steps: 1, 2, 3
    const loads = computeStepLoads(1, 3, 3);
    expect(loads).toEqual([1, 2, 3]);
  });

  it('returns null when range cannot yield stepCount distinct values', () => {
    // Range 100–101 can only yield 2 distinct values
    const loads = computeStepLoads(100, 101, 3);
    expect(loads).toBeNull();
  });

  it('handles 2-step sweep (minimum)', () => {
    const loads = computeStepLoads(50, 500, 2);
    expect(loads).toEqual([50, 500]);
  });

  it('handles 20-step sweep (maximum)', () => {
    const loads = computeStepLoads(100, 2000, 20);
    expect(loads).not.toBeNull();
    expect(loads!).toHaveLength(20);
    expect(loads![0]).toBe(100);
    expect(loads![19]).toBe(2000);
    for (let i = 1; i < loads!.length; i++) {
      expect(loads![i]!).toBeGreaterThan(loads![i - 1]!);
    }
  });

  it('first element always equals startRps', () => {
    const loads = computeStepLoads(42, 1000, 10);
    expect(loads![0]).toBe(42);
  });

  it('last element equals endRps when possible', () => {
    const loads = computeStepLoads(100, 1000, 10);
    expect(loads![loads!.length - 1]).toBe(1000);
  });
});

// ─── maxWorkableStepCount ────────────────────────────────────────

describe('maxWorkableStepCount', () => {
  it('returns range + 1 as the max distinct whole values', () => {
    expect(maxWorkableStepCount(100, 110)).toBe(11);
  });

  it('minimum is 2', () => {
    expect(maxWorkableStepCount(100, 100)).toBe(2);
  });
});

// ─── validateSweepConfig (Task 492) ─────────────────────────────

describe('validateSweepConfig', () => {
  it('returns no errors for a valid default config', () => {
    const errors = validateSweepConfig(DEFAULT_SWEEP_CONFIG);
    expect(errors).toHaveLength(0);
  });

  it('rejects endRps at or below startRps', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 500, endRps: 500 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'endRps')).toBe(true);
  });

  it('rejects endRps below startRps', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 500, endRps: 100 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'endRps')).toBe(true);
  });

  it('rejects out-of-range startRps', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 0 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'startRps')).toBe(true);
  });

  it('rejects startRps above 100,000', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 100_001 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'startRps')).toBe(true);
  });

  it('rejects non-finite parameter', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: Infinity };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'startRps')).toBe(true);
  });

  it('rejects NaN parameter', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: NaN };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'startRps')).toBe(true);
  });

  it('rejects stepCount below 2', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, stepCount: 1 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'stepCount')).toBe(true);
  });

  it('rejects stepCount above 20', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, stepCount: 21 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'stepCount')).toBe(true);
  });

  it('rejects warmUpMs above durationPerStepMs - 1', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, durationPerStepMs: 5000, warmUpMs: 5000 };
    const errors = validateSweepConfig(config);
    expect(errors.some((e) => e.parameter === 'warmUpMs')).toBe(true);
  });

  it('rejects a range that cannot yield stepCount distinct values', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 100, endRps: 102, stepCount: 5 };
    const errors = validateSweepConfig(config);
    const stepError = errors.find((e) => e.parameter === 'stepCount');
    expect(stepError).toBeDefined();
    expect(stepError!.message).toContain('highest workable count');
  });

  it('names the requested count and highest workable count in the error', () => {
    const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 100, endRps: 105, stepCount: 10 };
    const errors = validateSweepConfig(config);
    const stepError = errors.find((e) => e.parameter === 'stepCount');
    expect(stepError).toBeDefined();
    expect(stepError!.message).toContain('10');
    expect(stepError!.message).toContain('6');
  });
});

// ─── splitAcrossGenerators (Task 493) ────────────────────────────

describe('splitAcrossGenerators', () => {
  it('splits proportionally for two generators', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'Gen 1', configuredRps: 100 },
      { id: 'gen2', label: 'Gen 2', configuredRps: 300 },
    ];
    const result = splitAcrossGenerators(1000, generators, 0);
    // gen1: round(1000 * 100 / 400) = 250
    // gen2: round(1000 * 300 / 400) = 750
    // Sum = 1000, no residual
    expect(result.perGeneratorRps['gen1']).toBe(250);
    expect(result.perGeneratorRps['gen2']).toBe(750);
    expect(result.appliedRps).toBe(1000);
  });

  it('assigns residual to highest-configured-RPS generator', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'Gen 1', configuredRps: 100 },
      { id: 'gen2', label: 'Gen 2', configuredRps: 200 },
      { id: 'gen3', label: 'Gen 3', configuredRps: 300 },
    ];
    const result = splitAcrossGenerators(1001, generators, 0);
    // gen1: round(1001 * 100 / 600) = round(166.83) = 167
    // gen2: round(1001 * 200 / 600) = round(333.67) = 334
    // gen3: round(1001 * 300 / 600) = round(500.5) = 501
    // Sum = 167 + 334 + 501 = 1002, residual = -1 → assign to gen3 (highest)
    // gen3 gets 501 + (-1) = 500
    expect(result.perGeneratorRps['gen3']).toBe(500);
    expect(result.appliedRps).toBe(1001);
  });

  it('clamps each generator to at least 1 RPS', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'Gen 1', configuredRps: 1 },
      { id: 'gen2', label: 'Gen 2', configuredRps: 99999 },
    ];
    const result = splitAcrossGenerators(2, generators, 0);
    // gen1: round(2 * 1 / 100000) = round(0.00002) = 0, clamped to 1
    // gen2: round(2 * 99999 / 100000) = round(1.99998) = 2
    expect(result.perGeneratorRps['gen1']).toBeGreaterThanOrEqual(1);
  });

  it('breaks ties by ascending identifier', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen-b', label: 'Gen B', configuredRps: 500 },
      { id: 'gen-a', label: 'Gen A', configuredRps: 500 },
    ];
    const result = splitAcrossGenerators(999, generators, 0);
    // Both have same configured RPS, tie broken by ascending ID → gen-a
    // gen-b: round(999 * 500 / 1000) = round(499.5) = 500
    // gen-a: round(999 * 500 / 1000) = round(499.5) = 500
    // Sum = 1000, residual = -1
    // Tied at 500 RPS, ascending ID = gen-a gets residual
    expect(result.perGeneratorRps['gen-a']).toBe(499);
    expect(result.appliedRps).toBe(999);
  });

  it('emits normalisation warning when clamping above 100,000 (Task 494)', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'Monster Gen', configuredRps: 50000 },
    ];
    // Step load of 200,000 — single generator would need 200,000
    const result = splitAcrossGenerators(200_000, generators, 3);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]!.generatorLabel).toBe('Monster Gen');
    expect(result.warnings[0]!.stepIndex).toBe(3);
    expect(result.warnings[0]!.computedValue).toBe(200_000);
    expect(result.warnings[0]!.appliedBound).toBe(MAX_GENERATOR_RPS);
    expect(result.perGeneratorRps['gen1']).toBe(MAX_GENERATOR_RPS);
  });

  it('reports applied RPS different from requested when clamped', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'G1', configuredRps: 50000 },
      { id: 'gen2', label: 'G2', configuredRps: 50000 },
    ];
    // Each wants 100,000 → clamped to 100,000 each → applied 200,000
    // Actually: round(200000 * 50000/100000) = 100000 for each
    const result = splitAcrossGenerators(200_000, generators, 0);
    expect(result.appliedRps).toBe(200_000);
  });
});

// ─── validateTopologyForSweep (Task 494) ─────────────────────────

describe('validateTopologyForSweep', () => {
  it('rejects topology with no Traffic_Generator', () => {
    const error = validateTopologyForSweep([]);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('Traffic_Generator');
  });

  it('rejects topology with configured RPS sum of 0', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'G1', configuredRps: 0 },
    ];
    const error = validateTopologyForSweep(generators);
    expect(error).not.toBeNull();
    expect(error!.message).toContain('0');
  });

  it('accepts valid topology', () => {
    const generators: GeneratorInfo[] = [
      { id: 'gen1', label: 'G1', configuredRps: 100 },
    ];
    const error = validateTopologyForSweep(generators);
    expect(error).toBeNull();
  });
});

// ─── evaluateVerdict (Task 502) ──────────────────────────────────

describe('evaluateVerdict', () => {
  const objective = { maxP99LatencyMs: 500, maxErrorRate: 0.05 };

  it('returns satisfied when both p99 and error rate are within limits', () => {
    const result = evaluateVerdict(400, 0.03, 100, objective);
    expect(result.verdict).toBe('satisfied');
  });

  it('returns satisfied when exactly at limits', () => {
    const result = evaluateVerdict(500, 0.05, 100, objective);
    expect(result.verdict).toBe('satisfied');
  });

  it('returns violated when p99 exceeds limit', () => {
    const result = evaluateVerdict(501, 0.03, 100, objective);
    expect(result.verdict).toBe('violated');
  });

  it('returns violated when error rate exceeds limit', () => {
    const result = evaluateVerdict(400, 0.06, 100, objective);
    expect(result.verdict).toBe('violated');
  });

  it('returns not-evaluated when no terminations recorded', () => {
    const result = evaluateVerdict(0, 0, 0, objective);
    expect(result.verdict).toBe('not-evaluated');
    expect(result.explanation).toContain('no terminations');
  });
});

// ─── determineSweepResults (Tasks 503–504) ───────────────────────

describe('determineSweepResults', () => {
  const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 100, endRps: 1000 };

  function makeStep(
    stepIndex: number,
    requestedRps: number,
    verdict: 'satisfied' | 'violated' | 'not-evaluated',
  ): SweepStepResult {
    return {
      stepIndex,
      requestedRps,
      appliedRps: requestedRps,
      achievedThroughput: requestedRps * 0.9,
      latency: { p50: 100, p90: 200, p99: verdict === 'violated' ? 600 : 400 },
      totalErrorRate: verdict === 'violated' ? 0.1 : 0.02,
      terminalCounts: { SUCCESS: 100 },
      schedulerJobsEmitted: 0,
      measurementInterval: { startMs: 10000, endMs: 30000 },
      verdict,
    };
  }

  it('finds the Knee_Point at the lowest violating step', () => {
    const steps = [
      makeStep(0, 100, 'satisfied'),
      makeStep(1, 200, 'satisfied'),
      makeStep(2, 300, 'violated'),
      makeStep(3, 400, 'violated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint).not.toBeNull();
    expect(result.kneePoint!.offeredRps).toBe(300);
    expect(result.kneePoint!.stepIndex).toBe(2);
  });

  it('finds Sustainable_Load as highest satisfying step below the knee', () => {
    const steps = [
      makeStep(0, 100, 'satisfied'),
      makeStep(1, 200, 'satisfied'),
      makeStep(2, 300, 'violated'),
      makeStep(3, 400, 'violated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.sustainableLoad.offeredRps).toBe(200);
  });

  it('reports no knee when all evaluated steps satisfy', () => {
    const steps = [
      makeStep(0, 100, 'satisfied'),
      makeStep(1, 200, 'satisfied'),
      makeStep(2, 300, 'satisfied'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint).toBeNull();
    expect(result.sustainableLoad.explanation).toContain('at or above the ending load');
  });

  it('reports Sustainable_Load below starting load when every step below knee violated', () => {
    const steps = [
      makeStep(0, 100, 'violated'),
      makeStep(1, 200, 'violated'),
      makeStep(2, 300, 'violated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint!.offeredRps).toBe(100);
    expect(result.sustainableLoad.offeredRps).toBeNull();
    expect(result.sustainableLoad.explanation).toContain('below the starting load');
  });

  it('excludes not-evaluated steps from knee and sustainable determination', () => {
    const steps = [
      makeStep(0, 100, 'not-evaluated'),
      makeStep(1, 200, 'satisfied'),
      makeStep(2, 300, 'violated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint!.offeredRps).toBe(300);
    expect(result.sustainableLoad.offeredRps).toBe(200);
  });

  it('reports non-monotonic steps above the knee that satisfied (Task 504)', () => {
    const steps = [
      makeStep(0, 100, 'satisfied'),
      makeStep(1, 200, 'violated'),
      makeStep(2, 300, 'satisfied'), // non-monotonic
      makeStep(3, 400, 'violated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint!.offeredRps).toBe(200);
    expect(result.nonMonotonicSteps).toHaveLength(1);
    expect(result.nonMonotonicSteps[0]!.offeredRps).toBe(300);
    expect(result.nonMonotonicSteps[0]!.stepIndex).toBe(2);
  });

  it('handles no evaluated steps', () => {
    const steps = [
      makeStep(0, 100, 'not-evaluated'),
      makeStep(1, 200, 'not-evaluated'),
    ];
    const result = determineSweepResults(steps, config);
    expect(result.kneePoint).toBeNull();
    expect(result.sustainableLoad.offeredRps).toBeNull();
  });
});

// ─── buildSweepConfirmation (Task 500) ───────────────────────────

describe('buildSweepConfirmation', () => {
  it('reports that a running sim will be stopped', () => {
    const confirm = buildSweepConfirmation('running');
    expect(confirm.runWillBeStopped).toBe(true);
    expect(confirm.message).toContain('Running');
  });

  it('reports that a paused sim will be stopped', () => {
    const confirm = buildSweepConfirmation('paused');
    expect(confirm.runWillBeStopped).toBe(true);
    expect(confirm.message).toContain('Paused');
  });

  it('does not report stop for idle state', () => {
    const confirm = buildSweepConfirmation('idle');
    expect(confirm.runWillBeStopped).toBe(false);
  });
});

// ─── processCancellation (Task 501) ──────────────────────────────

describe('processCancellation', () => {
  const config: SweepConfig = { ...DEFAULT_SWEEP_CONFIG, startRps: 100, endRps: 500 };

  it('retains completed steps and reports cancelled', () => {
    const completedSteps: SweepStepResult[] = [
      {
        stepIndex: 0,
        requestedRps: 100,
        appliedRps: 100,
        achievedThroughput: 90,
        latency: { p50: 50, p90: 100, p99: 200 },
        totalErrorRate: 0.01,
        terminalCounts: { SUCCESS: 90, TIMEOUT: 10 },
        schedulerJobsEmitted: 0,
        measurementInterval: { startMs: 10000, endMs: 30000 },
        verdict: 'satisfied',
      },
    ];
    const report = processCancellation(completedSteps, 1, config);
    expect(report.status).toBe('cancelled');
    expect(report.cancelledAtStep).toBe(2); // 1-based
    expect(report.steps).toHaveLength(1);
  });

  it('determines knee and sustainable from retained steps alone', () => {
    const completedSteps: SweepStepResult[] = [
      {
        stepIndex: 0,
        requestedRps: 100,
        appliedRps: 100,
        achievedThroughput: 90,
        latency: { p50: 50, p90: 100, p99: 200 },
        totalErrorRate: 0.01,
        terminalCounts: { SUCCESS: 90 },
        schedulerJobsEmitted: 0,
        measurementInterval: { startMs: 10000, endMs: 30000 },
        verdict: 'satisfied',
      },
      {
        stepIndex: 1,
        requestedRps: 200,
        appliedRps: 200,
        achievedThroughput: 180,
        latency: { p50: 100, p90: 300, p99: 600 },
        totalErrorRate: 0.1,
        terminalCounts: { SUCCESS: 80, TIMEOUT: 20 },
        schedulerJobsEmitted: 0,
        measurementInterval: { startMs: 10000, endMs: 30000 },
        verdict: 'violated',
      },
    ];
    const report = processCancellation(completedSteps, 2, config);
    expect(report.kneePoint!.offeredRps).toBe(200);
    expect(report.sustainableLoad.offeredRps).toBe(100);
  });
});

// ─── CapacitySweepController (Tasks 497–501) ─────────────────────

describe('CapacitySweepController', () => {
  const generators: GeneratorInfo[] = [
    { id: 'gen1', label: 'Traffic Generator 1', configuredRps: 100 },
  ];

  it('prepares and validates config successfully', () => {
    const controller = new CapacitySweepController(generators, 42);
    const errors = controller.prepare(DEFAULT_SWEEP_CONFIG);
    expect(errors).toHaveLength(0);
    expect(controller.getStatus()).toBe('confirming');
  });

  it('returns errors for invalid config', () => {
    const controller = new CapacitySweepController(generators, 42);
    const errors = controller.prepare({ ...DEFAULT_SWEEP_CONFIG, startRps: 0 });
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects when no generators', () => {
    const controller = new CapacitySweepController([], 42);
    const errors = controller.prepare(DEFAULT_SWEEP_CONFIG);
    expect(errors.some((e) => e.parameter === 'topology')).toBe(true);
  });

  it('starts sweep and builds step requests', () => {
    const controller = new CapacitySweepController(generators, 42);
    controller.prepare({ ...DEFAULT_SWEEP_CONFIG, stepCount: 3, startRps: 100, endRps: 300 });
    controller.start({ nodes: [], edges: [] });
    expect(controller.getStatus()).toBe('running');

    const req = controller.buildCurrentStepRequest();
    expect(req).not.toBeNull();
    expect(req!.stepIndex).toBe(0);
    expect(req!.requestedRps).toBe(100);
    expect(req!.seed).toBe(42);
  });

  it('advances through all steps and completes', () => {
    const controller = new CapacitySweepController(generators, 42);
    controller.prepare({ ...DEFAULT_SWEEP_CONFIG, stepCount: 2, startRps: 100, endRps: 200 });
    controller.start({ nodes: [], edges: [] });

    const step1: SweepStepResult = {
      stepIndex: 0,
      requestedRps: 100,
      appliedRps: 100,
      achievedThroughput: 90,
      latency: { p50: 50, p90: 100, p99: 200 },
      totalErrorRate: 0.01,
      terminalCounts: { SUCCESS: 90 },
      schedulerJobsEmitted: 0,
      measurementInterval: { startMs: 10000, endMs: 30000 },
      verdict: 'satisfied',
    };
    const report1 = controller.recordStepResult(step1);
    expect(report1).toBeNull(); // not done yet

    const step2: SweepStepResult = {
      stepIndex: 1,
      requestedRps: 200,
      appliedRps: 200,
      achievedThroughput: 180,
      latency: { p50: 100, p90: 200, p99: 400 },
      totalErrorRate: 0.03,
      terminalCounts: { SUCCESS: 180 },
      schedulerJobsEmitted: 0,
      measurementInterval: { startMs: 10000, endMs: 30000 },
      verdict: 'satisfied',
    };
    const report2 = controller.recordStepResult(step2);
    expect(report2).not.toBeNull();
    expect(report2!.status).toBe('completed');
    expect(controller.getStatus()).toBe('completed');
  });

  it('cancels and retains completed steps', () => {
    const controller = new CapacitySweepController(generators, 42);
    controller.prepare({ ...DEFAULT_SWEEP_CONFIG, stepCount: 5, startRps: 100, endRps: 500 });
    controller.start({ nodes: [], edges: [] });

    const step1: SweepStepResult = {
      stepIndex: 0,
      requestedRps: 100,
      appliedRps: 100,
      achievedThroughput: 90,
      latency: { p50: 50, p90: 100, p99: 200 },
      totalErrorRate: 0.01,
      terminalCounts: { SUCCESS: 90 },
      schedulerJobsEmitted: 0,
      measurementInterval: { startMs: 10000, endMs: 30000 },
      verdict: 'satisfied',
    };
    controller.recordStepResult(step1);

    const report = controller.cancel();
    expect(report.status).toBe('cancelled');
    expect(report.cancelledAtStep).toBe(2); // 1-based index of in-progress step
    expect(report.steps).toHaveLength(1);
  });

  it('preserves canvas snapshot for restoration (Task 499)', () => {
    const controller = new CapacitySweepController(generators, 42);
    controller.prepare(DEFAULT_SWEEP_CONFIG);
    const snapshot = { nodes: [{ id: 'test' }] as never[], edges: [] };
    controller.start(snapshot);
    expect(controller.getSnapshot()).toEqual(snapshot);
  });

  it('reset returns controller to idle', () => {
    const controller = new CapacitySweepController(generators, 42);
    controller.prepare(DEFAULT_SWEEP_CONFIG);
    controller.start({ nodes: [], edges: [] });
    controller.reset();
    expect(controller.getStatus()).toBe('idle');
    expect(controller.getReport()).toBeNull();
  });
});

// ─── DEFAULT_SWEEP_CONFIG (Task 490) ────────────────────────────

describe('DEFAULT_SWEEP_CONFIG', () => {
  it('has warmUpMs of 10,000', () => {
    expect(DEFAULT_SWEEP_CONFIG.warmUpMs).toBe(10_000);
  });

  it('has startRps within 1–100,000', () => {
    expect(DEFAULT_SWEEP_CONFIG.startRps).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SWEEP_CONFIG.startRps).toBeLessThanOrEqual(100_000);
  });

  it('has endRps within 1–100,000 and above startRps', () => {
    expect(DEFAULT_SWEEP_CONFIG.endRps).toBeGreaterThan(DEFAULT_SWEEP_CONFIG.startRps);
    expect(DEFAULT_SWEEP_CONFIG.endRps).toBeLessThanOrEqual(100_000);
  });

  it('has stepCount within 2–20', () => {
    expect(DEFAULT_SWEEP_CONFIG.stepCount).toBeGreaterThanOrEqual(2);
    expect(DEFAULT_SWEEP_CONFIG.stepCount).toBeLessThanOrEqual(20);
  });

  it('has durationPerStepMs within 1,000–1,800,000', () => {
    expect(DEFAULT_SWEEP_CONFIG.durationPerStepMs).toBeGreaterThanOrEqual(1_000);
    expect(DEFAULT_SWEEP_CONFIG.durationPerStepMs).toBeLessThanOrEqual(1_800_000);
  });

  it('has warmUpMs less than durationPerStepMs', () => {
    expect(DEFAULT_SWEEP_CONFIG.warmUpMs).toBeLessThan(DEFAULT_SWEEP_CONFIG.durationPerStepMs);
  });

  it('has objective with valid maxP99LatencyMs and maxErrorRate', () => {
    expect(DEFAULT_SWEEP_CONFIG.objective.maxP99LatencyMs).toBeGreaterThanOrEqual(1);
    expect(DEFAULT_SWEEP_CONFIG.objective.maxP99LatencyMs).toBeLessThanOrEqual(600_000);
    expect(DEFAULT_SWEEP_CONFIG.objective.maxErrorRate).toBeGreaterThanOrEqual(0);
    expect(DEFAULT_SWEEP_CONFIG.objective.maxErrorRate).toBeLessThanOrEqual(1);
  });
});
