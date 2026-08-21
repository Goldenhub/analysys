import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { SimEventLogEntry } from '@/types/messages';

// ─── Types ───────────────────────────────────────────────────────

interface EventLogProps {
  entries: SimEventLogEntry[];
}

// ─── Constants ───────────────────────────────────────────────────

const MAX_ENTRIES = 500;

const CHAOS_EVENT_TYPES = ['CHAOS_START', 'CHAOS_END'];

const EVENT_ICONS: Record<string, string> = {
  REQUEST_ARRIVAL: '→',
  REQUEST_ENQUEUE: '⏳',
  REQUEST_PROCESS: '⚙',
  REQUEST_ROUTE: '↗',
  REQUEST_COMPLETE: '✓',
  REQUEST_TIMEOUT: '⏱',
  REQUEST_DROP: '✕',
  REQUEST_LOOP_DETECTED: '↺',
  CHAOS_START: '💥',
  CHAOS_END: '🔄',
  METRICS_SNAPSHOT: '📊',
  CONSUMER_POLL: '📨',
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  REQUEST_ARRIVAL: 'Request Arrival',
  REQUEST_ENQUEUE: 'Request Enqueued',
  REQUEST_PROCESS: 'Request Processing',
  REQUEST_ROUTE: 'Request Routed',
  REQUEST_COMPLETE: 'Request Complete',
  REQUEST_TIMEOUT: 'Request Timeout',
  REQUEST_DROP: 'Request Dropped',
  REQUEST_LOOP_DETECTED: 'Loop Detected',
  CHAOS_START: 'Chaos Started',
  CHAOS_END: 'Chaos Ended',
  METRICS_SNAPSHOT: 'Metrics Snapshot',
  CONSUMER_POLL: 'Consumer Poll',
};

// ─── Helpers ─────────────────────────────────────────────────────

function formatSimTime(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const millis = ms % 1000;
  return `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(millis).padStart(3, '0')}`;
}

// ─── Component ───────────────────────────────────────────────────

export function EventLog({ entries }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [nodeFilter, setNodeFilter] = useState<string>('ALL');
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  // Limit to last 500 entries
  const limitedEntries = useMemo(
    () => entries.slice(-MAX_ENTRIES),
    [entries],
  );

  // Get unique event types and node IDs for filters
  const eventTypes = useMemo(() => {
    const types = new Set(limitedEntries.map((e) => e.type));
    return Array.from(types).sort();
  }, [limitedEntries]);

  const nodeIds = useMemo(() => {
    const ids = new Set(limitedEntries.map((e) => e.nodeId));
    return Array.from(ids).sort();
  }, [limitedEntries]);

  // Apply filters
  const filteredEntries = useMemo(() => {
    return limitedEntries.filter((entry) => {
      if (typeFilter !== 'ALL' && entry.type !== typeFilter) return false;
      if (nodeFilter !== 'ALL' && entry.nodeId !== nodeFilter) return false;
      return true;
    });
  }, [limitedEntries, typeFilter, nodeFilter]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [filteredEntries, autoScroll]);

  // Detect user scroll to disable auto-scroll
  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isNearBottom = scrollHeight - scrollTop - clientHeight < 40;
    setAutoScroll(isNearBottom);
  }, []);

  if (entries.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-gray-500">
        No events yet
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter Controls */}
      <div className="flex items-center gap-2 border-b border-gray-700 px-2 py-1.5">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by event type"
        >
          <option value="ALL">All Types</option>
          {eventTypes.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
        <select
          value={nodeFilter}
          onChange={(e) => setNodeFilter(e.target.value)}
          className="rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 text-[10px] text-gray-300 focus:outline-none focus:ring-1 focus:ring-blue-500"
          aria-label="Filter by node"
        >
          <option value="ALL">All Nodes</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {id.slice(0, 8)}…
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-gray-500">
          {filteredEntries.length} events
        </span>
      </div>

      {/* Scrollable Log */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto"
        role="log"
        aria-live="polite"
        aria-label="Simulation event log"
      >
        {filteredEntries.map((entry) => {
          const isChaos = CHAOS_EVENT_TYPES.includes(entry.type);
          const isExpanded = selectedEntryId === entry.id;
          return (
            <div
              key={entry.id}
              className={`border-b border-gray-800 px-2 py-1 text-[10px] cursor-pointer ${
                isChaos
                  ? 'bg-red-950/30 border-red-900/30'
                  : 'hover:bg-gray-800/50'
              } ${isExpanded ? 'bg-gray-800/70' : ''}`}
              onClick={() => setSelectedEntryId(isExpanded ? null : entry.id)}
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedEntryId(isExpanded ? null : entry.id);
                }
              }}
            >
              <div className="flex items-start gap-1.5">
                <span className="shrink-0 font-mono text-gray-500">
                  {formatSimTime(entry.timestamp)}
                </span>
                <span className="shrink-0 w-4 text-center">
                  {EVENT_ICONS[entry.type] ?? '•'}
                </span>
                <span className="shrink-0 font-mono text-blue-400">
                  {entry.nodeId.slice(0, 6)}
                </span>
                <span className={isExpanded ? 'text-gray-300' : 'truncate text-gray-300'}>
                  {entry.message}
                </span>
              </div>
              {isExpanded && (
                <div className="mt-1 ml-6 space-y-0.5 text-[10px] text-gray-400 border-l-2 border-gray-700 pl-2">
                  <div>
                    <span className="text-gray-500">Time: </span>
                    {formatSimTime(entry.timestamp)}
                  </div>
                  <div>
                    <span className="text-gray-500">Type: </span>
                    {EVENT_TYPE_LABELS[entry.type] ?? entry.type}
                  </div>
                  <div>
                    <span className="text-gray-500">Node: </span>
                    <span className="font-mono">{entry.nodeId}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Message: </span>
                    {entry.message}
                  </div>
                  {entry.requestId && (
                    <div>
                      <span className="text-gray-500">Request: </span>
                      <span className="font-mono">{entry.requestId}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="border-t border-gray-700 bg-gray-800 px-2 py-1 text-[10px] text-blue-400 hover:bg-gray-700"
        >
          ↓ Scroll to latest
        </button>
      )}
    </div>
  );
}
