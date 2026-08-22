import type { Node as RFNode } from '@xyflow/react';

// ─── Enumerations ────────────────────────────────────────────────

/**
 * The 15 supported node types in the simulation topology, in request-flow order.
 *
 * The nine originally shipped member *values* are byte-identical to schema v1, because
 * persisted topologies key off these strings — renaming one would orphan saved files.
 */
export enum NodeType {
  TrafficGenerator = 'TRAFFIC_GENERATOR',
  ApiGateway = 'API_GATEWAY',
  RateLimiter = 'RATE_LIMITER',
  LoadBalancer = 'LOAD_BALANCER',
  CircuitBreaker = 'CIRCUIT_BREAKER',
  AppServer = 'APP_SERVER',
  Cache = 'CACHE',
  Database = 'DATABASE',
  MessageQueue = 'MESSAGE_QUEUE',
  AuthService = 'AUTH_SERVICE',
  AuthzService = 'AUTHZ_SERVICE',
  WorkerPool = 'WORKER_POOL',
  DeadLetterQueue = 'DEAD_LETTER_QUEUE',
  ObjectStore = 'OBJECT_STORE',
  Scheduler = 'SCHEDULER',
}

/** Statistical distribution for traffic generation inter-arrival times. */
export enum Distribution {
  Poisson = 'POISSON',
  Uniform = 'UNIFORM',
}

/** Load balancing algorithm for distributing requests across backends. */
export enum LBAlgorithm {
  RoundRobin = 'ROUND_ROBIN',
  LeastConnections = 'LEAST_CONNECTIONS',
}

/** Cache eviction policy. */
export enum EvictionPolicy {
  LRU = 'LRU',
  LFU = 'LFU',
  TTL = 'TTL',
}

/** Database engine type. */
export enum DatabaseType {
  Relational = 'RELATIONAL',
  NoSQL = 'NOSQL',
}

/** Circuit breaker state machine positions. */
export enum CircuitState {
  Closed = 'CLOSED',
  Open = 'OPEN',
  HalfOpen = 'HALF_OPEN',
}

/** Strategy applied when a message queue reaches its buffer capacity. */
export enum BackpressureStrategy {
  DropOldest = 'DROP_OLDEST',
  BlockProducer = 'BLOCK_PRODUCER',
  RejectNew = 'REJECT_NEW',
}

/** How an Auth_Service node verifies a credential. */
export enum VerificationMode {
  Local = 'LOCAL',
  Introspection = 'INTROSPECTION',
}

/** How a Worker_Pool grows the delay between retry attempts. */
export enum RetryBackoff {
  Fixed = 'FIXED',
  Exponential = 'EXPONENTIAL',
}

/** Whether a Dead_Letter_Queue redrives retained messages on its own. */
export enum RedriveMode {
  Manual = 'MANUAL',
  Automatic = 'AUTOMATIC',
}

/** What a Scheduler does when a trigger fires while the previous one is still running. */
export enum OverlapPolicy {
  Allow = 'ALLOW',
  Skip = 'SKIP',
  Queue = 'QUEUE',
}

/**
 * Per-node downstream routing policy (Requirement 32). Lives on BaseNodeData, not on config,
 * because it is cross-cutting: the engine applies it, not the node processor.
 */
export enum RoutingPolicy {
  First = 'FIRST',
  RoundRobin = 'ROUND_ROBIN',
  Weighted = 'WEIGHTED',
  FanOut = 'FAN_OUT',
}

// ─── Base Node ───────────────────────────────────────────────────

/** Common fields shared by all simulation node types. */
export interface BaseNodeData {
  id: string;
  nodeType: NodeType;
  label: string;
  position: { x: number; y: number };
  /**
   * R32.1 — defaults to First on placement; defaulted to First on schema v1 load (R32.13).
   *
   * Deliberately on the base node rather than on each config interface: one engine-side
   * resolver reads it for all fifteen types, and `UPDATE_CONFIG` (which merges into
   * `node.config`) cannot silently change routing mid-run.
   */
  routingPolicy: RoutingPolicy;
}

// ─── Per-Type Configuration Interfaces ───────────────────────────

export interface TrafficGeneratorConfig {
  rps: number;
  distribution: Distribution;
  spikeMultiplier: number;
  spikeDurationSec: number;
}

export interface ApiGatewayConfig {
  authLatencyMeanMs: number;
  authLatencyStdDevMs: number;
  /** Fraction of requests rejected as unauthorized (0.0–1.0). */
  rejectionRate: number;
}

export interface RateLimiterConfig {
  /** Token bucket capacity — the maximum burst admitted. */
  bucketCapacity: number;
  /** Tokens replenished per second — the sustained rate allowed. */
  refillRatePerSec: number;
}

export interface LoadBalancerConfig {
  algorithm: LBAlgorithm;
  healthCheckIntervalMs: number;
  evictionThreshold: number;
}

export interface CircuitBreakerConfig {
  /** Downstream error rate above which the breaker trips (0.0–1.0). */
  errorThreshold: number;
  /** How long the breaker stays open before probing, in ms. */
  openDurationMs: number;
  /** Requests allowed through while half-open to test recovery. */
  probeCount: number;
}

export interface AppServerConfig {
  workerThreadPoolSize: number;
  requestQueueDepth: number;
  processingTimeMeanMs: number;
  processingTimeStdDevMs: number;
}

export interface CacheConfig {
  hitRatio: number;
  evictionPolicy: EvictionPolicy;
  accessLatencyMs: number;
}

export interface DatabaseConfig {
  connectionPoolSize: number;
  queryLatencyMeanMs: number;
  queryLatencyStdDevMs: number;
  lockTimeoutMs: number;
  dbType: DatabaseType;
}

export interface MessageQueueConfig {
  consumerBatchSize: number;
  bufferCapacity: number;
  backpressureThresholdPct: number;
  backpressureStrategy: BackpressureStrategy;
}

/** Identity verification service — Requirement 23. */
export interface AuthServiceConfig {
  verificationMode: VerificationMode;
  verificationLatencyMeanMs: number;    // 0–60,000
  verificationLatencyStdDevMs: number;  // 0–30,000
  concurrencyLimit: number;             // 1–10,000
  queueDepth: number;                   // 0–10,000
  tokenCacheHitRatio: number;           // 0.0–1.0, applied only in Introspection mode
  credentialFailureRate: number;        // 0.0–1.0
}

/** Policy evaluation service — Requirement 24. */
export interface AuthzServiceConfig {
  policyLatencyMeanMs: number;          // 0–60,000
  policyLatencyStdDevMs: number;        // 0–30,000
  policyCacheHitRatio: number;          // 0.0–1.0
  lookupsPerRequest: number;            // 1–50
  denyRate: number;                     // 0.0–1.0
  concurrencyLimit: number;             // 1–10,000
  queueDepth: number;                   // 0–10,000
}

/** Fixed-concurrency job consumer with a retry policy — Requirement 25. */
export interface WorkerPoolConfig {
  concurrency: number;                  // 1–10,000
  jobProcessingMeanMs: number;          // 0–600,000
  jobProcessingStdDevMs: number;        // 0–300,000
  prefetchBufferDepth: number;          // 0–10,000
  jobFailureRate: number;               // 0.0–1.0
  maxRetries: number;                   // 0–10
  retryBackoff: RetryBackoff;
  retryBaseDelayMs: number;             // 1–300,000
  jobTimeoutMs: number;                 // 1–600,000
}

/** Terminal retention for retry-exhausted jobs — Requirement 26. */
export interface DeadLetterQueueConfig {
  capacity: number;                     // 1–1,000,000
  retentionPeriodMs: number;            // 1–2,592,000,000
  redriveMode: RedriveMode;
  redriveIntervalMs: number;            // 1–300,000
  redriveBatchSize: number;             // 1–10,000
  maxRedriveAttempts: number;           // 0–10
}

/** Size- and bandwidth-bound object storage — Requirement 27. */
export interface ObjectStoreConfig {
  objectSizeMeanKB: number;             // 1–10,485,760
  objectSizeStdDevKB: number;           // 0–10,485,760
  throughputCapacityMBps: number;       // 0.1–100,000
  baseLatencyMeanMs: number;            // 0–60,000
  baseLatencyStdDevMs: number;          // 0–30,000
  maxConcurrentTransfers: number;       // 1–100,000
  transferQueueDepth: number;           // 0–10,000
  readFraction: number;                 // 0.0–1.0
  writeLatencyMultiplier: number;       // 1.0–100.0
}

/** Periodic job trigger — Requirement 28. */
export interface SchedulerConfig {
  intervalMs: number;                   // 100–86,400,000
  jobsPerTrigger: number;               // 1–100,000
  startOffsetMs: number;                // 0–86,400,000
  jitterMs: number;                     // 0–86,400,000
  overlapPolicy: OverlapPolicy;
  maxDeferredTriggers: number;          // 1–1,000
}

// ─── Composed Node Types (Discriminated Union) ───────────────────

export interface TrafficGeneratorNode extends BaseNodeData {
  nodeType: NodeType.TrafficGenerator;
  config: TrafficGeneratorConfig;
}

export interface ApiGatewayNode extends BaseNodeData {
  nodeType: NodeType.ApiGateway;
  config: ApiGatewayConfig;
}

export interface RateLimiterNode extends BaseNodeData {
  nodeType: NodeType.RateLimiter;
  config: RateLimiterConfig;
}

export interface LoadBalancerNode extends BaseNodeData {
  nodeType: NodeType.LoadBalancer;
  config: LoadBalancerConfig;
}

export interface CircuitBreakerNode extends BaseNodeData {
  nodeType: NodeType.CircuitBreaker;
  config: CircuitBreakerConfig;
}

export interface AppServerNode extends BaseNodeData {
  nodeType: NodeType.AppServer;
  config: AppServerConfig;
}

export interface CacheNode extends BaseNodeData {
  nodeType: NodeType.Cache;
  config: CacheConfig;
}

export interface DatabaseNode extends BaseNodeData {
  nodeType: NodeType.Database;
  config: DatabaseConfig;
}

export interface MessageQueueNode extends BaseNodeData {
  nodeType: NodeType.MessageQueue;
  config: MessageQueueConfig;
}

export interface AuthServiceNode extends BaseNodeData {
  nodeType: NodeType.AuthService;
  config: AuthServiceConfig;
}

export interface AuthzServiceNode extends BaseNodeData {
  nodeType: NodeType.AuthzService;
  config: AuthzServiceConfig;
}

export interface WorkerPoolNode extends BaseNodeData {
  nodeType: NodeType.WorkerPool;
  config: WorkerPoolConfig;
}

export interface DeadLetterQueueNode extends BaseNodeData {
  nodeType: NodeType.DeadLetterQueue;
  config: DeadLetterQueueConfig;
}

export interface ObjectStoreNode extends BaseNodeData {
  nodeType: NodeType.ObjectStore;
  config: ObjectStoreConfig;
}

export interface SchedulerNode extends BaseNodeData {
  nodeType: NodeType.Scheduler;
  config: SchedulerConfig;
}

/** Discriminated union of all fifteen node types used in the simulation engine. */
export type SimulationNode =
  | TrafficGeneratorNode
  | ApiGatewayNode
  | RateLimiterNode
  | LoadBalancerNode
  | CircuitBreakerNode
  | AppServerNode
  | CacheNode
  | DatabaseNode
  | MessageQueueNode
  | AuthServiceNode
  | AuthzServiceNode
  | WorkerPoolNode
  | DeadLetterQueueNode
  | ObjectStoreNode
  | SchedulerNode;

// ─── React Flow Integration ─────────────────────────────────────

/** React Flow node wrapper for SimulationNode data. */
export type AnalysysNode = RFNode<Record<string, unknown> & SimulationNode>;
