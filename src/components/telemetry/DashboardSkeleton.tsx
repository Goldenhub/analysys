/**
 * Loading skeleton for the telemetry dashboard (Task 239).
 * Displays pulsing gray placeholder boxes before first metrics arrive.
 */
export function DashboardSkeleton() {
  return (
    <div className="flex h-full gap-2 p-2" aria-label="Loading telemetry data">
      {/* 2×2 Chart Grid Skeleton */}
      <div className="grid flex-1 grid-cols-2 grid-rows-2 gap-2">
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
        <SkeletonCard />
      </div>
      {/* Event Log Skeleton */}
      <div className="w-72 rounded border border-gray-800 bg-gray-900 p-2">
        <div className="mb-2 h-3 w-20 animate-pulse rounded bg-gray-700" />
        <div className="flex flex-col gap-2">
          {[85, 72, 90, 65, 78, 95].map((w, i) => (
            <div
              key={i}
              className="h-4 animate-pulse rounded bg-gray-800"
              style={{ width: `${w}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

function SkeletonCard() {
  return (
    <div className="rounded border border-gray-800 bg-gray-900 p-2">
      <div className="mb-2 h-2.5 w-24 animate-pulse rounded bg-gray-700" />
      <div className="flex h-[calc(100%-20px)] flex-col justify-end gap-1">
        <div className="h-full animate-pulse rounded bg-gray-800/60" />
      </div>
    </div>
  );
}
