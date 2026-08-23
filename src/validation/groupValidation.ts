import type { SubsystemGroup } from '@/types/groups';

// ─── Constants ───────────────────────────────────────────────────

export const MAX_GROUPS = 20;
export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 50;
export const MAX_NAME_LENGTH = 40;

// ─── Error Types ─────────────────────────────────────────────────

export interface GroupValidationError {
  constraint: string;
  nodeLabels?: string[];
}

// ─── Name Validation ─────────────────────────────────────────────

/**
 * Validates a group name: 1–40 characters after trimming, case-insensitively unique.
 * Returns an error message naming the violated constraint, or null if valid.
 */
export function validateGroupName(
  name: string,
  existingGroups: SubsystemGroup[],
  currentGroupId?: string,
): string | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return 'Group name must not be empty after trimming whitespace.';
  }
  if (trimmed.length > MAX_NAME_LENGTH) {
    return `Group name must not exceed ${MAX_NAME_LENGTH} characters after trimming (got ${trimmed.length}).`;
  }
  const lowerName = trimmed.toLowerCase();
  const duplicate = existingGroups.find(
    (g) => g.id !== currentGroupId && g.name.toLowerCase() === lowerName,
  );
  if (duplicate) {
    return `Group name "${trimmed}" conflicts with existing group "${duplicate.name}" (case-insensitive comparison).`;
  }
  return null;
}

// ─── Creation Validation ─────────────────────────────────────────

/**
 * Validates whether a set of node IDs can form a new group.
 * Returns a validation error or null if creation is permitted.
 */
export function validateGroupCreation(
  nodeIds: string[],
  existingGroups: SubsystemGroup[],
  nodeLabelsById: Map<string, string>,
): GroupValidationError | null {
  if (nodeIds.length < MIN_MEMBERS) {
    return {
      constraint: `A group requires at least ${MIN_MEMBERS} selected nodes (got ${nodeIds.length}).`,
    };
  }
  if (nodeIds.length > MAX_MEMBERS) {
    return {
      constraint: `A group may contain at most ${MAX_MEMBERS} nodes (got ${nodeIds.length}).`,
    };
  }
  if (existingGroups.length >= MAX_GROUPS) {
    return {
      constraint: `The topology already contains the maximum of ${MAX_GROUPS} groups.`,
    };
  }
  // Check if any selected node already belongs to a group
  const conflicting: string[] = [];
  for (const nodeId of nodeIds) {
    const owningGroup = existingGroups.find((g) => g.memberNodeIds.includes(nodeId));
    if (owningGroup) {
      conflicting.push(nodeLabelsById.get(nodeId) ?? nodeId);
    }
  }
  if (conflicting.length > 0) {
    return {
      constraint: `Selected node(s) already belong to a group.`,
      nodeLabels: conflicting,
    };
  }
  return null;
}

// ─── Add-to-Group Validation ─────────────────────────────────────

/**
 * Validates whether nodes can be added to an existing group.
 */
export function validateAddNodesToGroup(
  groupId: string,
  nodeIds: string[],
  existingGroups: SubsystemGroup[],
  nodeLabelsById: Map<string, string>,
): GroupValidationError | null {
  const group = existingGroups.find((g) => g.id === groupId);
  if (!group) {
    return { constraint: `Group not found.` };
  }
  const newSize = group.memberNodeIds.length + nodeIds.length;
  if (newSize > MAX_MEMBERS) {
    return {
      constraint: `Adding ${nodeIds.length} node(s) would raise membership to ${newSize}, exceeding the limit of ${MAX_MEMBERS}.`,
    };
  }
  // Check disjointness
  const conflicting: string[] = [];
  for (const nodeId of nodeIds) {
    const owningGroup = existingGroups.find(
      (g) => g.id !== groupId && g.memberNodeIds.includes(nodeId),
    );
    if (owningGroup) {
      conflicting.push(nodeLabelsById.get(nodeId) ?? nodeId);
    }
  }
  if (conflicting.length > 0) {
    return {
      constraint: `Node(s) already belong to another group.`,
      nodeLabels: conflicting,
    };
  }
  return null;
}

// ─── Import Normalisation ────────────────────────────────────────

export interface NormalisationWarning {
  groupName: string;
  violation: string;
  appliedChange: string;
}

/**
 * Normalises imported groups rather than rejecting them outright.
 * Returns the cleaned list plus any warnings.
 */
export function normaliseImportedGroups(
  groups: SubsystemGroup[],
  validNodeIds: Set<string>,
): { groups: SubsystemGroup[]; warnings: NormalisationWarning[] } {
  const warnings: NormalisationWarning[] = [];
  const usedNames = new Set<string>();
  const assignedNodeIds = new Set<string>();
  const result: SubsystemGroup[] = [];

  for (const group of groups) {
    let name = (group.name ?? '').trim();

    // Truncate name past 40 characters
    if (name.length > MAX_NAME_LENGTH) {
      const original = name;
      name = name.slice(0, MAX_NAME_LENGTH);
      warnings.push({
        groupName: original,
        violation: `Name exceeds ${MAX_NAME_LENGTH} characters`,
        appliedChange: `Truncated to "${name}"`,
      });
    }

    // Suffix a duplicate name
    const lowerName = name.toLowerCase();
    if (usedNames.has(lowerName)) {
      const original = name;
      let suffix = 2;
      while (usedNames.has(`${name} ${suffix}`.toLowerCase())) {
        suffix++;
      }
      name = `${name} ${suffix}`.slice(0, MAX_NAME_LENGTH);
      warnings.push({
        groupName: original,
        violation: `Duplicate name (case-insensitive)`,
        appliedChange: `Renamed to "${name}"`,
      });
    }
    usedNames.add(name.toLowerCase());

    // Drop absent and duplicated member identifiers
    const seen = new Set<string>();
    const cleaned: string[] = [];
    for (const memberId of group.memberNodeIds) {
      if (!validNodeIds.has(memberId)) {
        warnings.push({
          groupName: name,
          violation: `Member "${memberId}" absent from topology`,
          appliedChange: `Dropped absent member`,
        });
        continue;
      }
      if (seen.has(memberId)) {
        warnings.push({
          groupName: name,
          violation: `Duplicate member "${memberId}"`,
          appliedChange: `Dropped duplicate member`,
        });
        continue;
      }
      if (assignedNodeIds.has(memberId)) {
        warnings.push({
          groupName: name,
          violation: `Member "${memberId}" already assigned to another group`,
          appliedChange: `Dropped member to maintain disjoint membership`,
        });
        continue;
      }
      seen.add(memberId);
      cleaned.push(memberId);
    }

    // Keep the first 50 in stored order
    if (cleaned.length > MAX_MEMBERS) {
      warnings.push({
        groupName: name,
        violation: `Membership exceeds ${MAX_MEMBERS} nodes`,
        appliedChange: `Kept the first ${MAX_MEMBERS} members in stored order`,
      });
    }
    const finalMembers = cleaned.slice(0, MAX_MEMBERS);

    // Drop a group left with fewer than 2
    if (finalMembers.length < MIN_MEMBERS) {
      warnings.push({
        groupName: name,
        violation: `Fewer than ${MIN_MEMBERS} valid members remain`,
        appliedChange: `Dropped group`,
      });
      continue;
    }

    for (const id of finalMembers) {
      assignedNodeIds.add(id);
    }

    result.push({
      id: group.id,
      name,
      memberNodeIds: finalMembers,
      collapsed: group.collapsed ?? false,
    });
  }

  return { groups: result, warnings };
}
