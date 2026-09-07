import { useCallback, useEffect } from 'react';
import { useSimulationStore } from '@/store';
import { DEFAULT_MAX_HOPS_PER_REQUEST, DEFAULT_METRICS_INTERVAL_MS } from '@/types/messages';
import { useTopologyStore } from '@/store';
import { SimState } from '@/simulation/types';
import { Button } from '@/components/ui/button';
import { formatSimClockMs as formatSimTime } from '@/utils/simTime';

// ─── Icons (inline SVG) ──────────────────────────────────────────

function PlayIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-4"
    >
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-4"
    >
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="currentColor"
      className="size-4"
    >
      <path d="M6 6h12v12H6V6z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function DicesIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      <rect width="18" height="18" x="3" y="3" rx="2" ry="2" />
      <path d="M16 8h.01" />
      <path d="M12 12h.01" />
      <path d="M8 16h.01" />
    </svg>
  );
}

// ─── Speed Options ───────────────────────────────────────────────

const SPEED_OPTIONS = [1, 2, 5, 10, 50] as const;

// ─── Duration Options ────────────────────────────────────────────

const DURATION_OPTIONS = [
  { label: '30s', ms: 30_000 },
  { label: '1min', ms: 60_000 },
  { label: '2min', ms: 120_000 },
  { label: '5min', ms: 300_000 },
  { label: '10min', ms: 600_000 },
] as const;

// ─── Helpers ─────────────────────────────────────────────────────

function getStateBadgeColor(state: SimState): string {
  switch (state) {
    case SimState.Idle:
      return 'bg-[#5b5347] text-[#f3ede2]';
    case SimState.Running:
      return 'bg-[#4d6b52] text-[#f3ede2]';
    case SimState.Paused:
      return 'bg-[#8a6418] text-[#f3ede2]';
    case SimState.Complete:
      return 'bg-[#b8402e] text-[#f3ede2]';
  }
}

function getStateLabel(state: SimState): string {
  switch (state) {
    case SimState.Idle:
      return 'Idle';
    case SimState.Running:
      return 'Running';
    case SimState.Paused:
      return 'Paused';
    case SimState.Complete:
      return 'Complete';
  }
}

// ─── Component ───────────────────────────────────────────────────

export function SimulationToolbar() {
  const simState = useSimulationStore((s) => s.simState);
  const speedMultiplier = useSimulationStore((s) => s.speedMultiplier);
  const durationMs = useSimulationStore((s) => s.durationMs);
  const metrics = useSimulationStore((s) => s.metrics);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const setDuration = useSimulationStore((s) => s.setDuration);
  const setSimState = useSimulationStore((s) => s.setSimState);
  const initWorker = useSimulationStore((s) => s.initWorker);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);
  const resetMetrics = useSimulationStore((s) => s.resetMetrics);
  const terminateWorker = useSimulationStore((s) => s.terminateWorker);
  const getTopologySnapshot = useTopologyStore((s) => s.getTopologySnapshot);
  const seed = useSimulationStore((s) => s.seed);
  const setSeed = useSimulationStore((s) => s.setSeed);

  // ─── Button Handlers ─────────────────────────────────────────

  const handleStart = useCallback(() => {
    const topology = getTopologySnapshot();
    // Fresh run: clear the previous run's live metrics, log, and summary so the
    // dashboard never mixes runs.
    resetMetrics();
    initWorker();
    sendToWorker({
      type: 'INIT',
      payload: {
        topology,
        seed,
        speedMultiplier,
        maxSimulatedTimeMs: durationMs,
        metricsIntervalMs: DEFAULT_METRICS_INTERVAL_MS,
        maxHopsPerRequest: DEFAULT_MAX_HOPS_PER_REQUEST,
      },
    });
    sendToWorker({ type: 'START', payload: { speedMultiplier } });
    setSimState(SimState.Running);
  }, [
    getTopologySnapshot,
    initWorker,
    sendToWorker,
    speedMultiplier,
    setSimState,
    durationMs,
    seed,
    resetMetrics,
  ]);

  const handlePause = useCallback(() => {
    sendToWorker({ type: 'PAUSE' });
    setSimState(SimState.Paused);
  }, [sendToWorker, setSimState]);

  const handleResume = useCallback(() => {
    sendToWorker({ type: 'RESUME', payload: { speedMultiplier } });
    setSimState(SimState.Running);
  }, [sendToWorker, speedMultiplier, setSimState]);

  const handleStop = useCallback(() => {
    terminateWorker();
    setSimState(SimState.Complete);
  }, [terminateWorker, setSimState]);

  const handleReset = useCallback(() => {
    terminateWorker();
    resetMetrics();
    setSimState(SimState.Idle);
  }, [terminateWorker, resetMetrics, setSimState]);

  const handleSpeedChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const newSpeed = Number(e.target.value);
      setSpeed(newSpeed);
      if (simState === SimState.Running) {
        // Live speed change — no PAUSE/RESUME pair (that race could double-drive the loop).
        sendToWorker({ type: 'UPDATE_SPEED', payload: { speedMultiplier: newSpeed } });
      }
    },
    [setSpeed, simState, sendToWorker],
  );

  // ─── Keyboard Shortcuts ──────────────────────────────────────

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // Ignore when typing in an input/textarea/select
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (simState === SimState.Idle || simState === SimState.Complete) {
          handleStart();
        } else if (simState === SimState.Running) {
          handlePause();
        } else if (simState === SimState.Paused) {
          handleResume();
        }
      }

      if (e.code === 'KeyR' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        if (simState !== SimState.Idle) {
          handleReset();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [simState, handleStart, handlePause, handleResume, handleReset]);

  // ─── Button Visibility Logic ─────────────────────────────────

  const showStartButton = simState === SimState.Idle || simState === SimState.Complete;
  const showResumeButton = simState === SimState.Paused;
  const showPauseButton = simState === SimState.Running;
  const showStopButton = simState === SimState.Running || simState === SimState.Paused;
  const showResetButton = simState !== SimState.Idle;

  // ─── Render ──────────────────────────────────────────────────

  const selectClass =
    'h-7 rounded-md border border-[#5b5347]/30 bg-[#5b5347]/80 px-2 text-xs text-[#f3ede2] outline-none focus:border-[#b8402e] disabled:opacity-50 disabled:cursor-not-allowed';
  const fieldLabelClass = 'text-[10px] font-medium text-[#5b5347]/80';

  return (
    <div data-tour="sim" className="flex flex-wrap items-center gap-x-4 gap-y-2 max-md:contents">
      {/* ── Run: transport buttons ─────────────────────────────── */}
      <div className="flex items-center gap-1.5 max-md:order-2">
        {/* Start / Resume */}
        {showStartButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleStart}
            title="Start simulation (Space)"
            className="gap-1 text-[#4d6b52] hover:text-[#4d6b52]"
          >
            <PlayIcon />
            <span>Start</span>
          </Button>
        )}
        {showResumeButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleResume}
            title="Resume simulation (Space)"
            className="gap-1 text-[#4d6b52] hover:text-[#4d6b52]"
          >
            <PlayIcon />
            <span>Resume</span>
          </Button>
        )}

        {/* Pause */}
        {showPauseButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handlePause}
            title="Pause simulation (Space)"
            className="gap-1 text-[#8a6418] hover:text-[#8a6418]"
          >
            <PauseIcon />
            <span>Pause</span>
          </Button>
        )}

        {/* Stop */}
        {showStopButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleStop}
            title="Stop simulation (keeps metrics)"
            className="gap-1 text-[#8b2e1e] hover:text-[#8b2e1e]"
          >
            <StopIcon />
            <span>Stop</span>
          </Button>
        )}

        {/* Reset */}
        {showResetButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            title="Reset everything (R)"
            className="gap-1 text-[#5b5347]/70 hover:text-[#5b5347]"
          >
            <RefreshIcon />
            <span>Reset</span>
          </Button>
        )}
      </div>

      <span aria-hidden="true" className="hidden w-px self-stretch bg-[#5b5347]/15 sm:block" />

      {/* ── Settings: speed, duration, seed ────────────────────── */}
      <div className="md:flex md:flex-wrap md:items-center md:gap-3 max-md:contents">
        {/* Speed */}
        <div className="flex items-center gap-1.5 max-md:order-3">
          <label htmlFor="sim-speed" className={fieldLabelClass} title="Simulated requests per second (1× = real time)">
            Speed
          </label>
          <select
            id="sim-speed"
            value={speedMultiplier}
            onChange={handleSpeedChange}
            className={selectClass}
          >
            {SPEED_OPTIONS.map((speed) => (
              <option key={speed} value={speed}>
                {speed}×
              </option>
            ))}
          </select>
        </div>

        {/* Duration + Seed */}
        <div className="flex items-center gap-3 max-md:order-4 max-md:basis-full">
          <div className="flex items-center gap-1.5">
            <label htmlFor="sim-duration" className={fieldLabelClass}>
              Duration
            </label>
            <select
              id="sim-duration"
              value={durationMs}
              onChange={(e) => setDuration(Number(e.target.value))}
              disabled={simState === SimState.Running || simState === SimState.Paused}
              className={selectClass}
            >
              {DURATION_OPTIONS.map((opt) => (
                <option key={opt.ms} value={opt.ms}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Seed Control */}
          <div className="flex items-center gap-1.5">
            <label
              htmlFor="sim-seed"
              className={fieldLabelClass}
              title="Random seed for the simulation's randomness (arrival times, latencies). The same seed always produces the identical run — enter it again to reproduce results exactly."
            >
              Seed
            </label>
            <input
              id="sim-seed"
              type="number"
              value={seed}
              onChange={(e) => setSeed(Math.floor(Number(e.target.value) || 0))}
              disabled={simState === SimState.Running || simState === SimState.Paused}
              title="Random seed — same seed = identical run; dice button rolls a fresh one."
              className={`w-24 font-mono ${selectClass}`}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSeed(Math.floor(Math.random() * 0xffffffff))}
              disabled={simState === SimState.Running || simState === SimState.Paused}
              title="Randomize seed — new sample of arrival times and latencies"
              aria-label="Randomize seed"
              className="h-7 w-7 p-0 text-[#5b5347]/70 hover:text-[#5b5347] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <DicesIcon />
            </Button>
          </div>
        </div>
      </div>

      <span aria-hidden="true" className="hidden w-px self-stretch bg-[#5b5347]/15 sm:block" />

      {/* ── Status: sim time + state badge ─────────────────────── */}
      <div className="flex items-center gap-2 max-md:order-5">
        <span className="font-mono text-xs text-[#5b5347]">
          {formatSimTime(metrics?.simulatedTimeMs ?? 0)}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${getStateBadgeColor(simState)}`}
        >
          {getStateLabel(simState)}
        </span>
      </div>
    </div>
  );
}
