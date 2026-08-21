import {
  NodeType,
  Distribution,
  type SimulationNode,
  type TrafficGeneratorConfig,
  type LoadBalancerConfig,
  type AppServerConfig,
  type CacheConfig,
  type DatabaseConfig,
  type MessageQueueConfig,
} from '@/types/nodes';

// ─── Validation Result ───────────────────────────────────────────

export interface ConfigValidationResult {
  valid: boolean;
  errors: { field: string; message: string }[];
}

// ─── Helpers ─────────────────────────────────────────────────────

function isValidNumber(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && Number.isFinite(value);
}

function checkRange(
  errors: { field: string; message: string }[],
  field: string,
  value: unknown,
  min: number,
  max: number,
): void {
  if (!isValidNumber(value)) {
    errors.push({ field, message: `${field} must be a valid number.` });
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
    errors.push({ field, message: `${field} must be a valid number.` });
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
    errors.push({ field, message: `${field} must be a valid number.` });
    return;
  }
  if (value < 0) {
    errors.push({ field, message: `${field} must be non-negative.` });
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

export function validateLoadBalancerConfig(
  config: LoadBalancerConfig,
): ConfigValidationResult {
  const errors: { field: string; message: string }[] = [];

  checkPositive(errors, 'healthCheckIntervalMs', config.healthCheckIntervalMs);
  checkPositive(errors, 'evictionThreshold', config.evictionThreshold);

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

// ─── Unified Config Validator ────────────────────────────────────

export function validateNodeConfig(node: SimulationNode): ConfigValidationResult {
  switch (node.nodeType) {
    case NodeType.TrafficGenerator:
      return validateTrafficGeneratorConfig(node.config);
    case NodeType.LoadBalancer:
      return validateLoadBalancerConfig(node.config);
    case NodeType.AppServer:
      return validateAppServerConfig(node.config);
    case NodeType.Cache:
      return validateCacheConfig(node.config);
    case NodeType.Database:
      return validateDatabaseConfig(node.config);
    case NodeType.MessageQueue:
      return validateMessageQueueConfig(node.config);
  }
}

// ─── Normalize Config (Clamp Out-of-Range Values) ────────────────

function clamp(value: number, min: number, max: number): number {
  if (!isValidNumber(value)) return min;
  return Math.max(min, Math.min(max, value));
}

/**
 * Clamps out-of-range values for imported configs.
 * Returns a new SimulationNode with clamped config values.
 */
export function normalizeConfig(node: SimulationNode): SimulationNode {
  switch (node.nodeType) {
    case NodeType.TrafficGenerator:
      return {
        ...node,
        config: {
          rps: clamp(node.config.rps, 1, 100_000),
          distribution: Object.values(Distribution).includes(node.config.distribution)
            ? node.config.distribution
            : Distribution.Poisson,
          spikeMultiplier: clamp(node.config.spikeMultiplier, 1, 20),
          spikeDurationSec: clamp(node.config.spikeDurationSec, 0, Number.MAX_SAFE_INTEGER),
        },
      };
    case NodeType.LoadBalancer:
      return {
        ...node,
        config: {
          algorithm: node.config.algorithm,
          healthCheckIntervalMs: clamp(node.config.healthCheckIntervalMs, 1, Number.MAX_SAFE_INTEGER),
          evictionThreshold: clamp(node.config.evictionThreshold, 1, Number.MAX_SAFE_INTEGER),
        },
      };
    case NodeType.AppServer:
      return {
        ...node,
        config: {
          workerThreadPoolSize: clamp(node.config.workerThreadPoolSize, 1, 1_000),
          requestQueueDepth: clamp(node.config.requestQueueDepth, 0, 10_000),
          processingTimeMeanMs: clamp(node.config.processingTimeMeanMs, 0, Number.MAX_SAFE_INTEGER),
          processingTimeStdDevMs: clamp(node.config.processingTimeStdDevMs, 0, Number.MAX_SAFE_INTEGER),
        },
      };
    case NodeType.Cache:
      return {
        ...node,
        config: {
          hitRatio: clamp(node.config.hitRatio, 0, 1),
          evictionPolicy: node.config.evictionPolicy,
          accessLatencyMs: clamp(node.config.accessLatencyMs, 0, Number.MAX_SAFE_INTEGER),
        },
      };
    case NodeType.Database:
      return {
        ...node,
        config: {
          connectionPoolSize: clamp(node.config.connectionPoolSize, 1, 500),
          queryLatencyMeanMs: clamp(node.config.queryLatencyMeanMs, 0, Number.MAX_SAFE_INTEGER),
          queryLatencyStdDevMs: clamp(node.config.queryLatencyStdDevMs, 0, Number.MAX_SAFE_INTEGER),
          lockTimeoutMs: clamp(node.config.lockTimeoutMs, 1, Number.MAX_SAFE_INTEGER),
          dbType: node.config.dbType,
        },
      };
    case NodeType.MessageQueue:
      return {
        ...node,
        config: {
          consumerBatchSize: clamp(node.config.consumerBatchSize, 1, 10_000),
          bufferCapacity: clamp(node.config.bufferCapacity, 1, Number.MAX_SAFE_INTEGER),
          backpressureThresholdPct: clamp(node.config.backpressureThresholdPct, 0, 100),
          backpressureStrategy: node.config.backpressureStrategy,
        },
      };
  }
}
