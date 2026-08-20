# Implementation Plan

#[[file:.kiro/specs/design.md]]

## Overview

This implementation plan covers the full build-out of Analysys, an interactive distributed-systems architecture simulator. The project uses Vite + React + TypeScript with React Flow for the canvas, Zustand for state management, a Web Worker simulation engine, and Recharts for telemetry dashboards. Work is organized into 13 phases progressing from scaffolding through deployment.

## Tasks

### Phase 1: Project Scaffolding & Core Infrastructure

### 1.1 Initialize Project

- [x] 1. Scaffold Vite + React + TypeScript project (`npm create vite@latest . -- --template react-ts`).
- [ ] 2. Install core dependencies: `@xyflow/react`, `zustand`, `recharts`, `tailwindcss`, `postcss`, `autoprefixer`.
- [ ] 3. Install shadcn/ui CLI and initialize (`npx shadcn-ui@latest init`); configure Tailwind content paths.
- [ ] 4. Install dev dependencies: `vitest`, `@testing-library/react`, `@testing-library/jest-dom`, `jsdom`, `eslint`, `prettier`.
- [ ] 5. Configure `vite.config.ts`: enable Web Worker bundling (`import.meta.glob` / `new Worker(new URL(...))`).
- [ ] 6. Configure `tsconfig.json`: strict mode, path aliases (`@/` → `src/`), `lib: ["ES2022", "WebWorker"]`.
- [ ] 7. Create `.eslintrc.cjs` and `.prettierrc` with consistent formatting rules.
- [ ] 8. Verify `npm run dev`, `npm run build`, and `npm run test` all execute successfully.

### 1.2 Directory Structure

- [ ] 9. Create `src/types/` directory with empty barrel files: `nodes.ts`, `edges.ts`, `messages.ts`, `metrics.ts`.
- [ ] 10. Create `src/simulation/` directory with placeholder files per design §7.
- [ ] 11. Create `src/components/` subdirectories: `canvas/`, `canvas/nodes/`, `canvas/edges/`, `config/`, `controls/`, `telemetry/`, `presets/`.
- [ ] 12. Create `src/store/`, `src/validation/`, `src/presets/`, `src/utils/` directories.
- [ ] 13. Add `src/main.tsx` → `App.tsx` base layout with placeholder panels (sidebar, canvas, dashboard).

---

### Phase 2: Type Definitions & Shared Contracts

### 2.1 Node Types (`src/types/nodes.ts`)

- [ ] 14. Define `NodeType` enum (6 values).
- [ ] 15. Define `Distribution`, `LBAlgorithm`, `EvictionPolicy`, `DatabaseType`, `BackpressureStrategy` enums.
- [ ] 16. Define `BaseNodeData` interface (`id`, `nodeType`, `label`, `position`).
- [ ] 17. Define per-type config interfaces: `TrafficGeneratorConfig`, `LoadBalancerConfig`, `AppServerConfig`, `CacheConfig`, `DatabaseConfig`, `MessageQueueConfig`.
- [ ] 18. Define composed node interfaces: `TrafficGeneratorNode`, `LoadBalancerNode`, `AppServerNode`, `CacheNode`, `DatabaseNode`, `MessageQueueNode`.
- [ ] 19. Define `SimulationNode` discriminated union type.
- [ ] 20. Export `AnalysysNode` type wrapping `RFNode<SimulationNode>`.

### 2.2 Edge Types (`src/types/edges.ts`)

- [ ] 21. Define `EdgeProtocol` enum (`Sync`, `Async`).
- [ ] 22. Define `EdgeData` interface (`id`, `source`, `target`, `protocol`).
- [ ] 23. Export `AnalysysEdge` type wrapping `RFEdge<EdgeData>`.

### 2.3 Worker Protocol Types (`src/types/messages.ts`)

- [ ] 24. Define `MainToWorkerMessage` discriminated union (INIT, START, PAUSE, RESUME, RESET, CHAOS_EVENT, UPDATE_CONFIG).
- [ ] 25. Define `ChaosEventPayload` interface.
- [ ] 26. Define `WorkerToMainMessage` discriminated union (METRICS_BATCH, NODE_STATUS, EVENT_LOG, SIM_COMPLETE, ERROR).
- [ ] 27. Define `SimEventLogEntry` and `SimulationSummary` interfaces.

### 2.4 Metrics Types (`src/types/metrics.ts`)

- [ ] 28. Define `PercentileStats` interface (`p50`, `p90`, `p99`).
- [ ] 29. Define `LittlesLawMetrics` interface (`L`, `lambda`, `W`, `deviation`, `isStable`).
- [ ] 30. Define `NodeMetricsSnapshot` interface.
- [ ] 31. Define `MetricsBatchPayload` interface (with `systemWide` sub-object).

---

### Phase 3: State Management (Zustand Stores)

### 3.1 Topology Store (`src/store/topologyStore.ts`)

- [ ] 32. Create Zustand store with state: `nodes: AnalysysNode[]`, `edges: AnalysysEdge[]`.
- [ ] 33. Implement actions: `addNode`, `removeNode`, `updateNodePosition`, `updateNodeConfig`.
- [ ] 34. Implement actions: `addEdge`, `removeEdge`, `updateEdgeProtocol`.
- [ ] 35. Implement `onNodesChange` and `onEdgesChange` handlers (React Flow compatibility).
- [ ] 36. Implement undo/redo stack (array of snapshots or command pattern).
- [ ] 37. Implement `getTopologySnapshot()` — serializes current state for Worker INIT payload.
- [ ] 38. Implement `loadTopology(nodes, edges)` — bulk-replaces canvas state.

### 3.2 Simulation Store (`src/store/simulationStore.ts`)

- [ ] 39. Create Zustand store with state: `simState: SimState`, `speedMultiplier`, `metrics: MetricsBatchPayload | null`, `eventLog: SimEventLogEntry[]`, `nodeStatuses: Map<string, 'green'|'yellow'|'red'>`.
- [ ] 40. Implement actions: `setSimState`, `setSpeed`, `updateMetrics`, `appendEventLog`, `setNodeStatus`, `resetMetrics`.
- [ ] 41. Implement Worker lifecycle: `initWorker()`, `terminateWorker()` — manages Worker instance.
- [ ] 42. Implement `sendToWorker(message: MainToWorkerMessage)` helper.
- [ ] 43. Implement Worker `onmessage` handler dispatching to appropriate store actions.

### 3.3 Persistence Store (`src/store/persistenceStore.ts`)

- [ ] 44. Create Zustand store with state: `savedTopologies: { name, timestamp, data }[]`.
- [ ] 45. Implement `saveTopology(name)` — serializes topologyStore to localStorage.
- [ ] 46. Implement `loadSavedTopology(name)` — deserializes and calls `topologyStore.loadTopology`.
- [ ] 47. Implement `deleteSavedTopology(name)`.
- [ ] 48. Implement `exportJSON()` — triggers file download of `.analysys.json`.
- [ ] 49. Implement `importJSON(file: File)` — validates schema, migrates if needed, loads.
- [ ] 50. Add schema version field (`schemaVersion: 1`) to export format.
- [ ] 51. Implement size check: warn if localStorage usage exceeds 4MB.

---

### Phase 4: Interactive Node Canvas (React Flow)

### 4.1 Canvas Foundation (`src/components/canvas/CanvasEditor.tsx`)

- [ ] 52. Render `<ReactFlow>` with minimap, controls, and background grid.
- [ ] 53. Connect to `topologyStore` for `nodes`, `edges`, `onNodesChange`, `onEdgesChange`.
- [ ] 54. Register custom node types (mapping `NodeType` enum → React components).
- [ ] 55. Register custom edge types (`SyncEdge`, `AsyncEdge`).
- [ ] 56. Implement `onConnect` handler that calls `validateEdgeConnection` before adding edge.
- [ ] 57. Implement `onDrop` handler for palette drag-and-drop (create new node at coordinates).
- [ ] 58. Implement `onDragOver` handler (allow drop).
- [ ] 59. Implement node selection → open config panel.
- [ ] 60. Implement keyboard shortcuts: Delete/Backspace for selected node/edge removal.
- [ ] 61. Implement Ctrl+Z / Ctrl+Y for undo/redo.

### 4.2 Node Palette (`src/components/canvas/NodePalette.tsx`)

- [ ] 62. Render a vertical sidebar listing all 6 node types with icons and labels.
- [ ] 63. Each palette item is draggable (`draggable`, `onDragStart` sets transfer data with node type).
- [ ] 64. Style with Tailwind; group by category (Sources, Compute, Storage, Messaging).
- [ ] 65. Add `aria-label` and keyboard support (Enter/Space to initiate drag or place at center).

### 4.3 Custom Node Components (`src/components/canvas/nodes/`)

- [ ] 66. **TrafficGeneratorNode.tsx**: Icon (antenna/signal), label, RPS display, health ring.
- [ ] 67. **LoadBalancerNode.tsx**: Icon (scale/arrows), label, algorithm badge, health ring.
- [ ] 68. **AppServerNode.tsx**: Icon (server), label, queue depth gauge, health ring.
- [ ] 69. **CacheNode.tsx**: Icon (lightning/chip), label, hit ratio display, health ring.
- [ ] 70. **DatabaseNode.tsx**: Icon (cylinder), label, connection pool gauge, health ring.
- [ ] 71. **MessageQueueNode.tsx**: Icon (stack/queue), label, buffer gauge, health ring.
- [ ] 72. Each node renders source/target handles at appropriate positions.
- [ ] 73. Each node reads its `healthStatus` from simulationStore and applies animated color ring.
- [ ] 74. Disconnected nodes display dimmed opacity or dashed border.

### 4.4 Custom Edge Components (`src/components/canvas/edges/`)

- [ ] 75. **SyncEdge.tsx**: Solid line, arrowhead marker, subtle animation during simulation.
- [ ] 76. **AsyncEdge.tsx**: Dashed line, arrowhead marker, animated dots along path during simulation.
- [ ] 77. Both edges display protocol label on hover.

### 4.5 Node Configuration Panel (`src/components/config/NodeConfigPanel.tsx`)

- [ ] 78. Render as a right sidebar that opens when a node is selected.
- [ ] 79. Dynamically render form fields based on selected node's `nodeType`.
- [ ] 80. **Traffic Generator form**: RPS slider/input, distribution dropdown, spike multiplier, spike duration.
- [ ] 81. **Load Balancer form**: Algorithm dropdown, health-check interval, eviction threshold.
- [ ] 82. **App Server form**: Thread pool size, queue depth, processing time mean/stddev.
- [ ] 83. **Cache form**: Hit ratio slider, eviction policy dropdown, access latency.
- [ ] 84. **Database form**: Pool size, query latency mean/stddev, lock timeout, DB type toggle.
- [ ] 85. **Message Queue form**: Batch size, buffer capacity, backpressure threshold slider, strategy dropdown.
- [ ] 86. Implement inline validation with error messages for out-of-range values.
- [ ] 87. On valid change, dispatch `topologyStore.updateNodeConfig(nodeId, newConfig)`.
- [ ] 88. If simulation is paused, also send `UPDATE_CONFIG` message to Worker.

---

### Phase 5: Validation Logic

### 5.1 Edge Validation (`src/validation/edgeValidation.ts`)

- [ ] 89. Implement `validateEdgeConnection(source, target, existingEdges): ValidationResult`.
- [ ] 90. Implement self-loop rejection rule.
- [ ] 91. Implement duplicate-edge rejection rule.
- [ ] 92. Implement `CONNECTION_RULES` compatibility matrix (per design §3.2).
- [ ] 93. Implement `getValidProtocols(sourceType, targetType): EdgeProtocol[]`.
- [ ] 94. Write unit tests: self-loop, duplicate, valid connection, invalid source-target pair.

### 5.2 Cycle Detection (`src/validation/cycleDetection.ts`)

- [ ] 95. Implement `detectCycles(nodes, edges): string[][]` using iterative DFS.
- [ ] 96. Return array of cycle paths (node ID arrays).
- [ ] 97. Write unit tests: acyclic graph, simple cycle, multi-cycle, disconnected components.

### 5.3 Config Validation (`src/validation/configValidation.ts`)

- [ ] 98. Implement per-type validators: `validateTrafficGeneratorConfig`, `validateLoadBalancerConfig`, etc.
- [ ] 99. Each returns `{ valid: boolean; errors: { field: string; message: string }[] }`.
- [ ] 100. Implement `normalizeConfig(node)` — clamps out-of-range values for imported configs (e.g., pool size 0 → 1).
- [ ] 101. Write unit tests: boundary values, zero values, negative values, NaN handling.

---

### Phase 6: Simulation Engine (Web Worker)

### 6.1 Min-Heap Priority Queue (`src/simulation/eventQueue.ts`)

- [ ] 102. Implement `MinHeap<T>` class with generic comparator.
- [ ] 103. Methods: `insert`, `extractMin`, `peek`, `clear`, `size` getter.
- [ ] 104. Verify O(log n) insert and extract with benchmark (10,000 elements < 50ms).
- [ ] 105. Write unit tests: insert order, extract order, empty queue, single element.

### 6.2 Seeded PRNG (`src/simulation/prng.ts`)

- [ ] 106. Implement `SeededRNG` class (xoshiro128** per design §4.2).
- [ ] 107. Methods: `next()` (uniform float [0,1)), `poisson(lambda)`, `normal(mean, stdDev)`.
- [ ] 108. Write unit tests: determinism (same seed → same sequence), distribution sanity (mean within 5% of expected over 10k samples).

### 6.3 Simulation Types (`src/simulation/types.ts`)

- [ ] 109. Define `SimEventType` enum.
- [ ] 110. Define `SimEvent` interface.
- [ ] 111. Define `RequestStatus` enum.
- [ ] 112. Define `SimRequest` interface.
- [ ] 113. Define `SimState` enum.
- [ ] 114. Define `SimulationEngineConfig` interface.
- [ ] 115. Define `NodeRuntimeState` interface.
- [ ] 116. Define `NodeProcessor` interface.

### 6.4 Node Processors (`src/simulation/processors/`)

- [ ] 117. **TrafficGeneratorProcessor.ts**: Schedule arrivals based on RPS + distribution; handle spike multiplier via chaos.
- [ ] 118. **LoadBalancerProcessor.ts**: Route to downstream AppServers via Round Robin or Least Connections; track health per target; evict unhealthy targets.
- [ ] 119. **AppServerProcessor.ts**: Enqueue if queue not full (else drop); dequeue and process with latency from normal distribution; release to downstream; track pool utilization.
- [ ] 120. **CacheProcessor.ts**: On arrival, sample hit/miss from `hitRatio`; if hit → respond with access latency; if miss → route to downstream DB with access latency added.
- [ ] 121. **DatabaseProcessor.ts**: Acquire connection from pool (wait or timeout if exhausted); process with query latency from normal distribution; release connection.
- [ ] 122. **MessageQueueProcessor.ts**: Buffer incoming message; if buffer full → apply backpressure strategy; consumer dequeues in batch sizes at configured rate.
- [ ] 123. Each processor implements `onRequestArrived`, `onChaosApplied`, `onChaosReverted`, `getUtilization`.
- [ ] 124. Write unit tests per processor: happy path, queue full, pool exhausted, chaos applied.

### 6.5 Metrics Collector (`src/simulation/metrics/`)

- [ ] 125. **NodeMetricsAccumulator.ts**: Implement `recordArrival`, `recordDeparture`, `compute(currentTime): LittlesLawMetrics`.
- [ ] 126. Implement time-weighted occupancy tracking (design §5.2).
- [ ] 127. Implement sliding window pruning.
- [ ] 128. **MetricsCollector.ts**: Aggregate all node accumulators; produce `MetricsBatchPayload`.
- [ ] 129. Implement `computePercentiles(samples): PercentileStats` (sort + index).
- [ ] 130. Implement `deriveHealthStatus(utilization, errorRate)`.
- [ ] 131. Implement `computeSystemWideMetrics()`.
- [ ] 132. Write unit tests: Little's Law holds within 5% for steady-state arrivals; percentile calculation correctness.

### 6.6 Simulation Engine (`src/simulation/engine.ts`)

- [ ] 133. Implement `SimulationEngine` class constructor (init heap, RNG, node states, initial events).
- [ ] 134. Implement `initializeNodeStates()` — creates `NodeRuntimeState` + processor instance per node.
- [ ] 135. Implement `scheduleInitialEvents()` — first `RequestArrival` per TrafficGenerator + first `MetricsSnapshot`.
- [ ] 136. Implement `run()` — async batched event loop with `BATCH_SIZE` and `yieldToMacroTask()`.
- [ ] 137. Implement `processEvent(event)` — switch/dispatch to handler per `SimEventType`.
- [ ] 138. Implement `handleRequestArrival` — create request, route or NoRoute, schedule next arrival.
- [ ] 139. Implement `handleRequestRoute` — hop count check, delegate to processor.
- [ ] 140. Implement `handleRequestEnqueue` — add to node queue, schedule process when slot available.
- [ ] 141. Implement `handleRequestProcess` — sample latency, schedule route to downstream or complete.
- [ ] 142. Implement `handleRequestComplete` — mark request success, record metrics.
- [ ] 143. Implement `handleRequestTimeout` — mark request timed out, release resources.
- [ ] 144. Implement `handleMetricsSnapshot` — collect metrics, postMessage to main, schedule next snapshot.
- [ ] 145. Implement `handleChaosEvent` — apply/revert chaos on target processor(s).
- [ ] 146. Implement `pause()`, `resume(speed)`, `reset()`.
- [ ] 147. Implement `postComplete()` — send `SIM_COMPLETE` with summary stats.

### 6.7 Worker Entry Point (`src/simulation/simulation.worker.ts`)

- [ ] 148. Set up `self.onmessage` handler parsing `MainToWorkerMessage`.
- [ ] 149. On `INIT`: instantiate `SimulationEngine` with provided config.
- [ ] 150. On `START`: call `engine.run()`.
- [ ] 151. On `PAUSE`: call `engine.pause()`.
- [ ] 152. On `RESUME`: call `engine.resume(speed)`.
- [ ] 153. On `RESET`: call `engine.reset()`.
- [ ] 154. On `CHAOS_EVENT`: forward to engine's chaos handler.
- [ ] 155. On `UPDATE_CONFIG`: update node config in engine state.
- [ ] 156. Wrap all handlers in try/catch; post `ERROR` message on unhandled exceptions.

### 6.8 Performance Validation

- [ ] 157. Write a benchmark test: 5 generators × 200 RPS → LB → 10 AppServers → Cache → DB; run 60s simulated at max speed; assert ≥ 1,000 events/sec wall-clock throughput.
- [ ] 158. Write a determinism test: run identical config twice with same seed; compare final `SimulationSummary` — must be byte-identical.
- [ ] 159. Profile with Chrome DevTools Worker profiler; identify and eliminate hot spots if < 1,000 events/sec.

---

### Phase 7: Simulation Controls UI

### 7.1 Simulation Toolbar (`src/components/controls/SimulationToolbar.tsx`)

- [ ] 160. Render Start, Pause, Resume, Reset buttons with icons (Play, Pause, Square, Refresh).
- [ ] 161. Render Speed dropdown/selector: 1x, 2x, 5x, 10x, 50x.
- [ ] 162. Display current simulation time (formatted as mm:ss.ms) from metrics store.
- [ ] 163. Display simulation state badge (Idle / Running / Paused / Complete).
- [ ] 164. Wire buttons to `simulationStore` actions (which send Worker messages).
- [ ] 165. Disable Start when already running; disable Pause when idle; etc.
- [ ] 166. Add keyboard shortcuts: Space = Start/Pause toggle, R = Reset.

### 7.2 Chaos Panel (`src/components/controls/ChaosPanel.tsx`)

- [ ] 167. Render 3 chaos buttons: "Flush Cache (Stampede)", "Drop DB Node (Partition)", "Spike Traffic (5× Burst)".
- [ ] 168. Each button disabled when simulation is Idle or Complete.
- [ ] 169. "Flush Cache" sends `CHAOS_EVENT` with type `FLUSH_CACHE`, duration 30s.
- [ ] 170. "Drop DB Node" — if multiple DB nodes, show dropdown to select target; sends `DROP_DB`.
- [ ] 171. "Spike Traffic" sends `SPIKE_TRAFFIC` with 5x multiplier, duration 15s.
- [ ] 172. Display active chaos effects with countdown timer (simulated time remaining).
- [ ] 173. Style buttons with warning colors (amber/red) using shadcn/ui `Button` variant.

---

### Phase 8: Telemetry & Metrics Dashboard

### 8.1 Dashboard Layout (`src/components/telemetry/TelemetryDashboard.tsx`)

- [ ] 174. Render as a bottom or right panel (collapsible/resizable).
- [ ] 175. Layout: 2×2 grid of chart areas + event log sidebar.
- [ ] 176. Subscribe to `simulationStore.metrics` for data updates.
- [ ] 177. Show "No data — start a simulation" placeholder when metrics are null.

### 8.2 Latency Chart (`src/components/telemetry/LatencyChart.tsx`)

- [ ] 178. Render a Recharts `<LineChart>` with 3 series: p50, p90, p99 end-to-end latency.
- [ ] 179. X-axis: simulated time (mm:ss). Y-axis: latency (ms).
- [ ] 180. Maintain a rolling buffer of data points (last 120 snapshots).
- [ ] 181. Tooltip on hover showing exact values.
- [ ] 182. Support zoom (scroll wheel) and pan (drag) via Recharts brush or custom handler.
- [ ] 183. Color coding: p50=blue, p90=amber, p99=red.

### 8.3 Throughput Chart (`src/components/telemetry/ThroughputChart.tsx`)

- [ ] 184. Render a Recharts `<AreaChart>` with series: successful req/sec, error req/sec (stacked).
- [ ] 185. X-axis: simulated time. Y-axis: requests/sec.
- [ ] 186. Rolling buffer of last 120 snapshots.
- [ ] 187. Color: success=green area, errors=red area.

### 8.4 Queue Depth / Connection Pool Gauges (`src/components/telemetry/QueueGauge.tsx`)

- [ ] 188. Render per-node circular or linear gauge (progress bar style).
- [ ] 189. Shows: current / max (e.g., "47 / 50 connections").
- [ ] 190. Color transitions: green (<70%), amber (70–90%), red (>90%).
- [ ] 191. Pulse animation at >90%.
- [ ] 192. Render list of gauges for all relevant nodes (DB, MQ, AppServer).

### 8.5 Event Log (`src/components/telemetry/EventLog.tsx`)

- [ ] 193. Render scrollable list of `SimEventLogEntry` items.
- [ ] 194. Each entry shows: timestamp (sim time), icon per event type, node label, message.
- [ ] 195. Auto-scroll to bottom on new entries (with user override if scrolled up).
- [ ] 196. Filter controls: by event type (dropdown), by node (dropdown).
- [ ] 197. Limit rendered entries (virtualized list or last 500 entries).
- [ ] 198. Highlight chaos events with distinct background color.

### 8.6 Node Health Integration

- [ ] 199. On `NODE_STATUS` Worker message, update `simulationStore.nodeStatuses`.
- [ ] 200. Canvas node components read status from store and update their health ring color.
- [ ] 201. Add CSS transition for smooth color changes (300ms ease).
- [ ] 202. Render a small legend component on the canvas (Green/Yellow/Red definitions).

---

### Phase 9: Pre-Built Demo Templates (Presets)

### 9.1 Preset Data Files (`src/presets/`)

- [ ] 203. **dbExhaustion.json**: Topology: 1 TrafficGenerator (500 RPS) → 1 LoadBalancer → 3 AppServers → 1 Database (pool=10). Chaos timeline: traffic ramps 2x at t=30s, 3x at t=60s.
- [ ] 204. **queueBackpressure.json**: Topology: 1 TrafficGenerator (1000 RPS) → 1 MessageQueue (buffer=500, consumer batch=10) → 1 AppServer (slow: 50ms mean). No explicit chaos — natural backpressure.
- [ ] 205. **cacheStampede.json**: Topology: 1 TrafficGenerator (300 RPS) → 1 LoadBalancer → 2 AppServers → 1 Cache (hit=0.95) → 1 Database (pool=20). Chaos: flush cache at t=20s for 30s.
- [ ] 206. Each JSON file conforms to `.analysys.json` schema v1 (same as export format).
- [ ] 207. Each includes a `chaosTimeline: { time: number; event: ChaosEventPayload }[]` field.

### 9.2 Preset Selector UI (`src/components/presets/PresetSelector.tsx`)

- [ ] 208. Render a dropdown (shadcn/ui `Select`) in the toolbar with preset names + descriptions.
- [ ] 209. On selection, show confirmation dialog if current canvas has unsaved changes.
- [ ] 210. On confirm, call `topologyStore.loadTopology(preset.nodes, preset.edges)`.
- [ ] 211. Auto-start simulation: send INIT + START with the preset's chaos timeline.
- [ ] 212. Schedule chaos events from preset's `chaosTimeline` relative to simulation start.

### 9.3 Custom Scenario Save

- [ ] 213. After loading and modifying a preset, user can "Save as Custom Scenario".
- [ ] 214. Opens a name input dialog; saves to `persistenceStore` (localStorage).
- [ ] 215. Custom scenarios appear in the preset dropdown under a "Custom" separator.

---

### Phase 10: Persistence & Import/Export

### 10.1 localStorage Persistence (`src/utils/localStorage.ts`)

- [ ] 216. Define `AnalysysFileSchema` (TypeScript interface + runtime validator).
- [ ] 217. Include `schemaVersion: number`, `name: string`, `createdAt: string`, `topology: { nodes, edges }`, `chaosTimeline?`.
- [ ] 218. Implement `serialize(topology, name): string` — JSON.stringify with schema version.
- [ ] 219. Implement `deserialize(json: string): ValidationResult & { data?: AnalysysFileSchema }`.
- [ ] 220. Implement `migrateSchema(data, fromVersion): AnalysysFileSchema` — future-proof migration path.

### 10.2 Export/Import UI

- [ ] 221. "Export JSON" button in toolbar — calls `persistenceStore.exportJSON()`, triggers download.
- [ ] 222. "Import JSON" button — opens file picker (`.json` accept filter), reads file, validates, loads.
- [ ] 223. On validation failure, display toast with error details (missing fields, unknown types, version mismatch).
- [ ] 224. On success, load topology and display success toast.

### 10.3 Save/Load UI

- [ ] 225. "Save" button — if unnamed, prompt for name; else overwrite existing.
- [ ] 226. "Load" menu — lists saved topologies (name + date); click to load with confirmation.
- [ ] 227. "Delete" option per saved topology (with confirmation).
- [ ] 228. Display localStorage usage indicator (current MB / 5MB limit).

---

### Phase 11: Accessibility & Polish

### 11.1 Keyboard Navigation

- [ ] 229. Tab order: Palette → Canvas → Config Panel → Toolbar → Chaos Panel → Dashboard.
- [ ] 230. Canvas: Tab focuses nodes sequentially; Arrow keys move focused node; Enter opens config.
- [ ] 231. Toolbar buttons focusable and operable with Enter/Space.
- [ ] 232. Escape closes config panel and deselects node.

### 11.2 Screen Reader Support

- [ ] 233. `aria-live="polite"` region announces simulation state changes ("Simulation started", "Paused at 00:42").
- [ ] 234. `aria-live="assertive"` for chaos events ("Cache flushed — stampede active").
- [ ] 235. Nodes have `aria-label` including type, label, and current health status.
- [ ] 236. Charts have `aria-label` summarizing current values (updated each snapshot).

### 11.3 Visual Polish

- [ ] 237. Consistent color palette via Tailwind theme (CSS variables for health colors).
- [ ] 238. Dark mode support (Tailwind `dark:` variant).
- [ ] 239. Loading skeleton for dashboard before first metrics arrive.
- [ ] 240. Smooth panel resize animations.
- [ ] 241. Responsive layout: stack panels vertically below 1280px width.

---

### Phase 12: Testing & Quality Assurance

### 12.1 Unit Tests (Vitest)

- [ ] 242. `src/simulation/eventQueue.ts` — heap correctness, performance.
- [ ] 243. `src/simulation/prng.ts` — determinism, distribution shape.
- [ ] 244. `src/validation/edgeValidation.ts` — all rules.
- [ ] 245. `src/validation/cycleDetection.ts` — acyclic, cyclic, multi-cycle.
- [ ] 246. `src/validation/configValidation.ts` — boundary cases.
- [ ] 247. `src/simulation/processors/*` — each processor's core logic.
- [ ] 248. `src/simulation/metrics/NodeMetricsAccumulator.ts` — Little's Law correctness.
- [ ] 249. `src/utils/localStorage.ts` — serialize/deserialize/migrate.

### 12.2 Component Tests (React Testing Library)

- [ ] 250. `NodePalette` renders all 6 node types.
- [ ] 251. `NodeConfigPanel` renders correct form fields per node type.
- [ ] 252. `SimulationToolbar` button states match sim state.
- [ ] 253. `ChaosPanel` buttons disabled when sim is idle.
- [ ] 254. `PresetSelector` loads topology on selection.
- [ ] 255. `EventLog` renders entries and auto-scrolls.

### 12.3 Integration Tests

- [ ] 256. Full Worker round-trip: INIT → START → receive METRICS_BATCH → PAUSE → RESET.
- [ ] 257. Chaos injection during running simulation produces expected metrics shift.
- [ ] 258. Import/Export cycle: export topology → import file → canvas matches original.

### 12.4 Performance Tests

- [ ] 259. PB-1: Worker throughput benchmark (≥ 1,000 events/sec).
- [ ] 260. PB-4: Determinism test (10 runs, identical output).
- [ ] 261. Canvas rendering benchmark: 100 nodes + 200 edges, verify ≥ 30 fps.

---

### Phase 13: Build & Deployment

### 13.1 Production Build

- [ ] 262. `npm run build` produces optimized bundle; verify bundle size < 500KB gzipped (excluding preset JSONs).
- [ ] 263. Web Worker is correctly code-split into a separate chunk.
- [ ] 264. Verify no runtime errors in Chrome, Firefox, Edge, Safari via manual smoke test.
- [ ] 265. Add `<meta>` tags, favicon, and page title ("Analysys — Architecture Simulator").

### 13.2 CI/CD (GitHub Actions)

- [ ] 266. Create `.github/workflows/ci.yml`: install → lint → type-check → test → build.
- [ ] 267. Fail on lint errors, type errors, or test failures.
- [ ] 268. Cache `node_modules` for faster runs.
- [ ] 269. Optional: deploy to GitHub Pages or Vercel on push to `main`.

### 13.3 Documentation

- [ ] 270. Write `README.md` with: project overview, screenshot/GIF, quick-start instructions, architecture diagram, contributing guide.
- [ ] 271. Add inline JSDoc comments to all public types and exported functions.
- [ ] 272. Document the `.analysys.json` file schema (for users creating custom presets externally).

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
    Phase 13 (Build & Deploy)
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
| **Total** | **~192** | **~58–80 hrs** |

## Notes

- Phases 4, 5, and 6 can be developed in parallel once types and stores are in place.
- The simulation engine (Phase 6) is the most complex piece; consider timeboxing and iterating.
- Preset JSON files serve as both demo content and integration test fixtures.
- The `.analysys.json` schema should be versioned from day one to support future migrations.
- Performance benchmarks (≥1,000 events/sec, ≥30 fps) are hard requirements validated in Phase 12.
