import type { Node as RFNode } from '@xyflow/react';

// ─── Enumerations ────────────────────────────────────────────────

/** The 9 supported node types in the simulation topology, in request-flow order. */
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

// ─── Base Node ───────────────────────────────────────────────────

/** Common fields shared by all simulation node types. */
export interface BaseNodeData {
  id: string;
  nodeType: NodeType;
  label: string;
  position: { x: number; y: number };
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

/** Discriminated union of all node types used in the simulation engine. */
export type SimulationNode =
  | TrafficGeneratorNode
  | ApiGatewayNode
  | RateLimiterNode
  | LoadBalancerNode
  | CircuitBreakerNode
  | AppServerNode
  | CacheNode
  | DatabaseNode
  | MessageQueueNode;

// ─── React Flow Integration ─────────────────────────────────────

/** React Flow node wrapper for SimulationNode data. */
export type AnalysysNode = RFNode<Record<string, unknown> & SimulationNode>;
