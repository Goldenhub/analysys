import { useCallback, useEffect, useRef, useState } from 'react';

// ─── EditableLabel ───────────────────────────────────────────────
// A span that renders a label and, on double-click, swaps to an inline input.
// Emits `onCommit` with the new text; empty/re-committed-unchanged values are ignored.

interface EditableLabelProps {
  value: string;
  onCommit: (next: string) => void;
  className?: string;
  /** Callback invoked when editing begins (e.g. to suppress drag behavior). */
  onEditingChange?: (editing: boolean) => void;
}

export function EditableLabel({
  value,
  onCommit,
  className,
  onEditingChange,
}: EditableLabelProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  const begin = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDraft(value);
      setEditing(true);
      onEditingChange?.(true);
    },
    [value, onEditingChange],
  );

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    onEditingChange?.(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== value) onCommit(trimmed);
  }, [draft, value, onCommit, onEditingChange]);

  const cancel = useCallback(() => {
    setEditing(false);
    onEditingChange?.(false);
    setDraft(value);
  }, [value, onEditingChange]);

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') cancel();
          e.stopPropagation();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className="w-full min-w-0 truncate rounded border border-[#b8402e] bg-[#211e1a] px-1 py-0.5 text-xs font-medium text-[#f3ede2] outline-none"
        aria-label="Rename node"
      />
    );
  }

  return (
    <span
      className={`truncate ${className ?? ''}`}
      onPointerDown={(e) => e.stopPropagation()}
      onDoubleClick={begin}
      title={value}
    >
      {value}
    </span>
  );
}
