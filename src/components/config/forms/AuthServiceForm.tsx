import type { AuthServiceConfig } from '@/types/nodes';
import { VerificationMode } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function AuthServiceForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as AuthServiceConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Verification Mode</label>
        <div className="flex rounded-md border border-gray-700 bg-gray-800 p-0.5">
          <button
            type="button"
            onClick={() => onFieldChange('verificationMode', VerificationMode.Local)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.verificationMode === VerificationMode.Local
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Local
          </button>
          <button
            type="button"
            onClick={() => onFieldChange('verificationMode', VerificationMode.Introspection)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.verificationMode === VerificationMode.Introspection
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Introspection
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Verification Latency Mean (ms)</label>
        <input
          type="number"
          value={c.verificationLatencyMeanMs}
          min={0}
          max={60000}
          onChange={(e) => onFieldChange('verificationLatencyMeanMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.verificationLatencyMeanMs && <span className="text-xs text-red-400">{errors.verificationLatencyMeanMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Verification Latency Std Dev (ms)</label>
        <input
          type="number"
          value={c.verificationLatencyStdDevMs}
          min={0}
          max={30000}
          onChange={(e) => onFieldChange('verificationLatencyStdDevMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.verificationLatencyStdDevMs && <span className="text-xs text-red-400">{errors.verificationLatencyStdDevMs}</span>}
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

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400">Token Cache Hit Ratio</label>
          <span className="text-xs text-gray-500">{(c.tokenCacheHitRatio * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.tokenCacheHitRatio}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('tokenCacheHitRatio', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
        />
        {errors.tokenCacheHitRatio && <span className="text-xs text-red-400">{errors.tokenCacheHitRatio}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-gray-400">Credential Failure Rate</label>
          <span className="text-xs text-gray-500">{(c.credentialFailureRate * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.credentialFailureRate}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('credentialFailureRate', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-gray-700 accent-indigo-500"
        />
        {errors.credentialFailureRate && <span className="text-xs text-red-400">{errors.credentialFailureRate}</span>}
      </div>
    </div>
  );
}
