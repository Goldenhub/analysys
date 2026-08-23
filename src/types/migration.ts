// ─── Import / Migration Warnings ─────────────────────────────────

/**
 * One adjustment applied to an imported topology that the user should be told about.
 *
 * Raised whenever a value read from a file is not the value the System ends up using:
 * a numeric parameter clamped to its permitted range by `normalizeConfig`, or an absent
 * field filled from `createDefaultNodeData` by the schema migration. A warning is
 * advisory — the import completes — which is what distinguishes it from a validation
 * error, and it is deliberately shaped so the surfaced message can name what changed
 * without the caller having to reconstruct it.
 *
 * The design places this on the persistence layer, where `migrateV1ToV2` also emits it;
 * it lives here because `src/validation/configValidation.ts` needs it first and must not
 * import from the store.
 */
export interface MigrationWarning {
  /** The node's or edge's user-facing label, so a message can name what was adjusted. */
  label: string;
  /** The parameter that was adjusted, by its configuration field name. */
  field: string;
  /** The value as it appeared in the imported file. */
  importedValue: unknown;
  /** The value actually applied — the bound that was hit, or the default filled in. */
  appliedValue: unknown;
}
