// ─── Health Legend ────────────────────────────────────────────────
// Small floating legend displayed on the canvas showing Green/Yellow/Red status definitions.

export function HealthLegend() {
  return (
    <div className="absolute bottom-16 left-3 z-10 rounded-lg border border-[#5b5347]/30 bg-[#5b5347]/90 px-3 py-2 shadow-lg backdrop-blur-sm">
      <span className="mb-1.5 block text-[10px] font-semibold uppercase tracking-wider text-[#f3ede2]/80">
        Node Health
      </span>
      <div className="flex flex-col gap-1">
        <LegendItem color="bg-[#6b8f71]" label="Healthy" description="Normal operation" />
        <LegendItem color="bg-[#c49a3c]" label="Degraded" description="High utilization" />
        <LegendItem color="bg-[#8b2e1e]" label="Critical" description="At capacity / errors" />
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
      <span className="text-[10px] font-medium text-[#f3ede2]/80">{label}</span>
      <span className="text-[10px] text-[#f3ede2]/70">— {description}</span>
    </div>
  );
}
