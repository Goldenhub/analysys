import { useEffect, useRef } from 'react';
import { useSimulationStore } from '@/store/simulationStore';
import { useAnalysisStore } from '@/store/analysisStore';
import { SimState } from '@/simulation/types';
import type { Finding } from '@/types/findings';
import { formatSimClock as formatSimTime } from "@/utils/simTime";

/**
 * LiveAnnouncer provides aria-live regions for screen reader announcements.
 * - "polite" region: simulation state changes (Task 233)
 * - "assertive" region: chaos events + Critical Finding announcements (Task 234, Task 547)
 */
export function LiveAnnouncer() {
  const simState = useSimulationStore((s) => s.simState);
  const metrics = useSimulationStore((s) => s.metrics);
  const eventLog = useSimulationStore((s) => s.eventLog);
  const findings = useAnalysisStore((s) => s.findings);

  const politeRef = useRef<HTMLDivElement>(null);
  const assertiveRef = useRef<HTMLDivElement>(null);
  const prevSimStateRef = useRef<SimState>(simState);
  const prevEventLogLenRef = useRef(0);

  // Task 547: Track announced Finding IDs per run to avoid re-announcement
  const announcedIdsRef = useRef<Set<string>>(new Set());
  const lastAnnouncedWindowRef = useRef<number>(-1);
  const prevFindingsLenRef = useRef(0);

  // Reset announced set when simulation resets (new run)
  useEffect(() => {
    if (simState === SimState.Idle) {
      announcedIdsRef.current.clear();
      lastAnnouncedWindowRef.current = -1;
      prevFindingsLenRef.current = 0;
    }
  }, [simState]);

  // Task 233: Announce simulation state changes
  useEffect(() => {
    if (simState !== prevSimStateRef.current) {
      prevSimStateRef.current = simState;
      const timeStr = metrics ? formatSimTime(metrics.simulatedTimeMs) : '00:00';

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

  // Task 547: Announce newly appearing Critical Findings (one per identifier per run,
  // at most one announcement per metrics window)
  useEffect(() => {
    if (findings.length === 0 || findings.length <= prevFindingsLenRef.current) {
      prevFindingsLenRef.current = findings.length;
      return;
    }
    prevFindingsLenRef.current = findings.length;

    // Current window indicator (use metrics time as proxy)
    const currentWindow = metrics?.simulatedTimeMs ?? 0;
    if (currentWindow === lastAnnouncedWindowRef.current) return;

    // Find newly unanounced Critical Findings
    const criticalFindings: Finding[] = findings.filter(
      (f) => f.severity === 'Critical' && !announcedIdsRef.current.has(f.id),
    );

    if (criticalFindings.length === 0) return;

    // Limit to one announcement per window
    lastAnnouncedWindowRef.current = currentWindow;

    // Mark all as announced
    for (const f of criticalFindings) {
      announcedIdsRef.current.add(f.id);
    }

    // Announce: count + category and subject of first in display order
    const first = criticalFindings[0]!;
    const subjectLabel =
      first.subjectNodeIds.length > 0 ? first.subjectNodeIds[0]!.slice(0, 8) : 'system-wide';
    const category = first.category.replace(/_/g, ' ');

    const message =
      criticalFindings.length === 1
        ? `Critical finding: ${category}, ${subjectLabel}`
        : `${criticalFindings.length} critical findings, first: ${category}, ${subjectLabel}`;

    if (assertiveRef.current) {
      assertiveRef.current.textContent = message;
    }
  }, [findings, metrics]);

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

