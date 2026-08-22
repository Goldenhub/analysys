import type { ObjectStoreConfig } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function ObjectStoreForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as ObjectStoreConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Object Size Mean (KB)</label>
        <input
          type="number"
          value={c.objectSizeMeanKB}
          min={1}
          max={10485760}
          onChange={(e) => onFieldChange('objectSizeMeanKB', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.objectSizeMeanKB && <span className="text-xs text-red-400">{errors.objectSizeMeanKB}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Object Size Std Dev (KB)</label>
        <input
          type="number"
          value={c.objectSizeStdDevKB}
          min={0}
          max={10485760}
          onChange={(e) => onFieldChange('objectSizeStdDevKB', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.objectSizeStdDevKB && <span className="text-xs text-red-400">{errors.objectSizeStdDevKB}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Throughput Capacity (MB/s)</label>
        <input
          type="number"
          value={c.throughputCapacityMBps}
          min={0.1}
          max={100000}
          step={0.1}
          onChange={(e) => onFieldChange('throughputCapacityMBps', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.throughputCapacityMBps && <span className="text-xs text-red-400">{errors.throughputCapacityMBps}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Base Latency Mean (ms)</label>
        <input
          type="number"
          value={c.baseLatencyMeanMs}
          min={0}
          max={60000}
          onChange={(e) => onFieldChange('baseLatencyMeanMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.baseLatencyMeanMs && <span className="text-xs text-red-400">{errors.baseLatencyMeanMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Base Latency Std Dev (ms)</label>
        <input
          type="number"
          value={c.baseLatencyStdDevMs}
          min={0}
          max={30000}
          onChange={(e) => onFieldChange('baseLatencyStdDevMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.baseLatencyStdDevMs && <span className="text-xs text-red-400">{errors.baseLatencyStdDevMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Max Concurrent Transfers</label>
        <input
          type="number"
          value={c.maxConcurrentTransfers}
          min={1}
          max={100000}
          onChange={(e) => onFieldChange('maxConcurrentTransfers', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.maxConcurrentTransfers && <span className="text-xs text-red-400">{errors.maxConcurrentTransfers}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Transfer Queue Depth</label>
        <input
          type="number"
          value={c.transferQueueDepth}
          min={0}
          max={10000}
          onChange={(e) => onFieldChange('transferQueueDepth', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.transferQueueDepth && <span className="text-xs text-red-400">{errors.transferQueueDepth}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400">Read Fraction</label>
          <span className="text-xs text-gray-500">{(c.readFraction * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.readFraction}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('readFraction', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
        />
        {errors.readFraction && <span className="text-xs text-red-400">{errors.readFraction}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Write Latency Multiplier</label>
        <input
          type="number"
          value={c.writeLatencyMultiplier}
          min={1}
          max={100}
          step={0.1}
          onChange={(e) => onFieldChange('writeLatencyMultiplier', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.writeLatencyMultiplier && <span className="text-xs text-red-400">{errors.writeLatencyMultiplier}</span>}
      </div>
    </div>
  );
}
