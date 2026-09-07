import { useRef, useCallback, useState } from 'react';
import type { NodeRendererProps } from '../CanvasEngine';
import type { TextNoteNodeData } from '../types';

// ─── Text Note Node ──────────────────────────────────────────────
// A visual-only note: borderless stylized text with a blinking cursor.
// Click/drag the empty area to move it (typing inside the textarea is reserved for
// text). When selected OR the field has focus, a dashed border marks the resizable
// region and reveals the corner handle plus color swatches, so a note can be
// resized/restyled without losing the ability to keep typing.

const NOTE_COLORS = ['#211e1a', '#b8402e', '#8b2e1e', '#6b8f71', '#c49a3c', '#2d5f8a'];

export function TextNoteNode(props: NodeRendererProps) {
  const data = props.data as TextNoteNodeData;
  const start = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  const [focused, setFocused] = useState(false);

  const onResizeStart = useCallback(
    (e: React.PointerEvent) => {
      e.stopPropagation();
      start.current = {
        x: e.clientX,
        y: e.clientY,
        w: data.width,
        h: data.height,
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    [data.width, data.height],
  );

  const onResizeMove = useCallback(
    (e: React.PointerEvent) => {
      if (!start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      const w = Math.max(120, start.current.w + dx);
      const h = Math.max(80, start.current.h + dy);
      props.onEdit(props.id, { width: Math.round(w), height: Math.round(h) });
    },
    [props, start],
  );

  const onResizeEnd = useCallback(() => {
    start.current = null;
  }, []);

  return (
    <div
      className={`relative h-full w-full rounded-lg border-2 border-dashed p-3 transition-colors ${
        props.selected || focused ? 'border-[#b8402e]/70' : 'border-transparent'
      }`}
      aria-label="Text note"
    >
      <textarea
        value={data.text}
        onChange={(e) => props.onEdit(props.id, { text: e.target.value })}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onPointerDown={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        spellCheck={false}
        placeholder="Type a note…"
        className="h-full w-full resize-none bg-transparent font-serif text-xl italic leading-snug outline-none placeholder:italic"
        style={{ color: data.color ?? '#211e1a' }}
        aria-label="Note text"
      />

      {props.selected || focused ? (
        <>
          {/* Corner resize handle */}
          <div
            aria-label="Resize note"
            role="slider"
            onPointerDown={onResizeStart}
            onPointerMove={onResizeMove}
            onPointerUp={onResizeEnd}
            onMouseDown={(e) => e.preventDefault()}
            className="absolute -bottom-1.5 -right-1.5 h-4 w-4 cursor-nwse-resize rounded-full border border-[#211e1a]/40"
            style={{ background: '#f3ede2' }}
          />
          {/* Color swatches */}
          <div
            className="absolute -top-7 left-0 flex items-center gap-1 rounded-md border border-[#5b5347]/30 p-1"
            style={{ background: '#f3ede2' }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.preventDefault()}
          >
            {NOTE_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Note color ${c}`}
                className={`h-3.5 w-3.5 rounded-full ${data.color === c ? 'ring-1 ring-[#211e1a] ring-offset-1' : ''}`}
                style={{ background: c }}
                onPointerDown={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => {
                  e.stopPropagation();
                  props.onEdit(props.id, { color: c });
                }}
              />
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
