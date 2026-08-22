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
        <label className="text-xs font-medium text-gray-400">Capacity</label>
        <input
          type="number"
          value={c.capacity}
          min={1}
          max={1000000}
          onChange={(e) => onFieldChange('capacity', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.capacity && <span className="text-xs text-red-400">{errors.capacity}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Retention Period (ms)</label>
        <input
          type="number"
          value={c.retentionPeriodMs}
          min={1}
          max={2592000000}
          onChange={(e) => onFieldChange('retentionPeriodMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.retentionPeriodMs && <span className="text-xs text-red-400">{errors.retentionPeriodMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Redrive Mode</label>
        <div className="flex rounded-md border border-gray-700 bg-gray-800 p-0.5">
          <button
            type="button"
            onClick={() => onFieldChange('redriveMode', RedriveMode.Manual)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.redriveMode === RedriveMode.Manual
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Manual
          </button>
          <button
            type="button"
            onClick={() => onFieldChange('redriveMode', RedriveMode.Automatic)}
            className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
              c.redriveMode === RedriveMode.Automatic
                ? 'bg-indigo-600 text-white'
                : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            Automatic
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Redrive Interval (ms)</label>
        <input
          type="number"
          value={c.redriveIntervalMs}
          min={1}
          max={300000}
          onChange={(e) => onFieldChange('redriveIntervalMs', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.redriveIntervalMs && <span className="text-xs text-red-400">{errors.redriveIntervalMs}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Redrive Batch Size</label>
        <input
          type="number"
          value={c.redriveBatchSize}
          min={1}
          max={10000}
          onChange={(e) => onFieldChange('redriveBatchSize', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.redriveBatchSize && <span className="text-xs text-red-400">{errors.redriveBatchSize}</span>}
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-gray-400">Max Redrive Attempts</label>
        <input
          type="number"
          value={c.maxRedriveAttempts}
          min={0}
          max={10}
          onChange={(e) => onFieldChange('maxRedriveAttempts', parseFloat(e.target.value) || 0)}
          className="rounded-md border border-gray-700 bg-gray-800 px-2.5 py-1.5 text-sm text-gray-200 outline-none transition-colors focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/50"
        />
        {errors.maxRedriveAttempts && <span className="text-xs text-red-400">{errors.maxRedriveAttempts}</span>}
      </div>
    </div>
  );
}
