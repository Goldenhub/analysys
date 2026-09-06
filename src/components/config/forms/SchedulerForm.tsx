import type { SchedulerConfig } from '@/types/nodes';
import { OverlapPolicy } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function SchedulerForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as SchedulerConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Interval (ms)</label>
        <input
          type="number"
          value={c.intervalMs}
          min={100}
          max={86400000}
          onChange={(e) => onFieldChange('intervalMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.intervalMs && <span className="text-xs text-[#8b2e1e]">{errors.intervalMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Jobs Per Trigger</label>
        <input
          type="number"
          value={c.jobsPerTrigger}
          min={1}
          max={100000}
          onChange={(e) => onFieldChange('jobsPerTrigger', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.jobsPerTrigger && (
          <span className="text-xs text-[#8b2e1e]">{errors.jobsPerTrigger}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Start Offset (ms)</label>
        <input
          type="number"
          value={c.startOffsetMs}
          min={0}
          max={86400000}
          onChange={(e) => onFieldChange('startOffsetMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.startOffsetMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.startOffsetMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Jitter (ms)</label>
        <input
          type="number"
          value={c.jitterMs}
          min={0}
          max={86400000}
          onChange={(e) => onFieldChange('jitterMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.jitterMs && <span className="text-xs text-[#8b2e1e]">{errors.jitterMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Overlap Policy</label>
        <select
          value={c.overlapPolicy}
          onChange={(e) => onFieldChange('overlapPolicy', e.target.value)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        >
          <option value={OverlapPolicy.Allow}>Allow</option>
          <option value={OverlapPolicy.Skip}>Skip</option>
          <option value={OverlapPolicy.Queue}>Queue</option>
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Max Deferred Triggers</label>
        <input
          type="number"
          value={c.maxDeferredTriggers}
          min={1}
          max={1000}
          onChange={(e) => onFieldChange('maxDeferredTriggers', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.maxDeferredTriggers && (
          <span className="text-xs text-[#8b2e1e]">{errors.maxDeferredTriggers}</span>
        )}
      </div>
    </div>
  );
}
