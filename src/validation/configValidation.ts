import {
  NodeType,
  Distribution,
  VerificationMode,
  RetryBackoff,
  RedriveMode,
  OverlapPolicy,
  type SimulationNode,
  type TrafficGeneratorConfig,
  type ApiGatewayConfig,
  type RateLimiterConfig,
  type LoadBalancerConfig,
  type CircuitBreakerConfig,
  type AppServerConfig,
  type CacheConfig,
  type DatabaseConfig,
  type MessageQueueConfig,
  type AuthServiceConfig,
  type AuthzServiceConfig,
  type WorkerPoolConfig,
  type DeadLetterQueueConfig,
  type ObjectStoreConfig,
  type SchedulerConfig,
} from '@/types/nodes';
import type { MigrationWarning } from '@/types/migration';

// ─── Validation Result ───────────────────────────────────────────

export interface ConfigValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
}

/**
 * Explains *why* a value is not usable as a number, always naming the parameter.
 *
 * The three rejected shapes are called out separately because they arrive from different
 * places: an empty control in the config panel, a wrongly-typed field in an imported
 * file, and an arithmetic result of `NaN` or `Infinity`.
 */
function describeInvalidNumber(field: string, value: unknown): string {
  if (value === '' || value === null || value === undefined) {
    return `${field} must be a number and was left empty.`;
  }
  if (typeof value !== 'number') {
    return `${field} must be a number, not ${typeof value}.`;
  }
  if (Number.isNaN(value)) {
    return `${field} must be a number and was not a number (NaN).`;
  }
  return `${field} must be a finite number.`;
}

function checkRange(
  errors: { field: string; message: string }[],
  field: string,
  value: unknown,
  min: number,
  max: number,
): void {
  if (!isValidNumber(value)) {
    errors.push({ field, message: describeInvalidNumber(field, value) });
    return;
  }
  if (value < min || value > max) {
    errors.push({ field, message: `${field} must be between ${min} and ${max}.` });
  }
}

function checkPositive(
  errors: { field: string; message: string }[],
  field: string,
  value: unknown,
): void {
  if (!isValidNumber(value)) {
    errors.push({ field, message: describeInvalidNumber(field, value) });
    return;
  }
  if (value <= 0) {
    errors.push({ field, message: `${field} must be greater than 0.` });
  }
}

function checkNonNegative(
  errors: { field: string; message: string }[],
  field: string,
  value: unknown,
): void {
  if (!isValidNumber(value)) {
    errors.push({ field, message: describeInvalidNumber(field, value) });
    return;
  }
  if (value < 0) {
    errors.push({ field, message: `${field} must be non-negative.` });
  }
}

/** Rejects a discriminant that is not one of the enum's declared members. */
function checkEnum<T extends Record<string, string>>(
  errors: { field: string; message: string }[],
  field: string,
  value: unknown,
  enumObject: T,
  enumName: string,
): void {
  if (!Object.values(enumObject).includes(value as T[keyof T])) {
    errors.push({ field, message: `${field} must be a valid ${enumName} value.` });
  }
}

// ─── Per-Type Validators ─────────────────────────────────────────

export function validateTrafficGeneratorConfig(
  config: TrafficGeneratorConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'rps', config.rps, 1, 100_000);
  checkRange(errors, 'spikeMultiplier', config.spikeMultiplier, 1, 20);
  checkNonNegative(errors, 'spikeDurationSec', config.spikeDurationSec);

  if (!Object.values(Distribution).includes(config.distribution)) {
    errors.push({ field: 'distribution', message: 'distribution must be a valid Distribution value.' });
  }

  return { valid: errors.length === 0, errors };
}

export function validateApiGatewayConfig(
  config: ApiGatewayConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'authLatencyMeanMs', config.authLatencyMeanMs, 0, 60_000);
  checkRange(errors, 'authLatencyStdDevMs', config.authLatencyStdDevMs, 0, 30_000);
  checkRange(errors, 'rejectionRate', config.rejectionRate, 0, 1);

  return { valid: errors.length === 0, errors };
}

export function validateRateLimiterConfig(
  config: RateLimiterConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'bucketCapacity', config.bucketCapacity, 1, 1_000_000);
  checkRange(errors, 'refillRatePerSec', config.refillRatePerSec, 1, 1_000_000);

  return { valid: errors.length === 0, errors };
}

export function validateLoadBalancerConfig(
  config: LoadBalancerConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkPositive(errors, 'healthCheckIntervalMs', config.healthCheckIntervalMs);
  checkPositive(errors, 'evictionThreshold', config.evictionThreshold);

  return { valid: errors.length === 0, errors };
}

export function validateCircuitBreakerConfig(
  config: CircuitBreakerConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'errorThreshold', config.errorThreshold, 0, 1);
  checkRange(errors, 'openDurationMs', config.openDurationMs, 100, 300_000);
  checkRange(errors, 'probeCount', config.probeCount, 1, 1_000);

  return { valid: errors.length === 0, errors };
}

export function validateAppServerConfig(
  config: AppServerConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'workerThreadPoolSize', config.workerThreadPoolSize, 1, 1_000);
  checkRange(errors, 'requestQueueDepth', config.requestQueueDepth, 0, 10_000);
  checkNonNegative(errors, 'processingTimeMeanMs', config.processingTimeMeanMs);
  checkNonNegative(errors, 'processingTimeStdDevMs', config.processingTimeStdDevMs);

  return { valid: errors.length === 0, errors };
}

export function validateCacheConfig(
  config: CacheConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'hitRatio', config.hitRatio, 0, 1);
  checkNonNegative(errors, 'accessLatencyMs', config.accessLatencyMs);

  return { valid: errors.length === 0, errors };
}

export function validateDatabaseConfig(
  config: DatabaseConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'connectionPoolSize', config.connectionPoolSize, 1, 500);
  checkNonNegative(errors, 'queryLatencyMeanMs', config.queryLatencyMeanMs);
  checkNonNegative(errors, 'queryLatencyStdDevMs', config.queryLatencyStdDevMs);
  checkPositive(errors, 'lockTimeoutMs', config.lockTimeoutMs);

  return { valid: errors.length === 0, errors };
}

export function validateMessageQueueConfig(
  config: MessageQueueConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'consumerBatchSize', config.consumerBatchSize, 1, 10_000);
  checkPositive(errors, 'bufferCapacity', config.bufferCapacity);
  checkRange(errors, 'backpressureThresholdPct', config.backpressureThresholdPct, 0, 100);

  return { valid: errors.length === 0, errors };
}

// ─── Per-Type Validators: Requirement 23–28 Node Types ───────────

/** Requirement 23.1 ranges. `tokenCacheHitRatio` is range-checked in both modes even
 *  though it only takes effect in Introspection mode, so switching mode cannot surface
 *  a value that was never validated. */
export function validateAuthServiceConfig(
  config: AuthServiceConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkEnum(errors, 'verificationMode', config.verificationMode, VerificationMode, 'VerificationMode');
  checkRange(errors, 'verificationLatencyMeanMs', config.verificationLatencyMeanMs, 0, 60_000);
  checkRange(errors, 'verificationLatencyStdDevMs', config.verificationLatencyStdDevMs, 0, 30_000);
  checkRange(errors, 'concurrencyLimit', config.concurrencyLimit, 1, 10_000);
  checkRange(errors, 'queueDepth', config.queueDepth, 0, 10_000);
  checkRange(errors, 'tokenCacheHitRatio', config.tokenCacheHitRatio, 0, 1);
  checkRange(errors, 'credentialFailureRate', config.credentialFailureRate, 0, 1);

  return { valid: errors.length === 0, errors };
}

/** Requirement 24.1 ranges. */
export function validateAuthzServiceConfig(
  config: AuthzServiceConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'policyLatencyMeanMs', config.policyLatencyMeanMs, 0, 60_000);
  checkRange(errors, 'policyLatencyStdDevMs', config.policyLatencyStdDevMs, 0, 30_000);
  checkRange(errors, 'policyCacheHitRatio', config.policyCacheHitRatio, 0, 1);
  checkRange(errors, 'lookupsPerRequest', config.lookupsPerRequest, 1, 50);
  checkRange(errors, 'denyRate', config.denyRate, 0, 1);
  checkRange(errors, 'concurrencyLimit', config.concurrencyLimit, 1, 10_000);
  checkRange(errors, 'queueDepth', config.queueDepth, 0, 10_000);

  return { valid: errors.length === 0, errors };
}

/** Requirement 25.1 ranges. `maxRetries` 0 is a permitted degenerate value — no retry
 *  at all — so its lower bound is 0 rather than 1. */
export function validateWorkerPoolConfig(
  config: WorkerPoolConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'concurrency', config.concurrency, 1, 10_000);
  checkRange(errors, 'jobProcessingMeanMs', config.jobProcessingMeanMs, 0, 600_000);
  checkRange(errors, 'jobProcessingStdDevMs', config.jobProcessingStdDevMs, 0, 300_000);
  checkRange(errors, 'prefetchBufferDepth', config.prefetchBufferDepth, 0, 10_000);
  checkRange(errors, 'jobFailureRate', config.jobFailureRate, 0, 1);
  checkRange(errors, 'maxRetries', config.maxRetries, 0, 10);
  checkEnum(errors, 'retryBackoff', config.retryBackoff, RetryBackoff, 'RetryBackoff');
  checkRange(errors, 'retryBaseDelayMs', config.retryBaseDelayMs, 1, 300_000);
  checkRange(errors, 'jobTimeoutMs', config.jobTimeoutMs, 1, 600_000);

  return { valid: errors.length === 0, errors };
}

/** Requirement 26.1 ranges. The redrive fields are validated in both modes so that
 *  switching to Automatic cannot surface an unvalidated interval or batch size. */
export function validateDeadLetterQueueConfig(
  config: DeadLetterQueueConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'capacity', config.capacity, 1, 1_000_000);
  checkRange(errors, 'retentionPeriodMs', config.retentionPeriodMs, 1, 2_592_000_000);
  checkEnum(errors, 'redriveMode', config.redriveMode, RedriveMode, 'RedriveMode');
  checkRange(errors, 'redriveIntervalMs', config.redriveIntervalMs, 1, 300_000);
  checkRange(errors, 'redriveBatchSize', config.redriveBatchSize, 1, 10_000);
  checkRange(errors, 'maxRedriveAttempts', config.maxRedriveAttempts, 0, 10);

  return { valid: errors.length === 0, errors };
}

/** Requirement 27.1 ranges. `throughputCapacityMBps` has a fractional lower bound of
 *  0.1, not 1, because a deliberately slow store is a realistic thing to model. */
export function validateObjectStoreConfig(
  config: ObjectStoreConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'objectSizeMeanKB', config.objectSizeMeanKB, 1, 10_485_760);
  checkRange(errors, 'objectSizeStdDevKB', config.objectSizeStdDevKB, 0, 10_485_760);
  checkRange(errors, 'throughputCapacityMBps', config.throughputCapacityMBps, 0.1, 100_000);
  checkRange(errors, 'baseLatencyMeanMs', config.baseLatencyMeanMs, 0, 60_000);
  checkRange(errors, 'baseLatencyStdDevMs', config.baseLatencyStdDevMs, 0, 30_000);
  checkRange(errors, 'maxConcurrentTransfers', config.maxConcurrentTransfers, 1, 100_000);
  checkRange(errors, 'transferQueueDepth', config.transferQueueDepth, 0, 10_000);
  checkRange(errors, 'readFraction', config.readFraction, 0, 1);
  checkRange(errors, 'writeLatencyMultiplier', config.writeLatencyMultiplier, 1, 100);

  return { valid: errors.length === 0, errors };
}

/**
 * Requirement 28.1 ranges.
 *
 * `jitterMs` is checked against its own 0–86,400,000 range only. A jitter larger than
 * `intervalMs` is *not* an error: R28.3 has the engine take the lesser of the two as the
 * effective jitter, so the pair is degenerate rather than invalid.
 */
export function validateSchedulerConfig(
  config: SchedulerConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkRange(errors, 'intervalMs', config.intervalMs, 100, 86_400_000);
  checkRange(errors, 'jobsPerTrigger', config.jobsPerTrigger, 1, 100_000);
  checkRange(errors, 'startOffsetMs', config.startOffsetMs, 0, 86_400_000);
  checkRange(errors, 'jitterMs', config.jitterMs, 0, 86_400_000);
  checkEnum(errors, 'overlapPolicy', config.overlapPolicy, OverlapPolicy, 'OverlapPolicy');
  checkRange(errors, 'maxDeferredTriggers', config.maxDeferredTriggers, 1, 1_000);

  return { valid: errors.length === 0, errors };
}

// ─── Unified Config Validator ────────────────────────────────────

export function validateNodeConfig(node: SimulationNode): ConfigValidationResult {
  switch (node.nodeType) {
    case NodeType.TrafficGenerator:
      return validateTrafficGeneratorConfig(node.config);
    case NodeType.ApiGateway:
      return validateApiGatewayConfig(node.config);
    case NodeType.RateLimiter:
      return validateRateLimiterConfig(node.config);
    case NodeType.LoadBalancer:
      return validateLoadBalancerConfig(node.config);
    case NodeType.CircuitBreaker:
      return validateCircuitBreakerConfig(node.config);
    case NodeType.AppServer:
      return validateAppServerConfig(node.config);
    case NodeType.Cache:
      return validateCacheConfig(node.config);
    case NodeType.Database:
      return validateDatabaseConfig(node.config);
    case NodeType.MessageQueue:
      return validateMessageQueueConfig(node.config);
    case NodeType.AuthService:
      return validateAuthServiceConfig(node.config);
    case NodeType.AuthzService:
      return validateAuthzServiceConfig(node.config);
    case NodeType.WorkerPool:
      return validateWorkerPoolConfig(node.config);
    case NodeType.DeadLetterQueue:
      return validateDeadLetterQueueConfig(node.config);
    case NodeType.ObjectStore:
      return validateObjectStoreConfig(node.config);
    case NodeType.Scheduler:
      return validateSchedulerConfig(node.config);
  }
}

// ─── Normalize Config (Clamp Out-of-Range Values) ────────────────

/**
 * The outcome of normalizing one imported node.
 *
 * `warnings` is empty when nothing was adjusted, which is the ordinary case for a file
 * this build wrote itself; a non-empty list is the caller's cue to tell the user what
 * changed rather than let a silent clamp masquerade as a faithful load.
 */
export interface NormalizedConfigResult {
  node: SimulationNode;
  warnings: MigrationWarning[];
}

function clamp(value: number, min: number, max: number): number {
  if (!isValidNumber(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Builds a clamp bound to one node's label and warning list.
 *
 * Every clamp that actually changes a value records a warning. `NaN !== NaN` means a
 * non-finite import is recorded too, which is the case most worth telling the user about.
 */
function makeClamper(label: string, warnings: MigrationWarning[]) {
  return function clampField(
    field: string,
    value: number,
    min: number,
    max: number,
  ): number {
    const applied = clamp(value, min, max);
    if (applied !== value) {
      warnings.push({ label, field, importedValue: value, appliedValue: applied });
    }
    return applied;
  };
}

/** Falls an unrecognised enum discriminant back to a default, recording the substitution. */
function coerceEnum<T extends Record<string, string>, V extends T[keyof T]>(
  label: string,
  warnings: MigrationWarning[],
  field: string,
  value: unknown,
  enumObject: T,
  fallback: V,
): V {
  if (Object.values(enumObject).includes(value as T[keyof T])) {
    return value as V;
  }
  warnings.push({ label, field, importedValue: value, appliedValue: fallback });
  return fallback;
}

/**
 * Clamps out-of-range values for imported configs and reports what it changed.
 *
 * Returns a new `SimulationNode` — the input is never mutated — alongside one
 * `MigrationWarning` per adjusted parameter, each naming the node's label, the parameter,
 * the value the file carried, and the bound applied in its place.
 */
export function normalizeConfig(node: SimulationNode): NormalizedConfigResult {
  const warnings: MigrationWarning[] = [];
  const c = makeClamper(node.label, warnings);

  switch (node.nodeType) {
    case NodeType.TrafficGenerator:
      return {
        node: {
          ...node,
          config: {
            rps: c('rps', node.config.rps, 1, 100_000),
            distribution: coerceEnum(
              node.label, warnings, 'distribution', node.config.distribution,
              Distribution, Distribution.Poisson,
            ),
            spikeMultiplier: c('spikeMultiplier', node.config.spikeMultiplier, 1, 20),
            spikeDurationSec: c('spikeDurationSec', node.config.spikeDurationSec, 0, Number.MAX_SAFE_INTEGER),
          },
        },
        warnings,
      };
    case NodeType.ApiGateway:
      return {
        node: {
          ...node,
          config: {
            authLatencyMeanMs: c('authLatencyMeanMs', node.config.authLatencyMeanMs, 0, 60_000),
            authLatencyStdDevMs: c('authLatencyStdDevMs', node.config.authLatencyStdDevMs, 0, 30_000),
            rejectionRate: c('rejectionRate', node.config.rejectionRate, 0, 1),
          },
        },
        warnings,
      };
    case NodeType.RateLimiter:
      return {
        node: {
          ...node,
          config: {
            bucketCapacity: c('bucketCapacity', node.config.bucketCapacity, 1, 1_000_000),
            refillRatePerSec: c('refillRatePerSec', node.config.refillRatePerSec, 1, 1_000_000),
          },
        },
        warnings,
      };
    case NodeType.LoadBalancer:
      return {
        node: {
          ...node,
          config: {
            algorithm: node.config.algorithm,
            healthCheckIntervalMs: c('healthCheckIntervalMs', node.config.healthCheckIntervalMs, 1, Number.MAX_SAFE_INTEGER),
            evictionThreshold: c('evictionThreshold', node.config.evictionThreshold, 1, Number.MAX_SAFE_INTEGER),
          },
        },
        warnings,
      };
    case NodeType.CircuitBreaker:
      return {
        node: {
          ...node,
          config: {
            errorThreshold: c('errorThreshold', node.config.errorThreshold, 0, 1),
            openDurationMs: c('openDurationMs', node.config.openDurationMs, 100, 300_000),
            probeCount: c('probeCount', node.config.probeCount, 1, 1_000),
          },
        },
        warnings,
      };
    case NodeType.AppServer:
      return {
        node: {
          ...node,
          config: {
            workerThreadPoolSize: c('workerThreadPoolSize', node.config.workerThreadPoolSize, 1, 1_000),
            requestQueueDepth: c('requestQueueDepth', node.config.requestQueueDepth, 0, 10_000),
            processingTimeMeanMs: c('processingTimeMeanMs', node.config.processingTimeMeanMs, 0, Number.MAX_SAFE_INTEGER),
            processingTimeStdDevMs: c('processingTimeStdDevMs', node.config.processingTimeStdDevMs, 0, Number.MAX_SAFE_INTEGER),
          },
        },
        warnings,
      };
    case NodeType.Cache:
      return {
        node: {
          ...node,
          config: {
            hitRatio: c('hitRatio', node.config.hitRatio, 0, 1),
            evictionPolicy: node.config.evictionPolicy,
            accessLatencyMs: c('accessLatencyMs', node.config.accessLatencyMs, 0, Number.MAX_SAFE_INTEGER),
          },
        },
        warnings,
      };
    case NodeType.Database:
      return {
        node: {
          ...node,
          config: {
            connectionPoolSize: c('connectionPoolSize', node.config.connectionPoolSize, 1, 500),
            queryLatencyMeanMs: c('queryLatencyMeanMs', node.config.queryLatencyMeanMs, 0, Number.MAX_SAFE_INTEGER),
            queryLatencyStdDevMs: c('queryLatencyStdDevMs', node.config.queryLatencyStdDevMs, 0, Number.MAX_SAFE_INTEGER),
            lockTimeoutMs: c('lockTimeoutMs', node.config.lockTimeoutMs, 1, Number.MAX_SAFE_INTEGER),
            dbType: node.config.dbType,
          },
        },
        warnings,
      };
    case NodeType.MessageQueue:
      return {
        node: {
          ...node,
          config: {
            consumerBatchSize: c('consumerBatchSize', node.config.consumerBatchSize, 1, 10_000),
            bufferCapacity: c('bufferCapacity', node.config.bufferCapacity, 1, Number.MAX_SAFE_INTEGER),
            backpressureThresholdPct: c('backpressureThresholdPct', node.config.backpressureThresholdPct, 0, 100),
            backpressureStrategy: node.config.backpressureStrategy,
          },
        },
        warnings,
      };

    // ─── Requirement 23–28 Node Types ────────────────────────────

    case NodeType.AuthService:
      return {
        node: {
          ...node,
          config: {
            verificationMode: coerceEnum(
              node.label, warnings, 'verificationMode', node.config.verificationMode,
              VerificationMode, VerificationMode.Local,
            ),
            verificationLatencyMeanMs: c('verificationLatencyMeanMs', node.config.verificationLatencyMeanMs, 0, 60_000),
            verificationLatencyStdDevMs: c('verificationLatencyStdDevMs', node.config.verificationLatencyStdDevMs, 0, 30_000),
            concurrencyLimit: c('concurrencyLimit', node.config.concurrencyLimit, 1, 10_000),
            queueDepth: c('queueDepth', node.config.queueDepth, 0, 10_000),
            tokenCacheHitRatio: c('tokenCacheHitRatio', node.config.tokenCacheHitRatio, 0, 1),
            credentialFailureRate: c('credentialFailureRate', node.config.credentialFailureRate, 0, 1),
          },
        },
        warnings,
      };
    case NodeType.AuthzService:
      return {
        node: {
          ...node,
          config: {
            policyLatencyMeanMs: c('policyLatencyMeanMs', node.config.policyLatencyMeanMs, 0, 60_000),
            policyLatencyStdDevMs: c('policyLatencyStdDevMs', node.config.policyLatencyStdDevMs, 0, 30_000),
            policyCacheHitRatio: c('policyCacheHitRatio', node.config.policyCacheHitRatio, 0, 1),
            lookupsPerRequest: c('lookupsPerRequest', node.config.lookupsPerRequest, 1, 50),
            denyRate: c('denyRate', node.config.denyRate, 0, 1),
            concurrencyLimit: c('concurrencyLimit', node.config.concurrencyLimit, 1, 10_000),
            queueDepth: c('queueDepth', node.config.queueDepth, 0, 10_000),
          },
        },
        warnings,
      };
    case NodeType.WorkerPool:
      return {
        node: {
          ...node,
          config: {
            concurrency: c('concurrency', node.config.concurrency, 1, 10_000),
            jobProcessingMeanMs: c('jobProcessingMeanMs', node.config.jobProcessingMeanMs, 0, 600_000),
            jobProcessingStdDevMs: c('jobProcessingStdDevMs', node.config.jobProcessingStdDevMs, 0, 300_000),
            prefetchBufferDepth: c('prefetchBufferDepth', node.config.prefetchBufferDepth, 0, 10_000),
            jobFailureRate: c('jobFailureRate', node.config.jobFailureRate, 0, 1),
            maxRetries: c('maxRetries', node.config.maxRetries, 0, 10),
            retryBackoff: coerceEnum(
              node.label, warnings, 'retryBackoff', node.config.retryBackoff,
              RetryBackoff, RetryBackoff.Exponential,
            ),
            retryBaseDelayMs: c('retryBaseDelayMs', node.config.retryBaseDelayMs, 1, 300_000),
            jobTimeoutMs: c('jobTimeoutMs', node.config.jobTimeoutMs, 1, 600_000),
          },
        },
        warnings,
      };
    case NodeType.DeadLetterQueue:
      return {
        node: {
          ...node,
          config: {
            capacity: c('capacity', node.config.capacity, 1, 1_000_000),
            retentionPeriodMs: c('retentionPeriodMs', node.config.retentionPeriodMs, 1, 2_592_000_000),
            redriveMode: coerceEnum(
              node.label, warnings, 'redriveMode', node.config.redriveMode,
              RedriveMode, RedriveMode.Manual,
            ),
            redriveIntervalMs: c('redriveIntervalMs', node.config.redriveIntervalMs, 1, 300_000),
            redriveBatchSize: c('redriveBatchSize', node.config.redriveBatchSize, 1, 10_000),
            maxRedriveAttempts: c('maxRedriveAttempts', node.config.maxRedriveAttempts, 0, 10),
          },
        },
        warnings,
      };
    case NodeType.ObjectStore:
      return {
        node: {
          ...node,
          config: {
            objectSizeMeanKB: c('objectSizeMeanKB', node.config.objectSizeMeanKB, 1, 10_485_760),
            objectSizeStdDevKB: c('objectSizeStdDevKB', node.config.objectSizeStdDevKB, 0, 10_485_760),
            throughputCapacityMBps: c('throughputCapacityMBps', node.config.throughputCapacityMBps, 0.1, 100_000),
            baseLatencyMeanMs: c('baseLatencyMeanMs', node.config.baseLatencyMeanMs, 0, 60_000),
            baseLatencyStdDevMs: c('baseLatencyStdDevMs', node.config.baseLatencyStdDevMs, 0, 30_000),
            maxConcurrentTransfers: c('maxConcurrentTransfers', node.config.maxConcurrentTransfers, 1, 100_000),
            // Easy to miss: absent from schema v1 and defaulted by the migration, so it
            // reaches this clamp as whatever the file carried.
            transferQueueDepth: c('transferQueueDepth', node.config.transferQueueDepth, 0, 10_000),
            readFraction: c('readFraction', node.config.readFraction, 0, 1),
            writeLatencyMultiplier: c('writeLatencyMultiplier', node.config.writeLatencyMultiplier, 1, 100),
          },
        },
        warnings,
      };
    case NodeType.Scheduler:
      return {
        node: {
          ...node,
          config: {
            intervalMs: c('intervalMs', node.config.intervalMs, 100, 86_400_000),
            jobsPerTrigger: c('jobsPerTrigger', node.config.jobsPerTrigger, 1, 100_000),
            startOffsetMs: c('startOffsetMs', node.config.startOffsetMs, 0, 86_400_000),
            // Left independent of intervalMs on purpose: R28.3 has the engine take the
            // lesser of the two at fire time, so a larger jitter is degenerate, not invalid.
            jitterMs: c('jitterMs', node.config.jitterMs, 0, 86_400_000),
            overlapPolicy: coerceEnum(
              node.label, warnings, 'overlapPolicy', node.config.overlapPolicy,
              OverlapPolicy, OverlapPolicy.Skip,
            ),
            // Easy to miss for the same reason as transferQueueDepth above.
            maxDeferredTriggers: c('maxDeferredTriggers', node.config.maxDeferredTriggers, 1, 1_000),
          },
        },
        warnings,
      };
  }
}
