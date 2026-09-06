import { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import type { SimEventLogEntry } from '@/types/messages';
import { useNodeLabels } from './useNodeLabel';
import { formatSimClockMs as formatSimTime } from '@/utils/simTime';

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
  CONFIG_WARNING: '⚠️',
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
  CONFIG_WARNING: 'Config Warning',
};

// ─── Helpers ─────────────────────────────────────────────────────

// ─── Component ───────────────────────────────────────────────────

export function EventLog({ entries }: EventLogProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const labelFor = useNodeLabels();
  const [autoScroll, setAutoScroll] = useState(true);
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [nodeFilter, setNodeFilter] = useState<string>('ALL');
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  // Limit to last 500 entries
  const limitedEntries = useMemo(() => entries.slice(-MAX_ENTRIES), [entries]);

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
      <div className="flex h-full items-center justify-center px-4 text-center">
        <p className="text-xs text-[#f3ede2]/70 leading-relaxed">
          Events will appear here during simulation: timeouts, dropped requests, chaos effects, and
          sampled completions. Click any event to see details.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Filter Controls */}
      <div className="flex items-center gap-2 border-b border-[#5b5347]/30 px-2 py-1.5">
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded border border-[#5b5347]/40 bg-[#5b5347]/80 px-1.5 py-0.5 text-[10px] text-[#f3ede2]/80 focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
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
          className="rounded border border-[#5b5347]/40 bg-[#5b5347]/80 px-1.5 py-0.5 text-[10px] text-[#f3ede2]/80 focus:outline-none focus:ring-1 focus:ring-[#b8402e]"
          aria-label="Filter by node"
        >
          <option value="ALL">All Nodes</option>
          {nodeIds.map((id) => (
            <option key={id} value={id}>
              {labelFor(id)}
            </option>
          ))}
        </select>
        <span className="ml-auto text-[10px] text-[#f3ede2]/70">{filteredEntries.length} events</span>
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
              className={`border-b border-[#5b5347]/20 px-2 py-1 text-[10px] cursor-pointer ${
                isChaos ? 'bg-[#8b2e1e]/10 border-[#8b2e1e]/50/30' : 'hover:bg-[#5b5347]/70'
              } ${isExpanded ? 'bg-[#5b5347]/80/70' : ''}`}
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
                <span className="shrink-0 font-mono text-[#f3ede2]/70">
                  {formatSimTime(entry.timestamp)}
                </span>
                <span className="shrink-0 w-4 text-center">{EVENT_ICONS[entry.type] ?? '•'}</span>
                <span className="shrink-0 max-w-[70px] truncate text-[#b8402e]" title={entry.nodeId}>
                  {labelFor(entry.nodeId)}
                </span>
                <span className={isExpanded ? 'text-[#f3ede2]/80' : 'truncate text-[#f3ede2]/80'}>
                  {entry.message}
                </span>
              </div>
              {isExpanded && (
                <div className="mt-1 ml-6 space-y-0.5 text-[10px] text-[#f3ede2]/80 border-l-2 border-[#5b5347]/30 pl-2">
                  <div>
                    <span className="text-[#f3ede2]/70">Time: </span>
                    {formatSimTime(entry.timestamp)}
                  </div>
                  <div>
                    <span className="text-[#f3ede2]/70">Type: </span>
                    {EVENT_TYPE_LABELS[entry.type] ?? entry.type}
                  </div>
                  <div>
                    <span className="text-[#f3ede2]/70">Node: </span>
                    <span title={entry.nodeId}>{labelFor(entry.nodeId)}</span>
                  </div>
                  <div>
                    <span className="text-[#f3ede2]/70">Message: </span>
                    {entry.message}
                  </div>
                  {entry.requestId && (
                    <div>
                      <span className="text-[#f3ede2]/70">Request: </span>
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
          className="border-t border-[#5b5347]/30 bg-[#5b5347]/80 px-2 py-1 text-[10px] text-[#b8402e] hover:bg-[#5b5347]/60"
        >
          ↓ Scroll to latest
        </button>
      )}
    </div>
  );
}
