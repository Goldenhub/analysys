import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import {
  NodeType,
  Distribution,
  LBAlgorithm,
  EvictionPolicy,
  DatabaseType,
  BackpressureStrategy,
} from '@/types/nodes';
import type { NodeMetricsSnapshot } from '@/types/metrics';
import type {
  SimulationNode,
  TrafficGeneratorConfig,
  LoadBalancerConfig,
  AppServerConfig,
  CacheConfig,
  DatabaseConfig,
  MessageQueueConfig,
} from '@/types/nodes';

// ─── Validation Types ────────────────────────────────────────────

interface FieldValidation {
  min?: number;
  max?: number;
  step?: number;
}

// ─── Validation Rules ────────────────────────────────────────────

const VALIDATION_RULES: Record<string, Record<string, FieldValidation>> = {
  [NodeType.TrafficGenerator]: {
    rps: { min: 1, max: 100000 },
    spikeMultiplier: { min: 1, max: 20 },
    spikeDurationSec: { min: 0, max: 3600 },
  },
  [NodeType.LoadBalancer]: {
    healthCheckIntervalMs: { min: 100, max: 60000 },
    evictionThreshold: { min: 1, max: 100 },
  },
  [NodeType.AppServer]: {
    workerThreadPoolSize: { min: 1, max: 1000 },
    requestQueueDepth: { min: 0, max: 10000 },
    processingTimeMeanMs: { min: 1, max: 60000 },
    processingTimeStdDevMs: { min: 0, max: 30000 },
  },
  [NodeType.Cache]: {
    hitRatio: { min: 0, max: 1, step: 0.01 },
    accessLatencyMs: { min: 0, max: 10000 },
  },
  [NodeType.Database]: {
    connectionPoolSize: { min: 1, max: 500 },
    queryLatencyMeanMs: { min: 1, max: 60000 },
    queryLatencyStdDevMs: { min: 0, max: 30000 },
    lockTimeoutMs: { min: 100, max: 300000 },
  },
  [NodeType.MessageQueue]: {
    consumerBatchSize: { min: 1, max: 10000 },
    bufferCapacity: { min: 1, max: 1000000 },
    backpressureThresholdPct: { min: 0, max: 100, step: 1 },
  },
};

function validateField(
  nodeType: NodeType,
  field: string,
  value: number,
): string | null {
  const rules = VALIDATION_RULES[nodeType]?.[field];
  if (!rules) return null;

  if (rules.min !== undefined && value < rules.min) {
    return `Minimum value is ${rules.min}`;
  }
  if (rules.max !== undefined && value > rules.max) {
    return `Maximum value is ${rules.max}`;
  }
  return null;
}

// ─── Shared Form Field Components ────────────────────────────────

interface NumberFieldProps {
  label: string;
  field: string;
  value: number;
  onChange: (field: string, value: number) => void;
  error?: string | null;
  min?: number;
  max?: number;
  step?: number;
}

function NumberField({ label, field, value, onChange, error, min, max, step }: NumberFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(field, parseFloat(e.target.value) || 0)}
        className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

interface SliderFieldProps {
  label: string;
  field: string;
  value: number;
  onChange: (field: string, value: number) => void;
  error?: string | null;
  min: number;
  max: number;
  step: number;
  displayValue?: string;
}

function SliderField({ label, field, value, onChange, error, min, max, step, displayValue }: SliderFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-gray-400">{label}</label>
        <span className="text-xs text-gray-500">{displayValue ?? value}</span>
      </div>
      <input
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(field, parseFloat(e.target.value))}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
      />
      {error && <span className="text-xs text-red-400">{error}</span>}
    </div>
  );
}

interface SelectFieldProps {
  label: string;
  field: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (field: string, value: string) => void;
}

function SelectField({ label, field, value, options, onChange }: SelectFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(field, e.target.value)}
        className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

interface ToggleFieldProps {
  label: string;
  field: string;
  value: string;
  optionA: { value: string; label: string };
  optionB: { value: string; label: string };
  onChange: (field: string, value: string) => void;
}

function ToggleField({ label, field, value, optionA, optionB, onChange }: ToggleFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <div className="flex rounded-md border border-gray-700 bg-gray-800 p-0.5">
        <button
          type="button"
          onClick={() => onChange(field, optionA.value)}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            value === optionA.value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {optionA.label}
        </button>
        <button
          type="button"
          onClick={() => onChange(field, optionB.value)}
          className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
            value === optionB.value
              ? 'bg-indigo-600 text-white'
              : 'text-gray-400 hover:text-gray-200'
          }`}
        >
          {optionB.label}
        </button>
      </div>
    </div>
  );
}

// ─── Per-Type Form Components ────────────────────────────────────

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

function TrafficGeneratorForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as TrafficGeneratorConfig;
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Requests Per Second"
        field="rps"
        value={c.rps}
        onChange={onFieldChange}
        error={errors.rps}
        min={1}
        max={100000}
      />
      <SelectField
        label="Distribution"
        field="distribution"
        value={c.distribution}
        options={[
          { value: Distribution.Poisson, label: 'Poisson' },
          { value: Distribution.Uniform, label: 'Uniform' },
        ]}
        onChange={onFieldChange}
      />
      <NumberField
        label="Spike Multiplier"
        field="spikeMultiplier"
        value={c.spikeMultiplier}
        onChange={onFieldChange}
        error={errors.spikeMultiplier}
        min={1}
        max={20}
      />
      <NumberField
        label="Spike Duration (sec)"
        field="spikeDurationSec"
        value={c.spikeDurationSec}
        onChange={onFieldChange}
        error={errors.spikeDurationSec}
        min={0}
        max={3600}
      />
    </div>
  );
}

function LoadBalancerForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as LoadBalancerConfig;
  return (
    <div className="flex flex-col gap-3">
      <SelectField
        label="Algorithm"
        field="algorithm"
        value={c.algorithm}
        options={[
          { value: LBAlgorithm.RoundRobin, label: 'Round Robin' },
          { value: LBAlgorithm.LeastConnections, label: 'Least Connections' },
        ]}
        onChange={onFieldChange}
      />
      <NumberField
        label="Health Check Interval (ms)"
        field="healthCheckIntervalMs"
        value={c.healthCheckIntervalMs}
        onChange={onFieldChange}
        error={errors.healthCheckIntervalMs}
        min={100}
        max={60000}
      />
      <NumberField
        label="Eviction Threshold"
        field="evictionThreshold"
        value={c.evictionThreshold}
        onChange={onFieldChange}
        error={errors.evictionThreshold}
        min={1}
        max={100}
      />
    </div>
  );
}

function AppServerForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as AppServerConfig;
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Thread Pool Size"
        field="workerThreadPoolSize"
        value={c.workerThreadPoolSize}
        onChange={onFieldChange}
        error={errors.workerThreadPoolSize}
        min={1}
        max={1000}
      />
      <NumberField
        label="Queue Depth"
        field="requestQueueDepth"
        value={c.requestQueueDepth}
        onChange={onFieldChange}
        error={errors.requestQueueDepth}
        min={0}
        max={10000}
      />
      <NumberField
        label="Processing Time Mean (ms)"
        field="processingTimeMeanMs"
        value={c.processingTimeMeanMs}
        onChange={onFieldChange}
        error={errors.processingTimeMeanMs}
        min={1}
        max={60000}
      />
      <NumberField
        label="Processing Time Std Dev (ms)"
        field="processingTimeStdDevMs"
        value={c.processingTimeStdDevMs}
        onChange={onFieldChange}
        error={errors.processingTimeStdDevMs}
        min={0}
        max={30000}
      />
    </div>
  );
}

function CacheForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as CacheConfig;
  return (
    <div className="flex flex-col gap-3">
      <SliderField
        label="Hit Ratio"
        field="hitRatio"
        value={c.hitRatio}
        onChange={onFieldChange}
        error={errors.hitRatio}
        min={0}
        max={1}
        step={0.01}
        displayValue={`${(c.hitRatio * 100).toFixed(0)}%`}
      />
      <SelectField
        label="Eviction Policy"
        field="evictionPolicy"
        value={c.evictionPolicy}
        options={[
          { value: EvictionPolicy.LRU, label: 'LRU' },
          { value: EvictionPolicy.LFU, label: 'LFU' },
          { value: EvictionPolicy.TTL, label: 'TTL' },
        ]}
        onChange={onFieldChange}
      />
      <NumberField
        label="Access Latency (ms)"
        field="accessLatencyMs"
        value={c.accessLatencyMs}
        onChange={onFieldChange}
        error={errors.accessLatencyMs}
        min={0}
        max={10000}
      />
    </div>
  );
}

function DatabaseForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as DatabaseConfig;
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Connection Pool Size"
        field="connectionPoolSize"
        value={c.connectionPoolSize}
        onChange={onFieldChange}
        error={errors.connectionPoolSize}
        min={1}
        max={500}
      />
      <NumberField
        label="Query Latency Mean (ms)"
        field="queryLatencyMeanMs"
        value={c.queryLatencyMeanMs}
        onChange={onFieldChange}
        error={errors.queryLatencyMeanMs}
        min={1}
        max={60000}
      />
      <NumberField
        label="Query Latency Std Dev (ms)"
        field="queryLatencyStdDevMs"
        value={c.queryLatencyStdDevMs}
        onChange={onFieldChange}
        error={errors.queryLatencyStdDevMs}
        min={0}
        max={30000}
      />
      <NumberField
        label="Lock Timeout (ms)"
        field="lockTimeoutMs"
        value={c.lockTimeoutMs}
        onChange={onFieldChange}
        error={errors.lockTimeoutMs}
        min={100}
        max={300000}
      />
      <ToggleField
        label="Database Type"
        field="dbType"
        value={c.dbType}
        optionA={{ value: DatabaseType.Relational, label: 'Relational' }}
        optionB={{ value: DatabaseType.NoSQL, label: 'NoSQL' }}
        onChange={onFieldChange}
      />
    </div>
  );
}

function MessageQueueForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as MessageQueueConfig;
  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Consumer Batch Size"
        field="consumerBatchSize"
        value={c.consumerBatchSize}
        onChange={onFieldChange}
        error={errors.consumerBatchSize}
        min={1}
        max={10000}
      />
      <NumberField
        label="Buffer Capacity"
        field="bufferCapacity"
        value={c.bufferCapacity}
        onChange={onFieldChange}
        error={errors.bufferCapacity}
        min={1}
        max={1000000}
      />
      <SliderField
        label="Backpressure Threshold"
        field="backpressureThresholdPct"
        value={c.backpressureThresholdPct}
        onChange={onFieldChange}
        error={errors.backpressureThresholdPct}
        min={0}
        max={100}
        step={1}
        displayValue={`${c.backpressureThresholdPct}%`}
      />
      <SelectField
        label="Backpressure Strategy"
        field="backpressureStrategy"
        value={c.backpressureStrategy}
        options={[
          { value: BackpressureStrategy.DropOldest, label: 'Drop Oldest' },
          { value: BackpressureStrategy.BlockProducer, label: 'Block Producer' },
          { value: BackpressureStrategy.RejectNew, label: 'Reject New' },
        ]}
        onChange={onFieldChange}
      />
    </div>
  );
}

// ─── Node Type Labels & Icons ────────────────────────────────────

const NODE_TYPE_LABELS: Record<NodeType, string> = {
  [NodeType.TrafficGenerator]: 'Traffic Generator',
  [NodeType.ApiGateway]: 'API Gateway',
  [NodeType.RateLimiter]: 'Rate Limiter',
  [NodeType.CircuitBreaker]: 'Circuit Breaker',
  [NodeType.LoadBalancer]: 'Load Balancer',
  [NodeType.AppServer]: 'App Server',
  [NodeType.Cache]: 'Cache',
  [NodeType.Database]: 'Database',
  [NodeType.MessageQueue]: 'Message Queue',
};

function NodeTypeIcon({ nodeType }: { nodeType: NodeType }) {
  const className = 'h-5 w-5';
  switch (nodeType) {
    case NodeType.TrafficGenerator:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.348 14.652a3.75 3.75 0 0 1 0-5.304m5.304 0a3.75 3.75 0 0 1 0 5.304m-7.425 2.121a6.75 6.75 0 0 1 0-9.546m9.546 0a6.75 6.75 0 0 1 0 9.546M5.106 18.894c-3.808-3.807-3.808-9.98 0-13.788m13.788 0c3.808 3.807 3.808 9.98 0 13.788M12 12h.008v.008H12V12Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
        </svg>
      );
    case NodeType.LoadBalancer:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21 3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
        </svg>
      );
    case NodeType.AppServer:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 14.25h13.5m-13.5 0a3 3 0 0 1-3-3m3 3a3 3 0 1 0 0 6h13.5a3 3 0 1 0 0-6m-13.5-3a3 3 0 0 1 0-6h13.5a3 3 0 1 1 0 6M6 6.75h.008v.008H6V6.75Zm0 7.5h.008v.008H6v-.008Zm0 7.5h.008v.008H6v-.008Z" />
        </svg>
      );
    case NodeType.Cache:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="m3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z" />
        </svg>
      );
    case NodeType.Database:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
        </svg>
      );
    case NodeType.MessageQueue:
      return (
        <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75 2.25 12l4.179 2.25m0-4.5 5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L12 12.75l-5.571-3m11.142 0L21.75 12l-4.179 2.25m0 0L12 17.25l-5.571-3m11.142 0L21.75 16.5 12 21.75l-9.75-5.25 4.179-2.25" />
        </svg>
      );
  }
}

// ─── Activity Tab ────────────────────────────────────────────────

/** What "utilization" measures differs per node type — explain it inline. */
const UTILIZATION_NOTES: Record<NodeType, string> = {
  [NodeType.AppServer]: 'Worker threads busy',
  [NodeType.Database]: 'Connection pool in use',
  [NodeType.Cache]: 'Observed miss rate',
  [NodeType.MessageQueue]: 'Buffer capacity used',
  [NodeType.LoadBalancer]: 'Unhealthy targets',
  [NodeType.ApiGateway]: 'Observed rejection rate',
  [NodeType.RateLimiter]: 'Token bucket drained',
  [NodeType.CircuitBreaker]: 'Breaker tripped',
  [NodeType.TrafficGenerator]: 'Not capacity-bound',
};

const QUEUE_DEPTH_TYPES: NodeType[] = [
  NodeType.AppServer,
  NodeType.Database,
  NodeType.MessageQueue,
];

const CONNECTION_TYPES: NodeType[] = [
  NodeType.Database,
  NodeType.AppServer,
  NodeType.LoadBalancer,
];

const HEALTH_LABELS: Record<'green' | 'yellow' | 'red', string> = {
  green: 'Healthy',
  yellow: 'Degraded',
  red: 'Critical',
};

const HEALTH_BADGE_CLASSES: Record<'green' | 'yellow' | 'red', string> = {
  green: 'bg-green-500/15 text-green-400 border-green-500/40',
  yellow: 'bg-amber-500/15 text-amber-400 border-amber-500/40',
  red: 'bg-red-500/15 text-red-400 border-red-500/40',
};

/** Matches the gauge thresholds used in QueueGauge: green <70, amber 70–90, red >90. */
function utilizationBarColor(pct: number): string {
  if (pct >= 90) return 'bg-red-500';
  if (pct >= 70) return 'bg-amber-500';
  return 'bg-green-500';
}

function utilizationTextColor(pct: number): string {
  if (pct >= 90) return 'text-red-400';
  if (pct >= 70) return 'text-amber-400';
  return 'text-green-400';
}

/**
 * computePercentiles([]) yields all zeros, which is indistinguishable from a
 * genuine sub-millisecond measurement. If nothing completed in the window,
 * there is no latency to report.
 */
function hasNoCompletions(snapshot: NodeMetricsSnapshot): boolean {
  const { p50, p90, p99 } = snapshot.latencyPercentiles;
  return snapshot.throughput === 0 && p50 === 0 && p90 === 0 && p99 === 0;
}

function formatSimTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function ActivitySection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">
        {title}
      </h3>
      {children}
    </div>
  );
}

function StatRow({
  label,
  value,
  unit,
  suffix,
}: {
  label: string;
  value: string;
  unit?: string;
  suffix?: string;
}) {
  return (
    <div className="flex items-baseline justify-between text-xs">
      <span className="text-gray-400">{label}</span>
      <span className="text-gray-200">
        {value}
        {unit && <span className="ml-1 text-gray-500">{unit}</span>}
        {suffix && <span className="ml-1 text-gray-500">{suffix}</span>}
      </span>
    </div>
  );
}

/** Muted caption used to explain why a metric has no number to show. */
function ActivityNote({ children }: { children: ReactNode }) {
  return <p className="text-[10px] text-gray-500">{children}</p>;
}

const MAX_RECENT_EVENTS = 8;

function ActivityPanel({
  selectedNodeId,
  nodeType,
}: {
  selectedNodeId: string;
  nodeType: NodeType;
}) {
  const metrics = useSimulationStore((s) => s.metrics);
  const eventLog = useSimulationStore((s) => s.eventLog);
  const snapshot = metrics?.nodes.find((n) => n.nodeId === selectedNodeId) ?? null;

  const recentEvents = eventLog
    .filter((entry) => entry.nodeId === selectedNodeId)
    .slice(-MAX_RECENT_EVENTS)
    .reverse();

  if (!snapshot) {
    return (
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <p className="text-xs leading-relaxed text-gray-500">
          No activity yet — start a simulation to see this node&apos;s live behavior.
        </p>
      </div>
    );
  }

  const utilPct = snapshot.utilization * 100;
  const { littlesLaw } = snapshot;
  const isSource = nodeType === NodeType.TrafficGenerator;

  // A zero utilization is a real reading; say so rather than leaving a bare 0%.
  const utilizationNote =
    snapshot.utilization === 0 && !isSource
      ? `${UTILIZATION_NOTES[nodeType]} — currently idle`
      : UTILIZATION_NOTES[nodeType];

  return (
    <div className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 py-3">
      {/* Health */}
      <ActivitySection title="Health">
        <span
          className={`self-start rounded-full border px-2 py-0.5 text-xs font-medium ${HEALTH_BADGE_CLASSES[snapshot.healthStatus]}`}
        >
          {HEALTH_LABELS[snapshot.healthStatus]}
        </span>
      </ActivitySection>

      {/* Throughput & Errors */}
      <ActivitySection title="Throughput &amp; Errors">
        <StatRow label="Throughput" value={snapshot.throughput.toFixed(1)} unit="req/s" />
        <StatRow
          label="Error rate"
          value={(snapshot.errorRate * 100).toFixed(1)}
          unit="%"
        />
      </ActivitySection>

      {/* Latency */}
      <ActivitySection title="Latency">
        {isSource ? (
          <ActivityNote>
            Not applicable — a traffic generator originates requests rather than serving
            them.
          </ActivityNote>
        ) : hasNoCompletions(snapshot) ? (
          <ActivityNote>No completions in this window</ActivityNote>
        ) : (
          <>
            <StatRow label="p50" value={snapshot.latencyPercentiles.p50.toFixed(1)} unit="ms" />
            <StatRow label="p90" value={snapshot.latencyPercentiles.p90.toFixed(1)} unit="ms" />
            <StatRow label="p99" value={snapshot.latencyPercentiles.p99.toFixed(1)} unit="ms" />
          </>
        )}
      </ActivitySection>

      {/* Resources */}
      <ActivitySection title="Resources">
        {QUEUE_DEPTH_TYPES.includes(nodeType) && (
          <StatRow
            label="Queue depth"
            value={String(snapshot.queueDepth)}
            unit="items"
            suffix={snapshot.queueDepth === 0 ? '(idle)' : undefined}
          />
        )}
        {CONNECTION_TYPES.includes(nodeType) && (
          <StatRow
            label="Active connections"
            value={String(snapshot.activeConnections)}
          />
        )}
        {nodeType === NodeType.MessageQueue && (
          <StatRow
            label="Buffered messages"
            value={String(Math.round(snapshot.bufferOccupancy))}
          />
        )}
        <div className="mt-1 flex flex-col gap-1">
          <div className="flex items-baseline justify-between text-xs">
            <span className="text-gray-400">Utilization</span>
            <span className={utilizationTextColor(utilPct)}>{utilPct.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
            <div
              className={`h-full rounded-full transition-all duration-500 ${utilizationBarColor(utilPct)}`}
              style={{ width: `${Math.min(100, Math.max(0, utilPct))}%` }}
            />
          </div>
          <ActivityNote>{utilizationNote}</ActivityNote>
        </div>
      </ActivitySection>

      {/* Little's Law */}
      <ActivitySection title="Little's Law">
        {isSource ? (
          <ActivityNote>
            Not applicable — Little&apos;s Law describes requests dwelling in a system; a
            source node holds none.
          </ActivityNote>
        ) : (
          <>
            <StatRow label="L (avg items in system)" value={littlesLaw.L.toFixed(2)} />
            <StatRow label="λ (arrivals)" value={littlesLaw.lambda.toFixed(2)} unit="/s" />
            <StatRow label="W (avg time in system)" value={littlesLaw.W.toFixed(1)} unit="ms" />
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-gray-400">Steady state</span>
              <span className={littlesLaw.isStable ? 'text-green-400' : 'text-amber-400'}>
                {littlesLaw.isStable ? 'Stable' : 'Unstable'}
                <span className="ml-1 text-gray-500">
                  ({(littlesLaw.deviation * 100).toFixed(1)}%)
                </span>
              </span>
            </div>
            <ActivityNote>
              L = λ × W. A large deviation means the node is not in steady state.
            </ActivityNote>
          </>
        )}
      </ActivitySection>

      {/* Recent Events */}
      <ActivitySection title="Recent Events">
        {recentEvents.length === 0 ? (
          <p className="text-[10px] text-gray-500">No events recorded for this node.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {recentEvents.map((entry) => (
              <li key={entry.id} className="flex gap-1.5 text-[10px] leading-snug">
                <span className="shrink-0 font-mono text-gray-500">
                  {formatSimTime(entry.timestamp)}
                </span>
                <span className="text-gray-300">{entry.message}</span>
              </li>
            ))}
          </ul>
        )}
      </ActivitySection>
    </div>
  );
}

// ─── Main Panel Component ────────────────────────────────────────

interface NodeConfigPanelProps {
  selectedNodeId: string | null;
  onClose: () => void;
}

export function NodeConfigPanel({ selectedNodeId, onClose }: NodeConfigPanelProps) {
  const node = useTopologyStore((s) =>
    s.nodes.find((n) => n.id === selectedNodeId),
  );
  const updateNodeConfig = useTopologyStore((s) => s.updateNodeConfig);
  const simState = useSimulationStore((s) => s.simState);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<'config' | 'activity'>('config');

  // Task 232: Escape closes config panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        onClose();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const nodeData = useMemo(() => {
    if (!node) return null;
    return node.data as unknown as SimulationNode;
  }, [node]);

  const handleFieldChange = useCallback(
    (field: string, value: number | string) => {
      if (!nodeData || !selectedNodeId) return;

      // For numeric fields, validate
      if (typeof value === 'number') {
        const error = validateField(nodeData.nodeType, field, value);
        setErrors((prev) => {
          const next = { ...prev };
          if (error) {
            next[field] = error;
          } else {
            delete next[field];
          }
          return next;
        });

        // Don't dispatch if invalid
        if (error) return;
      }

      // Dispatch valid change to topology store
      const newConfig = { [field]: value };
      updateNodeConfig(selectedNodeId, newConfig);

      // If simulation is paused, also send to worker
      if (simState === SimState.Paused) {
        const fullConfig = { ...nodeData.config, ...newConfig };
        sendToWorker({
          type: 'UPDATE_CONFIG',
          payload: { nodeId: selectedNodeId, config: fullConfig },
        });
      }
    },
    [nodeData, selectedNodeId, updateNodeConfig, simState, sendToWorker],
  );

  // Don't render if no node selected
  if (!selectedNodeId || !nodeData) {
    return null;
  }

  return (
    <aside
      className="flex w-[280px] flex-col border-l border-gray-800 bg-gray-900/50 transition-all duration-300"
      aria-label="Node configuration panel"
      tabIndex={3}
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-800 px-4 py-3">
        <span className="text-gray-400">
          <NodeTypeIcon nodeType={nodeData.nodeType} />
        </span>
        <div className="flex flex-1 flex-col">
          <span className="text-sm font-medium text-gray-200">
            {nodeData.label}
          </span>
          <span className="text-xs text-gray-500">
            {NODE_TYPE_LABELS[nodeData.nodeType]}
          </span>
        </div>
        <button
          onClick={onClose}
          aria-label="Close configuration panel"
          className="rounded p-1 text-gray-400 transition-colors hover:bg-gray-800 hover:text-gray-200"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Tab Strip */}
      <div className="border-b border-gray-800 px-4 py-2">
        <div className="flex rounded-md border border-gray-700 bg-gray-800 p-0.5">
          <button
            type="button"
            onClick={() => setTab('config')}
            aria-pressed={tab === 'config'}
            className={`flex-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              tab === 'config'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Config
          </button>
          <button
            type="button"
            onClick={() => setTab('activity')}
            aria-pressed={tab === 'activity'}
            className={`flex-1 rounded px-2 py-0.5 text-[10px] font-medium transition-colors ${
              tab === 'activity'
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Activity
          </button>
        </div>
      </div>

      {tab === 'activity' && (
        <ActivityPanel selectedNodeId={selectedNodeId} nodeType={nodeData.nodeType} />
      )}

      {/* Form Content */}
      <div className={tab === 'config' ? 'flex-1 overflow-y-auto px-4 py-3' : 'hidden'}>
        {nodeData.nodeType === NodeType.TrafficGenerator && (
          <TrafficGeneratorForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
        {nodeData.nodeType === NodeType.LoadBalancer && (
          <LoadBalancerForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
        {nodeData.nodeType === NodeType.AppServer && (
          <AppServerForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
        {nodeData.nodeType === NodeType.Cache && (
          <CacheForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
        {nodeData.nodeType === NodeType.Database && (
          <DatabaseForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
        {nodeData.nodeType === NodeType.MessageQueue && (
          <MessageQueueForm
            config={nodeData.config as unknown as Record<string, unknown>}
            onFieldChange={handleFieldChange}
            errors={errors}
          />
        )}
      </div>

      {/* Footer hint — only relevant while editing config */}
      {tab === 'config' && (
        <div className="border-t border-gray-800 px-4 py-2">
          <p className="text-xs text-gray-500">
            Changes apply immediately.
            {simState === SimState.Paused && ' Config synced to paused simulation.'}
          </p>
        </div>
      )}
    </aside>
  );
}
