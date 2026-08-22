import type { AuthzServiceConfig } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function AuthzServiceForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as AuthzServiceConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Policy Latency Mean (ms)</label>
        <input
          type="number"
          value={c.policyLatencyMeanMs}
          min={0}
          max={60000}
          onChange={(e) => onFieldChange('policyLatencyMeanMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.policyLatencyMeanMs && <span className="text-xs text-red-400">{errors.policyLatencyMeanMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Policy Latency Std Dev (ms)</label>
        <input
          type="number"
          value={c.policyLatencyStdDevMs}
          min={0}
          max={30000}
          onChange={(e) => onFieldChange('policyLatencyStdDevMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.policyLatencyStdDevMs && <span className="text-xs text-red-400">{errors.policyLatencyStdDevMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400">Policy Cache Hit Ratio</label>
          <span className="text-xs text-gray-500">{(c.policyCacheHitRatio * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.policyCacheHitRatio}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('policyCacheHitRatio', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
        />
        {errors.policyCacheHitRatio && <span className="text-xs text-red-400">{errors.policyCacheHitRatio}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Lookups Per Request</label>
        <input
          type="number"
          value={c.lookupsPerRequest}
          min={1}
          max={50}
          onChange={(e) => onFieldChange('lookupsPerRequest', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.lookupsPerRequest && <span className="text-xs text-red-400">{errors.lookupsPerRequest}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400">Deny Rate</label>
          <span className="text-xs text-gray-500">{(c.denyRate * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.denyRate}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('denyRate', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
        />
        {errors.denyRate && <span className="text-xs text-red-400">{errors.denyRate}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Concurrency Limit</label>
        <input
          type="number"
          value={c.concurrencyLimit}
          min={1}
          max={10000}
          onChange={(e) => onFieldChange('concurrencyLimit', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.concurrencyLimit && <span className="text-xs text-red-400">{errors.concurrencyLimit}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Queue Depth</label>
        <input
          type="number"
          value={c.queueDepth}
          min={0}
          max={10000}
          onChange={(e) => onFieldChange('queueDepth', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.queueDepth && <span className="text-xs text-red-400">{errors.queueDepth}</span>}
      </div>
    </div>
  );
}
