import { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { SimState } from '@/simulation/types';

/**
 * LiveAnnouncer provides aria-live regions for screen reader announcements.
 * - "polite" region: simulation state changes (Task 233)
 * - "assertive" region: chaos events (Task 234)
 */
export function LiveAnnouncer() {
  const simState = useSimulationStore((s) => s.simState);
  const metrics = useSimulationStore((s) => s.metrics);
  const eventLog = useSimulationStore((s) => s.eventLog);

  const politeRef = useRef<HTMLDivElement>(null);
  const assertiveRef = useRef<HTMLDivElement>(null);
  const prevSimStateRef = useRef<SimState>(simState);
  const prevEventLogLenRef = useRef(0);

  // Task 233: Announce simulation state changes
  useEffect(() => {
    if (simState !== prevSimStateRef.current) {
      prevSimStateRef.current = simState;
      const timeStr = metrics
        ? formatSimTime(metrics.simulatedTimeMs)
        : '00:00';

      let announcement = '';
      switch (simState) {
        case SimState.Running:
          announcement = 'Simulation started';
          break;
        case SimState.Paused:
          announcement = `Simulation paused at ${timeStr}`;
          break;
        case SimState.Idle:
          announcement = 'Simulation reset';
          break;
        case SimState.Complete:
          announcement = `Simulation complete at ${timeStr}`;
          break;
      }

      if (politeRef.current && announcement) {
        politeRef.current.textContent = announcement;
      }
    }
  }, [simState, metrics]);

  // Task 234: Announce chaos events assertively
  useEffect(() => {
    if (eventLog.length > prevEventLogLenRef.current) {
      const newEntries = eventLog.slice(prevEventLogLenRef.current);
      const chaosEntries = newEntries.filter(
        (e) => e.type === 'chaos' || e.message.toLowerCase().includes('chaos'),
      );

      if (chaosEntries.length > 0 && assertiveRef.current) {
        const latestChaos = chaosEntries[chaosEntries.length - 1];
        assertiveRef.current.textContent = latestChaos?.message ?? '';
      }
    }
    prevEventLogLenRef.current = eventLog.length;
  }, [eventLog]);

  return (
    <>
      {/* Polite announcements for simulation state (Task 233) */}
      <div
        ref={politeRef}
        aria-live="polite"
        aria-atomic="true"
        role="status"
        className="sr-only"
      />
      {/* Assertive announcements for chaos events (Task 234) */}
      <div
        ref={assertiveRef}
        aria-live="assertive"
        aria-atomic="true"
        role="alert"
        className="sr-only"
      />
    </>
  );
}

function formatSimTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
