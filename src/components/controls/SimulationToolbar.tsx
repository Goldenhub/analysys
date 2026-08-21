import { useCallback, useEffect, useState } from 'react';
import { useSimulationStore } from '@/store';
import { useTopologyStore } from '@/store';
import { SimState } from '@/simulation/types';
import { Button } from '@/components/ui/button';

// ─── Icons (inline SVG) ──────────────────────────────────────────

function PlayIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M8 5.14v14l11-7-11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="size-4">
      <path d="M6 6h12v12H6V6z" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-4">
      <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="size-3.5">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

const DEFAULT_DURATION_MS = 120_000; // 2 min

// ─── Helpers ─────────────────────────────────────────────────────

function formatSimTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const millis = Math.floor(ms % 1000);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

function getStateBadgeColor(state: SimState): string {
  switch (state) {
    case SimState.Idle:
      return 'bg-gray-600 text-gray-200';
    case SimState.Running:
      return 'bg-green-600 text-green-100';
    case SimState.Paused:
      return 'bg-amber-600 text-amber-100';
    case SimState.Complete:
      return 'bg-blue-600 text-blue-100';
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
  const metrics = useSimulationStore((s) => s.metrics);
  const setSpeed = useSimulationStore((s) => s.setSpeed);
  const setSimState = useSimulationStore((s) => s.setSimState);
  const initWorker = useSimulationStore((s) => s.initWorker);
  const sendToWorker = useSimulationStore((s) => s.sendToWorker);
  const resetMetrics = useSimulationStore((s) => s.resetMetrics);
  const terminateWorker = useSimulationStore((s) => s.terminateWorker);
  const getTopologySnapshot = useTopologyStore((s) => s.getTopologySnapshot);

  const [showHelp, setShowHelp] = useState(false);
  const [durationMs, setDurationMs] = useState(DEFAULT_DURATION_MS);

  // ─── Button Handlers ─────────────────────────────────────────

  const handleStart = useCallback(() => {
    const topology = getTopologySnapshot();
    initWorker();
    sendToWorker({
      type: 'INIT',
      payload: {
        topology,
        seed: Date.now(),
        speedMultiplier,
        maxSimulatedTimeMs: durationMs,
        metricsIntervalMs: 500,
        maxHopsPerRequest: 20,
      },
    });
    sendToWorker({ type: 'START', payload: { speedMultiplier } });
    setSimState(SimState.Running);
  }, [getTopologySnapshot, initWorker, sendToWorker, speedMultiplier, setSimState, durationMs]);

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
        sendToWorker({ type: 'PAUSE' });
        sendToWorker({ type: 'RESUME', payload: { speedMultiplier: newSpeed } });
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

  return (
    <div className="flex items-center gap-3">
      {/* Action Buttons */}
      <div className="flex items-center gap-1.5">
        {/* Start / Resume */}
        {showStartButton && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleStart}
            title="Start simulation (Space)"
            className="gap-1 text-green-400 hover:text-green-300"
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
            className="gap-1 text-green-400 hover:text-green-300"
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
            className="gap-1 text-amber-400 hover:text-amber-300"
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
            className="gap-1 text-red-400 hover:text-red-300"
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
            className="gap-1 text-gray-400 hover:text-gray-300"
          >
            <RefreshIcon />
            <span>Reset</span>
          </Button>
        )}
      </div>

      {/* Speed Selector */}
      <select
        value={speedMultiplier}
        onChange={handleSpeedChange}
        className="h-7 rounded-md border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200 outline-none focus:border-blue-500"
      >
        {SPEED_OPTIONS.map((speed) => (
          <option key={speed} value={speed}>
            {speed}×
          </option>
        ))}
      </select>

      {/* Duration Selector */}
      <div className="flex items-center gap-1">
        <label htmlFor="sim-duration" className="text-[10px] text-gray-500">
          Duration
        </label>
        <select
          id="sim-duration"
          value={durationMs}
          onChange={(e) => setDurationMs(Number(e.target.value))}
          disabled={simState === SimState.Running || simState === SimState.Paused}
          className="h-7 rounded-md border border-gray-700 bg-gray-800 px-2 text-xs text-gray-200 outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {DURATION_OPTIONS.map((opt) => (
            <option key={opt.ms} value={opt.ms}>
              {opt.label}
            </option>
          ))}
        </select>
        <span className="text-[10px] text-gray-500">sim</span>
      </div>

      {/* Simulation Time */}
      <span className="font-mono text-xs text-gray-300">
        {formatSimTime(metrics?.simulatedTimeMs ?? 0)}
      </span>

      {/* State Badge */}
      <span
        className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${getStateBadgeColor(simState)}`}
      >
        {getStateLabel(simState)}
      </span>

      {/* Help Tooltip */}
      <div className="relative">
        <button
          onClick={() => setShowHelp(!showHelp)}
          className="rounded-full p-1 text-gray-500 hover:bg-gray-800 hover:text-gray-300 transition-colors"
          aria-label="How to use"
          title="How to use"
        >
          <HelpIcon />
        </button>
        {showHelp && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowHelp(false)}
              aria-hidden="true"
            />
            <div className="absolute right-0 top-full z-50 mt-1 w-64 rounded-lg border border-gray-700 bg-gray-800 p-3 shadow-xl">
              <p className="text-xs text-gray-300 leading-relaxed">
                <span className="font-semibold text-gray-100">How to use Analysys:</span>
                <br />
                1. Build a topology (drag nodes from palette)
                <br />
                2. Click <span className="text-green-400">Start</span> to run
                <br />
                3. Watch metrics in the dashboard below
                <br />
                4. Inject chaos to test resilience
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
