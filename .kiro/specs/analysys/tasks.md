# Implementation Plan

#[[file:.kiro/specs/design.md]]

## Overview

This implementation plan covers the full build-out of Analysys, an interactive distributed-systems architecture simulator. The project uses Vite + React + TypeScript with React Flow for the canvas, Zustand for state management, a Web Worker simulation engine, and Recharts for telemetry dashboards. Work is organized into 28 phases progressing from scaffolding through deployment.

Phases 1 through 13 cover Requirements 1 through 22 and are complete. Phases 14 through 28 cover the complete-architecture extension of Requirements 23 through 43: six new node types with their processors, multi-target routing and fan-out, subsystem grouping, schema version 2 and its migration, the main-thread Analysis Engine and its Findings, capacity sweeps, single-point-of-failure analysis, baseline comparison, the Analysis Panel, three reference architecture presets, and the property-based tests and benchmarks that hold them all in place.

## Tasks

### Phase 1: Project Scaffolding & Core Infrastructure

### 1.1 Initialize Project

- [x] 1. Scaffold Vite + React + TypeScript project (`npm create vite@latest . -- --template react-ts`).
- [x] 2. Install core dependencies: `@xyflow/react`, `zustand`, `recharts`, `tailwindcss`, `postcss`, `autoprefixer`.
- [x] 3. Install shadcn/ui CLI and initialize (`npx shadcn-ui@latest init`); configure Tailwind content paths.
- [x] 4. Install dev dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `prettier`.
- [x] 5. Configure `vite.config.ts`: enable Web Worker bundling (`import.meta.glob` / `new Worker(new URL(...))`).
- [x] 6. Configure `tsconfig.json`: strict mode, path aliases (`@/` → `src/`), `lib: ["ES2022", "WebWorker"]`.
- [x] 7. Create `.eslintrc.cjs` and `.prettierrc` with consistent formatting rules.
- [x] 8. Verify `npm run dev`, `npm run build`, and `npm run test` all execute successfully.

### 1.2 Directory Structure

- [x] 9. Create `src/types/` directory with empty barrel files: `nodes.ts`, `edges.ts`, `messages.ts`, `metrics.ts`.
- [x] 10. Create `src/simulation/` directory with placeholder files per design §7.
- [x] 11. Create `src/components/` subdirectories: `canvas/`, `canvas/nodes/`, `canvas/edges/`, `config/`, `controls/`, `telemetry/`, `presets/`.
- [x] 12. Create `src/store/`, `src/validation/`, `src/presets/`, `src/utils/` directories.
- [x] 13. Add `src/main.tsx` → `App.tsx` base layout with placeholder panels (sidebar, canvas, dashboard).

---

### Phase 2: Type Definitions & Shared Contracts

### 2.1 Node Types (`src/types/nodes.ts`)

- [x] 14. Define `NodeType` enum (6 values).
- [x] 15. Define `Distribution`, `LBAlgorithm`, `EvictionPolicy`, `DatabaseType`, `BackpressureStrategy` enums.
- [x] 16. Define `BaseNodeData` interface (`id`, `nodeType`, `label`, `position`).
- [x] 17. Define per-type config interfaces: `TrafficGeneratorConfig`, `LoadBalancerConfig`, `AppServerConfig`, `CacheConfig`, `DatabaseConfig`, `MessageQueueConfig`.
- [x] 18. Define composed node interfaces: `TrafficGeneratorNode`, `LoadBalancerNode`, `AppServerNode`, `CacheNode`, `DatabaseNode`, `MessageQueueNode`.
- [x] 19. Define `SimulationNode` discriminated union type.
- [x] 20. Export `AnalysysNode` type wrapping `RFNode<SimulationNode>`.

### 2.2 Edge Types (`src/types/edges.ts`)

- [x] 21. Define `EdgeProtocol` enum (`Sync`, `Async`).
- [x] 22. Define `EdgeData` interface (`id`, `source`, `target`, `protocol`).
- [x] 23. Export `AnalysysEdge` type wrapping `RFEdge<EdgeData>`.

### 2.3 Worker Protocol Types (`src/types/messages.ts`)

- [x] 24. Define `MainToWorkerMessage` discriminated union (INIT, START, PAUSE, RESUME, RESET, CHAOS_EVENT, UPDATE_CONFIG).
- [x] 25. Define `ChaosEventPayload` interface.
- [x] 26. Define `WorkerToMainMessage` discriminated union (METRICS_BATCH, NODE_STATUS, EVENT_LOG, SIM_COMPLETE, ERROR).
- [x] 27. Define `SimEventLogEntry` and `SimulationSummary` interfaces.

### 2.4 Metrics Types (`src/types/metrics.ts`)

- [x] 28. Define `PercentileStats` interface (`p50`, `p90`, `p99`).
- [x] 29. Define `LittlesLawMetrics` interface (`L`, `lambda`, `W`, `deviation`, `isStable`).
- [x] 30. Define `NodeMetricsSnapshot` interface.
- [x] 31. Define `MetricsBatchPayload` interface (with `systemWide` sub-object).

---

### Phase 3: State Management (Zustand Stores)

### 3.1 Topology Store (`src/store/topologyStore.ts`)

- [x] 32. Create Zustand store with state: `nodes: AnalysysNode[]`, `edges: AnalysysEdge[]`.
- [x] 33. Implement actions: `addNode`, `removeNode`, `updateNodePosition`, `updateNodeConfig`.
- [x] 34. Implement actions: `addEdge`, `removeEdge`, `updateEdgeProtocol`.
- [x] 35. Implement `onNodesChange` and `onEdgesChange` handlers (React Flow compatibility).
- [x] 36. Implement undo/redo stack (array of snapshots or command pattern).
- [x] 37. Implement `getTopologySnapshot()` — serializes current state for Worker INIT payload.
- [x] 38. Implement `loadTopology(nodes, edges)` — bulk-replaces canvas state.

### 3.2 Simulation Store (`src/store/simulationStore.ts`)

- [x] 39. Create Zustand store with state: `simState: SimState`, `speedMultiplier`, `metrics: MetricsBatchPayload | null`, `eventLog: SimEventLogEntry[]`, `nodeStatuses: Map<string, 'green'|'yellow'|'red'>`.
- [x] 40. Implement actions: `setSimState`, `setSpeed`, `updateMetrics`, `appendEventLog`, `setNodeStatus`, `resetMetrics`.
- [x] 41. Implement Worker lifecycle: `initWorker()`, `terminateWorker()` — manages Worker instance.
- [x] 42. Implement `sendToWorker(message: MainToWorkerMessage)` helper.
- [x] 43. Implement Worker `onmessage` handler dispatching to appropriate store actions.

### 3.3 Persistence Store (`src/store/persistenceStore.ts`)

- [x] 44. Create Zustand store with state: `savedTopologies: { name, timestamp, data }[]`.
- [x] 45. Implement `saveTopology(name)` — serializes topologyStore to localStorage.
- [x] 46. Implement `loadSavedTopology(name)` — deserializes and calls `topologyStore.loadTopology`.
- [x] 47. Implement `deleteSavedTopology(name)`.
- [x] 48. Implement `exportJSON()` — triggers file download of `.analysys.json`.
- [x] 49. Implement `importJSON(file: File)` — validates schema, migrates if needed, loads.
- [x] 50. Add schema version field (`schemaVersion: 1`) to export format.
- [x] 51. Implement size check: warn if localStorage usage exceeds 4MB.

---

### Phase 4: Interactive Node Canvas (React Flow)

### 4.1 Canvas Foundation (`src/components/canvas/CanvasEditor.tsx`)

- [x] 52. Render `<ReactFlow>` with minimap, controls, and background grid.
- [x] 53. Connect to `topologyStore` for `nodes`, `edges`, `onNodesChange`, `onEdgesChange`.
- [x] 54. Register custom node types (mapping `NodeType` enum → React components).
- [x] 55. Register custom edge types (`SyncEdge`, `AsyncEdge`).
- [x] 56. Implement `onConnect` handler that calls `validateEdgeConnection` before adding edge.
- [x] 57. Implement `onDrop` handler for palette drag-and-drop (create new node at coordinates).
- [x] 58. Implement `onDragOver` handler (allow drop).
- [x] 59. Implement node selection → open config panel.
- [x] 60. Implement keyboard shortcuts: Delete/Backspace for selected node/edge removal.
- [x] 61. Implement Ctrl+Z / Ctrl+Y for undo/redo.

### 4.2 Node Palette (`src/components/canvas/NodePalette.tsx`)

- [x] 62. Render a vertical sidebar listing all 6 node types with icons and labels.
- [x] 63. Each palette item is draggable (`draggable`, `onDragStart` sets transfer data with node type).
- [x] 64. Style with Tailwind; group by category (Sources, Compute, Storage, Messaging).
- [x] 65. Add `aria-label` and keyboard support (Enter/Space to initiate drag or place at center).

### 4.3 Custom Node Components (`src/components/canvas/nodes/`)

- [x] 66. **TrafficGeneratorNode.tsx**: Icon (antenna/signal), label, RPS display, health ring.
- [x] 67. **LoadBalancerNode.tsx**: Icon (scale/arrows), label, algorithm badge, health ring.
- [x] 68. **AppServerNode.tsx**: Icon (server), label, queue depth gauge, health ring.
- [x] 69. **CacheNode.tsx**: Icon (lightning/chip), label, hit ratio display, health ring.
- [x] 70. **DatabaseNode.tsx**: Icon (cylinder), label, connection pool gauge, health ring.
- [x] 71. **MessageQueueNode.tsx**: Icon (stack/queue), label, buffer gauge, health ring.
- [x] 72. Each node renders source/target handles at appropriate positions.
- [x] 73. Each node reads its `healthStatus` from simulationStore and applies animated color ring.
- [x] 74. Disconnected nodes display dimmed opacity or dashed border.

### 4.4 Custom Edge Components (`src/components/canvas/edges/`)

- [x] 75. **SyncEdge.tsx**: Solid line, arrowhead marker, subtle animation during simulation.
- [x] 76. **AsyncEdge.tsx**: Dashed line, arrowhead marker, animated dots along path during simulation.
- [x] 77. Both edges display protocol label on hover.

### 4.5 Node Configuration Panel (`src/components/config/NodeConfigPanel.tsx`)

- [x] 78. Render as a right sidebar that opens when a node is selected.
- [x] 79. Dynamically render form fields based on selected node's `nodeType`.
- [x] 80. **Traffic Generator form**: RPS slider/input, distribution dropdown, spike multiplier, spike duration.
- [x] 81. **Load Balancer form**: Algorithm dropdown, health-check interval, eviction threshold.
- [x] 82. **App Server form**: Thread pool size, queue depth, processing time mean/stddev.
- [x] 83. **Cache form**: Hit ratio slider, eviction policy dropdown, access latency.
- [x] 84. **Database form**: Pool size, query latency mean/stddev, lock timeout, DB type toggle.
- [x] 85. **Message Queue form**: Batch size, buffer capacity, backpressure threshold slider, strategy dropdown.
- [x] 86. Implement inline validation with error messages for out-of-range values.
- [x] 87. On valid change, dispatch `topologyStore.updateNodeConfig(nodeId, newConfig)`.
- [x] 88. If simulation is paused, also send `UPDATE_CONFIG` message to Worker.

---

### Phase 5: Validation Logic

### 5.1 Edge Validation (`src/validation/edgeValidation.ts`)

- [x] 89. Implement `validateEdgeConnection(source, target, existingEdges): ValidationResult`.
- [x] 90. Implement self-loop rejection rule.
- [x] 91. Implement duplicate-edge rejection rule.
- [x] 92. Implement `CONNECTION_RULES` compatibility matrix (per design §3.2).
- [x] 93. Implement `getValidProtocols(sourceType, targetType): EdgeProtocol[]`.
- [x] 94. Write unit tests: self-loop, duplicate, valid connection, invalid source-target pair.

### 5.2 Cycle Detection (`src/validation/cycleDetection.ts`)

- [x] 95. Implement `detectCycles(nodes, edges): string[][]` using iterative DFS.
- [x] 96. Return array of cycle paths (node ID arrays).
- [x] 97. Write unit tests: acyclic graph, simple cycle, multi-cycle, disconnected components.

### 5.3 Config Validation (`src/validation/configValidation.ts`)

- [x] 98. Implement per-type validators: `validateTrafficGeneratorConfig`, `validateLoadBalancerConfig`, etc.
- [x] 99. Each returns `{ valid: boolean; errors: { field: string; message: string }[] }`.
- [x] 100. Implement `normalizeConfig(node)` — clamps out-of-range values for imported configs (e.g., pool size 0 → 1).
- [x] 101. Write unit tests: boundary values, zero values, negative values, NaN handling.

---

### Phase 6: Simulation Engine (Web Worker)

### 6.1 Min-Heap Priority Queue (`src/simulation/eventQueue.ts`)

- [x] 102. Implement `MinHeap<T>` class with generic comparator.
- [x] 103. Methods: `insert`, `extractMin`, `peek`, `clear`, `size` getter.
- [x] 104. Verify O(log n) insert and extract with benchmark (10,000 elements < 50ms).
- [x] 105. Write unit tests: insert order, extract order, empty queue, single element.

### 6.2 Seeded PRNG (`src/simulation/prng.ts`)

- [x] 106. Implement `SeededRNG` class (xoshiro128** per design §4.2).
- [x] 107. Methods: `next()` (uniform float [0,1)), `poisson(lambda)`, `normal(mean, stdDev)`.
- [x] 108. Write unit tests: determinism (same seed → same sequence), distribution sanity (mean within 5% of expected over 10k samples).

### 6.3 Simulation Types (`src/simulation/types.ts`)

- [x] 109. Define `SimEventType` enum.
- [x] 110. Define `SimEvent` interface.
- [x] 111. Define `RequestStatus` enum.
- [x] 112. Define `SimRequest` interface.
- [x] 113. Define `SimState` enum.
- [x] 114. Define `SimulationEngineConfig` interface.
- [x] 115. Define `NodeRuntimeState` interface.
- [x] 116. Define `NodeProcessor` interface.

### 6.4 Node Processors (`src/simulation/processors/`)

- [x] 117. **TrafficGeneratorProcessor.ts**: Schedule arrivals based on RPS + distribution; handle spike multiplier via chaos.
- [x] 118. **LoadBalancerProcessor.ts**: Route to downstream AppServers via Round Robin or Least Connections; track health per target; evict unhealthy targets.
- [x] 119. **AppServerProcessor.ts**: Enqueue if queue not full (else drop); dequeue and process with latency from normal distribution; release to downstream; track pool utilization.
- [x] 120. **CacheProcessor.ts**: On arrival, sample hit/miss from `hitRatio`; if hit → respond with access latency; if miss → route to downstream DB with access latency added.
- [x] 121. **DatabaseProcessor.ts**: Acquire connection from pool (wait or timeout if exhausted); process with query latency from normal distribution; release connection.
- [x] 122. **MessageQueueProcessor.ts**: Buffer incoming message; if buffer full → apply backpressure strategy; consumer dequeues in batch sizes at configured rate.
- [x] 123. Each processor implements `onRequestArrived`, `onChaosApplied`, `onChaosReverted`, `getUtilization`.
- [x] 124. Write unit tests per processor: happy path, queue full, pool exhausted, chaos applied.

### 6.5 Metrics Collector (`src/simulation/metrics/`)

- [x] 125. **NodeMetricsAccumulator.ts**: Implement `recordArrival`, `recordDeparture`, `compute(currentTime): LittlesLawMetrics`.
- [x] 126. Implement time-weighted occupancy tracking (design §5.2).
- [x] 127. Implement sliding window pruning.
- [x] 128. **MetricsCollector.ts**: Aggregate all node accumulators; produce `MetricsBatchPayload`.
- [x] 129. Implement `computePercentiles(samples): PercentileStats` (sort + index).
- [x] 130. Implement `deriveHealthStatus(utilization, errorRate)`.
- [x] 131. Implement `computeSystemWideMetrics()`.
- [x] 132. Write unit tests: Little's Law holds within 5% for steady-state arrivals; percentile calculation correctness.

### 6.6 Simulation Engine (`src/simulation/engine.ts`)

- [x] 133. Implement `SimulationEngine` class constructor (init heap, RNG, node states, initial events).
- [x] 134. Implement `initializeNodeStates()` — creates `NodeRuntimeState` + processor instance per node.
- [x] 135. Implement `scheduleInitialEvents()` — first `RequestArrival` per TrafficGenerator + first `MetricsSnapshot`.
- [x] 136. Implement `run()` — async batched event loop with `BATCH_SIZE` and `yieldToMacroTask()`.
- [x] 137. Implement `processEvent(event)` — switch/dispatch to handler per `SimEventType`.
- [x] 138. Implement `handleRequestArrival` — create request, route or NoRoute, schedule next arrival.
- [x] 139. Implement `handleRequestRoute` — hop count check, delegate to processor.
- [x] 140. Implement `handleRequestEnqueue` — add to node queue, schedule process when slot available.
- [x] 141. Implement `handleRequestProcess` — sample latency, schedule route to downstream or complete.
- [x] 142. Implement `handleRequestComplete` — mark request success, record metrics.
- [x] 143. Implement `handleRequestTimeout` — mark request timed out, release resources.
- [x] 144. Implement `handleMetricsSnapshot` — collect metrics, postMessage to main, schedule next snapshot.
- [x] 145. Implement `handleChaosEvent` — apply/revert chaos on target processor(s).
- [x] 146. Implement `pause()`, `resume(speed)`, `reset()`.
- [x] 147. Implement `postComplete()` — send `SIM_COMPLETE` with summary stats.

### 6.7 Worker Entry Point (`src/simulation/simulation.worker.ts`)

- [x] 148. Set up `self.onmessage` handler parsing `MainToWorkerMessage`.
- [x] 149. On `INIT`: instantiate `SimulationEngine` with provided config.
- [x] 150. On `START`: call `engine.run()`.
- [x] 151. On `PAUSE`: call `engine.pause()`.
- [x] 152. On `RESUME`: call `engine.resume(speed)`.
- [x] 153. On `RESET`: call `engine.reset()`.
- [x] 154. On `CHAOS_EVENT`: forward to engine's chaos handler.
- [x] 155. On `UPDATE_CONFIG`: update node config in engine state.
- [x] 156. Wrap all handlers in try/catch; post `ERROR` message on unhandled exceptions.

### 6.8 Performance Validation

- [x] 157. Write a benchmark test: 5 generators × 200 RPS → LB → 10 AppServers → Cache → DB; run 60s simulated at max speed; assert ≥ 1,000 events/sec wall-clock throughput.
- [x] 158. Write a determinism test: run identical config twice with same seed; compare final `SimulationSummary` — must be byte-identical.
- [x] 159. Profile with Chrome DevTools Worker profiler; identify and eliminate hot spots if < 1,000 events/sec.

---

### Phase 7: Simulation Controls UI

### 7.1 Simulation Toolbar (`src/components/controls/SimulationToolbar.tsx`)

- [x] 160. Render Start, Pause, Resume, Reset buttons with icons (Play, Pause, Square, Refresh).
- [x] 161. Render Speed dropdown/selector: 1x, 2x, 5x, 10x, 50x.
- [x] 162. Display current simulation time (formatted as mm:ss.ms) from metrics store.
- [x] 163. Display simulation state badge (Idle / Running / Paused / Complete).
- [x] 164. Wire buttons to `simulationStore` actions (which send Worker messages).
- [x] 165. Disable Start when already running; disable Pause when idle; etc.
- [x] 166. Add keyboard shortcuts: Space = Start/Pause toggle, R = Reset.

### 7.2 Chaos Panel (`src/components/controls/ChaosPanel.tsx`)

- [x] 167. Render 3 chaos buttons: "Flush Cache (Stampede)", "Drop DB Node (Partition)", "Spike Traffic (5× Burst)".
- [x] 168. Each button disabled when simulation is Idle or Complete.
- [x] 169. "Flush Cache" sends `CHAOS_EVENT` with type `FLUSH_CACHE`, duration 30s.
- [x] 170. "Drop DB Node" — if multiple DB nodes, show dropdown to select target; sends `DROP_DB`.
- [x] 171. "Spike Traffic" sends `SPIKE_TRAFFIC` with 5x multiplier, duration 15s.
- [x] 172. Display active chaos effects with countdown timer (simulated time remaining).
- [x] 173. Style buttons with warning colors (amber/red) using shadcn/ui `Button` variant.

---

### Phase 8: Telemetry & Metrics Dashboard

### 8.1 Dashboard Layout (`src/components/telemetry/TelemetryDashboard.tsx`)

- [x] 174. Render as a bottom or right panel (collapsible/resizable).
- [x] 175. Layout: 2×2 grid of chart areas + event log sidebar.
- [x] 176. Subscribe to `simulationStore.metrics` for data updates.
- [x] 177. Show "No data — start a simulation" placeholder when metrics are null.

### 8.2 Latency Chart (`src/components/telemetry/LatencyChart.tsx`)

- [x] 178. Render a Recharts `<LineChart>` with 3 series: p50, p90, p99 end-to-end latency.
- [x] 179. X-axis: simulated time (mm:ss). Y-axis: latency (ms).
- [x] 180. Maintain a rolling buffer of data points (last 120 snapshots).
- [x] 181. Tooltip on hover showing exact values.
- [x] 182. Support zoom (scroll wheel) and pan (drag) via Recharts brush or custom handler.
- [x] 183. Color coding: p50=blue, p90=amber, p99=red.

### 8.3 Throughput Chart (`src/components/telemetry/ThroughputChart.tsx`)

- [x] 184. Render a Recharts `<AreaChart>` with series: successful req/sec, error req/sec (stacked).
- [x] 185. X-axis: simulated time. Y-axis: requests/sec.
- [x] 186. Rolling buffer of last 120 snapshots.
- [x] 187. Color: success=green area, errors=red area.

### 8.4 Queue Depth / Connection Pool Gauges (`src/components/telemetry/QueueGauge.tsx`)

- [x] 188. Render per-node circular or linear gauge (progress bar style).
- [x] 189. Shows: current / max (e.g., "47 / 50 connections").
- [x] 190. Color transitions: green (<70%), amber (70–90%), red (>90%).
- [x] 191. Pulse animation at >90%.
- [x] 192. Render list of gauges for all relevant nodes (DB, MQ, AppServer).

### 8.5 Event Log (`src/components/telemetry/EventLog.tsx`)

- [x] 193. Render scrollable list of `SimEventLogEntry` items.
- [x] 194. Each entry shows: timestamp (sim time), icon per event type, node label, message.
- [x] 195. Auto-scroll to bottom on new entries (with user override if scrolled up).
- [x] 196. Filter controls: by event type (dropdown), by node (dropdown).
- [x] 197. Limit rendered entries (virtualized list or last 500 entries).
- [x] 198. Highlight chaos events with distinct background color.

### 8.6 Node Health Integration

- [x] 199. On `NODE_STATUS` Worker message, update `simulationStore.nodeStatuses`.
- [x] 200. Canvas node components read status from store and update their health ring color.
- [x] 201. Add CSS transition for smooth color changes (300ms ease).
- [x] 202. Render a small legend component on the canvas (Green/Yellow/Red definitions).

---

### Phase 9: Pre-Built Demo Templates (Presets)

### 9.1 Preset Data Files (`src/presets/`)

- [x] 203. **dbExhaustion.json**: Topology: 1 TrafficGenerator (500 RPS) → 1 LoadBalancer → 3 AppServers → 1 Database (pool=10). Chaos timeline: traffic ramps 2x at t=30s, 3x at t=60s.
- [x] 204. **queueBackpressure.json**: Topology: 1 TrafficGenerator (1000 RPS) → 1 MessageQueue (buffer=500, consumer batch=10) → 1 AppServer (slow: 50ms mean). No explicit chaos — natural backpressure.
- [x] 205. **cacheStampede.json**: Topology: 1 TrafficGenerator (300 RPS) → 1 LoadBalancer → 2 AppServers → 1 Cache (hit=0.95) → 1 Database (pool=20). Chaos: flush cache at t=20s for 30s.
- [x] 206. Each JSON file conforms to `.analysys.json` schema v1 (same as export format).
- [x] 207. Each includes a `chaosTimeline: { time: number; event: ChaosEventPayload }[]` field.

### 9.2 Preset Selector UI (`src/components/presets/PresetSelector.tsx`)

- [x] 208. Render a dropdown (shadcn/ui `Select`) in the toolbar with preset names + descriptions.
- [x] 209. On selection, show confirmation dialog if current canvas has unsaved changes.
- [x] 210. On confirm, call `topologyStore.loadTopology(preset.nodes, preset.edges)`.
- [x] 211. Auto-start simulation: send INIT + START with the preset's chaos timeline.
- [x] 212. Schedule chaos events from preset's `chaosTimeline` relative to simulation start.

### 9.3 Custom Scenario Save

- [x] 213. After loading and modifying a preset, user can "Save as Custom Scenario".
- [x] 214. Opens a name input dialog; saves to `persistenceStore` (localStorage).
- [x] 215. Custom scenarios appear in the preset dropdown under a "Custom" separator.

---

### Phase 10: Persistence & Import/Export

### 10.1 localStorage Persistence (`src/utils/localStorage.ts`)

- [x] 216. Define `AnalysysFileSchema` (TypeScript interface + runtime validator).
- [x] 217. Include `schemaVersion: number`, `name: string`, `createdAt: string`, `topology: { nodes, edges }`, `chaosTimeline?`.
- [x] 218. Implement `serialize(topology, name): string` — JSON.stringify with schema version.
- [x] 219. Implement `deserialize(json: string): ValidationResult & { data?: AnalysysFileSchema }`.
- [x] 220. Implement `migrateSchema(data, fromVersion): AnalysysFileSchema` — future-proof migration path.

### 10.2 Export/Import UI

- [x] 221. "Export JSON" button in toolbar — calls `persistenceStore.exportJSON()`, triggers download.
- [x] 222. "Import JSON" button — opens file picker (`.json` accept filter), reads file, validates, loads.
- [x] 223. On validation failure, display toast with error details (missing fields, unknown types, version mismatch).
- [x] 224. On success, load topology and display success toast.

### 10.3 Save/Load UI

- [x] 225. "Save" button — if unnamed, prompt for name; else overwrite existing.
- [x] 226. "Load" menu — lists saved topologies (name + date); click to load with confirmation.
- [x] 227. "Delete" option per saved topology (with confirmation).
- [x] 228. Display localStorage usage indicator (current MB / 5MB limit).

---

### Phase 11: Accessibility & Polish

### 11.1 Keyboard Navigation

- [x] 229. Tab order: Palette → Canvas → Config Panel → Toolbar → Chaos Panel → Dashboard.
- [x] 230. Canvas: Tab focuses nodes sequentially; Arrow keys move focused node; Enter opens config.
- [x] 231. Toolbar buttons focusable and operable with Enter/Space.
- [x] 232. Escape closes config panel and deselects node.

### 11.2 Screen Reader Support

- [x] 233. `aria-live="polite"` region announces simulation state changes ("Simulation started", "Paused at 00:42").
- [x] 234. `aria-live="assertive"` for chaos events ("Cache flushed — stampede active").
- [x] 235. Nodes have `aria-label` including type, label, and current health status.
- [x] 236. Charts have `aria-label` summarizing current values (updated each snapshot).

### 11.3 Visual Polish

- [x] 237. Consistent color palette via Tailwind theme (CSS variables for health colors).
- [x] 238. Dark mode support (Tailwind `dark:` variant).
- [x] 239. Loading skeleton for dashboard before first metrics arrive.
- [x] 240. Smooth panel resize animations.
- [x] 241. Responsive layout: stack panels vertically below 1280px width.

---

### Phase 12: Testing & Quality Assurance

### 12.1 Unit Tests (Vitest)

- [x] 242. `src/simulation/eventQueue.ts` — heap correctness, performance.
- [x] 243. `src/simulation/prng.ts` — determinism, distribution shape.
- [x] 244. `src/validation/edgeValidation.ts` — all rules.
- [x] 245. `src/validation/cycleDetection.ts` — acyclic, cyclic, multi-cycle.
- [x] 246. `src/validation/configValidation.ts` — boundary cases.
- [x] 247. `src/simulation/processors/*` — each processor's core logic.
- [x] 248. `src/simulation/metrics/NodeMetricsAccumulator.ts` — Little's Law correctness.
- [x] 249. `src/utils/localStorage.ts` — serialize/deserialize/migrate.

### 12.2 Component Tests (React Testing Library)

- [x] 250. `NodePalette` renders all 6 node types.
- [x] 251. `NodeConfigPanel` renders correct form fields per node type.
- [x] 252. `SimulationToolbar` button states match sim state.
- [x] 253. `ChaosPanel` buttons disabled when sim is idle.
- [x] 254. `PresetSelector` loads topology on selection.
- [x] 255. `EventLog` renders entries and auto-scrolls.

### 12.3 Integration Tests

- [x] 256. Full Worker round-trip: INIT → START → receive METRICS_BATCH → PAUSE → RESET.
- [x] 257. Chaos injection during running simulation produces expected metrics shift.
- [x] 258. Import/Export cycle: export topology → import file → canvas matches original.

### 12.4 Performance Tests

- [x] 259. PB-1: Worker throughput benchmark (≥ 1,000 events/sec).
- [x] 260. PB-4: Determinism test (10 runs, identical output).
- [x] 261. Canvas rendering benchmark: 100 nodes + 200 edges, verify ≥ 30 fps.

---

### Phase 13: Build & Deployment

### 13.1 Production Build

- [x] 262. `npm run build` produces optimized bundle; verify bundle size < 500KB gzipped (excluding preset JSONs).
- [x] 263. Web Worker is correctly code-split into a separate chunk.
- [x] 264. Verify no runtime errors in Chrome, Firefox, Edge, Safari via manual smoke test.
- [x] 265. Add `<meta>` tags, favicon, and page title ("Analysys — Architecture Simulator").

### 13.2 CI/CD (GitHub Actions)

- [x] 266. Create `.github/workflows/ci.yml`: install → lint → type-check → test → build.
- [x] 267. Fail on lint errors, type errors, or test failures.
- [x] 268. Cache `node_modules` for faster runs.
- [x] 269. Optional: deploy to GitHub Pages or Vercel on push to `main`.

### 13.3 Documentation

- [x] 270. Write `README.md` with: project overview, screenshot/GIF, quick-start instructions, architecture diagram, contributing guide.
- [x] 271. Add inline JSDoc comments to all public types and exported functions.
- [x] 272. Document the `.analysys.json` file schema (for users creating custom presets externally).

---

### Phase 14: New Node Type Surface — Types, Defaults, Validation, and Compile Integrity

> This phase widens `NodeType` from 9 to 15 members. The design's Change Surface section lists 11 exhaustive-match sites that break the moment the union grows, plus 2 sites the compiler will not catch. Every task in this phase must land together: the build is red from task 273 until task 317 and must not be left red across a phase boundary.

### 14.1 Node and Edge Type Definitions (`src/types/nodes.ts`, `src/types/edges.ts`)

- [ ] 273. Extend the existing `NodeType` enum with `AuthService`, `AuthzService`, `WorkerPool`, `DeadLetterQueue`, `ObjectStore`, and `Scheduler`, leaving the nine shipped member values byte-identical so persisted topologies keep loading.
- [ ] 274. Add the `VerificationMode`, `RetryBackoff`, `RedriveMode`, and `OverlapPolicy` enums with the string values named in the design.
- [ ] 275. Add the `RoutingPolicy` enum (`First`, `RoundRobin`, `Weighted`, `FanOut`) and a required `routingPolicy` field on `BaseNodeData` rather than on each config interface, so one engine-side resolver reads it for all fifteen types and `UPDATE_CONFIG`'s config merge cannot change routing mid-run.
- [ ] 276. Add the six config interfaces `AuthServiceConfig`, `AuthzServiceConfig`, `WorkerPoolConfig`, `DeadLetterQueueConfig`, `ObjectStoreConfig`, and `SchedulerConfig` with the exact field names and range comments from the design's Configuration Interfaces block.
- [ ] 277. Add the six composed `…Node extends BaseNodeData` interfaces and widen the `SimulationNode` discriminated union to fifteen members.
- [ ] 278. Add `weight: number` to `EdgeData` and document in that file that the edge array's serialized order is the stored index the routing policies of Requirement 32 are defined over, so persistence must preserve it.
- [ ] 279. Create `src/types/groups.ts` exporting `SubsystemGroup` (`id`, `name`, `memberNodeIds`, `collapsed`) and re-export it from `src/types/index.ts`.

### 14.2 Utilization Reading and Its Consumers (`src/types/metrics.ts`)

- [ ] 280. Add the `UtilizationReading` discriminated union (`{ kind: 'value'; value; idle }` and `{ kind: 'not-applicable'; reason }`) so an idle `0.0` is distinguishable from an absent or zero bound.
- [ ] 281. Change `NodeMetricsSnapshot.utilization` from `number` to `UtilizationReading` — a breaking change for the three consumers below, all of which must be updated in this phase.
- [ ] 282. Update `MetricsSummary.tsx` to branch on the reading's discriminant, rendering the plain-language reason in place of a percentage where the reading is `not-applicable`.
- [ ] 283. Update `QueueGauge.tsx` to branch on the discriminant and render no bar where the reading is `not-applicable`.
- [ ] 284. Update `ActivityPanel` in `NodeConfigPanel.tsx` to read the discriminant instead of comparing `snapshot.utilization === 0`, keeping the existing idle annotation for `{ kind: 'value', idle: true }` and showing the reason for `not-applicable`.
- [ ] 285. Change `deriveHealthStatus` in `MetricsCollector.ts` to accept a `UtilizationReading`, deriving health from the existing thresholds for a numeric reading and from the error rate alone for a `not-applicable` reading.

### 14.3 Default Configurations (`src/types/nodeDefaults.ts`)

- [ ] 286. Add six `createDefaultNodeData` cases using the design's defaults table (Auth_Service Local 3 ms ± 1 concurrency 64; Authz_Service 4 ms ± 1.5 one lookup; Worker_Pool concurrency 8, 200 ms ± 50, Exponential 1,000 ms base; Dead_Letter_Queue capacity 10,000 Manual; Object_Store 256 KB ± 64 at 100 MB/s; Scheduler 60,000 ms interval, 50 jobs, Skip).
- [ ] 287. Set `routingPolicy: RoutingPolicy.First` on every node `createDefaultNodeData` returns, and set `weight: 1.0` at every edge-creation site (`topologyStore.addEdge` and `CanvasEditor.onConnect`).
- [ ] 288. Write a unit test asserting every default `createDefaultNodeData` produces passes `validateNodeConfig` for all fifteen types, and that the canvas drop handler and the palette keyboard path both route through it so their defaults cannot drift.

### 14.4 Config Validation and Clamping (`src/validation/configValidation.ts`)

- [ ] 289. Add the six per-type validators (`validateAuthServiceConfig` through `validateSchedulerConfig`) checking each parameter against its range from the design's interface comments.
- [ ] 290. Add six `case` arms to `validateNodeConfig` dispatching to those validators.
- [ ] 291. Add six clamping branches to `normalizeConfig` covering every numeric parameter of the new types, including the `ObjectStoreConfig.transferQueueDepth` and `SchedulerConfig.maxDeferredTriggers` fields that the design calls out as easy to miss.
- [ ] 292. Change `normalizeConfig` to return `{ node, warnings: MigrationWarning[] }` naming the node label, parameter, imported value, and applied bound for each clamp instead of clamping silently as it does today, and update every call site.
- [ ] 293. Make the validators reject non-numeric, empty, and non-finite values with a message naming the parameter, and confirm the config panel leaves the stored configuration at its previous value on rejection.
- [ ] 294. Extend `configValidation.test.ts` with both-bound and degenerate cases per new type: hit ratio 0.0 and 1.0, `maxRetries` 0, `queueDepth` 0, `jitterMs` above `intervalMs`, `objectSizeMeanKB` at 1 and at 10,485,760.

### 14.5 Connection Rules and Protocol Overrides (`src/validation/edgeValidation.ts`)

- [ ] 295. Add the six new `CONNECTION_RULES` entries exactly as the design's Connection Rules block specifies, with `ObjectStore` holding empty `allowedTargets` as a terminal node.
- [ ] 296. Widen the four pre-existing entries that gain targets: `TrafficGenerator` → `AuthService`; `ApiGateway` → `AuthService`, `AuthzService`; `AppServer` → `AuthService`, `AuthzService`, `ObjectStore`; `MessageQueue` → `WorkerPool`.
- [ ] 297. Add the `PROTOCOL_OVERRIDES` per-pair table and make `getValidProtocols` consult it before the source type's flat `allowedProtocols`, since Requirements 30.7 and 30.8 pin protocol per pair rather than per source type.
- [ ] 298. Widen `validateEdgeConnection` to `(source, target, protocol, existingEdges, nodesById)` and add the protocol-mismatch rule whose rejection names the source type, the target type, and the protocol permitted for that pair.
- [ ] 299. Add the Worker_Pool → Dead_Letter_Queue cardinality rule: at most one such outgoing edge per Worker_Pool, several distinct Worker_Pools to the same Dead_Letter_Queue permitted, with the rejection naming the pool's label and the label of the DLQ its existing edge targets.
- [ ] 300. Update every `validateEdgeConnection` call site for the widened signature, including `CanvasEditor.onConnect` and the import path.
- [ ] 301. Apply the same validator during topology import and reject the whole file on the first violating edge, leaving the Canvas edge set and node set unmodified.
- [ ] 302. Extend the `makeNode` fixture switch in `edgeValidation.test.ts` with a config per new type and add cases for the pair table, the protocol overrides, the DLQ cardinality rule, and the exact rejection message text.

### 14.6 Terminal Statuses, Event Types, and Runtime State (`src/simulation/types.ts`)

- [ ] 303. Widen `RequestStatus` with `Unauthenticated`, `Forbidden`, `RetryExhausted`, and `DeadLettered`, and export `TERMINAL_STATUSES` (the nine, excluding `InFlight`) and the `FailureClass` enum with `Success` in no class.
- [ ] 304. Add the twelve new `SimEventType` members (`SubRequestSettled`, `VerificationComplete`, `PolicyEvaluated`, `JobAdmit`, `JobAttemptComplete`, `JobRetryReady`, `JobTimeout`, `DlqRedrive`, `TransferComplete`, `SchedulerTrigger`, `NodeDisabled`, `NodeRestored`).
- [ ] 305. Add `terminalCounts` (per window) and `cumulativeTerminalCounts` (never reset) to `NodeRuntimeState`, keeping `totalProcessed`, `totalDropped`, and `totalTimedOut` because `CircuitBreakerProcessor.downstreamErrorRate` and `deriveHealthStatus` read them.
- [ ] 306. Extend `SimRequest` with `fanOutDepth`, `emittedByNodeId`, and the branch and parent fields (`parentRequestId`, `dispatchedAtNodeId`, `dispatchedAtMs`, `settleOnAccept`, `isDiscarded`, `pendingBranchIds`, `maxBranchSettleMs`, `branchPolicy`).
- [ ] 307. Widen `NodeProcessor` so `getUtilization()` returns `UtilizationReading`, add the optional `onMetricsWindowBoundary`, `onNodeDisabled`, and `onNodeRestored` hooks, and add `resolveTargets(nodeId, request)` to `ProcessorContext`.

### 14.7 Exhaustive-Match Sites — Restoring the Build

- [ ] 308. Work through every site in this subsection before ending the phase: the type checker is the work list here, and leaving any site unhandled leaves the build red across a phase boundary. Do not silence a site with a `default:` clause — that discards the enumeration for the next node type added.
- [ ] 309. Add six `case` arms to `createProcessor` in `engine.ts` returning skeleton processors that accept a request, record arrival and departure, forward along the resolved target, and return a `not-applicable` utilization reading, with real behavior landing in Phase 16.
- [ ] 310. Add six entries to `NODE_TYPE_LABELS` in `NodeConfigPanel.tsx`.
- [ ] 311. Add six `case` arms to `NodeTypeIcon` in `NodeConfigPanel.tsx`, each returning a visually distinct SVG.
- [ ] 312. Add six entries to `UTILIZATION_NOTES` in `NodeConfigPanel.tsx`, each naming what the bounded resource is for that type per the design's Utilization mapping, and a note for `Scheduler` stating it holds no bounded resource.
- [ ] 313. Create `AuthServiceNode.tsx`, `AuthzServiceNode.tsx`, `WorkerPoolNode.tsx`, `DeadLetterQueueNode.tsx`, `ObjectStoreNode.tsx`, and `SchedulerNode.tsx` in `src/components/canvas/nodes/` with handles, health ring, and a type-appropriate headline figure, and register all six in the `nodeTypes` map in `CanvasEditor.tsx`.
- [ ] 314. Regroup `PALETTE_CATEGORIES` in `NodePalette.tsx` into the five groups Sources, Admission, Compute, Data, Messaging with all fifteen items assigned to exactly one group, each with a distinct icon and label, and every group and item reachable by keyboard alone.
- [ ] 315. Add six entries to `VALIDATION_RULES` in `NodeConfigPanel.tsx` covering every numeric parameter of the new types — this record is keyed `Record<string, …>` and is not exhaustiveness-checked, so the compiler will not flag it.
- [ ] 316. Create `AuthServiceForm.tsx`, `AuthzServiceForm.tsx`, `WorkerPoolForm.tsx`, `DeadLetterQueueForm.tsx`, `ObjectStoreForm.tsx`, and `SchedulerForm.tsx` under `src/components/config/forms/`, each rendering an editable control per parameter with its valid range shown, and wire all six into `NodeConfigPanel`'s `nodeData.nodeType === …` form dispatch chain — that chain is a guard sequence, not a `switch`, so it will not fail to compile when the union grows.
- [ ] 317. Run `npm run build` and `npm run test` and confirm zero type errors, zero lint errors, and a green suite, then grep the touched switches to confirm none acquired a `default:` clause.

---

### Phase 15: Engine Core — Routing, Fan-Out, Sub-Requests, and the Terminal Partition

### 15.1 Routing Policies (`src/simulation/routing.ts`)

- [ ] 318. Implement `resolveTargets(nodeId, request)` returning every edge to dispatch along — one edge for First, Round_Robin, and Weighted, and every outgoing edge for Fan_Out below the depth cap — and expose it on `ProcessorContext`.
- [ ] 319. Implement the First policy as the outgoing edge of lowest stored index, relying on `buildAdjacency` already preserving serialized edge order, and add a test that a save/load round trip does not change which edge a node forwards along.
- [ ] 320. Implement Round_Robin with an engine-owned `roundRobinCursors: Map<string, number>` initialised to index 0 in the constructor and in `reset()`, advanced by exactly one per forwarding decision, wrapping after the highest index, and deliberately untouched by `pause()` and `resume()`.
- [ ] 321. Implement Weighted selection with exactly one PRNG draw per forwarding decision compared against cumulative normalised weights accumulated in ascending stored index order, leaving every configured weight stored unchanged so normalisation is idempotent.
- [ ] 322. Implement the zero-or-non-finite weight-sum fallback to uniform `1/outDegree` plus a normalisation warning naming the node's user-assigned label, so no decision divides by zero and no request is terminated for want of a weight.
- [ ] 323. Replace every hard-coded `edges[0]!.target` forwarding decision in the nine shipped processors with `context.resolveTargets`, so routing state cannot diverge per processor.
- [ ] 324. Create `src/components/config/RoutingPolicyField.tsx` offering the policy select on every node type permitting two or more outgoing edges plus a per-edge weight input, showing each normalised weight to 2 decimal places alongside its configured value.
- [ ] 325. Write unit tests for routing: First stability across persistence, the Round_Robin cycle and its reset-and-pause behaviour, weighted selection at a fixed seed, weight-sum-zero fallback, and normalisation idempotence.

### 15.2 Sub-Requests and Fan-Out (`src/simulation/subRequests.ts`)

- [ ] 326. Define `SubRequestPolicy` with the three values `FanOut`, `AuthIntrospection`, and `AuthzLookup`, and implement one shared dispatch-and-settle mechanism used by all three rather than a bespoke path per node type.
- [ ] 327. Implement branch dispatch: one branch per resolved edge at a single simulated timestamp, each branch a full `SimRequest` with `path = [dispatchNodeId]`, `hopCount` copied from the parent, and `fanOutDepth` set to the parent's depth plus 1.
- [ ] 328. Count every node a branch subsequently visits as one hop against the shared `maxHops` budget, so a fan-out inside a cycle still terminates `LOOP_DETECTED`.
- [ ] 329. Implement the branch response path: a successful branch runs the existing reverse walk over its own `path`, and on reaching index 0 it emits `SubRequestSettled` at the dispatch node instead of `ResponseComplete`, which structurally prevents a branch from traversing upstream of the dispatch node.
- [ ] 330. Implement `settleOnAccept` for branches dispatched along an Asynchronous edge, settling inside `MessageQueueProcessor.onRequestArrived` at the instant the message is buffered or rejected so the parent does not wait for a consumer to drain the queue.
- [ ] 331. Implement the `SubRequestSettled` handler: accumulate `maxBranchSettleMs`, remove the branch from `pendingBranchIds`, and on the last settle add that maximum — and nothing else — to the parent's accumulated latency before resuming it.
- [ ] 332. Implement the failure mapping per `branchPolicy` (Fan_Out propagates the branch's status with the branch target's identifier, AuthIntrospection maps to `Unauthenticated`, AuthzLookup propagates the status plus the lookup target's identifier), mark every unsettled sibling `isDiscarded` under no terminal status, and break same-timestamp ties toward the branch on the lowest stored edge index.
- [ ] 333. Implement the depth cap: a request arriving at a Fan_Out node already at `fanOutDepth` 4 is forwarded along the lowest stored index alone, dispatches no branch, and produces a `fan-out-depth-limit` event log entry naming the node and the request.

### 15.3 Branch Accounting Guards (`src/simulation/engine.ts`)

- [ ] 334. Guard one: branch creation never increments `inFlightCount`, and the parent stays counted exactly once for the whole interval its branches are unsettled.
- [ ] 335. Guard two: in `handleRequestRoute`'s failure path, call `markRequestDone` only for a request with no `parentRequestId`, and schedule `SubRequestSettled` for a branch instead of decrementing.
- [ ] 336. Guard three: route a branch's termination through `metricsCollector.recordBranchTermination` for per-node aggregates only, and a parent's through the existing `recordCompletion` for system-wide plus per-node.
- [ ] 337. Write a test asserting a Fan_Out parent and all its branches contribute exactly one system-wide termination and that the time-weighted active-request figure counts each end-to-end request once.

### 15.4 Terminal Status Partition (`src/simulation/engine.ts`)

- [ ] 338. Route every terminal assignment through one engine helper that records the status and the node identifier together and asserts the request was `In_Flight`, replacing the scattered direct `request.status = …` writes.
- [ ] 339. Implement `unmarkRequestDone(requestId)` as the inverse of `markRequestDone`, deleting from `countedAsComplete`, updating the in-flight weighted sum, and incrementing `inFlightCount`, for use by Dead_Letter_Queue Redrive.
- [ ] 340. Maintain `terminalCounts` per window and `cumulativeTerminalCounts` across the run, resetting only the former at each window boundary alongside the existing counters.
- [ ] 341. Report the count of requests and Jobs still `In_Flight` on entering `Complete` as the run's unfinished count, excluded from every cumulative terminal count and from the completion-percentage denominators.
- [ ] 342. Implement the three `FailureClass` rates in terminations per second and the total error rate as the window's non-Success terminations over all nine statuses in that same window.
- [ ] 343. Create `src/components/telemetry/TerminalStatusTable.tsx` reporting each of the nine statuses with its cumulative count, its rate in terminations per second, and its percentage of terminated requests, each with a unit.
- [ ] 344. Report each such percentage as not applicable with a plain-language explanation while the sum of the nine cumulative counts is zero, rather than as `0%`.
- [ ] 345. Extend the `METRICS_BATCH` per-node payload with `terminalCounts` and `cumulativeTerminalCounts` and update `simulationStore`'s message handler.
- [ ] 346. Write a test that the nine cumulative counts sum to the number of requests and Jobs that have left the system at every metrics snapshot of a small run, not only at the end.
- [ ] 347. Write a determinism test asserting two runs at the same topology, configuration, and seed produce byte-identical `SimulationSummary` and identical per-node terminal counts with routing policies and fan-out in play.

---

### Phase 16: The Six Node Processors (Requirements 23–28)

### 16.1 Auth Service (`src/simulation/processors/AuthServiceProcessor.ts`)

- [ ] 348. Extract the `NodeProcessor` interface and `UtilizationReading` helpers into `src/simulation/processors/NodeProcessor.ts` per the design's file structure, re-exporting from `simulation/types.ts` so existing imports keep working.
- [ ] 349. **AuthServiceProcessor.ts**: implement the slot-and-queue admission path — admit while `slots.size < concurrencyLimit`, else queue in arrival order up to `queueDepth` adding each queued request's wait to its accumulated latency, else terminate `Dropped` with no verification latency added.
- [ ] 350. Draw exactly one verification latency sample per admitted request, treat a value below 0 ms as 0 ms, add it whether or not the request is later terminated, and schedule `VerificationComplete`.
- [ ] 351. Implement Local mode as completing verification with no downstream call, and Introspection mode as one token-cache test that on a miss dispatches exactly one sub-request under `SubRequestPolicy.AuthIntrospection`, keeps the verification slot occupied until it settles, counts it as one hop, and terminates `NO_ROUTE` where the node has no outgoing edge.
- [ ] 352. Apply the credential failure test after verification (and after a successful introspection settle), terminating `Unauthenticated` at that node, releasing the slot, and admitting the longest-waiting queued request; hold the PRNG draw order at verification latency, then token cache test, then credential test.

### 16.2 Authz Service (`src/simulation/processors/AuthzServiceProcessor.ts`)

- [ ] 353. **AuthzServiceProcessor.ts**: implement the same slot-and-queue shape as Auth_Service, holding the slot occupied for the whole interval including any awaited lookups.
- [ ] 354. Add one policy evaluation latency sample per admitted request clamped at 0 ms, and the policy cache hit test recorded as a cache hit when it succeeds.
- [ ] 355. On a cache miss with at least one outgoing edge, dispatch exactly `lookupsPerRequest` sub-requests at one simulated timestamp under `SubRequestPolicy.AuthzLookup`, resume only when all have settled, and add the greatest settle interval to the parent.
- [ ] 356. On a cache miss with no outgoing edge, record a lookup-unavailable evaluation counted separately from cache hits, and apply the deny test only after every lookup has settled successfully so a denied request has already paid the policy and lookup latency.
- [ ] 357. Report the per-window amplification ratio as lookup calls issued over requests admitted, as not applicable rather than zero when no request was admitted in the window.

### 16.3 Worker Pool (`src/simulation/processors/WorkerPoolProcessor.ts`)

- [ ] 358. **WorkerPoolProcessor.ts**: define `WorkerPoolState` with the three disjoint Job populations `executing`, `prefetch`, and `retryWaiting`, plus the `attempts` and `epoch` maps.
- [ ] 359. Implement admission order: first any `retryWaiting` Job whose `readyAt` has elapsed in ascending `readyAt`, then `prefetch` in ascending enqueue time, bounded by `concurrency`.
- [ ] 360. Hold retry-waiting Jobs outside `prefetch` so they count against neither `prefetchBufferDepth` nor the Job_Backlog, and add each elapsed retry delay to that Job's accumulated latency.
- [ ] 361. Append arriving Jobs to the `prefetch` tail while concurrency is full, up to `prefetchBufferDepth`.
- [ ] 362. On admission, draw a processing time independently per attempt clamped at 0 ms, occupy one slot, and schedule both `JobAttemptComplete` and `JobTimeout` carrying that attempt's `epoch`, with the timeout measured from slot occupancy and excluding prefetch wait and retry delay.
- [ ] 363. Implement the epoch check at handling time so whichever of `JobAttemptComplete` and `JobTimeout` fires first increments the epoch and the loser is discarded as stale, keeping the min-heap untouched.
- [ ] 364. Draw one failure value per attempt against `jobFailureRate`, and on failure below `maxRetries + 1` attempts **release the concurrency slot first**, then schedule `JobRetryReady` — releasing before the delay is what lets a pool with a large retry budget still make progress.
- [ ] 365. Compute the backoff delay as exactly `retryBaseDelayMs` for Fixed with no growth, and `retryBaseDelayMs * 2^(n-1)` capped at 300,000 ms for Exponential, with no jitter in either case.
- [ ] 366. On retry exhaustion, route the Job along the outgoing edge to a Dead_Letter_Queue carrying its total attempt count and this node's identifier where one exists, else terminate `Retry_Exhausted` and record an error at this node.
- [ ] 367. Report Job completion rate, concurrency utilization, Job_Backlog as upstream buffered Jobs plus `prefetch.length` excluding `executing`, Backlog_Age reported as 0 ms while the backlog is empty, retry rate, retry-exhaustion rate, and either a Drain_Time projection or a plain "not draining" statement rather than a negative or infinite figure.

### 16.4 Message Queue Backpressure (`src/simulation/processors/MessageQueueProcessor.ts`)

- [ ] 368. Add the `BackpressureAwareConsumer` interface with `admissionCapacity(): number` and implement it on `WorkerPoolProcessor` as the room left across `executing` and `prefetch`.
- [ ] 369. Revise `onConsumerPoll` to clamp its batch by the downstream consumer's `admissionCapacity()` where the consumer implements the interface and by `Number.POSITIVE_INFINITY` otherwise, leaving the undelivered remainder in the buffer bounded by that queue's configured capacity.
- [ ] 370. Reschedule the consumer poll whenever the buffer is non-empty even when the computed batch size was 0, so consumption resumes when the pool drains, and leave the existing `consumerScheduled` latch to handle the empty-buffer case.

### 16.5 Dead Letter Queue (`src/simulation/processors/DeadLetterQueueProcessor.ts`)

- [ ] 371. **DeadLetterQueueProcessor.ts**: define `RetainedMessage` and retain arriving Jobs in append order with their `retentionStartMs`, `exhaustedAtNodeId`, cumulative `attemptCount`, and `redriveAttempts`, recording the arrival as `Dead_Lettered` in error accounting.
- [ ] 372. Implement overflow at capacity by discarding index 0 of the append-ordered retained set — which is the earliest `retentionStartMs` — and logging a dead-letter-overflow event naming the node.
- [ ] 373. Implement retention expiry inside `onMetricsWindowBoundary`, called from `handleMetricsSnapshot` before the per-window counter reset, so a message cannot expire unobserved on access.
- [ ] 374. Implement Automatic redrive on the redrive interval and Manual redrive from the Chaos_Panel control, routing up to `redriveBatchSize` retained messages whose `redriveAttempts` is below `maxRedriveAttempts` in ascending retention start order, incrementing each and removing it from the retained set at the instant it is routed so an in-flight redrive is subject to neither expiry nor overflow.
- [ ] 375. On redrive, clear the Job's `Dead_Lettered` status, decrement that node's cumulative `Dead_Lettered` count, and call `engine.unmarkRequestDone` to return the Job to `In_Flight` so the nine cumulative counts still sum correctly.
- [ ] 376. Reset a redriven Job's retry attempt count to zero on arrival at a Worker_Pool while carrying `redriveAttempts` forward, and on re-retention at the same DLQ carry `redriveAttempts` forward unchanged with a fresh `retentionStartMs`.
- [ ] 377. Report retained count, fill fraction, dead-letter arrival rate, oldest-message age, retained count grouped by the upstream node identifier where exhaustion occurred, cumulative redrives, and cumulative discards separated by overflow and by expiry.

### 16.6 Object Store (`src/simulation/processors/ObjectStoreProcessor.ts`)

- [ ] 378. **ObjectStoreProcessor.ts**: define `ActiveTransfer` tracking `remainingWorkKB`, `actualSizeKB`, `lastUpdateMs`, and `epoch`, and draw per request in the fixed order read/write classification, object size, base latency.
- [ ] 379. Clamp the sampled object size to the inclusive range 1 to 10,485,760 KB before it is used in any latency computation.
- [ ] 380. Encode the write multiplier as scaled remaining *work* (`sizeKB × multiplier` for a write) rather than as a post-hoc multiplication on a computed duration, so the multiplier stays exact under repricing while the sum of active bandwidth shares still equals the configured capacity.
- [ ] 381. Implement `reprice(now)` in three steps — charge elapsed progress against each active transfer, re-divide `throughputCapacityMBps` equally among active transfers, then reschedule each `TransferComplete` from remaining work and the new share with a fresh epoch — and call it whenever a transfer begins or completes.
- [ ] 382. Add base latency plus transfer time to each request, using 1 MB = 1,024 KB and 1 second = 1,000 ms, with the base latency clamped at 0 ms and left unscaled by the write multiplier.
- [ ] 383. Hold arriving requests in the transfer queue in arrival order while `maxConcurrentTransfers` is full, adding each wait to accumulated latency, and terminate `Dropped` beyond `transferQueueDepth` recording the latency accumulated before reaching this node.
- [ ] 384. Report the aggregate transfer rate from `actualSizeKB` rather than scaled work so a write-heavy window does not over-report bytes moved, plus the rate as a fraction of capacity, active transfers, queued requests, mean transfer time, drop rate, and read and write counts, and name bandwidth as the limiting resource in the Activity view at or above 0.85 of capacity.

### 16.7 Scheduler (`src/simulation/processors/SchedulerProcessor.ts`)

- [ ] 385. **SchedulerProcessor.ts**: separate the schedule from the fire time — `scheduledTime(n) = startOffsetMs + n * intervalMs` never adjusted by anything, and `fireTime(n) = scheduledTime(n) + uniform[0, min(jitterMs, intervalMs)]` — so jitter can never accumulate as drift.
- [ ] 386. Draw trigger `n+1`'s jitter offset and schedule its `SchedulerTrigger` event when trigger `n` is handled, a fixed draw position that keeps the fire-time sequence reproducible.
- [ ] 387. Emit exactly `jobsPerTrigger` Jobs at the fire timestamp, routing each along the node's resolved targets, and set `emittedByNodeId` on every emitted Job.
- [ ] 388. Track `outstanding` Jobs per Scheduler node via an engine notification when one of its Jobs reaches a terminal status, and treat the node as a source requiring no incoming edge that terminates emitted Jobs `NO_ROUTE` immediately when it has no outgoing edge.
- [ ] 389. Implement the three overlap policies: Allow emits regardless, Skip emits nothing and logs a skipped-trigger event, and Queue appends one entry per deferred trigger in ascending trigger index up to `maxDeferredTriggers`.
- [ ] 390. Under Queue, emit exactly the earliest deferred entry when `outstanding` becomes empty, remove that one entry, retain the rest, and on a trigger firing at `maxDeferredTriggers` count a skipped trigger and log a deferred-trigger-overflow event naming the node and fire time.
- [ ] 391. On entering `Complete`, retain the count of outstanding Jobs as the node's unfinished Job count, discard every remaining deferred entry without emitting it, report both figures with the run's final metrics, and widen the existing `isSource` branch in `ActivityPanel` so a Scheduler reports latency percentiles and Little's Law figures as not applicable.

### 16.8 Integration and Smoke Coverage

- [ ] 392. Report the type-specific per-node figures of Requirements 23.9, 24.11, 25.11, 26.9, 27.10, and 28.9 through the `METRICS_BATCH` snapshot fields the design lists, each with its unit surfaced in the Activity view.
- [ ] 393. Write the Requirement 29.5 smoke test for each of the six new types: one node at default configuration wired to a default Traffic_Generator or Scheduler, run 60 simulated seconds with `disablePacing: true`, and assert no validation error, no engine error, and at least one request or Job reaching a terminal status at that node.
- [ ] 394. Run the full suite and confirm the nine shipped processors' existing tests still pass unchanged after the `resolveTargets` and `UtilizationReading` migrations.

---

### Phase 17: Subsystem Grouping (Requirement 33)

### 17.1 Store and Validation (`src/store/topologyStore.ts`, `src/validation/groupValidation.ts`)

- [ ] 395. Add `subsystemGroups: SubsystemGroup[]` to `topologyStore` with the actions `createGroup`, `renameGroup`, `setGroupCollapsed`, `addNodesToGroup`, `removeNodesFromGroup`, `deleteGroup`, and `dragGroup`.
- [ ] 396. Create `src/validation/groupValidation.ts` enforcing the partition invariants — at most 20 groups, 2 to 50 members each, membership disjoint across groups, one level deep — re-checked on every mutation with the whole operation rejected on violation.
- [ ] 397. Reject a group creation naming the violated limit together with the labels of any selected nodes already in a group, leaving every existing group and every node position unchanged.
- [ ] 398. Validate group names as 1 to 40 characters after trimming and case-insensitively unique, with an inline error naming the violated constraint and the stored name left at its previous value on rejection.
- [ ] 399. Add a membership sweep to the existing `removeNode` so deleting a node drops it from its group, and delete a group left with fewer than 2 members while every remaining node and edge stays on the Canvas at its stored position.
- [ ] 400. Implement `deleteGroup` and `removeNodesFromGroup` so every affected node and edge is retained at its stored position whether the group was collapsed or expanded.
- [ ] 401. Implement group import normalisation rather than rejection: truncate a name past 40 characters, suffix a duplicate name, drop absent and duplicated member identifiers, keep the first 50 in stored order, drop a group left with fewer than 2, and record a normalisation warning naming the group, the violation, and the applied change.

### 17.2 Derived Rendering View (`src/components/canvas/groups/`)

- [ ] 402. Implement `useCollapsedTopologyView.ts` mapping the canonical topology plus groups onto the node and edge arrays React Flow renders, deliberately not using React Flow `parentId`/`extent: 'parent'` so member positions stay absolute and collapse/expand and group deletion remain position-preserving no-ops.
- [ ] 403. For each collapsed group emit one `SUBSYSTEM_GROUP` node at the members' bounding-box centre, omit every member node, and omit every edge whose source and target are both members.
- [ ] 404. Rewrite each boundary edge's contained endpoint to the group node and merge boundary edges sharing group, external node, and direction into one edge keyed `grp:{groupId}:{in|out}:{externalNodeId}` carrying `underlyingEdgeIds`, `underlyingCount`, and `memberLabels`.
- [ ] 405. Create `SubsystemGroupNode.tsx` as the collapsed group element and register it in the `nodeTypes` map, and `MergedBoundaryEdge.tsx` displaying the underlying-edge count and listing each merged member's label and protocol on hover or activation.
- [ ] 406. Implement `dragGroup` so a drag on a collapsed group applies the displacement to every member's stored position, leaving relative positions unchanged.
- [ ] 407. Create `GroupToolbar.tsx` offering create, rename, collapse, expand, add-to-group, remove-from-group, and delete, all operable by keyboard alone and permitted in the Idle, Running, Paused, and Complete simulation states.
- [ ] 408. Confirm `getTopologySnapshot()` is unchanged and sends no group information on `INIT`, and write a test that two runs of the same topology and seed produce identical metrics across differing group sets and collapsed states.

### 17.3 Group Telemetry Rollup

- [ ] 409. Display on each collapsed group the summed member throughput, the summed member error count, and the least healthy member status under the order red, then yellow, then green, each with its unit, excluding members with no available status.
- [ ] 410. Report a collapsed group's health as not applicable with a plain-language explanation while no member has an available status.
- [ ] 411. Create `src/components/telemetry/SubsystemBreakdown.tsx` reporting per group the summed throughput, the summed error count by terminal status, the highest member Utilization among numeric readings, and the label of the member holding it — computed on the main thread from the latest `METRICS_BATCH`.
- [ ] 412. Report a group's highest Utilization as not applicable with no number and no label while every member reads `not-applicable`.

---

### Phase 18: Schema Version 2 and Migration (Requirement 34)

### 18.1 Persistence Store (`src/store/persistenceStore.ts`)

- [ ] 413. Set `CURRENT_SCHEMA_VERSION = 2` and define `SerializedTopologyV2` carrying nodes with `routingPolicy` and every Requirement 23–28 parameter, edges with `weight` in stored order, and `subsystemGroups`.
- [ ] 414. Write a record at version 2 whenever it holds a node of one of the six new types, a routing policy other than `First`, an edge weight, or a Subsystem_Group.
- [ ] 415. Define `MigrationWarning` and implement `migrateV1ToV2` as a pure function returning the new record plus the warnings to surface, replacing the current no-op `migrateIfNeeded`.
- [ ] 416. In `migrateV1ToV2`, set every node's `routingPolicy` to `First`, every edge `weight` to 1.0, `subsystemGroups` to empty, and every absent Requirement 23–28 parameter — including `transferQueueDepth` and `maxDeferredTriggers` — to its `createDefaultNodeData` value, with one warning per applied default naming the label, field, and value, and complete the import with no error.
- [ ] 417. Apply the same absent-field defaulting to a version 2 record missing a routing policy, an edge weight, the group set, or a Requirement 23–28 parameter, so an absent field of this set is defaulted rather than treated as a validation failure.
- [ ] 418. Reject an import whose `schemaVersion` is above 2, naming the record's version and the required version, and one whose `schemaVersion` is absent, non-integer, or below 1, naming that field and the value found, leaving the Canvas and every stored topology unmodified in both cases.
- [ ] 419. Load a version 1 record from localStorage by migrating the **in-memory** topology only, leaving the stored record at version 1 with its original field values and writing version 2 on the next save invoked for it, so opening a v2 build is not destructive to a v1 record.
- [ ] 420. Include every Subsystem_Group name, member node identifier list, and collapsed state in save, load, export, and import.
- [ ] 421. Write a round-trip test asserting exporting a loaded version 2 record produces a record equal to the imported one across positions, configs, routing policies, protocols, weights, and groups.

### 18.2 File Schema Validator (`src/utils/localStorage.ts`)

- [ ] 422. Replace the hard-coded `VALID_NODE_TYPES` array — which currently lists only six of the nine shipped types and would reject every new type — with `Object.values(NodeType)`.
- [ ] 423. Raise `CURRENT_SCHEMA_VERSION` to 2 in the `.analysys.json` validator and extend `AnalysysFileSchema` with `subsystemGroups` and the version 2 node and edge shapes.
- [ ] 424. Wire `migrateSchema` to `migrateV1ToV2` and surface its warnings through the existing import toast rather than discarding them.
- [ ] 425. Replace `getStorageUsage`'s `key.length + value.length` UTF-16 measurement with `new TextEncoder().encode(serialized).length`, which the current form under-reports for multi-byte content.
- [ ] 426. Complete a save above 4,194,304 bytes and retain a loadable record while displaying a warning naming the serialized size in bytes and that threshold — this is a warning, not a failure.
- [ ] 427. Extend `localStorage.test.ts` with version 2 serialize/deserialize, the v1 to v2 migration and its warning set, the above-2 and malformed version rejections, and the UTF-8 byte-length measurement.

---

### Phase 19: Analysis Aggregates in the Worker (Requirement 41.3)

### 19.1 Snapshot Aggregates (`src/simulation/metrics/analysisAggregates.ts`)

- [ ] 428. Create `analysisAggregates.ts` accumulating the per-node, per-window aggregates the analysis layer needs, so no rule ever reads a per-request record.
- [ ] 429. Accumulate `timeInSystemAtNodeMs` as the summed time-in-system that requests and Jobs terminating in this window accumulated at this node — the Latency_Share numerator.
- [ ] 430. Accumulate `pathTimeInSystemMs` as the summed time-in-system those **same** requests and Jobs accumulated across their whole recorded path — the Latency_Share denominator, which is what makes the share weighted for a node lying on several paths.
- [ ] 431. Accumulate `terminatedThroughNodeCount` as terminating requests and Jobs whose recorded path, or the path of any branch dispatched for them, held this node, folding branch paths in at the instant the terminal status is assigned while the parent still holds its lineage.
- [ ] 432. Emit `monitoredDepth` per node as Job_Backlog for a Worker_Pool, buffered messages for a Message_Queue, reported queue depth for every other type that reports one, and `null` otherwise, alongside `monitoredDepthBound`.
- [ ] 433. Compute `monitoredDepthBound` as the node's prefetch buffer depth plus the configured capacity of every Message_Queue holding an edge into it for a Worker_Pool, the configured max capacity for a Message_Queue, and the configured max queue depth for every other type.
- [ ] 434. Emit `arrivalCount` and `departureCount` per window, counting a departure for each request or Job forwarded downstream, completed at the node, or terminated at the node.
- [ ] 435. Emit the type-specific optional fields `concurrencyOccupied`, `concurrencyBound`, `jobBacklog`, `backlogAgeMs`, `retainedByUpstreamNode`, `transferRateMBps`, `forwardedByEdge`, and `branchesDispatched`.
- [ ] 436. Record each window's actual `durationMs` so a rate can be weighted by it, and mark a window with `durationMs <= 0` unavailable rather than zero — the engine emits a final snapshot before `emitComplete()` on both exit paths and that window is usually shorter than `metricsIntervalMs`.
- [ ] 437. Create `RunCumulativeAccumulator.ts` holding whole-run aggregates alongside the existing sliding 5,000 ms `completedRequests` window, so a baseline is not silently a snapshot of the last five seconds.
- [ ] 438. Write a test asserting the aggregates are window-scoped, reset at each boundary, and reproduce a hand-computed Latency_Share and Blast_Radius for a three-node topology.

---

### Phase 20: Analysis Engine Core (Requirements 35, 41)

### 20.1 Finding Model (`src/types/findings.ts`, `src/analysis/FindingBuilder.ts`)

- [ ] 439. Define `FindingCategory` with the eight values in the declaration order the design pins as both the Requirement 35.8 tie-break order and the Requirement 43.2 group order, plus `Severity` and `Confidence`.
- [ ] 440. Define `EvidenceEntry`, `RecommendedAction`, `StructuralAction`, and `Finding` with the field bounds the design states, and enforce exactly one `primary` evidence entry per Finding.
- [ ] 441. Create `src/utils/round6.ts` implementing half-up rounding at 6 decimal places with explicit handling of negatives and an assertion that the result is finite.
- [ ] 442. Implement `FindingBuilder` passing every numeric value through `round6` at construction — not at display — so two independently computed Finding sets compare equal under exact numeric comparison.
- [ ] 443. Derive the stable identifier as `${ruleId}:${category}:${sortedSubjectNodeIds.join(',')}` so it survives a label edit, recomputation within a run, and repeated runs of the same inputs.
- [ ] 444. Key the result map on that identifier so "exactly one Finding" is enforced structurally rather than by each rule remembering to check.
- [ ] 445. Enforce units in `FindingBuilder`: 1 to 20 characters, `fraction` for a dimensionless 0.0–1.0 ratio and `percent` for a value scaled to 100, and derive confidence from the lowest completed-request count among subject nodes with the High/Medium/Low boundaries and the Steady_State condition the design states.

### 20.2 Window Store (`src/analysis/AnalysisWindowStore.ts`)

- [ ] 446. Implement a ring buffer retaining the 16 most recent metrics windows plus cumulative run totals, fed from `METRICS_BATCH`.
- [ ] 447. Exclude zero-duration windows from the completed-window count so the "3 completed windows" gate is not satisfied by a degenerate final snapshot.
- [ ] 448. Implement `Steady_State` detection per node: arrival rate varying under 10% between adjacent windows across at least 3 consecutive windows with queue-depth net change within ±5% of the mean depth.
- [ ] 449. Implement `AnalysisContext` exposing `windows`, `cumulative`, `topology`, `labelOf` with the shortened-identifier fallback, `eventLog`, and the optional `serviceObjective`.

### 20.3 Slicing Scheduler (`src/analysis/AnalysisScheduler.ts`)

- [ ] 450. Implement the `AnalysisRule` interface with `id`, `category`, `requiredMetrics`, and an `evaluate(ctx): Generator<void, Finding[], void>` — a generator rather than `async`/`await` so a rule yields at a point of its own choosing instead of at every `await`.
- [ ] 451. Implement `recompute` iterating `RULE_REGISTRY`, with `SLICE_BUDGET_MS = 33` and `TOTAL_BUDGET_MS = 500`.
- [ ] 452. Implement `yieldToFrame` as a `MessageChannel` port hop rather than `setTimeout(0)`, which browsers clamp to roughly 4 ms after nested timeouts and would consume about 12% of the 500 ms budget across a full pass's yields.
- [ ] 453. On reaching 500 ms, stop at the end of the slice in progress, retain and keep displaying the previously completed Finding set, never show a partial set, and report the count and identifiers of the rules that did not complete plus the window boundary at which it stopped.
- [ ] 454. Record suppression as a first-class outcome `{ ruleId, metricName, affectedNodeLabels[] }` when a required metric is `not-applicable` or absent, emitting no Finding for the affected nodes while every other rule runs unchanged.
- [ ] 455. Drive exactly one recomputation per completed metrics window boundary while Running, none between boundaries, and exactly one more on entering `Complete` over the final analysis window.
- [ ] 456. Display no Finding below 3 completed windows and state the completed count against the 3 required, keeping that state distinguishable from a completed analysis that produced no Finding.

### 20.4 Analysis Store (`src/store/analysisStore.ts`)

- [ ] 457. Create `analysisStore` holding the current Finding set, the suppression list, sweep results, and comparison results, and subscribe the scheduler to `METRICS_BATCH` window boundaries.
- [ ] 458. Retain an imported Finding set until a subsequent run produces a recomputed set, performing no recomputation of any imported Finding.
- [ ] 459. Label a displayed imported set with the PRNG seed, simulated duration, and offered load recorded in its report.

### 20.5 Analysis Report (`src/analysis/report.ts`)

- [ ] 460. Implement JSON export carrying a report schema version, every displayed Finding with every field, the topology, every node configuration, the seed, the simulated duration, and the offered load.
- [ ] 461. Implement a Markdown export intended for reading, and accept only the JSON format for import.
- [ ] 462. Implement JSON import displaying every carried Finding with field values equal to the exported values, in the Requirement 35.8 display order.
- [ ] 463. Reject an import carrying an unsupported report schema version, omitting a required Finding field, or carrying an out-of-set category, severity, or confidence, naming the required version and each omitted field or unrecognised value, and leave the currently displayed Findings unchanged.
- [ ] 464. Write a round-trip test asserting export then import yields a Finding set equal to the original.

---

### Phase 21: Analysis Rules (Requirements 31.9, 36, 37, 38.1–38.6)

### 21.1 Bottleneck Rules (`src/analysis/rules/bottleneck.ts`)

- [ ] 465. Implement `analysisUtilization` as the arithmetic mean of a node's per-window numeric utilization over the 3 most recently completed windows, and `latencyShare` as `timeInSystemAtNodeMs / pathTimeInSystemMs × 100` reported as not applicable while the divisor is 0 ms.
- [ ] 466. Implement the ranking total order — descending analysis Utilization, values within 0.001 tie-broken by descending Latency_Share, then descending throughput, then ascending node identifier — and expose it in the panel.
- [ ] 467. Implement `bottleneckRankRule` designating exactly one node per recomputation (highest analysis Utilization at or above 0.85, else greatest Latency_Share), naming the bounding configuration parameter and its configured value with unit, carrying the six evidence entries the design lists including which selection rule fired, and stating that reducing that node's contribution to 0 ms reduces end-to-end p99 by at most its Latency_Share percent.
- [ ] 468. Implement eligibility as a numeric utilization reading plus at least 1 arrival in the window, keeping a node eligible at 0 throughput, listing every excluded node with its reason, and setting confidence Low with the completed-request count stated where the designated node recorded fewer than 30 completions.
- [ ] 469. Implement `bottleneckCoLimitingRule` for other eligible nodes within 0.05 of a saturated Bottleneck, and `bottleneckNoConstraintRule` emitting one Info Finding where every applicable node is below 0.60 with no Instability.
- [ ] 470. Implement `bottleneckNoneEligibleRule` emitting one Info Finding naming the count excluded for a not-applicable utilization and the count excluded for zero arrivals, and write tests for all four rules including the single-designation and tie-break behaviour.

### 21.2 Saturation and Instability (`src/analysis/rules/saturation.ts`, `instability.ts`)

- [ ] 471. Implement `saturationRule` for a node at or above 0.85 in each of the 3 most recent windows, reporting sustained Utilization as the mean over the **maximal** run of consecutive windows at or above 0.85 ending at the most recent one, which may be longer than 3.
- [ ] 472. Implement `instabilityDepthGrowthRule` inspecting 5 windows: monitored depth increasing at each of the 4 most recent boundaries **and** the newest value exceeding the oldest by at least 20% of the oldest — the 20% floor is what stops a slow sawtooth being reported as unbounded growth.
- [ ] 473. Compute the growth rate and the projected time to the monitored depth bound, stating the projection holds while that growth rate continues, and report the projection as not applicable with a plain-language reason where the growth rate is at or below 0 items/s or no bound is available.
- [ ] 474. Implement the precedence rule: where a node satisfies both Saturation and Instability in one recomputation, emit only the Instability Finding with the sustained Utilization folded into its evidence.
- [ ] 475. Implement `instabilityLittlesLawRule` for a node exceeding 5% deviation in each of the 3 most recent windows, suppressing every `Capacity` Finding for that node, reporting which analysis was suppressed and for which node, and continuing to report per-node and system Headroom annotated as measured outside Steady_State.
- [ ] 476. Write tests for the run-length reporting, the 20% floor boundary, the not-applicable projection, and the Saturation-versus-Instability precedence.

### 21.3 Reliability, Capacity, and Configuration Rules

- [ ] 477. Implement `dlqGrowthRule` in `src/analysis/rules/reliability.ts` for a Dead_Letter_Queue whose retained count rose at each of the 3 most recent boundaries, with the per-upstream-node attribution as evidence and a tradeoff naming the added slot occupancy at that upstream node.
- [ ] 478. Implement `workerPoolConcurrencyRule` in `src/analysis/rules/capacity.ts` computing required concurrency as arrival rate times mean processing time in seconds rounded up, naming the configured concurrency and the 10,000 maximum where the computed value exceeds it, gated on at least 1 completed attempt in the window span.
- [ ] 479. Implement `schedulerCollisionRule` in `src/analysis/rules/configuration.ts` for pairs of Scheduler nodes with 2 or more consecutive coinciding trigger indices within 1,000 simulated ms, reading trigger fire times from the event log.
- [ ] 480. Implement `admissionDominatesRule` in `reliability.ts` requiring the admission rate to exceed the capacity-or-reliability rate by at least 20% in each of 3 windows with at least 30 non-Success terminations across them, so no rule fires from an empty denominator.
- [ ] 481. Write tests for each rule's minimum-sample gate, confirming suppression rather than a Finding computed from zero observations.

### 21.4 Headroom (`src/analysis/rules/headroom.ts`)

- [ ] 482. Report per-node Headroom as `(1 - analysisUtilization) * 100` with the bounding parameter name and its configured value and unit.
- [ ] 483. Report Headroom as not applicable with a plain-language reason for a node whose utilization reading is `not-applicable` or which recorded 0 arrivals.
- [ ] 484. Report system Headroom as `(0.85 / U - 1) * 100` percent and `L * (0.85 / U - 1)` RPS, naming the label and analysis Utilization of the node holding `U`, with `L` the offered load over the analysis window.
- [ ] 485. Report system Headroom as 0 percent and 0 RPS at or above 0.85 naming the holding node, and as not applicable naming which precondition failed where fewer than 3 windows completed, no node is eligible, `U` is 0.0, or offered load is 0 RPS.
- [ ] 486. State alongside every numeric system Headroom figure that it assumes proportional growth of the highest-utilization node and that no other node saturates sooner, and that a Capacity_Sweep produces a measured Sustainable_Load in its place.

### 21.5 Registry Wiring

- [ ] 487. Create `src/analysis/rules/index.ts` exporting `RULE_REGISTRY` in the design's stated order, with each rule declaring its `requiredMetrics`.
- [ ] 488. Make each rule yield every N nodes so a rule iterating 80 nodes never occupies the main thread for more than 33 consecutive milliseconds.
- [ ] 489. Write a test asserting no rule reads a single window and every rule carries a minimum sample count, so a one-window spike or a one-window zero cannot emit a Finding.

---

### Phase 22: Capacity Sweep (Requirement 38)

### 22.1 Pure Sweep Arithmetic (`src/analysis/CapacitySweepController.ts`)

- [ ] 490. Define `SweepConfig`, `SweepStepRequest`, and `SweepStepResult`, and populate each sweep parameter with a default inside its stated range including a 10,000 ms warm-up.
- [ ] 491. Implement per-step offered load as `startRps + n × (endRps − startRps) / (stepCount − 1)` rounded to whole RPS with exactly one half rounding up, raising a step by 1 RPS where rounding makes it equal its predecessor.
- [ ] 492. Reject up front a range that cannot yield `stepCount` distinct whole-RPS values, naming the requested count and the highest workable one, and reject an out-of-range, non-numeric, empty, or non-finite parameter or an ending load at or below the starting load with an inline error naming the parameter and its bounds.
- [ ] 493. Implement the per-generator split as `round(S × ownRps / B)` clamped to at least 1 RPS with the residual assigned to the generator holding the highest configured RPS (ties by ascending identifier), leaving distribution, spike multiplier, and spike duration untouched — computed on the main thread so the rule has one testable implementation.
- [ ] 494. Clamp a per-node value above 100,000 RPS with a normalisation warning naming the generator label, step index, computed value, and applied bound, report the step's applied offered load alongside its requested load, and reject a sweep with no Traffic_Generator or a configured RPS sum of 0.

### 22.2 Orchestration and Worker Protocol

- [ ] 495. Add `SWEEP_STEP` and `SWEEP_CANCEL` to `MainToWorkerMessage` and `SWEEP_STEP_COMPLETE` to `WorkerToMainMessage` with the payload shapes the design's Extended Worker Communication Protocol lists.
- [ ] 496. Create `MeasurementIntervalAccumulator.ts` starting to record end-to-end latency samples and terminal statuses when the virtual clock passes `warmUpMs`, since p99 over that interval cannot be reconstructed by averaging window percentiles.
- [ ] 497. Execute one run per step in ascending offered load, clearing all state and returning the clock to t=0 between steps, holding seed, topology, speed multiplier, routing policies, edge weights, and every configuration other than generator RPS constant.
- [ ] 498. Hold every Scheduler parameter constant, exclude Scheduler-emitted Jobs from each step's requested and applied offered load, and report each step's Scheduler-emitted Job count separately so Scheduler load is a constant additive background across steps.
- [ ] 499. Restore every node position, configuration, generator RPS, routing policy, edge weight, and Subsystem_Group to its sweep-start value on completion or cancellation, so a sweep changes the Canvas in no respect.
- [ ] 500. Disable Start, Pause, Resume, and chaos controls and make the config panel read-only while a sweep runs, offer a cancel control, and require confirmation naming that a Running or Paused run will be stopped and its metrics discarded before starting.
- [ ] 501. On cancellation, retain and report every step that completed its full simulated duration, discard the in-progress step's metrics, report the sweep as cancelled naming the 1-based in-progress index, and determine the Knee_Point and Sustainable_Load from the retained steps alone.

### 22.3 Verdicts and Findings

- [ ] 502. Evaluate the Service_Objective over the measurement interval alone, treating a step as satisfied while its p99 is at or below the configured maximum and its total error rate over that interval is at or below the configured maximum, and as `not-evaluated` with a plain-language explanation where the interval recorded no terminations, excluded from the Knee_Point and Sustainable_Load determinations.
- [ ] 503. Report the Knee_Point as the lowest violating evaluated step and Sustainable_Load as the highest satisfying evaluated step below it; report Sustainable_Load as below the starting load where every step below the knee violated or was not evaluated; report it as at or above the ending load with no knee where every evaluated step satisfied.
- [ ] 504. Report non-monotonic results rather than smoothing them: where a step above the Knee_Point satisfied the objective, report the count and offered load of each such step and state that the measured results are not monotonic in offered load.
- [ ] 505. Implement `sweepKneeRule` in `capacity.ts` naming the node that reached Saturation earliest during the Knee_Point step with its bounding parameter and configured value, and where no node saturated, naming the node holding the highest analysis Utilization plus which Service_Objective condition was violated with its observed value and configured limit.

---

### Phase 23: Single Point of Failure and Node Failure (Requirement 39)

### 23.1 Reachability and the SPOF Rule (`src/analysis/reachability.ts`, `rules/spof.ts`)

- [ ] 506. Implement the reachability analysis over the directed graph alone, ignoring edge protocol, weight, routing policy, and Subsystem_Group state, treating every out-degree-0 node as terminal irrespective of type and every Traffic_Generator and Scheduler as a source, and producing results whether or not a run has completed.
- [ ] 507. Compute each source's baseline reachable terminal set, then for each candidate node re-run a BFS in the graph with that node and every incident edge removed, designating a SPOF where at least one source goes from 1 or more reachable terminals to 0 — a per-source test, stricter than global disconnection.
- [ ] 508. Yield every 8 candidates so main-thread occupancy stays at or below 33 consecutive milliseconds; the roughly 90k edge visits at the 80-node envelope need no bitset or dominator-tree optimisation.
- [ ] 509. Implement `spofRule` emitting one Finding per designated node naming every source whose reachable terminal set becomes empty, with fan-in count, losing-source count, and topology source count as evidence.
- [ ] 510. Compute fan-in as the count of distinct nodes holding an edge into the subject, and set severity Critical at 3 or more and Warning at 2 or fewer.
- [ ] 511. Populate the recommended action as a `StructuralAction` naming the node, its type, one of the two structural changes, and the node and edge counts it adds, with a tradeoff naming those added nodes against the 200-node canvas limit and the metric the change degrades.
- [ ] 512. Read Blast_Radius from `terminatedThroughNodeCount / systemTerminatedCount × 100` as the Finding's primary evidence, and where no completed run is retained omit the entry entirely, state Blast_Radius is not applicable because no run has completed, promote the losing-source count to primary, and set confidence Low.

### 23.2 DISABLE_NODE and REDRIVE_DLQ Chaos

- [ ] 513. Extend `ChaosEventPayload.chaosType` with `DISABLE_NODE` and `REDRIVE_DLQ`, and add a targeted branch to `injectChaos` ahead of the existing node-type-matching loop, since both are addressed to a single node identifier.
- [ ] 514. Add `unreachableUntilMs: number | null` to `NodeRuntimeState` and terminate each arriving request `Timeout` against that node while it is set, forwarding nowhere, before delegating to the processor.
- [ ] 515. Implement `onNodeDisabled` on every processor holding occupancy, returning the request identifiers held in bounded resources, queues, prefetch buffers, and transfer queues for the engine to terminate through the single terminal-assignment helper, then hold every bounded resource at 0 occupancy.
- [ ] 516. Exempt a Dead_Letter_Queue: retain every held message without termination and perform no Redrive while unreachable.
- [ ] 517. Reject re-applying the control to an already-unreachable node, leaving its duration and scheduled restoration unchanged, holding no deferred failure, and naming the node's label and remaining duration.
- [ ] 518. Implement `onNodeRestored` restoring reachability with every bounded resource at 0 occupancy, log a recovery event naming the label and simulated time, and emit `NODE_STATE_CHANGE` on both transitions.
- [ ] 519. Add the failure-simulation control to `ChaosPanel.tsx` accepting any of the fifteen node types and a duration of 100 to 600,000 simulated ms while Running without a pause, and the Manual DLQ redrive control per Dead_Letter_Queue node.

### 23.3 Failure Impact Reporting

- [ ] 520. Compare the pre-failure window — the most recent window completing at or before the failure instant — against every window lying **wholly** within the failure interval, excluding partial overlaps at both ends.
- [ ] 521. Report the change in success rate and in end-to-end p99 as a signed absolute difference and a signed percentage of the pre-failure value, as not applicable where the pre-failure value is 0, and both as not applicable stating the interval contained no complete window where none lies wholly inside — the common case for a failure shorter than `metricsIntervalMs`.
- [ ] 522. State in the panel that every source retains a path to a reachable terminal under any single removal where no node is designated, listing every node excluded as a source and every source reaching 0 terminals before any removal.

---

### Phase 24: Baseline Runs and Comparison (Requirement 40)

### 24.1 Baseline Store (`src/store/baselineStore.ts`)

- [ ] 523. Define `BaselineRun` at schema version 2 carrying name, creation timestamp, seed, simulated duration, total offered load, optional Service_Objective, the version 2 topology, and the whole-run and per-node aggregates.
- [ ] 524. Write a record only from the `Complete` state, taking every value from the run's final cumulative metrics over its full simulated duration via `RunCumulativeAccumulator` rather than from a window or a mean across windows.
- [ ] 525. Retain at most 5 records under the localStorage key `analysys_baseline_runs`, list each by name and creation timestamp, and offer a per-record delete leaving every other record unchanged.
- [ ] 526. Validate the submitted name as 1 to 40 characters after trimming and case-insensitively unique, and reject a write at the 5-record limit with an error naming the violated constraint and the stored names, leaving every record and the current run's metrics unchanged.
- [ ] 527. On application load, restore every stored record at version 2 holding every required field, exclude any record at another version or missing a field with a warning naming it and the problem, and leave every stored record unmodified — a forward-incompatible baseline is hidden, never deleted.
- [ ] 528. Implement baseline reuse restoring the topology, positions, configurations, routing policies, protocols, weights, and groups with their collapsed states to the Canvas, leaving the stored record unchanged and requiring confirmation while unsaved changes exist.
- [ ] 529. Create `src/components/analysis/BaselineManager.tsx` offering retain, list, delete, and reuse, operable by keyboard alone.

### 24.2 Comparison (`src/analysis/comparison.ts`)

- [ ] 530. Accept exactly two selections from the stored baselines and the most recently completed run, designate them A and B, compute every signed difference as B minus A in one place, and report no result with a message where both selections name the same run.
- [ ] 531. Report for p50, p90, p99, total throughput, total error rate, and each of the nine terminal status rates: the A value, the B value, the signed absolute difference in that metric's unit, and the signed percentage difference over `|A|` to 2 decimal places.
- [ ] 532. Report per node present in both runs the mean per-window Utilization, throughput as Success terminations over simulated seconds, error rate over the full duration, and mean queue depth, each for A and B with the signed difference.
- [ ] 533. Implement node matching as same identifier with same type, falling back to same type and same case-insensitive label where the identifier appears in one run only and exactly one candidate exists per run — the fallback exists because a rebuilt topology gets fresh UUIDs, and everything ambiguous is listed as not present.
- [ ] 534. List every node not present in both runs with the run holding it, and every configuration parameter differing between the runs for a matched node with the parameter and both values.
- [ ] 535. Label a comparison a Controlled_Comparison at identical seed, identical duration, and offered loads within 0.01 RPS, else label it uncontrolled naming each differing attribute with its value in each run, and still report every result; then implement `comparisonObjectiveRule` and `comparisonUtilizationRule` in `src/analysis/rules/comparison.ts`.

---

### Phase 25: Analysis Panel and Supporting UI (Requirements 38, 43)

### 25.1 Analysis Panel (`src/components/analysis/`)

- [ ] 536. Add a control to the `TelemetryDashboard` header that opens `AnalysisPanel.tsx` alongside the Canvas, leaving the Canvas rendered with its pan position, zoom level, and node selection unchanged, reachable by pointer and by keyboard alone.
- [ ] 537. Group Findings by category, order category groups by their position in the eight-value declaration order, order Findings within a group by the severity then descending primary evidence magnitude then category position then ascending identifier total order, and contribute no group for a category holding no Finding.
- [ ] 538. Create `FindingCard.tsx` displaying the severity text label, subject node labels or the system-wide scope label, constraint statement, recommended action, tradeoff statement, confidence, and the inclusive analysis window bounds in simulated ms.
- [ ] 539. Identify each subject node by its user-assigned label with a shortened-identifier fallback where the node is absent from the topology.
- [ ] 540. Implement `activateFinding`: expand every collapsed group containing a present subject node, set the selection to exactly those nodes, and fit the view to their bounding box.
- [ ] 541. Where no zoom level at or above 0.25 frames every subject node, set zoom to 0.25, centre on the bounding-box midpoint, and display the count of subject nodes lying outside the viewport in nodes.
- [ ] 542. Leave the Canvas selection, pan, and zoom untouched for a Finding with an empty or fully absent subject set, showing the system-wide scope label or the shortened identifiers with a statement that those nodes are absent from the current topology.
- [ ] 543. Present every Finding of a recomputed set up to the 200-Finding maximum within 500 ms of that recomputation completing.

### 25.2 Analysis Panel Accessibility

- [ ] 544. Place the Finding list in the tab order, move focus through the display order on Down and Up, activate on Enter and Space, and leave the list on Tab and Shift+Tab.
- [ ] 545. Return keyboard focus to the control that opened the panel on Escape.
- [ ] 546. Render every severity as one of the three text labels at 4.5:1 or better contrast so severity is determinable without colour, matching the approach `HealthLegend` already takes.
- [ ] 547. Add an announced-identifier set per run to the existing `LiveAnnouncer` assertive region so a newly appearing Critical Finding announces exactly once per run, at most one announcement per metrics window, naming the count plus the category and subject label of the first in display order.
- [ ] 548. Meet the remaining contrast and semantics targets: 3:1 for large and bold text, 3:1 for non-text status and focus indicators, and a programmatic name and role on every interactive control in the panel.

### 25.3 Supporting Analysis Surfaces

- [ ] 549. Create `ComparisonTable.tsx` with each data cell programmatically associated with both its row and column header, a programmatic name naming the two compared runs, and every header and cell reachable by keyboard alone.
- [ ] 550. Create `SweepResultsTable.tsx` reporting per step the 1-based index, requested and applied offered load, achieved throughput, p50/p90/p99, total error rate, each of the nine terminal status counts, the measurement interval bounds, and the satisfied/violated/not-evaluated verdict, each with its unit.
- [ ] 551. Create `HeadroomList.tsx` rendering per-node and system Headroom including the not-applicable readings and the projection caveat.
- [ ] 552. Create `SpofList.tsx` rendering SPOF Findings, the exclusion list with reasons, and the no-SPOF statement.
- [ ] 553. Display the analysis-completed-with-no-Finding state with the analysis window bounds, keeping every panel control keyboard-operable, distinguishable from the fewer-than-3-windows state.
- [ ] 554. Display the suppression list naming each suppressed rule identifier, the missing or not-applicable metric, and each affected node label, and the budget-exhaustion report naming the incomplete rules.

### 25.4 Sweep and Chaos Controls

- [ ] 555. Create `CapacitySweepPanel.tsx` with the parameter form, inline validation messages, and a start control.
- [ ] 556. Display while a sweep runs the 1-based in-progress step index, the total step count, that step's requested offered load, its elapsed simulated time, and the reported results of every completed step.
- [ ] 557. Add the always-visible plain-language descriptions to the new chaos controls matching the existing panel's convention, and log every new chaos event with its simulated timestamp.
- [ ] 558. Write component tests for the panel: keyboard-only traversal of the Finding list, focus return on Escape, comparison table header association, and exactly one assertive announcement per Critical Finding identifier per run.

---

### Phase 26: Reference Architecture Presets (Requirement 42)

### 26.1 Preset Records (`src/presets/`)

- [ ] 559. Extend `PresetTopology` into `ReferencePreset` adding `schemaVersion: 2`, `subsystemGroups`, `seed`, `simulatedDurationMs`, `speedMultiplier`, `totalOfferedRps`, `expectedBottleneckNodeId`, and `expectedDominantTerminalStatus`.
- [ ] 560. **authenticatedWebApi.json**: Traffic_Generator → API_Gateway → Rate_Limiter → Auth_Service (Introspection, with an edge to the Cache) → Authz_Service → Load_Balancer → 2 or more App_Servers → Cache, Database, and Object_Store, with every node reachable from the generator along a directed path.
- [ ] 561. **asyncJobPlatform.json**: App_Server → Message_Queue → Worker_Pool → Dead_Letter_Queue plus Database and Object_Store, with the pool's job failure rate at 0.05 or above and 1 to 3 max retries so a run at the stored seed records at least one Retry_Exhaustion and retains at least one dead-lettered message.
- [ ] 562. **scheduledBatchWithLiveTraffic.json**: a Scheduler and a Traffic_Generator each holding a directed path to the same Database, with interval and start offset set so 3 or more triggers fire within the stored duration.
- [ ] 563. Give each preset 12 to 80 nodes and 3 to 20 Subsystem_Groups of 2 to 50 members each with every node in at most one group, and construct every edge from a pair and protocol permitted by the connection rules so loading produces no violation.
- [ ] 564. Set each preset's stored simulated duration and metrics interval so their product spans at least 3 completed metrics windows — the interval is caller-supplied, so no preset may assume a fixed window length.
- [ ] 565. Author node positions so every rendered node's bounding box is separated from every other by 16 or more logical pixels on the x axis or the y axis at 100% zoom.
- [ ] 566. Register the three presets in `PresetSelector.tsx` under a group label distinguishing them from the failure-mode presets, display each preset's expected Bottleneck label, expected dominant terminal status, stored duration in seconds, and stored offered load on selection, and auto-start with the stored seed, duration, speed multiplier, and chaos timeline after the existing unsaved-changes confirmation.

---

### Phase 27: Property-Based and Integration Tests

### 27.1 Test Infrastructure

- [ ] 567. Add `fast-check` as a dev dependency at a pinned version — it is not currently in `package.json`.
- [ ] 568. Implement `arbTopology()` building a valid graph over the fifteen types **by construction** rather than by filtering: pick a source, then extend only along pairs permitted by `CONNECTION_RULES` and `PROTOCOL_OVERRIDES`, parameterised to force Fan_Out nodes at varying depth, a Worker_Pool with a Dead_Letter_Queue, and several Traffic_Generators.
- [ ] 569. Implement `arbConfig(nodeType)` drawing each parameter across its Requirement 23–28 range including both bounds, with explicit weight on the degenerate values the requirements call out (hit ratio 0.0 and 1.0, `maxRetries` 0, `queueDepth` 0, jitter above interval) so those edge cases need no separate example test.
- [ ] 570. Implement `arbSubsystemGroups(nodes)` producing a random partition of a node subset into 0 to 20 groups of 2 to 50 members, and share one engine test fixture that sets `disablePacing: true` so no test builds its own config object.

### 27.2 Property Tests (one per property, `{ numRuns: 100 }` minimum)

- [ ] 571. Property 7 (CP-1) analysis determinism: two runs at one seed produce Finding sets of equal size comparing equal field-for-field after `round6` and presenting in the same display order.
- [ ] 572. Property 8 (CP-2) Analysis_Report round trip through `report.ts` export and import, in memory with no simulation.
- [ ] 573. Property 9 (CP-3) topology serialization round trip at schema version 2 across new node types, routing policies, edge weights, and Subsystem_Groups.
- [ ] 574. Property 10 (CP-4) schema v1 behavioural equivalence: final metrics equal before and after migration at the same seed.
- [ ] 575. Property 11 (CP-5) terminal status partition, asserted at **every** metrics snapshot of a generated run rather than only at the end.
- [ ] 576. Property 12 (CP-6) grouping invariance: one run per generated group set over the same topology and seed, asserting metric equality.
- [ ] 577. Property 13 (CP-7) resource conservation for the new types, asserted at every metrics snapshot.
- [ ] 578. Property 14 (CP-8) retry budget bound: total attempts at most `maxRetries + 1`, with the Job terminating `Retry_Exhausted` or arriving at a Dead_Letter_Queue.
- [ ] 579. Property 15 (CP-9) weight normalisation idempotence and unit sum — a pure-function test, no engine.
- [ ] 580. Property 16 (CP-10) fan-out latency is the maximum, over generated branch latencies mixing Sync and Async edges.
- [ ] 581. Property 17 (CP-11) evidence completeness over Finding sets built through `FindingBuilder` and over the Findings of every engine-backed property run.
- [ ] 582. Property 18 (CP-12) sweep offered loads strictly increasing, against `CapacitySweepController` with a stubbed Worker plus a direct test of the pure RPS split.
- [ ] 583. Property 19 (CP-13) SPOF soundness, checked against an independent brute-force reachability oracle so the naive implementation validates the sliced one.
- [ ] 584. Property 20 (CP-14) comparison antisymmetry over two generated `BaselineRun` records compared in both orders.
- [ ] 585. Property 21 (CP-15) Scheduler emission count under the Allow policy — a pure-function test, no engine.
- [ ] 586. Property 22 (CP-16) Object_Store bandwidth bound and share sum, asserted at every metrics snapshot.
- [ ] 587. Property 23 (CP-17) fan-out depth bound of 0 to 4 with the depth-4 single-edge forward, asserted at every metrics snapshot.
- [ ] 588. Property 24 (CP-18) Round_Robin selection determinism including the cycle order, the reset position, and cursor survival across a pause and resume.
- [ ] 589. Property 25 (CP-19) Scheduler schedule holds no drift: scheduled times independent of jitter, skips, and deferrals, with non-decreasing fire times.
- [ ] 590. Property 26 (CP-20) Subsystem_Group membership is a partition after every store mutation and after import.
- [ ] 591. Property 27 (CP-21) Finding identifier invariance across label edits, recomputations, and repeated runs, with at most one Finding per identifier per result.

### 27.3 Example-Based and Integration Tests

- [ ] 592. Example tests for the scenarios that are not properties: a Scheduler's first trigger at t=0 with zero offset, the exact Skip and Queue overlap transitions, the deferred-trigger-overflow log entry, and the Redrive decrement of a `Dead_Lettered` count.
- [ ] 593. Example tests asserting the exact rejection message text for each connection rule of Requirement 30 including the protocol mismatch and the Worker_Pool to Dead_Letter_Queue cardinality violation.
- [ ] 594. Integration test asserting each of the three reference presets, run at its stored seed, duration, speed multiplier, offered load, and chaos timeline, produces a Bottleneck Finding naming its stored expected Bottleneck node.
- [ ] 595. Integration test asserting each reference preset makes its stored expected dominant terminal status the largest of the eight non-Success cumulative counts.
- [ ] 596. Integration test asserting a reference preset load presents a first frame containing every node and edge within 2,000 ms, and that export then import restores every position, configuration, policy, protocol, weight, and group.
- [ ] 597. Extend the component test suite for the six new config forms, the regrouped fifteen-item palette, the group toolbar, and the terminal status table.

---

### Phase 28: Performance Benchmarks and Final Verification

### 28.1 Benchmarks at the 80-Node / 200-Edge Envelope

- [ ] 598. Benchmark engine throughput at 80 nodes drawn from all fifteen types and 200 edges, asserting 1,000 or more events per wall-clock second with `disablePacing: true`.
- [ ] 599. Benchmark full Finding recomputation, asserting 500 ms or less as the maximum over 10 consecutive recomputations within a single run.
- [ ] 600. Benchmark the longest main-thread slice by instrumenting `AnalysisScheduler` directly rather than sampling frame times, asserting 33 ms or less per slice — this measures what the requirement states.
- [ ] 601. Benchmark the single-point-of-failure analysis, asserting 500 ms or less from invocation to Finding availability and 33 ms or less of consecutive main-thread occupancy.
- [ ] 602. Benchmark an 8-step sweep at 60,000 ms per step and the 50x multiplier, asserting every step completes and reports within 90 wall-clock seconds.

### 28.2 Final Verification

- [ ] 603. Run `npm run build` and confirm a clean type-check and production build with the Worker still code-split into its own chunk.
- [ ] 604. Run `npm run lint` and `npm run format:check` and resolve every finding.
- [ ] 605. Run `npm run test` and confirm the full suite passes, including the property tests at their configured `numRuns`.
- [ ] 606. Verify the CI workflow still passes on Node 22 — the matrix in `.github/workflows/ci.yml` pins Node 22, and `fast-check` plus the new benchmarks must run there without a local-only assumption.
- [ ] 607. Confirm the bundle size budget still holds with the analysis layer and the three reference presets added, and warn in the build output rather than failing if the preset JSON pushes the serialized size toward the localStorage threshold.

---

## Task Dependency Graph

```
Phase 1 (Scaffold)
    ↓
Phase 2 (Types) ←── shared by all subsequent phases
    ↓
Phase 3 (Stores)
    ↓
┌───────────────┬──────────────────┐
│               │                  │
Phase 4       Phase 5           Phase 6
(Canvas)     (Validation)      (Engine)
│               │                  │
└───────┬───────┘                  │
        │                          │
    Phase 7 (Controls) ←───────────┘
        │
    Phase 8 (Telemetry)
        │
    Phase 9 (Presets)
        │
    Phase 10 (Persistence)
        │
    Phase 11 (A11y & Polish)
        │
    Phase 12 (Testing)
        │
    Phase 13 (Build & Deploy)   ← Requirements 1–22 complete
        │
    Phase 14 (New Node Type Surface — types, defaults, validation,
        │      connection rules, all 11 exhaustive-match sites)
        │      ⚠ single phase by necessity: the build is red inside it
        ↓
    Phase 15 (Engine Core — routing, fan-out, sub-requests, terminal partition)
        ↓
    Phase 16 (The Six Processors)
        │
┌───────┴───────┬──────────────────┐
│               │                  │
Phase 17      Phase 18         Phase 19
(Grouping)   (Schema v2)      (Worker analysis aggregates)
│               │                  │
└───────┬───────┴──────────────────┘
        │
    Phase 20 (Analysis Engine Core — Finding model, window store, scheduler)
        ↓
    Phase 21 (Analysis Rules)
        │
┌───────┴───────┬──────────────────┐
│               │                  │
Phase 22      Phase 23         Phase 24
(Sweep)       (SPOF/failure)   (Baselines/comparison)
│               │                  │
└───────┬───────┴──────────────────┘
        │
    Phase 25 (Analysis Panel & Supporting UI)
        ↓
    Phase 26 (Reference Architecture Presets)
        ↓
    Phase 27 (Property-Based & Integration Tests)
        ↓
    Phase 28 (Benchmarks & Final Verification)
```

```json
{
  "waves": [
    {
      "wave": 1,
      "description": "Project Scaffolding & Core Infrastructure",
      "tasks": ["1.1", "1.2"]
    },
    {
      "wave": 2,
      "description": "Type Definitions & Shared Contracts",
      "tasks": ["2.1", "2.2", "2.3", "2.4"]
    },
    {
      "wave": 3,
      "description": "State Management",
      "tasks": ["3.1", "3.2", "3.3"]
    },
    {
      "wave": 4,
      "description": "Canvas, Validation, and Engine (parallel)",
      "tasks": ["4.1", "4.2", "4.3", "4.4", "4.5", "5.1", "5.2", "5.3", "6.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7", "6.8"]
    },
    {
      "wave": 5,
      "description": "Simulation Controls UI",
      "tasks": ["7.1", "7.2"]
    },
    {
      "wave": 6,
      "description": "Telemetry & Metrics Dashboard",
      "tasks": ["8.1", "8.2", "8.3", "8.4", "8.5", "8.6"]
    },
    {
      "wave": 7,
      "description": "Pre-Built Demo Templates",
      "tasks": ["9.1", "9.2", "9.3"]
    },
    {
      "wave": 8,
      "description": "Persistence & Import/Export",
      "tasks": ["10.1", "10.2", "10.3"]
    },
    {
      "wave": 9,
      "description": "Accessibility & Polish",
      "tasks": ["11.1", "11.2", "11.3"]
    },
    {
      "wave": 10,
      "description": "Testing & Quality Assurance",
      "tasks": ["12.1", "12.2", "12.3", "12.4"]
    },
    {
      "wave": 11,
      "description": "Build & Deployment",
      "tasks": ["13.1", "13.2", "13.3"]
    },
    {
      "wave": 12,
      "description": "New node type surface — types, defaults, validation, connection rules, and every exhaustive-match site. Not splittable: the build is red until the whole wave lands.",
      "tasks": ["14.1", "14.2", "14.3", "14.4", "14.5", "14.6", "14.7"]
    },
    {
      "wave": 13,
      "description": "Engine core — routing policies, fan-out, sub-requests, and the terminal status partition",
      "tasks": ["15.1", "15.2", "15.3", "15.4"]
    },
    {
      "wave": 14,
      "description": "The six node processors",
      "tasks": ["16.1", "16.2", "16.3", "16.4", "16.5", "16.6", "16.7", "16.8"]
    },
    {
      "wave": 15,
      "description": "Grouping, schema v2, and worker analysis aggregates (parallel)",
      "tasks": ["17.1", "17.2", "17.3", "18.1", "18.2", "19.1"]
    },
    {
      "wave": 16,
      "description": "Analysis engine core — Finding model, window store, slicing scheduler, store, report",
      "tasks": ["20.1", "20.2", "20.3", "20.4", "20.5"]
    },
    {
      "wave": 17,
      "description": "Analysis rules",
      "tasks": ["21.1", "21.2", "21.3", "21.4", "21.5"]
    },
    {
      "wave": 18,
      "description": "Capacity sweep, SPOF and node failure, baselines and comparison (parallel)",
      "tasks": ["22.1", "22.2", "22.3", "23.1", "23.2", "23.3", "24.1", "24.2"]
    },
    {
      "wave": 19,
      "description": "Analysis Panel and supporting UI",
      "tasks": ["25.1", "25.2", "25.3", "25.4"]
    },
    {
      "wave": 20,
      "description": "Reference architecture presets",
      "tasks": ["26.1"]
    },
    {
      "wave": 21,
      "description": "Property-based and integration tests",
      "tasks": ["27.1", "27.2", "27.3"]
    },
    {
      "wave": 22,
      "description": "Performance benchmarks and final verification",
      "tasks": ["28.1", "28.2"]
    }
  ]
}
```

---

## Estimated Effort

| Phase | Tasks | Estimated Hours |
|-------|-------|-----------------|
| 1. Scaffolding | 8 | 2–3 |
| 2. Type Definitions | 16 | 3–4 |
| 3. State Management | 18 | 4–6 |
| 4. Canvas UI | 30 | 8–12 |
| 5. Validation | 10 | 3–4 |
| 6. Simulation Engine | 32 | 12–16 |
| 7. Controls UI | 10 | 3–4 |
| 8. Telemetry Dashboard | 18 | 6–8 |
| 9. Presets | 8 | 3–4 |
| 10. Persistence | 10 | 3–4 |
| 11. Accessibility | 10 | 3–4 |
| 12. Testing | 16 | 6–8 |
| 13. Build & Deploy | 6 | 2–3 |
| 14. New Node Type Surface | 45 | 14–18 |
| 15. Engine Core (routing, fan-out, partition) | 30 | 14–20 |
| 16. The Six Processors | 47 | 20–28 |
| 17. Subsystem Grouping | 18 | 8–12 |
| 18. Schema v2 & Migration | 15 | 5–7 |
| 19. Worker Analysis Aggregates | 11 | 5–7 |
| 20. Analysis Engine Core | 26 | 12–16 |
| 21. Analysis Rules | 25 | 14–20 |
| 22. Capacity Sweep | 16 | 8–12 |
| 23. SPOF & Node Failure | 17 | 8–12 |
| 24. Baselines & Comparison | 13 | 6–9 |
| 25. Analysis Panel & UI | 23 | 12–16 |
| 26. Reference Presets | 8 | 5–8 |
| 27. Property & Integration Tests | 31 | 18–26 |
| 28. Benchmarks & Verification | 10 | 5–8 |
| **Total** | **~607** | **~212–299 hrs** |

## Notes

- Phases 4, 5, and 6 can be developed in parallel once types and stores are in place.
- The simulation engine (Phase 6) is the most complex piece; consider timeboxing and iterating.
- Preset JSON files serve as both demo content and integration test fixtures.
- The `.analysys.json` schema should be versioned from day one to support future migrations.
- Performance benchmarks (≥1,000 events/sec, ≥30 fps) are hard requirements validated in Phase 12.
- **Do not spread a compile break across phases.** Widening `NodeType` from 9 to 15 members breaks 11 exhaustive-match sites at once. Phase 14 exists to widen the enum and fix every one of those sites, plus the 2 sites the compiler cannot catch (`NodeConfigPanel`'s form dispatch chain and `VALIDATION_RULES`). Task 317 is the gate: the phase is not done until the build and suite are green. The same rule applies to `NodeMetricsSnapshot.utilization` becoming `UtilizationReading` — `MetricsSummary`, `QueueGauge`, and `ActivityPanel` are updated in the same phase that introduces the union.
- **Never add a `default:` clause to silence one of those switches.** The exhaustiveness check is the mechanism that enumerates the work for the next node type added.
- **Every test that constructs a `SimulationEngine` and calls `run()` must pass `disablePacing: true`.** Without it `yieldToMacroTask` sleeps `max(1, 50 / speedMultiplier)` ms per 200-event batch for UI pacing, and the events-per-second benchmarks fail. The existing `engine.test.ts` fixture already sets it; new processor, analysis, and sweep tests inherit that fixture rather than building their own config objects.
- **CI runs on Node 22** (`.github/workflows/ci.yml` pins it). `fast-check`, the analysis benchmarks, and the `MessageChannel`-based `yieldToFrame` must all work there, not only locally.
- No analysis rule may read a single metrics window. Every threshold spans 3 or 5 windows and carries a minimum sample count — the same hazard that produced `CircuitBreakerProcessor.MIN_OBSERVATIONS = 10` applies to every new per-window rate.
- `metricsIntervalMs` is caller-supplied (`SimulationToolbar` sends 500 ms, `PresetSelector` sends 1,000 ms), so nothing may assume a fixed window length. Reference presets must set a duration that spans at least 3 completed windows at whatever interval the caller uses.
