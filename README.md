# Analysys — Distributed-Systems Architecture Simulator

A browser-based tool for backend engineers and software architects to **model**, **simulate**, and **analyse** complete backend systems. Build a topology, run a discrete-event simulation, and get evidence-backed findings that name the constraint, the evidence, the recommended change, and its tradeoff — so you can make technical decisions from the output rather than from intuition.

---

## About This Project

Analysys is a self-contained, fully client-side application — no servers, no accounts, no external APIs. It ships with a comprehensive test suite: 739 tests across 44 files, including property-based tests (fast-check) exercising 27 correctness properties.

(The spec documents themselves live in the development environment and are not part of this repository.)

---

## Features

| Category | What |
|----------|------|
| **15 Node Types** | Traffic Generator, Scheduler, API Gateway, Rate Limiter, Circuit Breaker, Auth Service, Authz Service, Load Balancer, App Server, Worker Pool, Cache, Database, Object Store, Message Queue, Dead Letter Queue |
| **Routing Policies** | First, Round Robin, Weighted, Fan-Out (depth-capped at 4) |
| **Discrete-Event Simulation** | Web Worker engine, min-heap event queue with FIFO same-timestamp ordering, seeded xoshiro128** PRNG for determinism |
| **Load Balancer Health Checks** | Periodic virtual-time probes; targets ejected after `evictionThreshold` consecutive failures and restored by a passing probe |
| **Reproducible Runs** | Seed control in the toolbar — repeat a run exactly or re-roll for a fresh sample |
| **Telemetry** | Latency p50/p90/p99, throughput, error rate, queue gauges, Little's Law, per-node Activity view |
| **Analysis Engine** | 13-rule registry (+2 comparison rules) producing evidence-backed Findings: bottleneck, saturation, instability, headroom, SPOF, DLQ growth, scheduler collision, admission dominance, comparison |
| **Capacity Sweep** | Sequential step execution measuring Sustainable Load and Knee Point against a Service Objective |
| **Baseline Comparison** | Retain up to 5 runs, compare B − A with controlled/uncontrolled labelling |
| **Chaos Engineering** | Cache flush, DB drop, traffic spike, DISABLE_NODE (any type), DLQ redrive |
| **Reference Presets** | Authenticated Web API, Async Job Platform, Scheduled Batch With Live Traffic, Microservices E-Commerce (with nested admission & checkout component layers) |
| **Component Layers** | Service nodes (gateways, app servers, worker pools, auth services) drill down via their «⌄» chip into a nested layer of internals. A node with children becomes a **container** — its internals handle its traffic; queues/caches/databases/object stores stay atomic |
| **Onboarding Tour** | A 9-step guided tour on first load — spotlight highlight, step card, Next/Back/Skip/Done, arrow-key & Escape navigation — including the help icon, and replayable any time from the help panel |
| **Canvas Interactions** | Click a node to select it and open its details panel; drag repositions it without opening the panel; right-click opens a Details/Delete context menu; the «⌄» chip drills into a component layer |
| **Clear Canvas** | One-click wipe of every node, edge, and the telemetry dashboard — undoable |
| **Visual Annotations** | Sections and text notes on any layer; a selected **or focused** text note shows a dashed border with its color swatches and corner resize handle — restyle or resize it without losing the ability to type |
| **Persistence** | Schema v4 with in-memory migration from v1–v3, localStorage + JSON export/import, run settings round-tripped in the file |
| **Accessibility** | WCAG 2.1 AA, keyboard-operable Analysis Panel, severity as text labels, Critical Finding announcements |

---

## Required Setup and Configuration

### Prerequisites

| Requirement | Minimum Version |
|-------------|-----------------|
| Node.js | **22** (CI pins this; `jsdom` 30 uses `undici` which needs `webidl.util.markAsUncloneable`) |
| npm | 10+ |
| Git | 2.20+ |

### Installation

```bash
git clone git@github.com:Goldenhub/analysys.git
cd analysys
npm install
```

### Development

```bash
npm run dev          # Vite dev server at http://localhost:5173
```

### Production Build

```bash
npm run build        # TypeScript check + Vite build
npm run preview      # Serve the build locally
```

### Environment Variables

None. The application is fully client-side — no backend server, no API keys, no database.

---

## Testing Instructions

```bash
# Run all tests (739 tests across 44 files)
npm test

# Run with verbose output
npx vitest run --reporter=verbose

# Run a specific test file
npx vitest run src/simulation/engine.test.ts

# Run property-based tests only
npx vitest run src/tests/properties/

# Run integration tests (preset regression, longer timeout)
npx vitest run src/tests/integration/

# Run benchmarks
npx vitest run src/tests/benchmarks/
```

### Test Categories

| Category | Location | What it covers |
|----------|----------|----------------|
| Unit | `src/**/*.test.ts` | Processors, validators, metrics, PRNG, event queue |
| Component | `src/components/**/*.test.tsx` | React components with Testing Library |
| Property-Based | `src/tests/properties/` | 21 correctness properties via fast-check (100 runs each) |
| Integration | `src/tests/integration/` | Reference preset regression, serialization round-trips |
| Benchmarks | `src/tests/benchmarks/` | Engine throughput ≥1K events/sec, analysis ≤500ms, sweep ≤90s |

### Test Credentials

None. The application has no authentication, no external services, and no API calls.

### CI

The GitHub Actions workflow at `.github/workflows/ci.yml` runs on every push to `main` and `feat/**`:

```
install → lint → type-check → test → build
```

It uses Node 22 and caches `node_modules`.

---

## Third-Party Libraries, Frameworks, and Assets

### Runtime Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [React](https://react.dev) | 19.2 | UI framework |
| [react-dom](https://react.dev) | 19.2 | React renderer (DOM) |
| [Zustand](https://zustand-demo.pmnd.rs) | 5.0 | Lightweight state management |
| [Lucide React](https://lucide.dev) | 1.33 | Icon library |
| [class-variance-authority](https://cva.style) | 0.7 | Variant-based component styling |
| [clsx](https://github.com/lukeed/clsx) | 2.1 | Conditional className merging |
| [tailwind-merge](https://github.com/dcastil/tailwind-merge) | 3.6 | Tailwind class deduplication |
| [@fontsource-variable/geist](https://fontsource.org/fonts/geist) | 5.3 | Geist variable font |
| [@base-ui/react](https://base-ui.com) | 1.7 | Unstyled accessible primitives |
| [shadcn](https://ui.shadcn.com) | 4.18 | UI component scaffolding (CLI) |
| [tw-animate-css](https://github.com/nicholasgillespie/tw-animate-css) | 1.4 | Tailwind animation utilities |

### Development Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [Vite](https://vitejs.dev) | 8.2 | Build tool with HMR and Web Worker bundling |
| [TypeScript](https://www.typescriptlang.org) | 6.0 | Type safety |
| [Vitest](https://vitest.dev) | 4.1 | Test runner (Vite-native) |
| [@testing-library/react](https://testing-library.com) | 16.3 | Component testing |
| [fast-check](https://fast-check.dev) | 3.22 | Property-based testing |
| [jsdom](https://github.com/jsdom/jsdom) | 30.0 | DOM environment for tests |
| [ESLint](https://eslint.org) | 10.8 | Linting |
| [oxlint](https://oxc-project.github.io) | 1.75 | Fast Rust-based linter |
| [Prettier](https://prettier.io) | 3.9 | Code formatting |
| [Tailwind CSS](https://tailwindcss.com) + [@tailwindcss/postcss](https://tailwindcss.com) | 4.3 | Utility-first styling (build-time) |
| [PostCSS](https://postcss.org) + [Autoprefixer](https://github.com/postcss/autoprefixer) | 8.5 / 10.5 | CSS processing |

### APIs and External Services

None. The application is entirely client-side. Simulation runs in a Web Worker. Persistence uses `localStorage` and the File API.

### Datasets

The four reference architecture presets and three failure-mode presets (`src/presets/*.json`) are hand-authored topology definitions, not derived from external datasets.

### Assets

- **Geist font** — Variable-weight sans-serif from Vercel, loaded via `@fontsource-variable/geist`
- **Icons** — Lucide React icon set + inline SVGs for node-type icons

---

## Scripts Reference

| Script | Command | Description |
|--------|---------|-------------|
| `dev` | `vite` | Development server with HMR |
| `build` | `tsc -b && vite build` | Type-check + production build |
| `preview` | `vite preview` | Serve production build locally |
| `test` | `vitest run` | Run all tests |
| `lint` | `oxlint && eslint .` | Run both linters |
| `format` | `prettier --write .` | Format all files |
| `format:check` | `prettier --check .` | Check formatting without writing |

---

## Architecture

```
┌─────────────────────────── MAIN THREAD ───────────────────────────┐
│                                                                    │
│  React 19 + Custom Canvas + Zustand Stores                    │
│       │                                                            │
│  ┌────┴────────────┐  ┌────────────────────┐  ┌───────────────┐  │
│  │ Analysis Engine │  │ Telemetry Dashboard│  │ Analysis Panel│  │
│  │ (cooperative    │  │ (Recharts)         │  │ (Findings)    │  │
│  │  33ms slicing)  │  └────────────────────┘  └───────────────┘  │
│  └─────────────────┘                                              │
│           ▲ METRICS_BATCH                                         │
├───────────┼───────────────────────────────────────────────────────┤
│           │ postMessage                                            │
│  ┌────────┴───────────────────────────────────────────────────┐   │
│  │ WEB WORKER — Discrete-Event Simulation Engine              │   │
│  │                                                            │   │
│  │  Min-Heap PQ → Event Loop → 15 Processors → Metrics       │   │
│  │  xoshiro128** PRNG ─── Deterministic for any seed          │   │
│  └────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

- **Analysis runs on the main thread** (not the Worker) because it needs the full topology — labels, edges, and the event log — not just the engine's metric slices. Cooperative 33ms slicing keeps ≥30 fps.
- **Fan-out branches root their `path` at the dispatch node** so the parent's response traversal stays linear.
- **Component layers resolve before the event loop** — a service node with children becomes a container; its own processor is bypassed and its internals handle traffic via explicit flat edges, so container semantics never enter the engine's decisions.
- **Legacy files migrate in memory to the current schema version** — imported v1–v3 bundles are upgraded on load with warnings; the file on disk is only rewritten at the current version (v4) on the next explicit save.

---

## File Schema (v4)

```jsonc
{
  "schemaVersion": 4,
  "nodes": [
    {
      "id": "uuid",
      "nodeType": "TRAFFIC_GENERATOR | API_GATEWAY | RATE_LIMITER | LOAD_BALANCER | CIRCUIT_BREAKER | AUTH_SERVICE | AUTHZ_SERVICE | APP_SERVER | WORKER_POOL | CACHE | DATABASE | OBJECT_STORE | MESSAGE_QUEUE | DEAD_LETTER_QUEUE | SCHEDULER",
      "label": "Display Name",
      "position": { "x": 0, "y": 0 },
      "parentNodeId": "uuid | null",
      "routingPolicy": "FIRST | ROUND_ROBIN | WEIGHTED | FAN_OUT",
      "config": { /* type-specific parameters */ }
    }
  ],
  "edges": [
    {
      "id": "uuid",
      "source": "source-node-id",
      "target": "target-node-id",
      "protocol": "SYNC | ASYNC",
      "weight": 1.0
    }
  ],
  "settings": {
    "durationMs": 60000,
    "speedMultiplier": 10,
    "seed": 42
  }
}
```

- `parentNodeId` is `null` for root-canvas nodes; a non-null value nests the node inside a component layer (service nodes only).
- The optional `settings` block reproduces the exact run (duration, speed multiplier, and optional PRNG seed). Legacy v1–v3 bundles migrate to v4 with defaulted settings.
- The subsystem-group system was removed in v3 — current files carry no group data.

---

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/my-feature`)
3. Make changes and add tests
4. Run `npm test && npm run lint && npm run build`
5. Submit a pull request

---

## License

MIT
