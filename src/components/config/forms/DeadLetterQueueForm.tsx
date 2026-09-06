import type { DeadLetterQueueConfig } from '@/types/nodes';
import { RedriveMode } from '@/types/nodes';

interface FormProps {
  config: Record<string, unknown>;
  onFieldChange: (field: string, value: number | string) => void;
  errors: Record<string, string>;
}

export function DeadLetterQueueForm({ config, onFieldChange, errors }: FormProps) {
  const c = config as unknown as DeadLetterQueueConfig;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Capacity</label>
        <input
          type="number"
          value={c.capacity}
          min={1}
          max={1000000}
          onChange={(e) => onFieldChange('capacity', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.capacity && <span className="text-xs text-[#8b2e1e]">{errors.capacity}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Retention Period (ms)</label>
        <input
          type="number"
          value={c.retentionPeriodMs}
          min={1}
          max={2592000000}
          onChange={(e) => onFieldChange('retentionPeriodMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.retentionPeriodMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.retentionPeriodMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Redrive Mode</label>
        <div className="flex rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 p-0.5">
          <button
            type="button"
            onClick={() => onFieldChange('redriveMode', RedriveMode.Manual)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.redriveMode === RedriveMode.Manual
                ? 'bg-[#b8402e] text-[#f3ede2]'
                : 'text-[#f3ede2]/60 hover:text-[#f3ede2]'
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => onFieldChange('redriveMode', RedriveMode.Automatic)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.redriveMode === RedriveMode.Automatic
                ? 'bg-[#b8402e] text-[#f3ede2]'
                : 'text-[#f3ede2]/60 hover:text-[#f3ede2]'
            }`}
          >
            Automatic
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Redrive Interval (ms)</label>
        <input
          type="number"
          value={c.redriveIntervalMs}
          min={1}
          max={300000}
          onChange={(e) => onFieldChange('redriveIntervalMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.redriveIntervalMs && (
          <span className="text-xs text-[#8b2e1e]">{errors.redriveIntervalMs}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Redrive Batch Size</label>
        <input
          type="number"
          value={c.redriveBatchSize}
          min={1}
          max={10000}
          onChange={(e) => onFieldChange('redriveBatchSize', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.redriveBatchSize && (
          <span className="text-xs text-[#8b2e1e]">{errors.redriveBatchSize}</span>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-[#f3ede2]/60">Max Redrive Attempts</label>
        <input
          type="number"
          value={c.maxRedriveAttempts}
          min={0}
          max={10}
          onChange={(e) => onFieldChange('maxRedriveAttempts', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2.5 py-1.5 text-sm text-[#f3ede2] outline-none transition-colors focus:border-[#b8402e] focus:ring-1 focus:ring-[#b8402e]/50"
        />
        {errors.maxRedriveAttempts && (
          <span className="text-xs text-[#8b2e1e]">{errors.maxRedriveAttempts}</span>
        )}
      </div>
    </div>
  );
}
