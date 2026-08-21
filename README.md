# Analysys — Architecture Simulator

Interactive distributed-systems architecture simulator. Design, validate, and stress-test system topologies directly in the browser using a visual drag-and-drop canvas.

## Features

- **Visual Canvas** — Drag-and-drop node placement with React Flow. Connect components via sync/async edges.
- **6 Node Types** — Traffic Generator, Load Balancer, App Server, Cache, Database, Message Queue.
- **Discrete-Event Simulation** — Web Worker engine processes events off-main-thread with deterministic PRNG.
- **Real-Time Telemetry** — Latency percentiles, throughput, queue depths, and Little's Law stability via Recharts dashboards.
- **Chaos Engineering** — Inject cache flushes, DB drops, and traffic spikes mid-simulation.
- **Presets** — Built-in scenarios (DB Exhaustion, Queue Backpressure, Cache Stampede) with chaos timelines.
- **Persistence** — Save/load topologies to localStorage or export/import `.analysys.json` files.
- **Accessibility** — Full keyboard navigation, ARIA live regions, screen reader support.
- **Dark Mode** — Tailwind dark theme with consistent color palette.

## Quick Start

```bash
# Clone and install
git clone <repo-url> analysys
cd analysys
npm install

# Development server
npm run dev

# Run tests
npm test

# Production build
npm run build
npm run preview
```

### Requirements

- Node.js 20+
- npm 10+

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Main Thread                                                     │
│                                                                   │
│  ┌─────────┐   ┌──────────┐   ┌──────────────┐                 │
│  │ React   │◄──│ Zustand  │◄──│ Worker Msgs  │                 │
│  │ UI      │   │ Stores   │──►│ (postMessage)│                 │
│  └─────────┘   └──────────┘   └──────┬───────┘                 │
│       │                               │                          │
│  Canvas │ Config │ Telemetry          │                          │
└────────┼────────┼──────────────────────┼─────────────────────────┘
         │        │                      │
         ▼        ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│  Web Worker (simulation.worker.ts)                               │
│                                                                   │
│  ┌───────────────┐   ┌───────────┐   ┌────────────────────┐    │
│  │ EventQueue    │──►│ Engine    │──►│ Processors          │    │
│  │ (min-heap)    │   │ (loop)    │   │ (per node type)     │    │
│  └───────────────┘   └───────────┘   └────────────────────┘    │
│                              │                                    │
│                              ▼                                    │
│                       ┌─────────────┐                            │
│                       │ Metrics     │                            │
│                       │ Collector   │                            │
│                       └─────────────┘                            │
└─────────────────────────────────────────────────────────────────┘
```

### Key Directories

| Path | Purpose |
|------|---------|
| `src/types/` | Shared TypeScript types (nodes, edges, messages, metrics) |
| `src/store/` | Zustand stores (topology, simulation, persistence) |
| `src/simulation/` | Engine, event queue, PRNG, processors, metrics |
| `src/components/canvas/` | React Flow canvas, node components, edge components |
| `src/components/controls/` | Toolbar, chaos panel, persistence controls |
| `src/components/telemetry/` | Charts, gauges, event log |
| `src/components/config/` | Node configuration panel |
| `src/validation/` | Edge validation, cycle detection, config validation |
| `src/presets/` | Built-in scenario JSON files |

### Tech Stack

- **Vite** — Build tool
- **React 19** — UI framework
- **TypeScript** — Type safety
- **React Flow** — Canvas/graph library
- **Zustand** — State management
- **Recharts** — Charts/telemetry
- **Tailwind CSS 4** — Styling
- **Web Workers** — Off-main-thread simulation
- **Vitest** — Testing

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server |
| `npm run build` | Type-check + production build |
| `npm test` | Run all tests (Vitest) |
| `npm run lint` | Run oxlint + eslint |
| `npm run format` | Format code with Prettier |
| `npm run preview` | Preview production build |

## `.analysys.json` File Schema

Topology files use the following JSON schema for import/export:

```json
{
  "schemaVersion": 1,
  "name": "My Topology",
  "createdAt": "2024-01-01T00:00:00.000Z",
  "topology": {
    "nodes": [
      {
        "id": "unique-uuid",
        "nodeType": "TRAFFIC_GENERATOR | LOAD_BALANCER | APP_SERVER | CACHE | DATABASE | MESSAGE_QUEUE",
        "label": "Display Name",
        "position": { "x": 0, "y": 0 },
        "config": { /* type-specific configuration */ }
      }
    ],
    "edges": [
      {
        "id": "unique-uuid",
        "source": "source-node-id",
        "target": "target-node-id",
        "protocol": "SYNC | ASYNC"
      }
    ]
  }
}
```

### Node Config Schemas

**TrafficGenerator**: `{ rps, distribution: "POISSON"|"UNIFORM", spikeMultiplier, spikeDurationSec }`

**LoadBalancer**: `{ algorithm: "ROUND_ROBIN"|"LEAST_CONNECTIONS", healthCheckIntervalMs, evictionThreshold }`

**AppServer**: `{ workerThreadPoolSize, requestQueueDepth, processingTimeMeanMs, processingTimeStdDevMs }`

**Cache**: `{ hitRatio, evictionPolicy: "LRU"|"LFU"|"TTL", accessLatencyMs }`

**Database**: `{ connectionPoolSize, queryLatencyMeanMs, queryLatencyStdDevMs, lockTimeoutMs, dbType: "RELATIONAL"|"NOSQL" }`

**MessageQueue**: `{ consumerBatchSize, bufferCapacity, backpressureThresholdPct, backpressureStrategy: "DROP_OLDEST"|"BLOCK_PRODUCER"|"REJECT_NEW" }`

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make your changes and add tests
4. Run `npm test && npm run lint && npm run build`
5. Submit a pull request

## License

MIT
