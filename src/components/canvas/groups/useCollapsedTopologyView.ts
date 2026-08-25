import { useMemo } from 'react';
import { useTopologyStore } from '@/store/topologyStore';
import type { AnalysysNode, SimulationNode } from '@/types/nodes';
import type { AnalysysEdge } from '@/types/edges';
import type { SubsystemGroup } from '@/types/groups';

// ─── Constants ───────────────────────────────────────────────────

export const SUBSYSTEM_GROUP_NODE_TYPE = 'SUBSYSTEM_GROUP';
export const SUBSYSTEM_GROUP_FRAME_NODE_TYPE = 'SUBSYSTEM_GROUP_FRAME';
export const MERGED_BOUNDARY_EDGE_TYPE = 'MERGED_BOUNDARY';

/** Padding around member bounding boxes for expanded-group frames, in px. */
const FRAME_PADDING = 28;

// ─── Merged Edge Data ────────────────────────────────────────────

export interface MergedBoundaryEdgeData {
  underlyingEdgeIds: string[];
  underlyingCount: number;
  memberLabels: string[];
  memberProtocols: string[];
}

// ─── Collapsed Group Node Data ───────────────────────────────────

export interface SubsystemGroupNodeData {
  groupId: string;
  groupName: string;
  memberCount: number;
  memberNodeIds: string[];
  memberLabels: string[];
}

/** Data for the non-interactive container drawn behind an expanded group's members. */
export interface SubsystemGroupFrameData {
  groupId: string;
  groupName: string;
  memberCount: number;
}

// ─── Hook ────────────────────────────────────────────────────────

/**
 * Maps the canonical topology + groups onto the node and edge arrays React Flow renders.
 *
 * Expanded groups get a non-interactive FRAME node (dashed container with the group
 * name) drawn behind their members — member positions stay absolute, so collapse/
 * expand and group deletion remain position-preserving no-ops. Collapsed groups
 * replace their members with a single named box node.
 */
export function useCollapsedTopologyView(): { nodes: AnalysysNode[]; edges: AnalysysEdge[] } {
  const nodes = useTopologyStore((s) => s.nodes);
  const edges = useTopologyStore((s) => s.edges);
  const subsystemGroups = useTopologyStore((s) => s.subsystemGroups);

  return useMemo(
    () => computeCollapsedView(nodes, edges, subsystemGroups),
    [nodes, edges, subsystemGroups],
  );
}

/**
 * Pure computation extracted for testability.
 */
export function computeCollapsedView(
  nodes: AnalysysNode[],
  edges: AnalysysEdge[],
  subsystemGroups: SubsystemGroup[],
): { nodes: AnalysysNode[]; edges: AnalysysEdge[] } {
  if (subsystemGroups.length === 0) {
    return { nodes, edges };
  }

  const collapsedGroups = subsystemGroups.filter((g) => g.collapsed);
  const expandedGroups = subsystemGroups.filter((g) => !g.collapsed);

  // ─── Frames for expanded groups: dashed container behind members ──

  const frameNodes: AnalysysNode[] = [];
  for (const group of expandedGroups) {
    const members = nodes.filter((n) => group.memberNodeIds.includes(n.id));
    if (members.length === 0) continue;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of members) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y);
    }
    const frameData: SubsystemGroupFrameData = {
      groupId: group.id,
      groupName: group.name,
      memberCount: members.length,
    };
    frameNodes.push({
      id: `frame:${group.id}`,
      type: SUBSYSTEM_GROUP_FRAME_NODE_TYPE,
      position: { x: minX - FRAME_PADDING, y: minY - FRAME_PADDING },
      style: {
        width: maxX - minX + FRAME_PADDING * 2,
        height: maxY - minY + FRAME_PADDING * 2,
      },
      draggable: false,
      selectable: false,
      connectable: false,
      zIndex: -1,
      data: frameData as unknown as AnalysysNode['data'],
    } as AnalysysNode);
  }

  if (collapsedGroups.length === 0) {
    return { nodes: [...nodes, ...frameNodes], edges };
  }

  // Build a map of nodeId → collapsed group
  const nodeToGroup = new Map<string, SubsystemGroup>();
  for (const group of collapsedGroups) {
    for (const nodeId of group.memberNodeIds) {
      nodeToGroup.set(nodeId, group);
    }
  }

  // Build node label map for merged edge display
  const nodeLabelMap = new Map<string, string>();
  for (const n of nodes) {
    nodeLabelMap.set(n.id, (n.data as SimulationNode).label);
  }

  // Compute bounding-box centre for each collapsed group
  const groupCentres = new Map<string, { x: number; y: number }>();
  for (const group of collapsedGroups) {
    const memberNodes = nodes.filter((n) => group.memberNodeIds.includes(n.id));
    if (memberNodes.length === 0) continue;
    let minX = Infinity,
      maxX = -Infinity,
      minY = Infinity,
      maxY = -Infinity;
    for (const n of memberNodes) {
      minX = Math.min(minX, n.position.x);
      maxX = Math.max(maxX, n.position.x);
      minY = Math.min(minY, n.position.y);
      maxY = Math.max(maxY, n.position.y);
    }
    groupCentres.set(group.id, { x: (minX + maxX) / 2, y: (minY + maxY) / 2 });
  }

  // Emit nodes: omit collapsed members, add group nodes
  const resultNodes: AnalysysNode[] = [];
  for (const n of nodes) {
    if (!nodeToGroup.has(n.id)) {
      resultNodes.push(n);
    }
  }
  for (const group of collapsedGroups) {
    const centre = groupCentres.get(group.id) ?? { x: 0, y: 0 };
    const memberLabels = group.memberNodeIds.map((id) => nodeLabelMap.get(id) ?? id);
    const groupNodeData: SubsystemGroupNodeData = {
      groupId: group.id,
      groupName: group.name,
      memberCount: group.memberNodeIds.length,
      memberNodeIds: group.memberNodeIds,
      memberLabels,
    };
    resultNodes.push({
      id: `grp:${group.id}`,
      type: SUBSYSTEM_GROUP_NODE_TYPE,
      position: centre,
      data: groupNodeData as unknown as AnalysysNode['data'],
    } as AnalysysNode);
  }

  // Emit edges: omit internal edges, rewrite & merge boundary edges
  const resultEdges: AnalysysEdge[] = [];
  // Key: `grp:{groupId}:{in|out}:{externalNodeId}` → accumulated merged edge data
  const mergedEdgeMap = new Map<
    string,
    {
      groupId: string;
      externalNodeId: string;
      direction: 'in' | 'out';
      underlyingEdgeIds: string[];
      memberLabels: string[];
      memberProtocols: string[];
    }
  >();

  for (const edge of edges) {
    const sourceGroup = nodeToGroup.get(edge.source);
    const targetGroup = nodeToGroup.get(edge.target);

    // Both endpoints in the same collapsed group → omit (R33.6)
    if (sourceGroup && targetGroup && sourceGroup.id === targetGroup.id) {
      continue;
    }

    // Source in collapsed group, target external → outbound boundary edge
    if (sourceGroup && !targetGroup) {
      const key = `grp:${sourceGroup.id}:out:${edge.target}`;
      const existing = mergedEdgeMap.get(key);
      if (existing) {
        existing.underlyingEdgeIds.push(edge.id);
        existing.memberLabels.push(nodeLabelMap.get(edge.source) ?? edge.source);
        existing.memberProtocols.push(edge.data?.protocol ?? 'SYNC');
      } else {
        mergedEdgeMap.set(key, {
          groupId: sourceGroup.id,
          externalNodeId: edge.target,
          direction: 'out',
          underlyingEdgeIds: [edge.id],
          memberLabels: [nodeLabelMap.get(edge.source) ?? edge.source],
          memberProtocols: [edge.data?.protocol ?? 'SYNC'],
        });
      }
      continue;
    }

    // Target in collapsed group, source external → inbound boundary edge
    if (targetGroup && !sourceGroup) {
      const key = `grp:${targetGroup.id}:in:${edge.source}`;
      const existing = mergedEdgeMap.get(key);
      if (existing) {
        existing.underlyingEdgeIds.push(edge.id);
        existing.memberLabels.push(nodeLabelMap.get(edge.target) ?? edge.target);
        existing.memberProtocols.push(edge.data?.protocol ?? 'SYNC');
      } else {
        mergedEdgeMap.set(key, {
          groupId: targetGroup.id,
          externalNodeId: edge.source,
          direction: 'in',
          underlyingEdgeIds: [edge.id],
          memberLabels: [nodeLabelMap.get(edge.target) ?? edge.target],
          memberProtocols: [edge.data?.protocol ?? 'SYNC'],
        });
      }
      continue;
    }

    // Source in one collapsed group, target in a different collapsed group
    if (sourceGroup && targetGroup && sourceGroup.id !== targetGroup.id) {
      // Treat as both out from source group and in to target group... but actually
      // this is a single edge that connects two groups. We merge it from the source group's
      // perspective with the target being the target group node.
      const outKey = `grp:${sourceGroup.id}:out:grp:${targetGroup.id}`;
      const existing = mergedEdgeMap.get(outKey);
      if (existing) {
        existing.underlyingEdgeIds.push(edge.id);
        existing.memberLabels.push(nodeLabelMap.get(edge.source) ?? edge.source);
        existing.memberProtocols.push(edge.data?.protocol ?? 'SYNC');
      } else {
        mergedEdgeMap.set(outKey, {
          groupId: sourceGroup.id,
          externalNodeId: `grp:${targetGroup.id}`,
          direction: 'out',
          underlyingEdgeIds: [edge.id],
          memberLabels: [nodeLabelMap.get(edge.source) ?? edge.source],
          memberProtocols: [edge.data?.protocol ?? 'SYNC'],
        });
      }
      continue;
    }

    // Neither endpoint in a collapsed group → pass through
    resultEdges.push(edge);
  }

  // Convert merged edge map to actual edges
  for (const [key, data] of mergedEdgeMap) {
    const mergedData: MergedBoundaryEdgeData = {
      underlyingEdgeIds: data.underlyingEdgeIds,
      underlyingCount: data.underlyingEdgeIds.length,
      memberLabels: data.memberLabels,
      memberProtocols: data.memberProtocols,
    };
    const groupNodeId = `grp:${data.groupId}`;
    resultEdges.push({
      id: key,
      source: data.direction === 'out' ? groupNodeId : data.externalNodeId,
      target: data.direction === 'out' ? data.externalNodeId : groupNodeId,
      type: MERGED_BOUNDARY_EDGE_TYPE,
      data: mergedData as unknown as AnalysysEdge['data'],
    } as AnalysysEdge);
  }

  return { nodes: [...resultNodes, ...frameNodes], edges: resultEdges };
}
