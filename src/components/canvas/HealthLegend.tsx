// ─── Health Legend ────────────────────────────────────────────────
// Small floating legend displayed on the canvas showing Green/Yellow/Red status definitions.

export function HealthLegend() {
  return (
    <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-gray-700 bg-gray-900/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-gray-400">
        Node Health
      </span>
      <div className="flex flex-col gap-1">
        <LegendItem color="bg-green-400" label="Healthy" description="Normal operation" />
        <LegendItem color="bg-yellow-400" label="Degraded" description="High utilization" />
        <LegendItem color="bg-red-400" label="Critical" description="At capacity / errors" />
      </div>
    </div>
  );
}

function LegendItem({
  color,
  label,
  description,
}: {
  color: string;
  label: string;
  description: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={`h-2 w-2 rounded-full ${color}`} />
      <span className="text-[10px] font-medium text-gray-300">{label}</span>
      <span className="text-[10px] text-gray-500">— {description}</span>
    </div>
  );
}
