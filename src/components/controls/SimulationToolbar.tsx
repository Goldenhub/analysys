import { useCallback, useEffect } from 'react';
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

// ─── Speed Options ───────────────────────────────────────────────

const SPEED_OPTIONS = [1, 2, 5, 10, 50] as const;

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
        maxSimulatedTimeMs: 300_000, // 5 min default
        metricsIntervalMs: 1000,
        maxHopsPerRequest: 20,
      },
    });
    sendToWorker({ type: 'START', payload: { speedMultiplier } });
    setSimState(SimState.Running);
  }, [getTopologySnapshot, initWorker, sendToWorker, speedMultiplier, setSimState]);

  const handlePause = useCallback(() => {
    sendToWorker({ type: 'PAUSE' });
    setSimState(SimState.Paused);
  }, [sendToWorker, setSimState]);

  const handleResume = useCallback(() => {
    sendToWorker({ type: 'RESUME', payload: { speedMultiplier } });
    setSimState(SimState.Running);
  }, [sendToWorker, speedMultiplier, setSimState]);

  const handleReset = useCallback(() => {
    sendToWorker({ type: 'RESET' });
    terminateWorker();
    resetMetrics();
    setSimState(SimState.Idle);
  }, [sendToWorker, terminateWorker, resetMetrics, setSimState]);

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

  // ─── Disable Logic ───────────────────────────────────────────

  const startDisabled = simState === SimState.Running;
  const pauseDisabled = simState === SimState.Idle || simState === SimState.Complete || simState === SimState.Paused;
  const resumeDisabled = simState !== SimState.Paused;
  const resetDisabled = simState === SimState.Idle;

  // ─── Render ──────────────────────────────────────────────────

  return (
    <div className="flex items-center gap-3">
      {/* Action Buttons */}
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={startDisabled}
          onClick={handleStart}
          title="Start (Space)"
        >
          <PlayIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={pauseDisabled}
          onClick={handlePause}
          title="Pause (Space)"
        >
          <PauseIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={resumeDisabled}
          onClick={handleResume}
          title="Resume (Space)"
        >
          <StopIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={resetDisabled}
          onClick={handleReset}
          title="Reset (R)"
        >
          <RefreshIcon />
        </Button>
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
    </div>
  );
}
