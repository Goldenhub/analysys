// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { SimulationToolbar } from './controls/SimulationToolbar';
import { PresetSelector } from './presets/PresetSelector';
import { useTopologyStore } from '@/store/topologyStore';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';
import {
  DEFAULT_MAX_HOPS_PER_REQUEST,
  DEFAULT_METRICS_INTERVAL_MS,
  type MainToWorkerMessage,
  type SimulationEngineConfig,
} from '@/types/messages';
import { presets } from '@/presets';

// ─── Worker mock ─────────────────────────────────────────────────
//
// Every surface that starts a simulation builds its own INIT payload. This
// mock captures those payloads so the two surfaces can be compared.

const posted: MainToWorkerMessage[] = [];

class MockWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = (message: MainToWorkerMessage) => {
    posted.push(message);
  };
  terminate = vi.fn();
}

vi.stubGlobal('Worker', MockWorker);

function initPayload(): SimulationEngineConfig {
  const init = posted.find((m) => m.type === 'INIT');
  if (!init || init.type !== 'INIT') {
    throw new Error(`no INIT message was posted; got ${posted.map((m) => m.type).join(', ')}`);
  }
  return init.payload;
}

beforeEach(() => {
  posted.length = 0;
  useTopologyStore.setState({ nodes: [], edges: [], past: [], future: [] });
  useSimulationStore.setState({ simState: SimState.Idle, speedMultiplier: 1, metrics: null });
});

afterEach(() => {
  cleanup();
  useSimulationStore.getState().terminateWorker();
  vi.useRealTimers();
});

// ─── The defaults themselves ─────────────────────────────────────

describe('engine INIT defaults', () => {
  it('sets the cycle guard to the 20 hops Requirement 13.1 specifies', () => {
    expect(DEFAULT_MAX_HOPS_PER_REQUEST).toBe(20);
  });

  it('keeps the metrics window at or below the 500 ms Requirement 7.2 implies', () => {
    // R7.2 requires >= 2 chart updates per simulated second at 1x speed.
    expect(DEFAULT_METRICS_INTERVAL_MS).toBeLessThanOrEqual(500);
    expect(1000 / DEFAULT_METRICS_INTERVAL_MS).toBeGreaterThanOrEqual(2);
  });
});

// ─── Each surface applies them ───────────────────────────────────

describe('SimulationToolbar Start', () => {
  it('initialises the worker with the shared engine defaults', () => {
    render(<SimulationToolbar />);
    fireEvent.click(screen.getByRole('button', { name: /start/i }));

    const payload = initPayload();
    expect(payload.maxHopsPerRequest).toBe(DEFAULT_MAX_HOPS_PER_REQUEST);
    expect(payload.metricsIntervalMs).toBe(DEFAULT_METRICS_INTERVAL_MS);
  });
});

describe('PresetSelector load', () => {
  it('initialises the worker with the shared engine defaults', () => {
    // The preset schedules its chaos timeline on real timers; keep them frozen
    // so no callback fires after the worker is torn down.
    vi.useFakeTimers();

    render(<PresetSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(presets[0]!.name, 'i') }));

    const payload = initPayload();
    expect(payload.maxHopsPerRequest).toBe(DEFAULT_MAX_HOPS_PER_REQUEST);
    expect(payload.metricsIntervalMs).toBe(DEFAULT_METRICS_INTERVAL_MS);
  });
});

// ─── The regression this guards ──────────────────────────────────

describe('engine defaults across surfaces', () => {
  it('sends an identical cycle guard and metrics window from every start path', () => {
    // Before this was centralised, PresetSelector sent maxHops 10 / window
    // 1000 ms while SimulationToolbar sent 20 / 500 ms, so a topology deeper
    // than 10 hops completed from the toolbar and was terminated
    // LOOP_DETECTED from a preset.
    render(<SimulationToolbar />);
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    const fromToolbar = initPayload();

    cleanup();
    useSimulationStore.getState().terminateWorker();
    posted.length = 0;

    vi.useFakeTimers();
    render(<PresetSelector />);
    fireEvent.click(screen.getByRole('button', { name: 'Presets' }));
    fireEvent.click(screen.getByRole('button', { name: new RegExp(presets[0]!.name, 'i') }));
    const fromPreset = initPayload();

    expect(fromPreset.maxHopsPerRequest).toBe(fromToolbar.maxHopsPerRequest);
    expect(fromPreset.metricsIntervalMs).toBe(fromToolbar.metricsIntervalMs);
  });
});
