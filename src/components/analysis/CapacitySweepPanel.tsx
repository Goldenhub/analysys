import { useState, useCallback } from 'react';
import {
  DEFAULT_SWEEP_CONFIG,
  validateSweepConfig,
  type SweepConfig,
  type SweepStepResult,
  type SweepValidationError,
} from '@/analysis/CapacitySweepController';
import { SweepResultsTable } from './SweepResultsTable';

// ─── Types ───────────────────────────────────────────────────────

export interface SweepProgress {
  /** 1-based index of the step currently executing. */
  currentStep: number;
  /** Total number of steps in the sweep. */
  totalSteps: number;
  /** Requested RPS for the current step. */
  currentRequestedRps: number;
  /** Elapsed simulated time in the current step. */
  elapsedMs: number;
  /** Completed step results so far. */
  completedSteps: SweepStepResult[];
}

export interface CapacitySweepPanelProps {
  /** Called when the user starts a sweep. */
  onStartSweep?: (config: SweepConfig) => void;
  /** Called when the user cancels a sweep. */
  onCancelSweep?: () => void;
  /** Whether a sweep is currently running. */
  isRunning?: boolean;
  /** Progress info for a running sweep. */
  progress?: SweepProgress | null;
  /** Final results from a completed sweep. */
  completedSteps?: SweepStepResult[];
}

// ─── Helpers ─────────────────────────────────────────────────────

function getFieldError(errors: SweepValidationError[], parameter: string): string | undefined {
  return errors.find((e) => e.parameter === parameter)?.message;
}

// ─── CapacitySweepPanel (Tasks 555, 556) ─────────────────────────

export function CapacitySweepPanel({
  onStartSweep,
  onCancelSweep,
  isRunning = false,
  progress = null,
  completedSteps = [],
}: CapacitySweepPanelProps) {
  const [config, setConfig] = useState<SweepConfig>({ ...DEFAULT_SWEEP_CONFIG });
  const [errors, setErrors] = useState<SweepValidationError[]>([]);

  const updateField = useCallback((field: keyof SweepConfig, value: number) => {
    setConfig((prev) => ({ ...prev, [field]: value }));
    // Clear field-level error on change
    setErrors((prev) => prev.filter((e) => e.parameter !== field));
  }, []);

  const handleStart = useCallback(() => {
    const validationErrors = validateSweepConfig(config);
    setErrors(validationErrors);
    if (validationErrors.length === 0) {
      onStartSweep?.(config);
    }
  }, [config, onStartSweep]);

  return (
    <div className="flex flex-col gap-3">
      <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Capacity Sweep Configuration
      </h4>

      {/* Parameter form */}
      <div className="grid grid-cols-2 gap-2" role="form" aria-label="Capacity sweep parameters">
        <FormField
          label="Start RPS"
          value={config.startRps}
          onChange={(v) => updateField('startRps', v)}
          error={getFieldError(errors, 'startRps')}
          min={1}
          max={100000}
          disabled={isRunning}
        />
        <FormField
          label="End RPS"
          value={config.endRps}
          onChange={(v) => updateField('endRps', v)}
          error={getFieldError(errors, 'endRps')}
          min={1}
          max={100000}
          disabled={isRunning}
        />
        <FormField
          label="Step Count"
          value={config.stepCount}
          onChange={(v) => updateField('stepCount', v)}
          error={getFieldError(errors, 'stepCount')}
          min={2}
          max={20}
          disabled={isRunning}
        />
        <FormField
          label="Duration / Step (ms)"
          value={config.durationPerStepMs}
          onChange={(v) => updateField('durationPerStepMs', v)}
          error={getFieldError(errors, 'durationPerStepMs')}
          min={1000}
          max={1800000}
          disabled={isRunning}
        />
        <FormField
          label="Warm-up (ms)"
          value={config.warmUpMs}
          onChange={(v) => updateField('warmUpMs', v)}
          error={getFieldError(errors, 'warmUpMs')}
          min={0}
          max={config.durationPerStepMs - 1}
          disabled={isRunning}
        />
        <FormField
          label="Speed Multiplier"
          value={config.speedMultiplier}
          onChange={(v) => updateField('speedMultiplier', v)}
          error={getFieldError(errors, 'speedMultiplier')}
          min={1}
          max={1000}
          disabled={isRunning}
        />
        <FormField
          label="Max p99 Latency (ms)"
          value={config.objective.maxP99LatencyMs}
          onChange={(v) =>
            setConfig((prev) => ({ ...prev, objective: { ...prev.objective, maxP99LatencyMs: v } }))
          }
          error={getFieldError(errors, 'objective.maxP99LatencyMs')}
          min={1}
          max={60000}
          disabled={isRunning}
        />
        <FormField
          label="Max Error Rate"
          value={config.objective.maxErrorRate}
          onChange={(v) =>
            setConfig((prev) => ({ ...prev, objective: { ...prev.objective, maxErrorRate: v } }))
          }
          error={getFieldError(errors, 'objective.maxErrorRate')}
          min={0}
          max={1}
          step={0.01}
          disabled={isRunning}
        />
      </div>

      {/* Start / Cancel button */}
      <div className="flex items-center gap-2">
        {!isRunning ? (
          <button
            type="button"
            onClick={handleStart}
            className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            aria-label="Start capacity sweep"
          >
            Start Sweep
          </button>
        ) : (
          <button
            type="button"
            onClick={onCancelSweep}
            className="rounded-md bg-red-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 focus:outline-none focus:ring-2 focus:ring-red-500"
            aria-label="Cancel capacity sweep"
          >
            Cancel Sweep
          </button>
        )}
      </div>

      {/* Progress display (Task 556) */}
      {isRunning && progress && (
        <div
          className="rounded border border-indigo-800/50 bg-indigo-950/30 px-3 py-2 text-xs"
          role="status"
          aria-live="polite"
          aria-label="Sweep progress"
        >
          <p className="text-indigo-300">
            Step {progress.currentStep} of {progress.totalSteps} — {progress.currentRequestedRps}{' '}
            RPS
          </p>
          <p className="text-gray-400 text-[10px] mt-0.5">
            Elapsed: {progress.elapsedMs.toFixed(0)} ms simulated time
          </p>
          {progress.completedSteps.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-gray-400 hover:text-gray-200">
                Completed steps ({progress.completedSteps.length})
              </summary>
              <div className="mt-1">
                <SweepResultsTable steps={progress.completedSteps} />
              </div>
            </details>
          )}
        </div>
      )}

      {/* Completed results */}
      {!isRunning && completedSteps.length > 0 && (
        <section aria-label="Completed sweep results">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
            Sweep Results
          </h4>
          <SweepResultsTable steps={completedSteps} />
        </section>
      )}
    </div>
  );
}

// ─── Form Field ──────────────────────────────────────────────────

interface FormFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  error?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}

function FormField({
  label,
  value,
  onChange,
  error,
  min,
  max,
  step = 1,
  disabled,
}: FormFieldProps) {
  const id = `sweep-${label.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;

  return (
    <div className="flex flex-col gap-0.5">
      <label htmlFor={id} className="text-[10px] text-gray-400 font-medium">
        {label}
      </label>
      <input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={`h-7 rounded-md border px-2 text-xs text-gray-200 bg-gray-800 outline-none focus:ring-1 disabled:opacity-50 ${
          error ? 'border-red-500 focus:ring-red-500' : 'border-gray-700 focus:ring-indigo-500'
        }`}
      />
      {error && (
        <span id={`${id}-error`} className="text-[10px] text-red-400" role="alert">
          {error}
        </span>
      )}
    </div>
  );
}
