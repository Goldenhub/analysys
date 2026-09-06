import type { NodeRendererProps } from '../CanvasEngine';
import { EditableLabel } from '../EditableLabel';
import type { SectionNodeData } from '../types';

// ─── Section Node ────────────────────────────────────────────────
// A visual-only container rectangle with a label. Nodes remain independent and can be
// dragged/positioned freely on top; sections do not participate in the simulation.

export function SectionNode(props: NodeRendererProps) {
  const data = props.data as SectionNodeData;
  return (
    <div className="relative h-full w-full" aria-label={`Section: ${data.label}`}>
      {/* Section line + frame */}
      <div
        className={`absolute inset-0 overflow-hidden rounded-xl border-2 ${
          props.selected
            ? 'border-[#b8402e] bg-[#5b5347]/10'
            : 'border-[#5b5347]/30 bg-[#5b5347]/5'
        }`}
      >
        {/* Top accent bar */}
        <div className="h-1.5 w-full bg-[#b8402e]/70" />
        <div className="absolute left-3 top-1.5 right-3 flex items-center">
          <EditableLabel
            value={data.label}
            className="text-xs font-semibold uppercase tracking-widest text-[#211e1a]"
            onCommit={(next) => props.onEdit(props.id, { label: next })}
          />
        </div>
      </div>
    </div>
  );
}
