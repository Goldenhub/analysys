import type { Node as RFNode } from '@xyflow/react';

// ─── Enumerations ────────────────────────────────────────────────

export enum NodeType {
  TrafficGenerator = 'TRAFFIC_GENERATOR',
  LoadBalancer = 'LOAD_BALANCER',
  AppServer = 'APP_SERVER',
  Cache = 'CACHE',
  Database = 'DATABASE',
  MessageQueue = 'MESSAGE_QUEUE',
}

export enum Distribution {
  Poisson = 'POISSON',
  Uniform = 'UNIFORM',
}

export enum LBAlgorithm {
  RoundRobin = 'ROUND_ROBIN',
  LeastConnections = 'LEAST_CONNECTIONS',
}

export enum EvictionPolicy {
  LRU = 'LRU',
  LFU = 'LFU',
  TTL = 'TTL',
}

export enum DatabaseType {
  Relational = 'RELATIONAL',
  NoSQL = 'NOSQL',
}

export enum BackpressureStrategy {
  DropOldest = 'DROP_OLDEST',
  BlockProducer = 'BLOCK_PRODUCER',
  RejectNew = 'REJECT_NEW',
}

// ─── Base Node ───────────────────────────────────────────────────

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

export interface LoadBalancerConfig {
  algorithm: LBAlgorithm;
  healthCheckIntervalMs: number;
  evictionThreshold: number;
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

export interface LoadBalancerNode extends BaseNodeData {
  nodeType: NodeType.LoadBalancer;
  config: LoadBalancerConfig;
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

export type SimulationNode =
  | TrafficGeneratorNode
  | LoadBalancerNode
  | AppServerNode
  | CacheNode
  | DatabaseNode
  | MessageQueueNode;

// ─── React Flow Integration ─────────────────────────────────────

export type AnalysysNode = RFNode<Record<string, unknown> & SimulationNode>;
