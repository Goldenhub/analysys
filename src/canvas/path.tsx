// ─── Bezier Path Helpers ─────────────────────────────────────────
// Compute cubic-bezier edge paths and curve control points for edges.

export type PositionHint = 'left' | 'right' | 'top' | 'bottom';

/**
 * Compute a cubic bezier path between two anchor points given the direction each
 * side faces. Produces the same feel as React Flow's getBezierPath.
 */
export function getBezierPath(
  source: { x: number; y: number },
  target: { x: number; y: number },
  sourceDirection: PositionHint = 'right',
  targetDirection: PositionHint = 'left',
): string {
  const dx = Math.abs(source.x - target.x);
  const dy = Math.abs(source.y - target.y);
  const minHorizontal = Math.min(40, Math.max(24, dx * 0.5));
  const minVertical = Math.min(40, Math.max(24, dy * 0.5));

  let c1x = source.x;
  let c1y = source.y;
  let c2x = target.x;
  let c2y = target.y;

  const opposingDirections = [
    ['left', 'right'],
    ['right', 'left'],
    ['top', 'bottom'],
    ['bottom', 'top'],
  ].some(([a, b]) => a === sourceDirection && b === targetDirection);

  if (opposingDirections) {
    if (sourceDirection === 'left' || sourceDirection === 'right') {
      c1x += sourceDirection === 'right' ? minHorizontal : -minHorizontal;
      c2x += targetDirection === 'right' ? minHorizontal : -minHorizontal;
    } else {
      c1y += sourceDirection === 'bottom' ? minVertical : -minVertical;
      c2y += targetDirection === 'bottom' ? minVertical : -minVertical;
    }
  } else {
    const horizontal = sourceDirection === 'left' || sourceDirection === 'right';
    const sameHorizontal = sourceDirection === targetDirection;
    if (horizontal) {
      c1x += sourceDirection === 'right' ? minHorizontal : -minHorizontal;
      c2x += targetDirection === 'left' ? -minHorizontal : minHorizontal;
      if (sameHorizontal) {
        const normalize = sourceDirection === 'right' ? -1 : 1;
        const a = Math.abs(dx) * (normalize * 0.25);
        c1x += a;
        c2x += a;
      }
    } else {
      c1y += sourceDirection === 'bottom' ? minVertical : -minVertical;
      c2y += targetDirection === 'top' ? -minVertical : minVertical;
      if (sameHorizontal) {
        const normalize = sourceDirection === 'bottom' ? -1 : 1;
        const a = Math.abs(dy) * (normalize * 0.25);
        c1y += a;
        c2y += a;
      }
    }
  }

  return `M ${source.x},${source.y} C ${c1x},${c1y} ${c2x},${c2y} ${target.x},${target.y}`;
}

/** Return an SVG marker arrowhead definition. */
export function arrowMarkerDef(id: string, color: string): React.ReactElement {
  return (
    <marker
      id={id}
      viewBox="0 0 10 10"
      refX="9"
      refY="5"
      markerWidth="6"
      markerHeight="6"
      orient="auto-start-reverse"
    >
      <path d="M 0 0 L 10 5 L 0 10 z" fill={color} />
    </marker>
  );
}
