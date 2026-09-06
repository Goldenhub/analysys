/**
 * Loading skeleton for the telemetry dashboard (Task 239).
 * Displays pulsing gray placeholder boxes before first metrics arrive.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex h-full flex-col gap-2 p-2" aria-label="Loading telemetry data">
      <p className="shrink-0 text-[10px] text-[#f3ede2]/70">
        Waiting for the first metrics window (every 500 ms of simulated time). Per-node
        throughput, latency, queues, and utilization appear here once the simulation runs.
      </p>
      <div className="flex min-h-0 flex-1 gap-2">
        {/* 2×2 Chart Grid Skeleton */}
        <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
        {/* Event Log Skeleton */}
        <div className="w-72 rounded border border-[#5b5347]/20 bg-[#5b5347] p-2">
          <div className="mb-2 h-3 w-20 animate-pulse rounded bg-[#5b5347]/60" />
          <div className="flex flex-col gap-2">
            {[85, 72, 90, 65, 78, 95].map((w, i) => (
              <div
                key={i}
                className="h-4 animate-pulse rounded bg-[#5b5347]/80"
                style={{ width: `${w}%` }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded border border-[#5b5347]/20 bg-[#5b5347] p-2">
      <div className="mb-2 h-2.5 w-24 animate-pulse rounded bg-[#5b5347]/60" />
      <div className="flex h-[calc(100%-20px)] flex-col justify-end gap-1">
        <div className="h-full animate-pulse rounded bg-[#5b5347]/80/60" />
      </div>
    </div>
  );
}
