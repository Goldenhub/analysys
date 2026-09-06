import type { WorkerPoolConfig } from '@/types/nodes';
import { RetryBackoff } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function WorkerPoolForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as WorkerPoolConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Concurrency</label>
        <input
          type="number"
          value={c.concurrency}
          min={1}
          max={10000}
          onChange={(e) => onFieldChange('concurrency', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.concurrency && <span className="text-xs text-[#8b2e1e]">{errors.concurrency}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Job Processing Mean (ms)</label>
        <input
          type="number"
          value={c.jobProcessingMeanMs}
          min={0}
          max={600000}
          onChange={(e) => onFieldChange('jobProcessingMeanMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.jobProcessingMeanMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.jobProcessingMeanMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Job Processing Std Dev (ms)</label>
        <input
          type="number"
          value={c.jobProcessingStdDevMs}
          min={0}
          max={300000}
          onChange={(e) => onFieldChange('jobProcessingStdDevMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.jobProcessingStdDevMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.jobProcessingStdDevMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Prefetch Buffer Depth</label>
        <input
          type="number"
          value={c.prefetchBufferDepth}
          min={0}
          max={10000}
          onChange={(e) => onFieldChange('prefetchBufferDepth', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.prefetchBufferDepth && (
          <span className="text-xs text-[#8b2e1e]">{errors.prefetchBufferDepth}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[#f3ede2]/60">Job Failure Rate</label>
          <span className="text-xs text-[#f3ede2]/50">{(c.jobFailureRate * 100).toFixed(0)}%</span>
        </div>
        <input
          type="range"
          value={c.jobFailureRate}
          min={0}
          max={1}
          step={0.01}
          onChange={(e) => onFieldChange('jobFailureRate', parseFloat(e.target.value))}
          className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-[#5b5347]/60 accent-indigo-500"
        />
        {errors.jobFailureRate && (
          <span className="text-xs text-[#8b2e1e]">{errors.jobFailureRate}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Max Retries</label>
        <input
          type="number"
          value={c.maxRetries}
          min={0}
          max={10}
          onChange={(e) => onFieldChange('maxRetries', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.maxRetries && <span className="text-xs text-[#8b2e1e]">{errors.maxRetries}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Retry Backoff</label>
        <div className="flex rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 p-0.5">
          <button
            type="button"
            onClick={() => onFieldChange('retryBackoff', RetryBackoff.Fixed)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.retryBackoff === RetryBackoff.Fixed
                ? 'bg-[#b8402e] text-[#f3ede2]'
                : 'text-[#f3ede2]/60 hover:text-[#f3ede2]'
            }`}
          >
            Fixed
          </button>
          <button
            type="button"
            onClick={() => onFieldChange('retryBackoff', RetryBackoff.Exponential)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.retryBackoff === RetryBackoff.Exponential
                ? 'bg-[#b8402e] text-[#f3ede2]'
                : 'text-[#f3ede2]/60 hover:text-[#f3ede2]'
            }`}
          >
            Exponential
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Retry Base Delay (ms)</label>
        <input
          type="number"
          value={c.retryBaseDelayMs}
          min={1}
          max={300000}
          onChange={(e) => onFieldChange('retryBaseDelayMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.retryBaseDelayMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.retryBaseDelayMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Job Timeout (ms)</label>
        <input
          type="number"
          value={c.jobTimeoutMs}
          min={1}
          max={600000}
          onChange={(e) => onFieldChange('jobTimeoutMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.jobTimeoutMs && <span className="text-xs text-[#8b2e1e]">{errors.jobTimeoutMs}</span>}
      </div>
    </div>
  );
}
