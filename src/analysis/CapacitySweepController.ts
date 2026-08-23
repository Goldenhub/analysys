import type { PercentileStats } from '@/types/metrics';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import type { ServiceObjective } from '@/analysis/AnalysisWindowStore';

// ─── Types (Task 490) ────────────────────────────────────────────

/**
 * Configuration for a capacity sweep.
 * All numeric parameters are validated before execution.
 */
export interface SweepConfig {
  /** Starting offered load in RPS. Range: 1–100,000. */
  startRps: number;
  /** Ending offered load in RPS. Range: 1–100,000, strictly above startRps. */
  endRps: number;
  /** Number of steps in the sweep. Range: 2–20. */
  stepCount: number;
  /** Duration of each step in simulated ms. Range: 1,000–1,800,000. */
  durationPerStepMs: number;
  /** Warm-up period excluded from measurement in ms. Range: 0 … durationPerStepMs − 1. Default: 10,000. */
  warmUpMs: number;
  /** Speed multiplier for the simulation. */
  speedMultiplier: number;
  /** Service objective for pass/fail determination. */
  objective: ServiceObjective;
}

/**
 * Per-step request sent to the Worker via SWEEP_STEP.
 * The main thread computes perGeneratorRps so there is exactly one implementation.
 */
export interface SweepStepRequest {
  /** 0-based step index. */
  stepIndex: number;
  /** The target RPS for this step (from the step load formula). */
  requestedRps: number;
  /** Per-generator RPS map (computed on main thread). */
  perGeneratorRps: Record<string, number>;
  /** Duration of this step in simulated ms. */
  durationPerStepMs: number;
  /** Warm-up period in ms. */
  warmUpMs: number;
  /** Speed multiplier. */
  speedMultiplier: number;
  /** Seed for deterministic PRNG. */
  seed: number;
}

/**
 * Result of a completed sweep step, reported via SWEEP_STEP_COMPLETE.
 */
export interface SweepStepResult {
  /** 0-based step index (displayed 1-based to users). */
  stepIndex: number;
  /** RPS requested by the sweep formula. */
  requestedRps: number;
  /** Actual sum of per-generator RPS applied (may differ due to clamping). */
  appliedRps: number;
  /** Measured throughput over the measurement interval. */
  achievedThroughput: number;
  /** Latency percentiles over the measurement interval. */
  latency: PercentileStats;
  /** Total error rate over the measurement interval. */
  totalErrorRate: number;
  /** Terminal status counts over the measurement interval. */
  terminalCounts: Record<string, number>;
  /** Scheduler-emitted Job count (reported separately from offered load). */
  schedulerJobsEmitted: number;
  /** The measurement interval boundaries. */
  measurementInterval: { startMs: number; endMs: number };
  /** Whether the step satisfied the service objective. */
  verdict: 'satisfied' | 'violated' | 'not-evaluated';
}

// ─── Default SweepConfig ─────────────────────────────────────────

export const DEFAULT_SWEEP_CONFIG: SweepConfig = {
  startRps: 100,
  endRps: 1000,
  stepCount: 10,
  durationPerStepMs: 30_000,
  warmUpMs: 10_000,
  speedMultiplier: 10,
  objective: { maxP99LatencyMs: 500, maxErrorRate: 0.05 },
};

// ─── Validation Error ────────────────────────────────────────────

export interface SweepValidationError {
  parameter: string;
  message: string;
}

// ─── Normalisation Warning (Task 494) ────────────────────────────

export interface NormalisationWarning {
  generatorLabel: string;
  stepIndex: number;
  computedValue: number;
  appliedBound: number;
}

// ─── Sweep Report ────────────────────────────────────────────────

export interface SweepReport {
  status: 'completed' | 'cancelled';
  /** 1-based index of the in-progress step if cancelled. */
  cancelledAtStep?: number;
  steps: SweepStepResult[];
  kneePoint: KneePointResult | null;
  sustainableLoad: SustainableLoadResult;
  nonMonotonicSteps: NonMonotonicEntry[];
  warnings: NormalisationWarning[];
}

export interface KneePointResult {
  /** Offered RPS at the knee. */
  offeredRps: number;
  /** 0-based step index. */
  stepIndex: number;
}

export interface SustainableLoadResult {
  offeredRps: number | null;
  /** Explanation when null or when at/above ending load. */
  explanation?: string;
}

export interface NonMonotonicEntry {
  stepIndex: number;
  offeredRps: number;
}

// ─── Generator Info (for split computation) ──────────────────────

export interface GeneratorInfo {
  id: string;
  label: string;
  configuredRps: number;
}

// ─── Per-Step Load Computation (Task 491) ────────────────────────

/**
 * Round half-up to the nearest integer.
 * Exactly one half rounds up (e.g. 2.5 → 3, 3.5 → 4).
 */
export function roundHalfUp(value: number): number {
  return Math.floor(value + 0.5);
}

/**
 * Compute the per-step offered load array (R38.9–R38.10).
 *
 * Formula: startRps + n × (endRps − startRps) / (stepCount − 1)
 * rounded to whole RPS with exactly one half rounding up.
 *
 * Where rounding makes a step equal its predecessor, that step is raised by 1 RPS
 * so offered loads are strictly increasing.
 *
 * Returns null if the range cannot yield stepCount distinct whole-RPS values.
 */
export function computeStepLoads(
  startRps: number,
  endRps: number,
  stepCount: number,
): number[] | null {
  // Check if range can yield stepCount distinct values
  const maxDistinct = endRps - startRps + 1;
  if (maxDistinct < stepCount) {
    return null;
  }

  const loads: number[] = [];
  for (let n = 0; n < stepCount; n++) {
    const raw = startRps + (n * (endRps - startRps)) / (stepCount - 1);
    let rounded = roundHalfUp(raw);

    // Ensure strictly increasing
    if (loads.length > 0 && rounded <= loads[loads.length - 1]!) {
      rounded = loads[loads.length - 1]! + 1;
    }

    loads.push(rounded);
  }

  // Final check: if the last load exceeds endRps, the range is too small
  if (loads[loads.length - 1]! > endRps) {
    return null;
  }

  return loads;
}

/**
 * Compute the highest workable stepCount for a given range.
 */
export function maxWorkableStepCount(startRps: number, endRps: number): number {
  return Math.max(2, endRps - startRps + 1);
}

// ─── Validation (Task 492) ───────────────────────────────────────

/**
 * Validate a SweepConfig, returning an array of errors (empty if valid).
 *
 * Checks:
 * - Non-numeric, non-finite, or empty parameters.
 * - Out-of-range parameters.
 * - endRps at or below startRps.
 * - stepCount that cannot yield distinct whole-RPS values.
 */
export function validateSweepConfig(config: SweepConfig): SweepValidationError[] {
  const errors: SweepValidationError[] = [];

  // ── Helper for numeric checks ──
  function checkNumeric(name: string, value: unknown, min: number, max: number): boolean {
    if (value === null || value === undefined || value === '') {
      errors.push({ parameter: name, message: `${name} is required` });
      return false;
    }
    if (typeof value !== 'number' || !Number.isFinite(value as number)) {
      errors.push({
        parameter: name,
        message: `${name} must be a finite number`,
      });
      return false;
    }
    const v = value as number;
    if (v < min || v > max) {
      errors.push({
        parameter: name,
        message: `${name} must be between ${String(min)} and ${String(max)}, got ${String(v)}`,
      });
      return false;
    }
    return true;
  }

  const startOk = checkNumeric('startRps', config.startRps, 1, 100_000);
  const endOk = checkNumeric('endRps', config.endRps, 1, 100_000);
  checkNumeric('stepCount', config.stepCount, 2, 20);
  checkNumeric('durationPerStepMs', config.durationPerStepMs, 1_000, 1_800_000);
  checkNumeric('speedMultiplier', config.speedMultiplier, 1, 1000);
  checkNumeric('objective.maxP99LatencyMs', config.objective?.maxP99LatencyMs, 1, 600_000);
  checkNumeric('objective.maxErrorRate', config.objective?.maxErrorRate, 0.0, 1.0);

  // warmUpMs range depends on durationPerStepMs
  if (Number.isFinite(config.durationPerStepMs) && Number.isFinite(config.warmUpMs)) {
    const maxWarmUp = config.durationPerStepMs - 1;
    if (config.warmUpMs < 0 || config.warmUpMs > maxWarmUp) {
      errors.push({
        parameter: 'warmUpMs',
        message: `warmUpMs must be between 0 and ${String(maxWarmUp)}, got ${String(config.warmUpMs)}`,
      });
    }
  }

  // endRps must be strictly above startRps
  if (startOk && endOk && config.endRps <= config.startRps) {
    errors.push({
      parameter: 'endRps',
      message: `endRps must be strictly above startRps (${String(config.startRps)}), got ${String(config.endRps)}`,
    });
  }

  // stepCount vs range check
  if (
    startOk &&
    endOk &&
    config.endRps > config.startRps &&
    Number.isFinite(config.stepCount) &&
    config.stepCount >= 2 &&
    config.stepCount <= 20
  ) {
    const loads = computeStepLoads(config.startRps, config.endRps, config.stepCount);
    if (loads === null) {
      const highest = maxWorkableStepCount(config.startRps, config.endRps);
      errors.push({
        parameter: 'stepCount',
        message: `Cannot yield ${String(config.stepCount)} distinct whole-RPS values in range ${String(config.startRps)}–${String(config.endRps)}; highest workable count is ${String(highest)}`,
      });
    }
  }

  return errors;
}

// ─── Per-Generator Split (Task 493) ──────────────────────────────

export interface GeneratorSplitResult {
  /** Map of generator id to assigned RPS for this step. */
  perGeneratorRps: Record<string, number>;
  /** Warnings emitted during the split. */
  warnings: NormalisationWarning[];
  /** The actual total applied RPS after clamping. */
  appliedRps: number;
}

/**
 * Maximum RPS per generator node (Task 494).
 */
export const MAX_GENERATOR_RPS = 100_000;

/**
 * Split the target step RPS across generators preserving their relative mix (R38.11–R38.13).
 *
 * Formula: round(S × ownRps / B) clamped to ≥1, residual assigned to the generator
 * with the highest configured RPS (ascending ID tie-break).
 *
 * Distribution, spike multiplier, and spike duration are untouched.
 * A per-node value above 100,000 is clamped with a warning.
 */
export function splitAcrossGenerators(
  stepRps: number,
  generators: GeneratorInfo[],
  stepIndex: number,
): GeneratorSplitResult {
  const totalConfiguredRps = generators.reduce((s, g) => s + g.configuredRps, 0);

  const perGeneratorRps: Record<string, number> = {};
  const warnings: NormalisationWarning[] = [];

  // Compute individual shares
  for (const gen of generators) {
    const raw = (stepRps * gen.configuredRps) / totalConfiguredRps;
    const assigned = Math.max(1, roundHalfUp(raw));
    perGeneratorRps[gen.id] = assigned;
  }

  // Compute sum and assign residual to generator with highest configured RPS
  // Ties broken by ascending identifier
  const sum = Object.values(perGeneratorRps).reduce((s, v) => s + v, 0);
  const residual = stepRps - sum;

  if (residual !== 0) {
    // Find the generator with the highest configured RPS; tie-break by ascending ID
    const sorted = [...generators].sort((a, b) => {
      if (b.configuredRps !== a.configuredRps) return b.configuredRps - a.configuredRps;
      return a.id.localeCompare(b.id);
    });
    const residualGen = sorted[0]!;
    perGeneratorRps[residualGen.id] = Math.max(1, perGeneratorRps[residualGen.id]! + residual);
  }

  // Clamp per-node values above 100,000 with a warning (Task 494)
  for (const gen of generators) {
    const value = perGeneratorRps[gen.id]!;
    if (value > MAX_GENERATOR_RPS) {
      warnings.push({
        generatorLabel: gen.label,
        stepIndex,
        computedValue: value,
        appliedBound: MAX_GENERATOR_RPS,
      });
      perGeneratorRps[gen.id] = MAX_GENERATOR_RPS;
    }
  }

  // Compute actual applied RPS after clamping
  const appliedRps = Object.values(perGeneratorRps).reduce((s, v) => s + v, 0);

  return { perGeneratorRps, warnings, appliedRps };
}

// ─── Verdict Evaluation (Task 502) ──────────────────────────────

/**
 * Evaluate a step's verdict against the service objective.
 *
 * A step satisfies when:
 * - Its p99 latency is at or below maxP99LatencyMs
 * - Its total error rate is at or below maxErrorRate
 *
 * A step is 'not-evaluated' when the measurement interval recorded no terminations.
 */
export function evaluateVerdict(
  latencyP99: number,
  totalErrorRate: number,
  totalTerminations: number,
  objective: ServiceObjective,
): { verdict: 'satisfied' | 'violated' | 'not-evaluated'; explanation?: string } {
  if (totalTerminations === 0) {
    return {
      verdict: 'not-evaluated',
      explanation: 'The measurement interval recorded no terminations',
    };
  }

  const p99Ok = latencyP99 <= objective.maxP99LatencyMs;
  const errorOk = totalErrorRate <= objective.maxErrorRate;

  if (p99Ok && errorOk) {
    return { verdict: 'satisfied' };
  }

  return { verdict: 'violated' };
}

// ─── Knee_Point and Sustainable_Load (Tasks 503–504) ─────────────

export interface SweepDetermination {
  kneePoint: KneePointResult | null;
  sustainableLoad: SustainableLoadResult;
  nonMonotonicSteps: NonMonotonicEntry[];
}

/**
 * Determine the Knee_Point and Sustainable_Load from a set of completed steps.
 *
 * Knee_Point: lowest offered RPS among violating evaluated steps.
 * Sustainable_Load: highest satisfying RPS below the Knee_Point.
 *
 * Sustainable_Load is reported as below the starting load where every step below the
 * knee violated or was not-evaluated.
 *
 * Sustainable_Load is reported as at or above the ending load with no knee where every
 * evaluated step satisfied.
 *
 * Non-monotonic results (steps above the knee that satisfied) are reported rather than smoothed.
 */
export function determineSweepResults(
  steps: SweepStepResult[],
  config: SweepConfig,
): SweepDetermination {
  // Filter to only evaluated steps for knee/sustainable determination
  const evaluated = steps.filter((s) => s.verdict !== 'not-evaluated');

  // Find the Knee_Point: lowest RPS among violating evaluated steps
  const violating = evaluated.filter((s) => s.verdict === 'violated');
  const satisfying = evaluated.filter((s) => s.verdict === 'satisfied');

  // Case: every evaluated step satisfied — no knee
  if (violating.length === 0) {
    if (satisfying.length === 0) {
      return {
        kneePoint: null,
        sustainableLoad: {
          offeredRps: null,
          explanation: 'No evaluated steps available to determine Sustainable_Load',
        },
        nonMonotonicSteps: [],
      };
    }
    const maxSatisfied = Math.max(...satisfying.map((s) => s.requestedRps));
    return {
      kneePoint: null,
      sustainableLoad: {
        offeredRps: maxSatisfied,
        explanation: `Every evaluated step satisfied the objective; Sustainable_Load is at or above the ending load (${String(config.endRps)} RPS)`,
      },
      nonMonotonicSteps: [],
    };
  }

  // Knee_Point: lowest violating evaluated step by requestedRps
  const kneeStep = violating.reduce((lowest, s) =>
    s.requestedRps < lowest.requestedRps ? s : lowest,
  );
  const kneePoint: KneePointResult = {
    offeredRps: kneeStep.requestedRps,
    stepIndex: kneeStep.stepIndex,
  };

  // Sustainable_Load: highest satisfying evaluated step below the knee
  const belowKnee = satisfying.filter((s) => s.requestedRps < kneePoint.offeredRps);
  let sustainableLoad: SustainableLoadResult;

  if (belowKnee.length === 0) {
    sustainableLoad = {
      offeredRps: null,
      explanation: `Sustainable_Load is below the starting load (${String(config.startRps)} RPS): every step below the knee violated or was not evaluated`,
    };
  } else {
    const maxBelowKnee = Math.max(...belowKnee.map((s) => s.requestedRps));
    sustainableLoad = { offeredRps: maxBelowKnee };
  }

  // Non-monotonic: steps above the knee that satisfied
  const aboveKnee = satisfying.filter((s) => s.requestedRps > kneePoint.offeredRps);
  const nonMonotonicSteps: NonMonotonicEntry[] = aboveKnee.map((s) => ({
    stepIndex: s.stepIndex,
    offeredRps: s.requestedRps,
  }));

  return { kneePoint, sustainableLoad, nonMonotonicSteps };
}

// ─── Canvas Snapshot (Task 499) ──────────────────────────────────

export interface CanvasSnapshot {
  nodes: SimulationNode[];
  edges: EdgeData[];
  /** Additional state to restore: per-node configs, routing policies, edge weights, groups. */
  additionalState?: Record<string, unknown>;
}

// ─── Sweep State ─────────────────────────────────────────────────

export type SweepStatus = 'idle' | 'confirming' | 'running' | 'cancelled' | 'completed';

export interface SweepState {
  status: SweepStatus;
  config: SweepConfig | null;
  currentStepIndex: number;
  completedSteps: SweepStepResult[];
  warnings: NormalisationWarning[];
  snapshot: CanvasSnapshot | null;
  report: SweepReport | null;
}

// ─── Confirmation (Task 500) ─────────────────────────────────────

export interface SweepConfirmation {
  /** True if a run is Running or Paused and will be stopped. */
  runWillBeStopped: boolean;
  /** Message naming that metrics will be discarded. */
  message: string;
}

/**
 * Build the confirmation message required before starting a sweep.
 */
export function buildSweepConfirmation(simState: 'idle' | 'running' | 'paused'): SweepConfirmation {
  if (simState === 'running' || simState === 'paused') {
    return {
      runWillBeStopped: true,
      message: `A ${simState === 'running' ? 'Running' : 'Paused'} run will be stopped and its metrics discarded before starting the sweep`,
    };
  }
  return {
    runWillBeStopped: false,
    message: 'Starting capacity sweep',
  };
}

// ─── Cancellation (Task 501) ─────────────────────────────────────

/**
 * Process a sweep cancellation: retain completed steps, discard in-progress.
 */
export function processCancellation(
  completedSteps: SweepStepResult[],
  inProgressStepIndex: number,
  config: SweepConfig,
): SweepReport {
  const determination = determineSweepResults(completedSteps, config);

  return {
    status: 'cancelled',
    cancelledAtStep: inProgressStepIndex + 1, // 1-based display
    steps: completedSteps,
    kneePoint: determination.kneePoint,
    sustainableLoad: determination.sustainableLoad,
    nonMonotonicSteps: determination.nonMonotonicSteps,
    warnings: [],
  };
}

// ─── Full Sweep Completion ───────────────────────────────────────

/**
 * Process a completed sweep — all steps finished.
 */
export function processSweepCompletion(
  steps: SweepStepResult[],
  config: SweepConfig,
  warnings: NormalisationWarning[],
): SweepReport {
  const determination = determineSweepResults(steps, config);

  return {
    status: 'completed',
    steps,
    kneePoint: determination.kneePoint,
    sustainableLoad: determination.sustainableLoad,
    nonMonotonicSteps: determination.nonMonotonicSteps,
    warnings,
  };
}

// ─── Topology Validation (Task 494) ──────────────────────────────

/**
 * Validate that the topology contains at least one Traffic_Generator and
 * that the configured RPS sum is not 0.
 */
export function validateTopologyForSweep(generators: GeneratorInfo[]): SweepValidationError | null {
  if (generators.length === 0) {
    return {
      parameter: 'topology',
      message: 'A sweep requires at least one Traffic_Generator node',
    };
  }
  const totalRps = generators.reduce((s, g) => s + g.configuredRps, 0);
  if (totalRps === 0) {
    return {
      parameter: 'topology',
      message: 'The configured RPS sum across all Traffic_Generator nodes is 0',
    };
  }
  return null;
}

// ─── Scheduler Exclusion (Task 498) ──────────────────────────────

/**
 * Check if a node is a Scheduler type — its emitted Jobs are excluded from offered load.
 */
export function isSchedulerNode(node: SimulationNode): boolean {
  return node.nodeType === 'SCHEDULER';
}

// ─── Controller Class (Tasks 497–501) ────────────────────────────

/**
 * Orchestrates a capacity sweep on the main thread.
 *
 * Coordinates sequential execution of steps, state clearing between steps,
 * canvas snapshot/restore, and result aggregation.
 */
export class CapacitySweepController {
  private state: SweepState = {
    status: 'idle',
    config: null,
    currentStepIndex: 0,
    completedSteps: [],
    warnings: [],
    snapshot: null,
    report: null,
  };

  private readonly generators: GeneratorInfo[];
  private readonly seed: number;
  private stepLoads: number[] = [];

  constructor(generators: GeneratorInfo[], seed: number) {
    this.generators = generators;
    this.seed = seed;
  }

  /**
   * Validate and prepare the sweep. Returns errors if invalid.
   */
  prepare(config: SweepConfig): SweepValidationError[] {
    const errors = validateSweepConfig(config);
    const topoError = validateTopologyForSweep(this.generators);
    if (topoError) errors.push(topoError);
    if (errors.length > 0) return errors;

    const loads = computeStepLoads(config.startRps, config.endRps, config.stepCount);
    if (!loads) {
      errors.push({
        parameter: 'stepCount',
        message: `Cannot yield ${String(config.stepCount)} distinct whole-RPS values`,
      });
      return errors;
    }

    this.state.config = config;
    this.state.status = 'confirming';
    this.stepLoads = loads;
    return [];
  }

  /**
   * Start the sweep after confirmation.
   * Caller must snapshot the canvas and pass it here.
   */
  start(snapshot: CanvasSnapshot): void {
    this.state.status = 'running';
    this.state.currentStepIndex = 0;
    this.state.completedSteps = [];
    this.state.warnings = [];
    this.state.snapshot = snapshot;
    this.state.report = null;
  }

  /**
   * Build the SweepStepRequest for the current step.
   */
  buildCurrentStepRequest(): SweepStepRequest | null {
    const config = this.state.config;
    if (!config || this.state.status !== 'running') return null;

    const stepIndex = this.state.currentStepIndex;
    if (stepIndex >= this.stepLoads.length) return null;

    const requestedRps = this.stepLoads[stepIndex]!;
    const split = splitAcrossGenerators(requestedRps, this.generators, stepIndex);
    this.state.warnings.push(...split.warnings);

    return {
      stepIndex,
      requestedRps,
      perGeneratorRps: split.perGeneratorRps,
      durationPerStepMs: config.durationPerStepMs,
      warmUpMs: config.warmUpMs,
      speedMultiplier: config.speedMultiplier,
      seed: this.seed,
    };
  }

  /**
   * Record a completed step result and advance to the next.
   * Returns the SweepReport if this was the last step.
   */
  recordStepResult(result: SweepStepResult): SweepReport | null {
    this.state.completedSteps.push(result);
    this.state.currentStepIndex++;

    if (this.state.currentStepIndex >= this.stepLoads.length) {
      // All steps completed
      const report = processSweepCompletion(
        this.state.completedSteps,
        this.state.config!,
        this.state.warnings,
      );
      this.state.status = 'completed';
      this.state.report = report;
      return report;
    }

    return null;
  }

  /**
   * Cancel the sweep: retain completed steps, discard in-progress.
   */
  cancel(): SweepReport {
    const report = processCancellation(
      this.state.completedSteps,
      this.state.currentStepIndex,
      this.state.config!,
    );
    report.warnings = this.state.warnings;
    this.state.status = 'cancelled';
    this.state.report = report;
    return report;
  }

  /**
   * Get the canvas snapshot for restoration (Task 499).
   */
  getSnapshot(): CanvasSnapshot | null {
    return this.state.snapshot;
  }

  /**
   * Get the current sweep status.
   */
  getStatus(): SweepStatus {
    return this.state.status;
  }

  /**
   * Get the current step index (0-based).
   */
  getCurrentStepIndex(): number {
    return this.state.currentStepIndex;
  }

  /**
   * Get the step loads array.
   */
  getStepLoads(): readonly number[] {
    return this.stepLoads;
  }

  /**
   * Get the completed report.
   */
  getReport(): SweepReport | null {
    return this.state.report;
  }

  /**
   * Reset the controller to idle state.
   */
  reset(): void {
    this.state = {
      status: 'idle',
      config: null,
      currentStepIndex: 0,
      completedSteps: [],
      warnings: [],
      snapshot: null,
      report: null,
    };
    this.stepLoads = [];
  }
}
