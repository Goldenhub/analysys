import { useEffect } from 'react';

// ─── NodeContextMenu ─────────────────────────────────────────────
// Right-click menu for a canvas node: opens the details panel or deletes the node.
// Rendered as a fixed overlay at the cursor, clamped to the viewport.

interface NodeContextMenuProps {
  nodeId: string;
  x: number;
  y: number;
  onDetails: (nodeId: string) => void;
  onDelete: (nodeId: string) => void;
  onClose: () => void;
}

const MENU_WIDTH = 160;
const MENU_HEIGHT = 76;
const EDGE_MARGIN = 8;

export function NodeContextMenu({ nodeId, x, y, onDetails, onDelete, onClose }: NodeContextMenuProps) {
  // Escape closes the menu (matching the config panel's Escape behavior).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const left = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - MENU_WIDTH - EDGE_MARGIN));
  const top = Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - MENU_HEIGHT - EDGE_MARGIN));

  const itemClass =
    'flex w-full items-center gap-2 px-4 py-2 text-left text-xs font-medium text-[#211e1a] transition-colors hover:bg-[#b8402e]/10';

  return (
    <>
      {/* Backdrop: a click or right-click anywhere else dismisses the menu. */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div
        role="menu"
        aria-label="Node menu"
        className="fixed z-50 overflow-hidden rounded-lg border border-[#5b5347]/20 bg-[#fffaf2] py-1 shadow-xl"
        style={{ left, top, width: MENU_WIDTH }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <button type="button" role="menuitem" className={itemClass} onClick={() => onDetails(nodeId)}>
          <span className="text-[#b8402e]">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4m0 4h.01M21.7 12a9.7 9.7 0 1 1-19.4 0 9.7 9.7 0 0 1 19.4 0Z" />
            </svg>
          </span>
          Details
        </button>
        <button type="button" role="menuitem" className={itemClass} onClick={() => onDelete(nodeId)}>
          <span className="text-[#8b2e1e]">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m19 7-.9 12.1a2 2 0 0 1-2 1.9H7.9a2 2 0 0 1-2-1.9L5 7m5 4v6m4-6v6M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3M4 7h16" />
            </svg>
          </span>
          Delete
        </button>
      </div>
    </>
  );
}