// ─── Legacy Subsystem Grouping (Requirement 33 — removed) ────────

/**
 * The subsystem-group system was removed. This type is retained solely so that
 * legacy v2 persisted records (which stored `subsystemGroups`) can still be
 * read and migrated to the current schema, at which point the group data is
 * discarded. No runtime group logic remains in the codebase.
 */
export interface SubsystemGroup {
  id: string;
  name: string;
  memberNodeIds: string[];
  collapsed: boolean;
}
