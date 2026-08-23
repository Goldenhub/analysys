import { useRef, useCallback, useEffect, useState } from 'react';
import type { Finding } from '@/types/findings';
import { FINDING_CATEGORY_ORDER, type FindingCategory } from '@/types/findings';
import { FindingCard } from './FindingCard';

// ─── Display Order Sort (R35.8 / Task 537) ───────────────────────

const SEVERITY_RANK: Record<string, number> = { Critical: 0, Warning: 1, Info: 2 };

/**
 * Sort Findings within a category group:
 * severity → descending primary evidence magnitude → category position → ascending identifier.
 */
function sortWithinGroup(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => {
    // Severity
    const sevA = SEVERITY_RANK[a.severity] ?? 9;
    const sevB = SEVERITY_RANK[b.severity] ?? 9;
    if (sevA !== sevB) return sevA - sevB;

    // Descending primary evidence magnitude
    const primaryA = a.evidence.find((e) => e.primary)?.value ?? 0;
    const primaryB = b.evidence.find((e) => e.primary)?.value ?? 0;
    const magA = Math.abs(primaryA);
    const magB = Math.abs(primaryB);
    if (magA !== magB) return magB - magA; // descending

    // Category position (should be same within a group, but for correctness)
    const catA = FINDING_CATEGORY_ORDER.indexOf(a.category);
    const catB = FINDING_CATEGORY_ORDER.indexOf(b.category);
    if (catA !== catB) return catA - catB;

    // Ascending identifier
    return a.id.localeCompare(b.id);
  });
}

/** Group Findings by category, omitting empty categories. */
export function groupFindings(findings: Finding[]): Array<{ category: FindingCategory; items: Finding[] }> {
  const groups: Array<{ category: FindingCategory; items: Finding[] }> = [];

  for (const category of FINDING_CATEGORY_ORDER) {
    const items = findings.filter((f) => f.category === category);
    if (items.length > 0) {
      groups.push({ category, items: sortWithinGroup(items) });
    }
  }

  return groups;
}

// ─── MAX_FINDINGS (Task 543) ─────────────────────────────────────

const MAX_FINDINGS = 200;

// ─── FindingList Component (Tasks 537, 543, 544, 545) ────────────

export interface FindingListProps {
  findings: Finding[];
  /** Called when a Finding is activated (Enter/Space/click). */
  onActivateFinding?: (finding: Finding) => void;
  /** Ref to the opener button, for focus return on Escape. */
  openerRef?: React.RefObject<HTMLElement | null>;
}

export function FindingList({ findings, onActivateFinding, openerRef }: FindingListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLElement | null)[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);

  // Limit to 200 Findings (Task 543)
  const limitedFindings = findings.slice(0, MAX_FINDINGS);
  const groups = groupFindings(limitedFindings);

  // Flatten for keyboard navigation
  const flatFindings = groups.flatMap((g) => g.items);

  // Keep refs in sync
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, flatFindings.length);
  }, [flatFindings.length]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = Math.min(activeIndex + 1, flatFindings.length - 1);
          setActiveIndex(next);
          itemRefs.current[next]?.focus();
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = Math.max(activeIndex - 1, 0);
          setActiveIndex(prev);
          itemRefs.current[prev]?.focus();
          break;
        }
        case 'Enter':
        case ' ': {
          e.preventDefault();
          if (activeIndex >= 0 && activeIndex < flatFindings.length) {
            onActivateFinding?.(flatFindings[activeIndex]!);
          }
          break;
        }
        case 'Escape': {
          e.preventDefault();
          // Return focus to opener (Task 545)
          openerRef?.current?.focus();
          break;
        }
        // Tab and Shift+Tab: let browser handle naturally to leave the list
      }
    },
    [activeIndex, flatFindings, onActivateFinding, openerRef],
  );

  const handleItemFocus = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  let flatIndex = 0;

  return (
    <div
      ref={listRef}
      role="listbox"
      aria-label="Analysis findings"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className="flex flex-col gap-3 overflow-y-auto pr-1 outline-none focus:ring-2 focus:ring-indigo-500/50 rounded"
    >
      {groups.map(({ category, items }) => (
        <section key={category} aria-label={`${category.replace(/_/g, ' ')} findings`}>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5 sticky top-0 bg-gray-950/90 py-0.5 backdrop-blur-sm">
            {category.replace(/_/g, ' ')} ({items.length})
          </h3>
          <div className="flex flex-col gap-1.5" role="group" aria-label={category.replace(/_/g, ' ')}>
            {items.map((finding) => {
              const idx = flatIndex++;
              return (
                <div
                  key={finding.id}
                  ref={(el) => {
                    itemRefs.current[idx] = el;
                  }}
                  tabIndex={-1}
                  onFocus={() => handleItemFocus(idx)}
                  className="outline-none"
                >
                  <FindingCard
                    finding={finding}
                    isActive={activeIndex === idx}
                    onActivate={() => {
                      setActiveIndex(idx);
                      onActivateFinding?.(finding);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}

      {flatFindings.length === 0 && (
        <p className="text-xs text-gray-500 italic py-4 text-center">No findings to display.</p>
      )}
    </div>
  );
}
