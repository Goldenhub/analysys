/**
 * Design-time metadata shared by simulation and visual canvas nodes.
 *
 * `parentNodeId` is `null` for a root-canvas node. An undefined value is accepted
 * for backwards-compatible imports and is treated as root by graph selectors.
 */
export interface ArchitectureNodeMetadata {
  parentNodeId?: string | null;
}
