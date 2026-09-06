export {
  validateEdgeConnection,
  getValidProtocols,
  CONNECTION_RULES,
  PROTOCOL_OVERRIDES,
  type ValidationResult,
} from './edgeValidation';

export { detectCycles } from './cycleDetection';

export {
  validateTrafficGeneratorConfig,
  validateApiGatewayConfig,
  validateRateLimiterConfig,
  validateLoadBalancerConfig,
  validateCircuitBreakerConfig,
  validateAppServerConfig,
  validateCacheConfig,
  validateDatabaseConfig,
  validateMessageQueueConfig,
  validateAuthServiceConfig,
  validateAuthzServiceConfig,
  validateWorkerPoolConfig,
  validateDeadLetterQueueConfig,
  validateObjectStoreConfig,
  validateSchedulerConfig,
  validateNodeConfig,
  normalizeConfig,
  type ConfigValidationResult,
  type NormalizedConfigResult,
} from './configValidation';

// Re-exported here so an import-path caller can surface a clamp warning without also
// importing from `@/types` — see `normalizeConfig`.
export type { MigrationWarning } from '@/types/migration';
