# Requirements: Analysys — Interactive Backend Architecture Visualizer & Discrete-Event Simulation Tool

## 1. Overview

Analysys is a browser-based tool that enables engineers to visually model distributed system topologies on an interactive canvas, run discrete-event simulations entirely client-side via Web Workers, inject chaos failures, and observe real-time telemetry (latency percentiles, throughput, queue depth) — all without a backend server.

---

## 2. User Stories & Acceptance Criteria

### 2.1 Interactive Node Canvas (Visual Topology Editor)

#### US-1: Drag-and-Drop Node Placement

**As a** systems engineer,
**I want to** drag nodes from a palette onto a canvas,
**So that** I can visually model my backend architecture topology.

**Acceptance Criteria:**

- [ ] A side palette lists all supported node types: Traffic Generator, Load Balancer, App Server, Cache, Database, Message Queue.
- [ ] Each node type has a distinct icon and label.
- [ ] Dragging a node from the palette onto the canvas creates a new instance at the drop coordinates.
- [ ] Nodes can be repositioned freely on the canvas after placement.
- [ ] Nodes can be deleted via context menu or keyboard shortcut (Delete/Backspace).
- [ ] Undo/Redo support for node add, move, and delete operations.

#### US-2: Directional Edge Connections

**As a** systems engineer,
**I want to** connect nodes with directional edges representing network calls,
**So that** I can define the request flow between components.

**Acceptance Criteria:**

- [ ] Edges are created by dragging from a source handle to a target handle on another node.
- [ ] Each edge has a configurable type: Synchronous (HTTP/gRPC) or Asynchronous (AMQP/Kafka).
- [ ] Edge type is visually distinguishable (solid line for sync, dashed line for async).
- [ ] Edges display an arrowhead indicating request direction.
- [ ] Edges can be deleted via selection and keyboard shortcut or context menu.
- [ ] Self-referencing edges (node to itself) are disallowed at creation time.

#### US-3: Node Configuration Panel

**As a** systems engineer,
**I want to** configure each node's behavioral parameters,
**So that** the simulation reflects realistic operational characteristics.

**Acceptance Criteria:**

- [ ] Clicking a node opens a configuration panel (sidebar or modal).
- [ ] Traffic Generator parameters: RPS (1–100,000), distribution (Poisson, Uniform), spike multiplier (1x–20x), spike duration (seconds).
- [ ] Load Balancer parameters: algorithm (Round Robin, Least Connections), health-check interval (ms), eviction threshold (consecutive failures).
- [ ] App Server parameters: worker thread pool size (1–1,000), request queue depth (0–10,000), processing time distribution (mean, std dev in ms).
- [ ] Cache (Redis) parameters: hit ratio (0.0–1.0), eviction policy (LRU, LFU, TTL), access latency (ms).
- [ ] Database parameters: connection pool size (1–500), query latency distribution (mean, std dev in ms), lock timeout (ms), type (Relational/NoSQL).
- [ ] Message Queue (Kafka) parameters: consumer batch size (1–10,000), buffer capacity (messages), backpressure threshold (%), retention policy.
- [ ] All parameter inputs validate ranges and display inline error messages for invalid values.
- [ ] Configuration changes are reflected immediately without requiring simulation restart (hot-reconfigurable during pause).

### 2.2 Off-Thread Discrete-Event Simulation Engine

#### US-4: Start, Pause, Resume, and Reset Simulation

**As a** systems engineer,
**I want to** control the simulation lifecycle,
**So that** I can observe system behavior at my own pace.

**Acceptance Criteria:**

- [ ] A toolbar provides Start, Pause, Resume, Reset, and Speed controls.
- [ ] Start initiates the simulation from t=0 using the current canvas topology and node configurations.
- [ ] Pause freezes the virtual clock; all metrics and visuals retain their last state.
- [ ] Resume continues from the paused state without losing pending events.
- [ ] Reset clears all simulation state (metrics, queues, in-flight requests) and returns to t=0.
- [ ] Speed control allows 1x, 2x, 5x, 10x, and 50x time acceleration.
- [ ] The simulation runs inside a Web Worker — the main UI thread remains responsive (no dropped frames above 30 fps) during execution.

#### US-5: Discrete-Event Processing with Priority Queue

**As a** simulation engine,
**I need to** process events in virtual-time order using a min-heap priority queue,
**So that** causal ordering is preserved and results are deterministic for a given seed.

**Acceptance Criteria:**

- [ ] Events are scheduled with a virtual timestamp and processed in ascending order.
- [ ] The min-heap supports O(log n) insert and O(log n) extract-min.
- [ ] A deterministic PRNG (seeded) drives all stochastic distributions (Poisson arrivals, latency sampling).
- [ ] Given the same topology, configuration, and seed, two runs produce identical metric outputs.
- [ ] The engine processes a minimum of 1,000 events per wall-clock second in the Web Worker (see Performance Benchmarks §5).

#### US-6: Request Lifecycle & Little's Law

**As a** systems engineer,
**I want** each simulated request to traverse the topology and accumulate realistic latency,
**So that** I can observe bottleneck propagation and validate Little's Law (L = λW).

**Acceptance Criteria:**

- [ ] A request originates at a Traffic Generator, follows edges through the topology, and terminates with a success or failure status.
- [ ] At each node, the request may: enqueue (if queue is full → drop/timeout), be processed (incurs latency), and route to downstream nodes.
- [ ] Connection pool exhaustion at a Database node causes new requests to wait or timeout (configurable).
- [ ] Cache miss triggers a downstream database call; cache hit returns immediately with configured latency.
- [ ] Queue backpressure at a Message Queue node blocks or drops upstream producers when buffer capacity is reached.
- [ ] The telemetry dashboard displays real-time L (queue length), λ (arrival rate), and W (wait time) per node, validating L = λW within 5% tolerance under steady state.

### 2.3 Telemetry & Signal Analysis Dashboard

#### US-7: Real-Time Latency & Throughput Charts

**As a** systems engineer,
**I want to** observe live time-series metrics for each node and the overall system,
**So that** I can identify performance degradation and saturation points.

**Acceptance Criteria:**

- [ ] A dashboard panel displays synchronized time-series charts for: p50, p90, p99 end-to-end latency; per-node latency contribution; throughput (successful requests/sec); error rate (timeouts + drops/sec).
- [ ] Charts update in real-time as the simulation runs (minimum 2 updates per simulated second at 1x speed).
- [ ] Hovering over a chart shows a tooltip with exact values at the hovered timestamp.
- [ ] Time axis is labeled in simulated time (not wall-clock time).
- [ ] Charts support zoom (scroll) and pan (drag) for historical analysis during pause.

#### US-8: Node Health Status Indicators

**As a** systems engineer,
**I want to** see at-a-glance health indicators on each canvas node,
**So that** I can quickly identify which components are degraded.

**Acceptance Criteria:**

- [ ] Each node on the canvas displays a colored status ring or badge.
- [ ] Green: utilization < 70%, no drops or timeouts.
- [ ] Yellow: utilization 70%–90% OR occasional timeouts (< 5% error rate).
- [ ] Red: utilization > 90% OR error rate ≥ 5% OR active drops.
- [ ] Status transitions are animated (smooth color fade, not abrupt).
- [ ] A legend is visible explaining the color coding.

#### US-9: Connection Pool & Queue Depth Gauges

**As a** systems engineer,
**I want to** see real-time fill-level gauges for connection pools and message queues,
**So that** I can anticipate resource exhaustion before it causes failures.

**Acceptance Criteria:**

- [ ] Database nodes display a gauge showing active connections / max pool size.
- [ ] Message Queue nodes display a gauge showing buffered messages / max capacity.
- [ ] App Server nodes display a gauge showing queue depth / max queue depth.
- [ ] Gauges animate smoothly and update at the same cadence as the charts.
- [ ] When a gauge exceeds 90%, it pulses or highlights to draw attention.

### 2.4 Chaos & Stress Testing Sandbox

#### US-10: One-Click Chaos Injection

**As a** systems engineer,
**I want to** inject common failure scenarios with a single click,
**So that** I can observe cascading failure behavior without manual reconfiguration.

**Acceptance Criteria:**

- [ ] A Chaos Panel provides labeled buttons: "Flush Cache (Stampede)", "Drop DB Node (Partition)", "Spike Traffic (5x Burst)".
- [ ] "Flush Cache" sets all Cache nodes' hit ratio to 0.0 for a configurable duration (default 30 simulated seconds), then restores.
- [ ] "Drop DB Node" marks a selected (or random) Database node as unreachable; all in-flight and new connections timeout.
- [ ] "Spike Traffic" multiplies all Traffic Generator RPS by 5x for a configurable duration (default 15 simulated seconds).
- [ ] Each chaos event is logged with a timestamp in a simulation event log visible to the user.
- [ ] Chaos can be injected during a running simulation without pausing.

#### US-11: Scenario Presets

**As a** systems engineer or hackathon judge,
**I want to** load pre-built topology + chaos scenarios,
**So that** I can quickly demonstrate or evaluate specific failure modes.

**Acceptance Criteria:**

- [ ] A "Presets" dropdown offers at least 3 built-in scenarios:
  1. **Database Connection Exhaustion**: 3-tier app (LB → App × 3 → DB), traffic ramps until pool exhaustion.
  2. **Queue Backpressure Decoupling**: Producer → Kafka → Consumer, consumer slower than producer.
  3. **Cache Stampede & Recovery**: LB → App → Cache → DB, cache flush triggers thundering herd.
- [ ] Loading a preset replaces the current canvas (with confirmation dialog if unsaved changes exist).
- [ ] Each preset auto-starts the simulation with a pre-configured chaos timeline.
- [ ] Users can modify a loaded preset and save it as a custom scenario (localStorage persistence).

### 2.5 Persistence & Export

#### US-12: Save and Load Topologies

**As a** systems engineer,
**I want to** save my canvas topology and configurations locally,
**So that** I can return to previous designs without rebuilding them.

**Acceptance Criteria:**

- [ ] "Save" serializes the full state (nodes, edges, positions, configurations) to localStorage.
- [ ] "Load" lists previously saved topologies by name and timestamp.
- [ ] "Export JSON" downloads the topology as a `.analysys.json` file.
- [ ] "Import JSON" accepts a `.analysys.json` file and restores the topology.
- [ ] Schema versioning: imported files from older schema versions are migrated automatically or rejected with a clear error message.

---

## 3. System Input/Output Boundaries

### 3.1 Inputs

| Source | Data | Format |
|--------|------|--------|
| User (Canvas) | Node placement, edge connections, node configuration | React state / Zustand store |
| User (Controls) | Start, Pause, Resume, Reset, Speed, Chaos triggers | UI events → postMessage to Worker |
| User (Presets) | Preset selection | Predefined JSON topology + chaos timeline |
| User (Import) | External topology file | `.analysys.json` (JSON schema v1) |

### 3.2 Outputs

| Destination | Data | Format |
|-------------|------|--------|
| Canvas (Main Thread) | Node health status, edge animation state | Worker → postMessage → React state |
| Telemetry Dashboard | Time-series metrics (latency, throughput, errors, queue depths) | Batched metric snapshots (every 100ms wall-clock) |
| Simulation Event Log | Timestamped event entries (request created, queued, processed, dropped, chaos injected) | Append-only array rendered in scrollable panel |
| Export | Full topology + config | `.analysys.json` file download |
| LocalStorage | Saved topologies | Serialized JSON (keyed by user-assigned name) |

### 3.3 Worker Communication Protocol

| Message Direction | Type | Payload |
|-------------------|------|---------|
| Main → Worker | `INIT` | Full topology graph + node configs + PRNG seed |
| Main → Worker | `START` | Speed multiplier |
| Main → Worker | `PAUSE` | — |
| Main → Worker | `RESUME` | Speed multiplier |
| Main → Worker | `RESET` | — |
| Main → Worker | `CHAOS_EVENT` | Event type + target node ID + parameters |
| Main → Worker | `UPDATE_CONFIG` | Node ID + updated configuration |
| Worker → Main | `METRICS_BATCH` | Array of per-node metric snapshots |
| Worker → Main | `NODE_STATUS` | Node ID + health status (green/yellow/red) |
| Worker → Main | `EVENT_LOG` | Array of simulation event log entries |
| Worker → Main | `SIM_COMPLETE` | Final summary statistics |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| Metric | Target |
|--------|--------|
| Simulation throughput | ≥ 1,000 events/sec processed in Web Worker |
| UI frame rate during simulation | ≥ 30 fps (no main-thread blocking) |
| Metrics update latency (Worker → UI) | ≤ 100ms wall-clock at 1x speed |
| Canvas rendering (100 nodes, 200 edges) | ≤ 16ms per frame (60 fps target) |
| Initial page load (Vite production build) | ≤ 3 seconds on 4G connection |
| Worker initialization | ≤ 500ms from Start click to first event processed |

### 4.2 Scalability

| Dimension | Supported Range |
|-----------|----------------|
| Nodes on canvas | 1–200 |
| Edges on canvas | 0–500 |
| Concurrent simulated in-flight requests | Up to 50,000 |
| Simulation time window | Up to 30 minutes (simulated) |
| Saved topologies in localStorage | Up to 50 (with size warnings at 4MB) |

### 4.3 Browser Compatibility

- Chrome 90+
- Firefox 90+
- Edge 90+
- Safari 15+ (WebWorker + structured clone required)

### 4.4 Accessibility

- All interactive controls meet WCAG 2.1 AA.
- Keyboard navigation for node palette, canvas (Tab/Arrow for node focus), and toolbar.
- Screen-reader announcements for simulation state changes and chaos events.
- Sufficient color contrast for health indicators; pattern/icon differentiation supplements color.

---

## 5. Performance Benchmarks

### PB-1: Web Worker Throughput

**Scenario:** 5 Traffic Generators at 200 RPS each → LB → 10 App Servers → Cache → DB.
**Measure:** Total events processed per wall-clock second.
**Pass Criteria:** ≥ 1,000 events/sec sustained over a 60-second simulated window at 10x speed.

### PB-2: UI Responsiveness Under Load

**Scenario:** Simulation running at 50x speed with 100 nodes and 200 edges on canvas.
**Measure:** Main-thread frame timing via `requestAnimationFrame` delta.
**Pass Criteria:** 95th percentile frame time ≤ 33ms (≥ 30 fps).

### PB-3: Metrics Delivery Freshness

**Scenario:** Simulation at 1x speed, 500 RPS total.
**Measure:** Wall-clock delay between Worker computing a metric snapshot and the chart rendering it.
**Pass Criteria:** ≤ 150ms end-to-end (Worker computation + postMessage + React render).

### PB-4: Determinism Verification

**Scenario:** Identical topology, configuration, and PRNG seed.
**Measure:** Byte-level comparison of final metrics JSON after 5-minute simulated run.
**Pass Criteria:** 100% identical output across 10 consecutive runs.

---

## 6. Edge Case Assertions

### EC-1: Circular Topology Loops

**Condition:** User connects Node A → Node B → Node C → Node A (cycle).
**Expected Behavior:**
- Simulation detects the cycle and enforces a max-hop limit (configurable, default 20).
- Requests exceeding the max-hop limit are terminated with a `LOOP_DETECTED` status.
- A warning badge appears on nodes participating in the cycle.
- The event log records cycle termination with the traversal path.

### EC-2: Disconnected / Orphan Nodes

**Condition:** A node exists on the canvas with no incoming or outgoing edges.
**Expected Behavior:**
- Traffic Generators with no outgoing edge produce requests that immediately terminate with `NO_ROUTE` status.
- Non-generator nodes with no incoming edge are idle; their metrics remain at zero.
- A visual indicator (dimmed opacity or dashed border) marks disconnected nodes.
- Simulation proceeds without error; disconnected nodes do not block or crash the engine.

### EC-3: Zero Connection Pool Size

**Condition:** User sets a Database node's connection pool size to 0.
**Expected Behavior:**
- Input validation rejects 0 and displays an inline error ("Minimum pool size is 1").
- If bypassed (e.g., via JSON import with pool size 0), the engine treats it as pool size 1 and logs a normalization warning.

### EC-4: All Cache Misses (Hit Ratio = 0.0)

**Condition:** Cache hit ratio configured to 0.0 (100% miss rate).
**Expected Behavior:**
- Every request through the cache triggers a downstream DB call.
- Cache node still incurs its configured access latency (lookup cost) before forwarding.
- Metrics correctly reflect 0% hit ratio; no division-by-zero errors in hit-rate calculations.

### EC-5: Consumer Slower Than Producer (Unbounded Growth)

**Condition:** Message Queue consumer processing rate < producer publish rate, buffer capacity set to maximum.
**Expected Behavior:**
- Buffer fills at the differential rate.
- When buffer reaches capacity, backpressure behavior activates (configurable: drop oldest, block producer, or reject new).
- Metrics show monotonically increasing buffer occupancy until capacity is reached.
- No memory leak in the Web Worker; buffer is bounded by the configured capacity, not JS array growth.

### EC-6: Rapid Start/Stop/Reset Cycling

**Condition:** User clicks Start → Pause → Reset → Start in rapid succession (< 100ms between actions).
**Expected Behavior:**
- Each state transition is processed sequentially; no race conditions.
- Reset fully clears state before the subsequent Start initializes fresh state.
- No zombie events from a previous run appear in the new run's metrics.
- Worker message queue drains correctly; no orphan postMessage callbacks.

### EC-7: Maximum Canvas Scale (200 Nodes, 500 Edges)

**Condition:** User creates the maximum supported topology.
**Expected Behavior:**
- Canvas remains interactive (pan, zoom, select) at ≥ 30 fps.
- Simulation start time ≤ 2 seconds.
- Metrics dashboard renders without truncation or overlap.
- Export/Import handles the full topology without exceeding localStorage 5MB limit warning.

### EC-8: Import of Malformed or Incompatible JSON

**Condition:** User imports a `.analysys.json` file with missing fields, unknown node types, or a future schema version.
**Expected Behavior:**
- Parser validates against the schema before applying.
- Missing required fields produce a clear error listing the missing fields.
- Unknown node types are rejected with a message naming the unrecognized type.
- Future schema versions display "This file requires Analysys vX.Y or later" rather than crashing.
- The canvas is not modified if import validation fails.

---

## 7. Technical Constraints & Stack

| Layer | Technology | Rationale |
|-------|-----------|-----------|
| Frontend Framework | React 18+ with TypeScript | Component model, ecosystem, type safety |
| Build Tool | Vite 5+ | Fast HMR, native ESM, optimized production builds |
| Canvas Engine | @xyflow/react (React Flow v12+) | Mature node-graph library with handles, minimap, controls |
| State Management | Zustand | Minimal boilerplate, works well with React Flow |
| Simulation Engine | Pure TypeScript in Web Worker | Off-thread execution, no DOM dependency, testable in isolation |
| Charts | Recharts or Chart.js (via react-chartjs-2) | Time-series rendering with React integration |
| UI Components | shadcn/ui + Tailwind CSS | Accessible primitives, utility-first styling |
| Persistence | localStorage + File API | No backend required; fully client-side |
| Testing | Vitest + React Testing Library + Playwright | Unit, component, and E2E coverage |

---

## 8. Glossary

| Term | Definition |
|------|-----------|
| RPS | Requests Per Second — the rate at which a Traffic Generator emits requests. |
| Little's Law | L = λW — the long-term average number of items in a system equals the arrival rate multiplied by the average time an item spends in the system. |
| Backpressure | A flow-control mechanism where a downstream component signals upstream to slow down or stop sending. |
| Cache Stampede | A sudden surge of cache misses (e.g., after flush) causing all requests to hit the backing store simultaneously. |
| Discrete-Event Simulation | A modeling approach where state changes occur at discrete points in simulated time, driven by an event queue. |
| Min-Heap | A binary heap data structure where the minimum element can be extracted in O(log n), used for the event priority queue. |
| PRNG | Pseudorandom Number Generator — produces deterministic sequences given a seed. |
| Chaos Engineering | The practice of deliberately injecting failures to test system resilience. |

---

## 9. Open Questions / Future Considerations

- **Collaborative editing**: Should multiple users be able to edit the same topology in real-time (WebSocket/CRDT)?
- **Export to infrastructure-as-code**: Generate Terraform/Pulumi stubs from the topology?
- **Historical simulation replay**: Record full event logs for scrubbing through past runs?
- **Custom node plugins**: Allow users to define custom node types with scripted behavior?
- **Backend persistence**: Optional cloud save (auth + API) for cross-device access?
