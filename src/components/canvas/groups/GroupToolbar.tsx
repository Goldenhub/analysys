import { useState, useCallback } from 'react';
import { useTopologyStore } from '@/store/topologyStore';
import type { SubsystemGroup } from '@/types/groups';

// ─── GroupToolbar ────────────────────────────────────────────────

/**
 * Toolbar offering create, rename, collapse, expand, add-to-group,
 * remove-from-group, and delete — all operable by keyboard alone.
 *
 * Permitted in Idle, Running, Paused, and Complete simulation states (R33.13).
 */
export function GroupToolbar({ selectedNodeIds }: { selectedNodeIds: string[] }) {
  const subsystemGroups = useTopologyStore((s) => s.subsystemGroups);
  const createGroup = useTopologyStore((s) => s.createGroup);
  const renameGroup = useTopologyStore((s) => s.renameGroup);
  const setGroupCollapsed = useTopologyStore((s) => s.setGroupCollapsed);
  const addNodesToGroup = useTopologyStore((s) => s.addNodesToGroup);
  const removeNodesFromGroup = useTopologyStore((s) => s.removeNodesFromGroup);
  const deleteGroup = useTopologyStore((s) => s.deleteGroup);

  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [newName, setNewName] = useState('');

  // Find which group(s) the selected nodes belong to for showing relevant actions

  const handleCreate = useCallback(() => {
    const result = createGroup(selectedNodeIds);
    if (result) {
      const msg = result.nodeLabels
        ? `${result.constraint} Conflicting nodes: ${result.nodeLabels.join(', ')}`
        : result.constraint;
      setError(msg);
    } else {
      setError(null);
    }
  }, [createGroup, selectedNodeIds]);

  const handleRenameStart = useCallback(
    (groupId: string) => {
      const group = subsystemGroups.find((g) => g.id === groupId);
      setRenaming(groupId);
      setNewName(group?.name ?? '');
      setError(null);
    },
    [subsystemGroups],
  );

  const handleRenameSubmit = useCallback(() => {
    if (!renaming) return;
    const result = renameGroup(renaming, newName);
    if (result) {
      setError(result);
    } else {
      setError(null);
      setRenaming(null);
    }
  }, [renaming, newName, renameGroup]);

  const handleCollapse = useCallback(
    (groupId: string) => {
      setGroupCollapsed(groupId, true);
      setError(null);
    },
    [setGroupCollapsed],
  );

  const handleExpand = useCallback(
    (groupId: string) => {
      setGroupCollapsed(groupId, false);
      setError(null);
    },
    [setGroupCollapsed],
  );

  const handleAddToGroup = useCallback(
    (groupId: string) => {
      // Add selected nodes that don't already belong to this group
      const group = subsystemGroups.find((g) => g.id === groupId);
      const toAdd = selectedNodeIds.filter((id) => !group?.memberNodeIds.includes(id));
      if (toAdd.length === 0) return;
      const result = addNodesToGroup(groupId, toAdd);
      if (result) {
        const msg = result.nodeLabels
          ? `${result.constraint} Conflicting nodes: ${result.nodeLabels.join(', ')}`
          : result.constraint;
        setError(msg);
      } else {
        setError(null);
      }
    },
    [addNodesToGroup, selectedNodeIds, subsystemGroups],
  );

  const handleRemoveFromGroup = useCallback(
    (groupId: string) => {
      const group = subsystemGroups.find((g) => g.id === groupId);
      const toRemove = selectedNodeIds.filter((id) => group?.memberNodeIds.includes(id));
      if (toRemove.length === 0) return;
      removeNodesFromGroup(groupId, toRemove);
      setError(null);
    },
    [removeNodesFromGroup, selectedNodeIds, subsystemGroups],
  );

  const handleDelete = useCallback(
    (groupId: string) => {
      deleteGroup(groupId);
      setError(null);
    },
    [deleteGroup],
  );

  // Determine which groups the selected nodes belong to for showing relevant actions

  return (
    <div
      className="flex flex-col gap-1 rounded-md bg-gray-800 p-2 text-xs text-gray-200 shadow-md"
      role="toolbar"
      aria-label="Subsystem grouping toolbar"
    >
      {/* Create Group */}
      <button
        onClick={handleCreate}
        disabled={selectedNodeIds.length < 2}
        className="rounded bg-indigo-700 px-2 py-1 text-white hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed focus:outline-none focus:ring-1 focus:ring-indigo-400"
        aria-label="Create group from selected nodes"
      >
        Create Group
      </button>

      {/* Per-group actions */}
      {subsystemGroups.map((group: SubsystemGroup) => (
        <div key={group.id} className="mt-1 border-t border-gray-700 pt-1">
          <div className="flex items-center gap-1 mb-0.5">
            {renaming === group.id ? (
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSubmit();
                  if (e.key === 'Escape') {
                    setRenaming(null);
                    setError(null);
                  }
                }}
                className="flex-1 rounded bg-gray-900 px-1 py-0.5 text-[10px] text-white border border-gray-600 focus:outline-none focus:border-indigo-400"
                aria-label={`New name for group ${group.name}`}
                autoFocus
              />
            ) : (
              <span className="flex-1 truncate font-medium text-[10px]">{group.name}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-0.5">
            <button
              onClick={() => handleRenameStart(group.id)}
              className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              aria-label={`Rename group ${group.name}`}
            >
              Rename
            </button>
            {group.collapsed ? (
              <button
                onClick={() => handleExpand(group.id)}
                className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label={`Expand group ${group.name}`}
              >
                Expand
              </button>
            ) : (
              <button
                onClick={() => handleCollapse(group.id)}
                className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] hover:bg-gray-600 focus:outline-none focus:ring-1 focus:ring-indigo-400"
                aria-label={`Collapse group ${group.name}`}
              >
                Collapse
              </button>
            )}
            <button
              onClick={() => handleAddToGroup(group.id)}
              disabled={selectedNodeIds.length === 0}
              className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] hover:bg-gray-600 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              aria-label={`Add selected nodes to group ${group.name}`}
            >
              Add
            </button>
            <button
              onClick={() => handleRemoveFromGroup(group.id)}
              disabled={selectedNodeIds.length === 0}
              className="rounded bg-gray-700 px-1.5 py-0.5 text-[10px] hover:bg-gray-600 disabled:opacity-40 focus:outline-none focus:ring-1 focus:ring-indigo-400"
              aria-label={`Remove selected nodes from group ${group.name}`}
            >
              Remove
            </button>
            <button
              onClick={() => handleDelete(group.id)}
              className="rounded bg-red-900/50 px-1.5 py-0.5 text-[10px] text-red-300 hover:bg-red-800/50 focus:outline-none focus:ring-1 focus:ring-red-400"
              aria-label={`Delete group ${group.name}`}
            >
              Delete
            </button>
          </div>
        </div>
      ))}

      {/* Error display */}
      {error && (
        <div
          className="mt-1 rounded bg-red-900/30 px-2 py-1 text-[10px] text-red-300 border border-red-800"
          role="alert"
        >
          {error}
        </div>
      )}
    </div>
  );
}
