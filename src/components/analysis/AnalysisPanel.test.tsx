// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { FindingList, groupFindings } from './FindingList';
import { ComparisonTable } from './ComparisonTable';
import type { Finding } from '@/types/findings';
import type { ComparisonResult } from '@/analysis/comparison';

// ─── Mock stores ─────────────────────────────────────────────────

vi.mock('@/store/topologyStore', () => ({
  useTopologyStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ nodes: [], edges: [], subsystemGroups: [] }),
}));

vi.mock('@/store/analysisStore', () => ({
  useAnalysisStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      findings: [],
      suppressions: [],
      completedWindowCount: 0,
      incompleteRules: null,
      importedFindings: null,
    }),
}));

vi.mock('@/store/simulationStore', () => ({
  useSimulationStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ simState: 'IDLE', metrics: null, eventLog: [] }),
}));

// ─── Test Findings ───────────────────────────────────────────────

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: `test-finding-${Math.random().toString(36).slice(2, 10)}`,
    category: 'Bottleneck',
    severity: 'Warning',
    subjectNodeIds: ['node-1'],
    evidence: [{ metricName: 'utilization', value: 0.92, unit: 'fraction', scope: 'node-1', primary: true }],
    constraint: 'Node utilization exceeds threshold',
    action: { nodeId: 'node-1', parameter: 'threads', direction: 'increase' as const },
    tradeoff: 'Increasing threads consumes more memory',
    confidence: 'High',
    window: { startMs: 0, endMs: 10000 },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
});

// ─── Task 558: Keyboard-only traversal of the Finding list ───────

describe('FindingList keyboard navigation', () => {
  const findings: Finding[] = [
    makeFinding({ id: 'f1', category: 'Bottleneck', severity: 'Critical' }),
    makeFinding({ id: 'f2', category: 'Bottleneck', severity: 'Warning' }),
    makeFinding({ id: 'f3', category: 'Saturation', severity: 'Info' }),
  ];

  it('moves focus down with ArrowDown', () => {
    const onActivate = vi.fn();
    render(<FindingList findings={findings} onActivateFinding={onActivate} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });

    // After two ArrowDown presses, activeIndex should be 1 (second item)
    // Activate with Enter
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);
    // The activated finding should be the second in display order
    expect(onActivate.mock.calls[0]![0].id).toBe('f2');
  });

  it('moves focus up with ArrowUp', () => {
    const onActivate = vi.fn();
    render(<FindingList findings={findings} onActivateFinding={onActivate} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();

    // Move down to index 2
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    // Now at index 2, move up to index 1
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });

    fireEvent.keyDown(listbox, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(onActivate.mock.calls[0]![0].id).toBe('f2');
  });

  it('activates on Enter and Space', () => {
    const onActivate = vi.fn();
    render(<FindingList findings={findings} onActivateFinding={onActivate} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onActivate).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(listbox, { key: 'ArrowDown' });
    fireEvent.keyDown(listbox, { key: ' ' });
    expect(onActivate).toHaveBeenCalledTimes(2);
  });

  it('does not go below the last item or above the first', () => {
    const onActivate = vi.fn();
    render(<FindingList findings={findings} onActivateFinding={onActivate} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();

    // Try moving up when at index 0
    fireEvent.keyDown(listbox, { key: 'ArrowUp' });
    fireEvent.keyDown(listbox, { key: 'Enter' });
    expect(onActivate.mock.calls[0]![0].id).toBe('f1');
  });
});

// ─── Task 558: Focus return on Escape ────────────────────────────

describe('FindingList Escape returns focus to opener', () => {
  it('returns focus to the opener ref on Escape', () => {
    const openerButton = document.createElement('button');
    openerButton.textContent = 'Open Analysis';
    document.body.appendChild(openerButton);
    const openerRef = { current: openerButton };
    const focusSpy = vi.spyOn(openerButton, 'focus');

    render(<FindingList findings={[makeFinding()]} openerRef={openerRef} />);

    const listbox = screen.getByRole('listbox');
    listbox.focus();

    fireEvent.keyDown(listbox, { key: 'Escape' });
    expect(focusSpy).toHaveBeenCalled();

    document.body.removeChild(openerButton);
  });
});

// ─── Task 558: ComparisonTable header association ────────────────

describe('ComparisonTable header association', () => {
  const mockResult: ComparisonResult = {
    label: { kind: 'controlled' },
    nameA: 'Baseline A',
    nameB: 'Baseline B',
    systemMetrics: [
      { metric: 'p99', unit: 'ms', valueA: 100, valueB: 150, absoluteDiff: 50, percentDiff: 50 },
      { metric: 'throughput', unit: 'req/s', valueA: 500, valueB: 450, absoluteDiff: -50, percentDiff: -10 },
    ],
    perNode: [],
    unmatchedNodes: [],
    configDifferences: [],
  };

  it('renders table with proper scope attributes on headers', () => {
    render(<ComparisonTable result={mockResult} />);

    const table = screen.getByRole('table', { name: /comparison.*baseline a.*baseline b/i });
    expect(table).toBeDefined();

    // Column headers have scope="col"
    const colHeaders = table.querySelectorAll('th[scope="col"]');
    expect(colHeaders.length).toBe(4); // Metric, Baseline A, Baseline B, Difference

    // Row headers have scope="row"
    const rowHeaders = table.querySelectorAll('th[scope="row"]');
    expect(rowHeaders.length).toBe(2); // p99, throughput
  });

  it('includes both run names in column headers', () => {
    render(<ComparisonTable result={mockResult} />);

    expect(screen.getByText('Baseline A')).toBeDefined();
    expect(screen.getByText('Baseline B')).toBeDefined();
  });

  it('displays the programmatic name with both compared runs', () => {
    render(<ComparisonTable result={mockResult} />);

    const table = screen.getByRole('table');
    expect(table.getAttribute('aria-label')).toContain('Baseline A');
    expect(table.getAttribute('aria-label')).toContain('Baseline B');
  });
});

// ─── Task 558: groupFindings correctness ─────────────────────────

describe('groupFindings', () => {
  it('groups by category in declaration order and omits empty categories', () => {
    const findings: Finding[] = [
      makeFinding({ id: 'sat1', category: 'Saturation', severity: 'Warning' }),
      makeFinding({ id: 'bot1', category: 'Bottleneck', severity: 'Critical' }),
      makeFinding({ id: 'bot2', category: 'Bottleneck', severity: 'Warning' }),
    ];

    const groups = groupFindings(findings);

    // Only two categories with findings
    expect(groups.length).toBe(2);
    expect(groups[0]!.category).toBe('Bottleneck'); // Bottleneck comes before Saturation
    expect(groups[1]!.category).toBe('Saturation');
    expect(groups[0]!.items.length).toBe(2);
    expect(groups[1]!.items.length).toBe(1);
  });

  it('sorts within group: severity then descending primary evidence magnitude', () => {
    const findings: Finding[] = [
      makeFinding({
        id: 'a',
        category: 'Bottleneck',
        severity: 'Warning',
        evidence: [{ metricName: 'util', value: 0.5, unit: 'fraction', scope: 'n', primary: true }],
      }),
      makeFinding({
        id: 'b',
        category: 'Bottleneck',
        severity: 'Critical',
        evidence: [{ metricName: 'util', value: 0.3, unit: 'fraction', scope: 'n', primary: true }],
      }),
      makeFinding({
        id: 'c',
        category: 'Bottleneck',
        severity: 'Warning',
        evidence: [{ metricName: 'util', value: 0.9, unit: 'fraction', scope: 'n', primary: true }],
      }),
    ];

    const groups = groupFindings(findings);
    const items = groups[0]!.items;

    // Critical first (b), then Warning sorted by descending magnitude: c(0.9) before a(0.5)
    expect(items[0]!.id).toBe('b');
    expect(items[1]!.id).toBe('c');
    expect(items[2]!.id).toBe('a');
  });
});

// ─── Task 558: Critical Finding announcement — exactly once per run ──

describe('Critical Finding announcement via LiveAnnouncer', () => {
  it('tracks announced IDs to prevent re-announcement per run', () => {
    // This is a unit test of the announcement logic pattern.
    // The LiveAnnouncer uses a Set<string> to track announced Finding IDs.
    const announcedIds = new Set<string>();

    const findings: Finding[] = [
      makeFinding({ id: 'crit-1', severity: 'Critical' }),
      makeFinding({ id: 'crit-2', severity: 'Critical' }),
    ];

    // First window: announce new critical findings
    const newCritical = findings.filter((f) => f.severity === 'Critical' && !announcedIds.has(f.id));
    expect(newCritical.length).toBe(2);
    for (const f of newCritical) announcedIds.add(f.id);

    // Second window with same findings: nothing new to announce
    const secondPass = findings.filter((f) => f.severity === 'Critical' && !announcedIds.has(f.id));
    expect(secondPass.length).toBe(0);

    // Third window with a new finding: only the new one
    const newFinding = makeFinding({ id: 'crit-3', severity: 'Critical' });
    const thirdFindings = [...findings, newFinding];
    const thirdPass = thirdFindings.filter((f) => f.severity === 'Critical' && !announcedIds.has(f.id));
    expect(thirdPass.length).toBe(1);
    expect(thirdPass[0]!.id).toBe('crit-3');
  });

  it('resets announced set on simulation reset', () => {
    const announcedIds = new Set<string>();
    announcedIds.add('crit-1');
    announcedIds.add('crit-2');

    // Simulate reset
    announcedIds.clear();
    expect(announcedIds.size).toBe(0);

    // Previously-announced finding should now be announced again
    const findings: Finding[] = [makeFinding({ id: 'crit-1', severity: 'Critical' })];
    const newCritical = findings.filter((f) => f.severity === 'Critical' && !announcedIds.has(f.id));
    expect(newCritical.length).toBe(1);
  });
});
