import type { SimulationNode } from '@/types/nodes';
import type { EdgeData } from '@/types/edges';

/**
 * Detects cycles in the topology graph using iterative DFS.
 * Returns an array of node ID arrays representing each cycle found.
 * Empty array = acyclic graph.
 */
export function detectCycles(
  nodes: SimulationNode[],
  edges: EdgeData[],
): string[][] {
  // Build adjacency list
  const adjacency = new Map<string, string[]>();
  for (const node of nodes) {
    adjacency.set(node.id, []);
  }
  for (const edge of edges) {
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visited = new Set<string>();
  const cycles: string[][] = [];

  for (const node of nodes) {
    if (visited.has(node.id)) continue;

    // Iterative DFS with explicit recursion stack tracking
    const recStack = new Set<string>();
    const parentMap = new Map<string, string | null>();
    const stack: { nodeId: string; neighborIndex: number }[] = [];

    stack.push({ nodeId: node.id, neighborIndex: 0 });
    recStack.add(node.id);
    parentMap.set(node.id, null);

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const neighbors = adjacency.get(frame.nodeId) ?? [];

      if (frame.neighborIndex < neighbors.length) {
        const neighbor = neighbors[frame.neighborIndex]!;
        frame.neighborIndex++;

        if (recStack.has(neighbor)) {
          // Found a cycle — reconstruct the path from neighbor back to neighbor
          const cyclePath: string[] = [neighbor];
          for (let i = stack.length - 1; i >= 0; i--) {
            cyclePath.push(stack[i]!.nodeId);
            if (stack[i]!.nodeId === neighbor) break;
          }
          cyclePath.reverse();
          cycles.push(cyclePath);
        } else if (!visited.has(neighbor)) {
          stack.push({ nodeId: neighbor, neighborIndex: 0 });
          recStack.add(neighbor);
        }
      } else {
        // Backtrack
        stack.pop();
        recStack.delete(frame.nodeId);
        visited.add(frame.nodeId);
      }
    }
  }

  return cycles;
}
