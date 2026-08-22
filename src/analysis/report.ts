import type {
  Finding,
  FindingCategory,
  Severity,
  Confidence,
  AnalysisReport,
} from '@/types/findings';
import {
  REPORT_SCHEMA_VERSION,
  FINDING_CATEGORY_ORDER,
  SEVERITY_VALUES,
  CONFIDENCE_VALUES,
} from '@/types/findings';
import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';
import { sortFindingsForDisplay } from '@/store/analysisStore';

// ─── Export Interfaces ───────────────────────────────────────────

export interface ExportContext {
  findings: Finding[];
  topology: { nodes: SimulationNode[]; edges: EdgeData[] };
  nodeConfigurations: Record<string, unknown>;
  seed: number;
  simulatedDurationMs: number;
  offeredLoadRps: number;
}

// ─── JSON Export (Task 460) ──────────────────────────────────────

/**
 * Export a JSON report carrying:
 * - Report schema version
 * - Every displayed Finding with every field
 * - Topology (nodes, edges)
 * - Every node configuration
 * - Seed, simulated duration, offered load
 */
export function exportJSON(ctx: ExportContext): string {
  const report: AnalysisReport = {
    schemaVersion: REPORT_SCHEMA_VERSION,
    seed: ctx.seed,
    simulatedDurationMs: ctx.simulatedDurationMs,
    offeredLoadRps: ctx.offeredLoadRps,
    findings: ctx.findings,
    topology: ctx.topology,
    nodeConfigurations: ctx.nodeConfigurations,
  };
  return JSON.stringify(report, null, 2);
}

// ─── Markdown Export (Task 461) ──────────────────────────────────

/**
 * Export a Markdown report intended for reading.
 * Only JSON is accepted for import.
 */
export function exportMarkdown(ctx: ExportContext): string {
  const lines: string[] = [];

  lines.push('# Analysis Report');
  lines.push('');
  lines.push(`- **Seed**: ${String(ctx.seed)}`);
  lines.push(`- **Simulated Duration**: ${String(ctx.simulatedDurationMs)} ms`);
  lines.push(`- **Offered Load**: ${String(ctx.offeredLoadRps)} RPS`);
  lines.push(`- **Schema Version**: ${String(REPORT_SCHEMA_VERSION)}`);
  lines.push('');

  if (ctx.findings.length === 0) {
    lines.push('No findings were produced.');
    return lines.join('\n');
  }

  lines.push(`## Findings (${String(ctx.findings.length)})`);
  lines.push('');

  // Group by category in declaration order
  const grouped = new Map<FindingCategory, Finding[]>();
  for (const cat of FINDING_CATEGORY_ORDER) {
    const inCat = ctx.findings.filter((f) => f.category === cat);
    if (inCat.length > 0) grouped.set(cat, inCat);
  }

  for (const [category, findings] of grouped) {
    lines.push(`### ${category}`);
    lines.push('');

    for (const f of findings) {
      lines.push(`#### ${f.id}`);
      lines.push('');
      lines.push(`- **Severity**: ${f.severity}`);
      lines.push(`- **Confidence**: ${f.confidence}`);
      if (f.subjectNodeIds.length > 0) {
        lines.push(`- **Subjects**: ${f.subjectNodeIds.join(', ')}`);
      } else {
        lines.push('- **Scope**: System-wide');
      }
      lines.push(`- **Constraint**: ${f.constraint}`);
      lines.push(`- **Tradeoff**: ${f.tradeoff}`);
      lines.push(`- **Window**: ${String(f.window.startMs)}–${String(f.window.endMs)} ms`);
      lines.push('');

      lines.push('**Evidence:**');
      lines.push('');
      for (const e of f.evidence) {
        const marker = e.primary ? ' (primary)' : '';
        lines.push(`- ${e.metricName}: ${String(e.value)} ${e.unit} [${e.scope}]${marker}`);
      }
      lines.push('');

      lines.push('**Action:**');
      lines.push('');
      if ('parameter' in f.action) {
        lines.push(`- Node: ${f.action.nodeId}`);
        lines.push(`- ${f.action.direction} ${f.action.parameter}`);
        if (f.action.targetValue) {
          lines.push(`- Target: ${String(f.action.targetValue.value)} ${f.action.targetValue.unit}`);
        }
        if (f.action.multiplier !== undefined) {
          lines.push(`- Multiplier: ${String(f.action.multiplier)}`);
        }
      } else {
        lines.push(`- Node: ${f.action.nodeId} (${f.action.nodeType})`);
        lines.push(`- Change: ${f.action.change}`);
        lines.push(`- Nodes added: ${String(f.action.nodesAdded)}, Edges added: ${String(f.action.edgesAdded)}`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

// ─── JSON Import (Tasks 462–463) ─────────────────────────────────

export interface ImportError {
  message: string;
  details: string[];
}

const REQUIRED_FINDING_FIELDS = [
  'id',
  'category',
  'severity',
  'subjectNodeIds',
  'evidence',
  'constraint',
  'action',
  'tradeoff',
  'confidence',
  'window',
] as const;

/**
 * Import a JSON report.
 *
 * Rejects an import carrying:
 * - An unsupported report schema version (naming the required version)
 * - A Finding omitting a required field (naming each omitted field)
 * - An out-of-set category, severity, or confidence (naming each unrecognised value)
 *
 * On rejection, the currently displayed Findings are left unchanged.
 * On success, returns Findings in R35.8 display order (Task 462).
 */
export function importJSON(json: string): { findings: Finding[]; label: { seed: number; simulatedDurationMs: number; offeredLoadRps: number } } | ImportError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return { message: 'Invalid JSON', details: ['Could not parse the input as JSON'] };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return { message: 'Invalid report format', details: ['Root must be an object'] };
  }

  const report = parsed as Record<string, unknown>;

  // ── Schema version check ──
  if (report['schemaVersion'] !== REPORT_SCHEMA_VERSION) {
    return {
      message: 'Unsupported report schema version',
      details: [
        `Required version: ${String(REPORT_SCHEMA_VERSION)}, got: ${String(report['schemaVersion'] ?? 'missing')}`,
      ],
    };
  }

  // ── Extract metadata ──
  const seed = typeof report['seed'] === 'number' ? report['seed'] : 0;
  const simulatedDurationMs =
    typeof report['simulatedDurationMs'] === 'number' ? report['simulatedDurationMs'] : 0;
  const offeredLoadRps =
    typeof report['offeredLoadRps'] === 'number' ? report['offeredLoadRps'] : 0;

  // ── Validate findings array ──
  if (!Array.isArray(report['findings'])) {
    return {
      message: 'Invalid report format',
      details: ['Missing or non-array "findings" field'],
    };
  }

  const findings: Finding[] = [];
  const errors: string[] = [];

  for (let i = 0; i < (report['findings'] as unknown[]).length; i++) {
    const raw = (report['findings'] as unknown[])[i];
    if (typeof raw !== 'object' || raw === null) {
      errors.push(`Finding[${String(i)}]: not an object`);
      continue;
    }

    const f = raw as Record<string, unknown>;

    // Check required fields
    for (const field of REQUIRED_FINDING_FIELDS) {
      if (!(field in f)) {
        errors.push(`Finding[${String(i)}]: missing required field "${field}"`);
      }
    }

    // Validate category
    if (typeof f['category'] === 'string' && !FINDING_CATEGORY_ORDER.includes(f['category'] as FindingCategory)) {
      errors.push(`Finding[${String(i)}]: unrecognised category "${f['category'] as string}"`);
    }

    // Validate severity
    if (typeof f['severity'] === 'string' && !SEVERITY_VALUES.includes(f['severity'] as Severity)) {
      errors.push(`Finding[${String(i)}]: unrecognised severity "${f['severity'] as string}"`);
    }

    // Validate confidence
    if (typeof f['confidence'] === 'string' && !CONFIDENCE_VALUES.includes(f['confidence'] as Confidence)) {
      errors.push(`Finding[${String(i)}]: unrecognised confidence "${f['confidence'] as string}"`);
    }

    if (errors.length === 0) {
      findings.push(raw as Finding);
    }
  }

  if (errors.length > 0) {
    return { message: 'Invalid findings in report', details: errors };
  }

  // Validate evidence entries have required structure
  for (let i = 0; i < findings.length; i++) {
    const f = findings[i]!;
    if (!Array.isArray(f.evidence) || f.evidence.length === 0) {
      return {
        message: 'Invalid findings in report',
        details: [`Finding[${String(i)}]: evidence must be a non-empty array`],
      };
    }
    for (let j = 0; j < f.evidence.length; j++) {
      const e = f.evidence[j] as Record<string, unknown> | undefined;
      if (!e || typeof e['metricName'] !== 'string' || typeof e['value'] !== 'number' || typeof e['unit'] !== 'string' || typeof e['scope'] !== 'string') {
        return {
          message: 'Invalid findings in report',
          details: [`Finding[${String(i)}].evidence[${String(j)}]: missing required evidence fields (metricName, value, unit, scope)`],
        };
      }
    }
  }

  // Return Findings in R35.8 display order
  return {
    findings: sortFindingsForDisplay(findings),
    label: { seed, simulatedDurationMs, offeredLoadRps },
  };
}

/**
 * Type guard: checks if an import result is an error.
 */
export function isImportError(result: ReturnType<typeof importJSON>): result is ImportError {
  return 'message' in result && 'details' in result;
}
