# Requirements Document

## Introduction

Analysys is a browser-based tool that enables engineers to visually model distributed system topologies on an interactive canvas, run discrete-event simulations entirely client-side via Web Workers, inject chaos failures, and observe real-time telemetry (latency percentiles, throughput, queue depth) — all without a backend server.

## Glossary

- **System**: The Analysys application as a whole, including the canvas editor, simulation engine, and telemetry dashboard.
- **Canvas**: The interactive visual workspace where nodes and edges are placed to model a topology.
- **Simulation_Engine**: The discrete-event simulation engine running in a Web Worker, responsible for processing events in virtual-time order.
- **Traffic_Generator**: A node type that emits simulated requests at a configured rate and distribution.
- **API_Gateway**: A node type representing the front door of a topology, applying an authentication latency to every request and rejecting a configured fraction as unauthorized before they reach downstream capacity.
- **Rate_Limiter**: A node type that admits requests according to a token bucket, allowing a burst up to its capacity and then only as fast as tokens are replenished, rejecting the remainder.
- **Load_Balancer**: A node type that distributes incoming requests across downstream nodes using a configured algorithm.
- **Circuit_Breaker**: A node type guarding a downstream dependency, fast-failing requests once the observed downstream error rate crosses a threshold so the dependency has room to recover.
- **App_Server**: A node type representing an application server with a thread pool and request queue.
- **Cache**: A node type representing a caching layer (e.g., Redis) with configurable hit ratio and eviction policy.
- **Database**: A node type representing a database with a connection pool and query latency distribution.
- **Message_Queue**: A node type representing a message broker (e.g., Kafka) with buffer capacity and backpressure behavior.
- **Telemetry_Dashboard**: The panel displaying real-time time-series charts, gauges, and health indicators.
- **Chaos_Panel**: The UI panel providing one-click chaos injection controls.
- **RPS**: Requests Per Second — the rate at which a Traffic Generator emits requests.
- **Little's_Law**: L = λW — the long-term average number of items in a system equals the arrival rate multiplied by the average time an item spends in the system.
- **Backpressure**: A flow-control mechanism where a downstream component signals upstream to slow down or stop sending.
- **Cache_Stampede**: A sudden surge of cache misses (e.g., after flush) causing all requests to hit the backing store simultaneously.
- **Discrete_Event_Simulation**: A modeling approach where state changes occur at discrete points in simulated time, driven by an event queue.
- **Min_Heap**: A binary heap data structure where the minimum element can be extracted in O(log n), used for the event priority queue.
- **PRNG**: Pseudorandom Number Generator — produces deterministic sequences given a seed.
- **Chaos_Engineering**: The practice of deliberately injecting failures to test system resilience.

## Requirements

### Requirement 1: Drag-and-Drop Node Placement

**User Story:** As a systems engineer, I want to drag nodes from a palette onto a canvas, so that I can visually model my backend architecture topology.

#### Acceptance Criteria

1. THE System SHALL display a side palette listing all supported node types: Traffic Generator, API Gateway, Rate Limiter, Load Balancer, Circuit Breaker, App Server, Cache, Database, Message Queue.
2. THE System SHALL render each node type with a distinct icon and label in the palette.
3. WHEN a node is dragged from the palette onto the Canvas, THE System SHALL create a new instance at the drop coordinates.
4. WHEN a node is repositioned on the Canvas, THE System SHALL update its position freely without constraint.
5. WHEN a node is selected and the Delete or Backspace key is pressed or a context menu delete action is triggered, THE System SHALL remove the node from the Canvas.
6. THE System SHALL support Undo and Redo operations for node add, move, and delete actions.

### Requirement 2: Directional Edge Connections

**User Story:** As a systems engineer, I want to connect nodes with directional edges representing network calls, so that I can define the request flow between components.

#### Acceptance Criteria

1. WHEN a user drags from a source handle on one node to a target handle on another node, THE System SHALL create a directional edge between the two nodes.
2. THE System SHALL support two configurable edge types: Synchronous (HTTP/gRPC) and Asynchronous (AMQP/Kafka).
3. THE System SHALL render Synchronous edges as solid lines and Asynchronous edges as dashed lines.
4. THE System SHALL display an arrowhead on each edge indicating request direction.
5. WHEN an edge is selected and deleted via keyboard shortcut or context menu, THE System SHALL remove the edge from the Canvas.
6. WHEN a user attempts to create a self-referencing edge (source and target are the same node), THE System SHALL reject the connection and not create the edge.

### Requirement 3: Node Configuration Panel

**User Story:** As a systems engineer, I want to configure each node's behavioral parameters, so that the simulation reflects realistic operational characteristics.

#### Acceptance Criteria

1. WHEN a node is clicked, THE System SHALL open a configuration panel displaying editable parameters for that node type.
2. WHILE a Traffic_Generator node is selected, THE System SHALL display configurable parameters: RPS (1–100,000), distribution (Poisson, Uniform), spike multiplier (1x–20x), spike duration (seconds).
3. WHILE an API_Gateway node is selected, THE System SHALL display configurable parameters: auth latency distribution (mean 0–60,000 ms, std dev 0–30,000 ms), rejection rate (0.0–1.0).
4. WHILE a Rate_Limiter node is selected, THE System SHALL display configurable parameters: bucket capacity (1–1,000,000 tokens), refill rate (1–1,000,000 tokens/sec).
5. WHILE a Load_Balancer node is selected, THE System SHALL display configurable parameters: algorithm (Round Robin, Least Connections), health-check interval (ms), eviction threshold (consecutive failures).
6. WHILE a Circuit_Breaker node is selected, THE System SHALL display configurable parameters: error threshold (0.0–1.0), open duration (100–300,000 ms), probe count (1–1,000).
7. WHILE an App_Server node is selected, THE System SHALL display configurable parameters: worker thread pool size (1–1,000), request queue depth (0–10,000), processing time distribution (mean, std dev in ms).
8. WHILE a Cache node is selected, THE System SHALL display configurable parameters: hit ratio (0.0–1.0), eviction policy (LRU, LFU, TTL), access latency (ms).
9. WHILE a Database node is selected, THE System SHALL display configurable parameters: connection pool size (1–500), query latency distribution (mean, std dev in ms), lock timeout (ms), type (Relational/NoSQL).
10. WHILE a Message_Queue node is selected, THE System SHALL display configurable parameters: consumer batch size (1–10,000), buffer capacity (messages), backpressure threshold (%), retention policy.
11. IF an invalid value is entered for a parameter, THEN THE System SHALL display an inline error message indicating the valid range.
12. WHILE the simulation is paused, THE System SHALL apply configuration changes immediately without requiring a simulation restart.

### Requirement 4: Simulation Lifecycle Controls

**User Story:** As a systems engineer, I want to control the simulation lifecycle, so that I can observe system behavior at my own pace.

#### Acceptance Criteria

1. THE System SHALL provide a toolbar with Start, Pause, Resume, Stop, Reset, and Speed controls with clear text labels.
2. WHEN Start is clicked, THE Simulation_Engine SHALL initialize from t=0 using the current Canvas topology and node configurations.
3. WHEN Pause is clicked, THE Simulation_Engine SHALL freeze the virtual clock and retain all metrics and visual state.
4. WHEN Resume is clicked, THE Simulation_Engine SHALL continue from the paused state without losing pending events.
5. WHEN Reset is clicked, THE Simulation_Engine SHALL clear all simulation state (metrics, queues, in-flight requests) and return to t=0.
5a. WHEN Stop is clicked, THE System SHALL terminate the Worker and set state to Complete, preserving all metrics for review.
5b. THE System SHALL show contextual buttons: Start/Resume when not running, Pause when running, Stop when running or paused, Reset when not idle.
6. THE System SHALL support speed control at 1x, 2x, 5x, 10x, and 50x time acceleration.
7. THE Simulation_Engine SHALL run inside a Web Worker so that the main UI thread remains responsive at 30 fps or above during execution.

### Requirement 5: Discrete-Event Processing with Priority Queue

**User Story:** As a simulation engine, I need to process events in virtual-time order using a min-heap priority queue, so that causal ordering is preserved and results are deterministic for a given seed.

#### Acceptance Criteria

1. THE Simulation_Engine SHALL schedule events with a virtual timestamp and process them in ascending order.
2. THE Simulation_Engine SHALL implement the event priority queue using a Min_Heap supporting O(log n) insert and O(log n) extract-min.
3. THE Simulation_Engine SHALL use a deterministic PRNG (seeded) to drive all stochastic distributions (Poisson arrivals, latency sampling).
4. WHEN the same topology, configuration, and seed are provided, THE Simulation_Engine SHALL produce identical metric outputs across runs.
5. THE Simulation_Engine SHALL process a minimum of 1,000 events per wall-clock second in the Web Worker.

### Requirement 6: Request Lifecycle and Little's Law Validation

**User Story:** As a systems engineer, I want each simulated request to traverse the topology and accumulate realistic latency, so that I can observe bottleneck propagation and validate Little's Law (L = λW).

#### Acceptance Criteria

1. WHEN a request is emitted by a Traffic_Generator, THE Simulation_Engine SHALL route it through the topology following defined edges until it terminates with a success or failure status.
2. WHEN a request arrives at a node with a full queue, THE Simulation_Engine SHALL drop or timeout the request according to the node configuration.
3. WHEN a Database node's connection pool is exhausted, THE Simulation_Engine SHALL cause new requests to wait or timeout based on the configured lock timeout.
4. WHEN a request arrives at a Cache node, THE Simulation_Engine SHALL return immediately with configured access latency on a cache hit, or trigger a downstream Database call on a cache miss.
5. WHEN a Message_Queue node's buffer capacity is reached, THE Simulation_Engine SHALL activate backpressure behavior (block or drop upstream producers) as configured.
6. THE Telemetry_Dashboard SHALL display real-time L (queue length), λ (arrival rate), and W (wait time) per node, validating Little's_Law within 5% tolerance under steady state.
7. WHEN a request reaches a terminal node (Database or Cache hit), THE Simulation_Engine SHALL generate response events that traverse the request path in reverse, accumulating response latency (network + serialization) at each hop.
8. THE Telemetry_Dashboard SHALL display round-trip latency (request + response) as the end-to-end metric.
9. WHEN the simulation is running, THE Canvas SHALL render animated packet dots traveling along edges: blue dots in the request direction (source → target) and green dots in the response direction (target → source).

### Requirement 7: Real-Time Latency and Throughput Charts

**User Story:** As a systems engineer, I want to observe live time-series metrics for each node and the overall system, so that I can identify performance degradation and saturation points.

#### Acceptance Criteria

1. THE Telemetry_Dashboard SHALL display synchronized time-series charts for: p50, p90, p99 end-to-end latency; per-node latency contribution; throughput (successful requests/sec); error rate (timeouts + drops/sec).
2. WHILE the simulation is running at 1x speed, THE Telemetry_Dashboard SHALL update charts at a minimum of 2 updates per simulated second.
3. WHEN a user hovers over a chart, THE Telemetry_Dashboard SHALL show a tooltip with exact values at the hovered timestamp.
4. THE Telemetry_Dashboard SHALL label the time axis in simulated time, not wall-clock time.
5. WHILE the simulation is paused, THE Telemetry_Dashboard SHALL support zoom (scroll) and pan (drag) for historical analysis.

### Requirement 8: Node Health Status Indicators

**User Story:** As a systems engineer, I want to see at-a-glance health indicators on each canvas node, so that I can quickly identify which components are degraded.

#### Acceptance Criteria

1. THE System SHALL display a colored status ring or badge on each node on the Canvas.
2. WHILE a node's utilization is below 70% and it has no drops or timeouts, THE System SHALL display a green status indicator.
3. WHILE a node's utilization is between 70% and 90% OR it has occasional timeouts (less than 5% error rate), THE System SHALL display a yellow status indicator.
4. WHILE a node's utilization exceeds 90% OR its error rate is 5% or greater OR it has active drops, THE System SHALL display a red status indicator.
5. WHEN a node's status transitions between colors, THE System SHALL animate the transition with a smooth color fade.
6. THE System SHALL display a visible legend explaining the health indicator color coding.
7. THE System SHALL identify every node in the Telemetry_Dashboard, the Queue/Connection gauges, and the event log by its user-assigned label rather than its internal node identifier, and SHALL expose the full identifier as hover text.
8. WHEN a node's user-assigned label is unavailable because the node is no longer present in the topology, THE System SHALL fall back to a shortened form of that node's identifier.
9. WHEN a user selects a node on the Canvas, THE System SHALL offer a per-node activity view alongside the node's configuration form.
10. WHILE a node is selected and metrics are available for it, THE per-node activity view SHALL display that node's health status, throughput, error rate, p50/p90/p99 latency percentiles, the resource measures applicable to its node type (queue depth, active connections, buffered messages), and its utilization with a plain-language explanation of what utilization measures for that node type.
11. WHILE a node is selected and metrics are available for it, THE per-node activity view SHALL display that node's Little's Law figures (L, lambda, W), a stability indicator, and the deviation from the ideal relationship.
12. WHILE a node is selected, THE per-node activity view SHALL display the most recent events recorded for that node with their simulated timestamps.
13. WHILE no metrics are available for the selected node, THE per-node activity view SHALL display a message directing the user to start a simulation.
14. WHERE a metric does not apply to the selected node's type, THE per-node activity view SHALL display a plain-language explanation of why it does not apply instead of a numeric value, so that a not-applicable metric is never presented as a measured zero.
15. WHILE a Traffic_Generator node is selected, THE per-node activity view SHALL present its latency percentiles and its Little's Law figures as not applicable, because a source node originates requests rather than serving or holding them.
16. WHILE no requests completed at the selected node during the current metrics window, THE per-node activity view SHALL indicate that the window recorded no completions instead of displaying a zero latency.
17. WHERE a resource measure or utilization figure for the selected node is zero, THE per-node activity view SHALL annotate it as an idle state, so that a healthy zero is distinguishable from missing data.

### Requirement 9: Connection Pool and Queue Depth Gauges

**User Story:** As a systems engineer, I want to see real-time fill-level gauges for connection pools and message queues, so that I can anticipate resource exhaustion before it causes failures.

#### Acceptance Criteria

1. THE System SHALL display a gauge on Database nodes showing active connections divided by max pool size.
2. THE System SHALL display a gauge on Message_Queue nodes showing buffered messages divided by max capacity.
3. THE System SHALL display a gauge on App_Server nodes showing queue depth divided by max queue depth.
4. THE System SHALL animate gauges smoothly and update them at the same cadence as the Telemetry_Dashboard charts.
5. WHEN a gauge exceeds 90% capacity, THE System SHALL pulse or highlight the gauge to draw attention.

### Requirement 10: One-Click Chaos Injection

**User Story:** As a systems engineer, I want to inject common failure scenarios with a single click, so that I can observe cascading failure behavior without manual reconfiguration.

#### Acceptance Criteria

1. THE Chaos_Panel SHALL provide labeled buttons: "Flush Cache (Stampede)", "Drop DB Node (Partition)", "Spike Traffic (5x Burst)".
2. WHEN "Flush Cache" is triggered, THE Simulation_Engine SHALL set all Cache nodes' hit ratio to 0.0 for a configurable duration (default 30 simulated seconds), then restore the original value.
3. WHEN "Drop DB Node" is triggered, THE Simulation_Engine SHALL mark a selected (or random) Database node as unreachable, causing all in-flight and new connections to timeout.
4. WHEN "Spike Traffic" is triggered, THE Simulation_Engine SHALL multiply all Traffic_Generator RPS by 5x for a configurable duration (default 15 simulated seconds).
5. WHEN a chaos event is triggered, THE System SHALL log the event with a timestamp in the simulation event log visible to the user.
6. THE System SHALL allow chaos injection during a running simulation without requiring a pause.

### Requirement 11: Scenario Presets

**User Story:** As a systems engineer or hackathon judge, I want to load pre-built topology and chaos scenarios, so that I can quickly demonstrate or evaluate specific failure modes.

#### Acceptance Criteria

1. THE System SHALL provide a "Presets" dropdown offering at least 3 built-in scenarios: Database Connection Exhaustion (3-tier app with traffic ramp until pool exhaustion), Queue Backpressure Decoupling (Producer to Kafka to Consumer where consumer is slower), and Cache Stampede and Recovery (cache flush triggers thundering herd).
2. WHEN a preset is selected and unsaved changes exist on the Canvas, THE System SHALL display a confirmation dialog before replacing the current topology.
3. WHEN a preset is loaded, THE System SHALL auto-start the simulation with a pre-configured chaos timeline.
4. THE System SHALL allow users to modify a loaded preset and save it as a custom scenario persisted in localStorage.

### Requirement 12: Save and Load Topologies

**User Story:** As a systems engineer, I want to save my canvas topology and configurations locally, so that I can return to previous designs without rebuilding them.

#### Acceptance Criteria

1. WHEN "Save" is triggered, THE System SHALL serialize the full state (nodes, edges, positions, configurations) to localStorage.
2. WHEN "Load" is triggered, THE System SHALL list previously saved topologies by name and timestamp.
3. WHEN "Export JSON" is triggered, THE System SHALL download the topology as a `.analysys.json` file.
4. WHEN "Import JSON" is triggered, THE System SHALL accept a `.analysys.json` file and restore the topology on the Canvas.
5. WHEN an imported file uses an older schema version, THE System SHALL migrate it automatically or reject it with a clear error message identifying the version mismatch.

### Requirement 13: Circular Topology Loop Handling

**User Story:** As a systems engineer, I want the simulation to handle circular topologies gracefully, so that cyclic request paths do not cause infinite loops or crashes.

#### Acceptance Criteria

1. WHEN a request traversal exceeds a configurable max-hop limit (default 20), THE Simulation_Engine SHALL terminate the request with a LOOP_DETECTED status.
2. WHEN a cycle is detected in the topology, THE System SHALL display a warning badge on nodes participating in the cycle.
3. WHEN a request is terminated due to a cycle, THE System SHALL record the termination with the traversal path in the event log.

### Requirement 14: Disconnected and Orphan Node Handling

**User Story:** As a systems engineer, I want disconnected nodes to behave predictably during simulation, so that incomplete topologies do not cause errors.

#### Acceptance Criteria

1. WHEN a Traffic_Generator has no outgoing edge, THE Simulation_Engine SHALL terminate its requests immediately with a NO_ROUTE status.
2. WHILE a non-generator node has no incoming edge, THE Simulation_Engine SHALL keep it idle with metrics at zero.
3. THE System SHALL display a visual indicator (dimmed opacity or dashed border) on disconnected nodes.
4. THE Simulation_Engine SHALL proceed without error when disconnected nodes exist on the Canvas.

### Requirement 15: Input Validation Edge Cases

**User Story:** As a systems engineer, I want the system to validate all configuration inputs robustly, so that invalid configurations do not corrupt the simulation.

#### Acceptance Criteria

1. IF a Database node's connection pool size is set to 0, THEN THE System SHALL reject the value with an inline error message ("Minimum pool size is 1").
2. IF a JSON import contains a connection pool size of 0, THEN THE Simulation_Engine SHALL normalize it to 1 and log a normalization warning.
3. WHILE a Cache node's hit ratio is configured to 0.0, THE Simulation_Engine SHALL route every request to the downstream Database while still incurring the configured Cache access latency.

### Requirement 16: Rapid State Transition Handling

**User Story:** As a systems engineer, I want rapid control actions (Start, Pause, Reset in quick succession) to be handled safely, so that no race conditions or zombie events occur.

#### Acceptance Criteria

1. WHEN multiple state transitions are issued within 100ms, THE Simulation_Engine SHALL process each transition sequentially in order received.
2. WHEN Reset is followed by Start, THE Simulation_Engine SHALL fully clear state before initializing fresh state for the new run.
3. THE Simulation_Engine SHALL ensure no events from a previous run appear in a new run's metrics after a Reset.

### Requirement 17: Maximum Canvas Scale Performance

**User Story:** As a systems engineer, I want the system to perform well at maximum supported scale (200 nodes, 500 edges), so that large topologies remain usable.

#### Acceptance Criteria

1. WHILE 200 nodes and 500 edges are present on the Canvas, THE System SHALL maintain interactive pan, zoom, and select operations at 30 fps or above.
2. WHEN a simulation starts with 200 nodes and 500 edges, THE Simulation_Engine SHALL begin processing events within 2 seconds.
3. WHEN exporting a maximum-scale topology, THE System SHALL warn the user if the serialized size approaches the localStorage 5MB limit.

### Requirement 18: Import Validation for Malformed JSON

**User Story:** As a systems engineer, I want import validation to catch malformed or incompatible files, so that invalid imports do not corrupt the canvas state.

#### Acceptance Criteria

1. WHEN an imported JSON file has missing required fields, THE System SHALL display an error listing the missing fields.
2. WHEN an imported JSON file contains unknown node types, THE System SHALL reject the import with a message naming the unrecognized type.
3. WHEN an imported JSON file uses a future schema version, THE System SHALL display "This file requires Analysys vX.Y or later" without crashing.
4. IF import validation fails, THEN THE System SHALL leave the Canvas unmodified.

### Requirement 19: Consumer Slower Than Producer Handling

**User Story:** As a systems engineer, I want the simulation to correctly model unbounded queue growth when consumers are slower than producers, so that I can observe backpressure dynamics.

#### Acceptance Criteria

1. WHILE a Message_Queue consumer processing rate is less than the producer publish rate, THE Simulation_Engine SHALL fill the buffer at the differential rate.
2. WHEN the Message_Queue buffer reaches capacity, THE Simulation_Engine SHALL activate the configured backpressure behavior (drop oldest, block producer, or reject new).
3. THE Simulation_Engine SHALL bound the buffer by the configured capacity, preventing unbounded memory growth in the Web Worker.

### Requirement 20: Onboarding and Usability

**User Story:** As a first-time user, I want the app to guide me on how to get started, so that I can use it without reading documentation.

#### Acceptance Criteria

1. WHEN the canvas is empty, THE System SHALL display a welcome overlay explaining how to use the app and offering quick-load preset buttons.
2. THE System SHALL provide a help tooltip (?) in the toolbar explaining the workflow: Build topology → Start → Watch metrics → Inject chaos.
3. THE Chaos_Panel SHALL display always-visible descriptions under each chaos button explaining what it does in plain language.
4. WHEN a chaos effect is active, THE Chaos_Panel SHALL display a clear sentence describing the current impact and remaining time.
5. WHEN a chaos effect ends, THE System SHALL display an impact summary showing before/after metric deltas.

### Requirement 21: Numeric Summary View

**User Story:** As a user who finds charts hard to interpret, I want to see all metrics as plain numbers with units and explanations, so that I can understand system performance without reading graphs.

#### Acceptance Criteria

1. THE Telemetry_Dashboard SHALL provide a "Charts / Summary" toggle in its header.
2. WHEN Summary view is selected, THE System SHALL display all system-wide metrics as large numeric cards with values, units (req/s, ms, %, count), and one-line descriptions.
3. THE Summary view SHALL include a per-node breakdown table showing: Node label, Health status, Throughput (req/s), Error Rate (%), Latency p50 (ms), Queue depth (items), Active connections, and Utilization (%).
4. ALL displayed values SHALL include their unit of measurement.

### Requirement 22: Edge and Resilience Node Behaviors

**User Story:** As a systems engineer, I want to model the gateway, rate limiting, and circuit breaking layers that sit in front of my services, so that I can observe how admission control and fast-failing change a cascading failure.

#### Acceptance Criteria

1. WHEN a request arrives at an API_Gateway node, THE Simulation_Engine SHALL add an authentication latency drawn from the node's configured distribution to that request's accumulated latency, whether or not the request is subsequently admitted.
2. WHEN a request arrives at an API_Gateway node, THE Simulation_Engine SHALL reject it as unauthorized with probability equal to the node's configured rejection rate, and a rejected request SHALL terminate at the gateway without reaching any downstream node.
3. WHEN a request arrives at a Rate_Limiter node and at least one token is available in its bucket, THE Simulation_Engine SHALL consume one token and forward the request downstream.
4. WHEN a request arrives at a Rate_Limiter node and its bucket is empty, THE Simulation_Engine SHALL reject the request without consulting any downstream node.
5. THE Rate_Limiter SHALL replenish tokens at its configured refill rate, bounded by its configured bucket capacity, so that a burst of up to the bucket capacity is admitted before the admitted rate settles to the refill rate.
6. WHILE a Circuit_Breaker node's circuit is Closed and the observed error rate of its downstream node exceeds the node's configured error threshold, THE Simulation_Engine SHALL trip the circuit to Open.
7. WHILE a Circuit_Breaker node's circuit is Open, THE Simulation_Engine SHALL fast-fail every arriving request without forwarding it downstream.
8. WHEN the configured open duration has elapsed since a Circuit_Breaker node's circuit tripped and a request arrives, THE Simulation_Engine SHALL transition the circuit to Half_Open.
9. WHILE a Circuit_Breaker node's circuit is Half_Open, THE Simulation_Engine SHALL forward up to the configured probe count of requests downstream to test recovery, then close the circuit if the observed downstream error rate is at or below the threshold, or re-open it otherwise.
10. THE Circuit_Breaker SHALL require a minimum number of downstream observations within the current metrics window before acting on the observed error rate, so that the per-window counter reset at a metrics-window boundary does not cause the circuit to flap.
11. THE Simulation_Engine SHALL treat API_Gateway, Rate_Limiter, and Circuit_Breaker nodes as holding no request queue and no connection pool, so that no queue-depth or connection measure is reported for them.

## Non-Functional Requirements

### Performance

| Metric | Target |
|--------|--------|
| Simulation throughput | ≥ 1,000 events/sec processed in Web Worker |
| UI frame rate during simulation | ≥ 30 fps (no main-thread blocking) |
| Metrics update latency (Worker → UI) | ≤ 100ms wall-clock at 1x speed |
| Canvas rendering (100 nodes, 200 edges) | ≤ 16ms per frame (60 fps target) |
| Initial page load (Vite production build) | ≤ 3 seconds on 4G connection |
| Worker initialization | ≤ 500ms from Start click to first event processed |

### Scalability

| Dimension | Supported Range |
|-----------|----------------|
| Nodes on canvas | 1–200 |
| Edges on canvas | 0–500 |
| Concurrent simulated in-flight requests | Up to 50,000 |
| Simulation time window | Up to 30 minutes (simulated) |
| Saved topologies in localStorage | Up to 50 (with size warnings at 4MB) |

### Browser Compatibility

- Chrome 90+
- Firefox 90+
- Edge 90+
- Safari 15+ (WebWorker + structured clone required)

### Accessibility

- All interactive controls meet WCAG 2.1 AA.
- Keyboard navigation for node palette, canvas (Tab/Arrow for node focus), and toolbar.
- Screen-reader announcements for simulation state changes and chaos events.
- Sufficient color contrast for health indicators; pattern/icon differentiation supplements color.

## System Input/Output Boundaries

### Inputs

| Source | Data | Format |
|--------|------|--------|
| User (Canvas) | Node placement, edge connections, node configuration | React state / Zustand store |
| User (Controls) | Start, Pause, Resume, Reset, Speed, Chaos triggers | UI events → postMessage to Worker |
| User (Presets) | Preset selection | Predefined JSON topology + chaos timeline |
| User (Import) | External topology file | `.analysys.json` (JSON schema v1) |

### Outputs

| Destination | Data | Format |
|-------------|------|--------|
| Canvas (Main Thread) | Node health status, edge animation state | Worker → postMessage → React state |
| Telemetry Dashboard | Time-series metrics (latency, throughput, errors, queue depths) | Batched metric snapshots (every 100ms wall-clock) |
| Simulation Event Log | Timestamped event entries (request created, queued, processed, dropped, chaos injected) | Append-only array rendered in scrollable panel |
| Export | Full topology + config | `.analysys.json` file download |
| LocalStorage | Saved topologies | Serialized JSON (keyed by user-assigned name) |

### Worker Communication Protocol

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

## Performance Benchmarks

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

## Technical Constraints and Stack

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

## Open Questions / Future Considerations

- **Collaborative editing**: Should multiple users be able to edit the same topology in real-time (WebSocket/CRDT)?
- **Export to infrastructure-as-code**: Generate Terraform/Pulumi stubs from the topology?
- **Historical simulation replay**: Record full event logs for scrubbing through past runs?
- **Custom node plugins**: Allow users to define custom node types with scripted behavior?
- **Backend persistence**: Optional cloud save (auth + API) for cross-device access?
