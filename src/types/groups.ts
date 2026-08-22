// ─── Subsystem Grouping (Requirement 33) ─────────────────────────

/**
 * A presentation-only container for a set of nodes.
 *
 * Groups exist to let a large topology be read at a coarser grain: they are held in
 * `topologyStore`, never sent to the Worker, and never influence simulation behaviour.
 */
export interface SubsystemGroup {
  id: string;
  /** 1–40 chars trimmed, case-insensitively unique across groups. */
  name: string;
  /** 2–50 members, disjoint across groups, one level deep — no group nesting. */
  memberNodeIds: string[];
  /** Whether the group renders as a single collapsed element on the Canvas. */
  collapsed: boolean;
}
