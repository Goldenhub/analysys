# Requirements Document

## Introduction

Analysys is a browser-based tool that enables engineers to visually model distributed system topologies on an interactive canvas, run discrete-event simulations entirely client-side via Web Workers, inject chaos failures, and observe real-time telemetry (latency percentiles, throughput, queue depth) — all without a backend server.

Requirements 1 through 22 describe the modelling, simulation, and telemetry capabilities that are implemented today. Requirements 23 through 43 extend the tool so that backend engineers and software architects can model a **complete** backend application and **make technical decisions from the simulation** rather than only observing metrics. That extension adds six node types a realistic backend contains (authentication, authorization, worker pool, dead letter queue, object storage, and scheduler), multi-target routing and subsystem grouping so a whole architecture stays workable on one canvas, an analysis layer that produces evidence-backed Findings naming the constraint and its tradeoff, and reference architecture presets that demonstrate a full backend rather than a single failure mode.

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

- **Auth_Service**: A node type that verifies a caller's identity for each arriving request, either locally (stateless token verification with no downstream call) or by introspection (a downstream lookup that may be served from a token cache), and terminates requests that fail verification.
- **Authz_Service**: A node type that evaluates access-control policy for each arriving request, optionally performing one or more downstream policy lookups per request, and terminates requests whose policy decision is deny.
- **Worker_Pool**: A node type that consumes Jobs from an upstream Message_Queue and executes them with a bounded Concurrency_Limit, retrying failed Jobs according to a configured retry policy.
- **Dead_Letter_Queue**: A node type that accumulates Jobs or messages which have exhausted their retry budget, holding them for inspection or Redrive rather than discarding them.
- **Object_Store**: A node type representing file or object storage whose per-request latency is a function of object size and available transfer bandwidth, and whose aggregate throughput is bounded by a configured bandwidth ceiling.
- **Scheduler**: A source node type that emits a fixed batch of Jobs at a fixed interval, modeling cron-style periodic Burst_Load as distinct from the continuous arrival process of a Traffic_Generator.
- **Analysis_Engine**: The component that consumes metrics snapshots and topology structure and produces Findings. It runs on the main thread and reads only data already emitted by the Simulation_Engine.
- **Analysis_Panel**: The UI surface that presents Findings, capacity results, single-point-of-failure results, and run comparisons.
- **Subsystem_Group**: A named, collapsible container that holds a set of nodes so that a large topology can be viewed at a coarser level of detail.


- **Job**: A unit of asynchronous work carried through a Message_Queue, Worker_Pool, Scheduler, or Dead_Letter_Queue. A Job reuses the existing simulation request object and is subject to the same latency accumulation and terminal-status accounting.
- **Concurrency_Limit**: The maximum number of Jobs a Worker_Pool executes simultaneously.
- **Job_Backlog**: The number of Jobs waiting upstream of a Worker_Pool plus the number held in its prefetch buffer, excluding Jobs currently executing.
- **Backlog_Age**: The simulated time elapsed since the oldest Job still in the Job_Backlog was enqueued.
- **Drain_Time**: The projected simulated time to reduce the Job_Backlog to zero at the currently observed completion rate, defined only while the completion rate exceeds the arrival rate.
- **Poison_Message**: A Job that fails on every execution attempt and therefore exhausts its retry budget rather than completing.
- **Retry_Exhaustion**: The condition in which a Job has been attempted `maxRetries + 1` times without success.
- **Redrive**: The act of moving a Job out of a Dead_Letter_Queue back to a target node for another execution attempt.
- **Burst_Load**: An arrival pattern in which a batch of Jobs is released at a single simulated instant, rather than spread over an interval.
- **Utilization**: For a node holding a bounded resource, the occupied fraction of that resource within a single metrics window, in the range 0.0 to 1.0. The bounded resource per node type is defined in Requirement 29 criterion 10. Utilization is reported as not applicable for a Scheduler node, which holds no bounded resource, and for any node whose bounding denominator is zero or unavailable, per Requirement 29 criteria 11 through 13; a node holding a bounding denominator above zero that recorded no arrivals within the window reports Utilization as 0.0 annotated as idle.
- **Analysis_Utilization**: For a node whose Utilization is applicable, the arithmetic mean of that node's per-window Utilization values over the analysis window comprising the 3 most recently completed metrics windows, per Requirement 36 criterion 1. Analysis_Utilization is the ranking quantity for Bottleneck designation, Headroom, and capacity Findings.
- **Monitored_Depth_Measure**: The single depth quantity the Analysis_Engine tracks per node for Instability evaluation, being the Job_Backlog in Jobs for a Worker_Pool node, the buffered message count in messages for a Message_Queue node, and the reported queue depth in requests for every other node type that reports a queue depth, per Requirement 37 criterion 9. A node type reporting no such quantity, and a Dead_Letter_Queue node, are excluded from Instability evaluation.
- **Saturation**: The condition in which a node's per-window Utilization is at or above 0.85 in each of the 3 most recently completed metrics windows, per Requirement 37 criterion 1.
- **Instability**: The condition in which, across the 5 most recently completed metrics windows, a node's Monitored_Depth_Measure at the end of each of the 4 most recent of those windows exceeds its value at the end of the window preceding it and its value at the end of the most recently completed window exceeds its value at the end of the earliest of those 5 windows by at least 20 percent of that earliest value, indicating an arrival rate above the service rate, per Requirement 37 criterion 2.
- **Steady_State**: The condition in which, across at least 3 consecutive metrics windows, a node's arrival rate varies by less than 10% between adjacent windows and its queue depth net change over the span is within ±5% of the mean queue depth.
- **Bottleneck**: The node that most limits end-to-end throughput or latency, determined by the ranking rule in Requirement 36.
- **Latency_Share**: A node's aggregate share of end-to-end time, computed over an analysis window as the summed time-in-system that requests and Jobs terminating within that window accumulated at that node, divided by the summed time-in-system those same requests and Jobs accumulated at every node on their recorded path, expressed as a percentage from 0 to 100, per Requirement 36 criterion 10. A node lying on several request paths receives one share weighted by the requests that traversed it, and the share is reported as not applicable while that divisor is 0 ms.
- **Headroom**: The unoccupied share of a bounded resource, computed at two scopes. Per-node Headroom is `(1 - Analysis_Utilization) * 100` expressed as a percentage from 0 to 100, per Requirement 38 criterion 1. System Headroom is the additional offered load a topology absorbs before its first node reaches Saturation, expressed as the percentage `(0.85 / U - 1) * 100` and as the absolute figure `L * (0.85 / U - 1)` in RPS, where `U` is the highest Analysis_Utilization among eligible nodes and `L` is the offered load in RPS over the analysis window, per Requirement 38 criterion 3. System Headroom is 0 percent and 0 RPS where `U` is at or above 0.85.
- **Sustainable_Load**: The highest offered RPS at which a topology satisfies a user-specified Service_Objective for a full simulated run.
- **Knee_Point**: The lowest offered RPS in a Capacity_Sweep at which the Service_Objective is violated.
- **Capacity_Sweep**: A sequence of simulation runs over the same topology and seed at strictly increasing offered load, used to determine Sustainable_Load and the Knee_Point.
- **Measurement_Interval**: For a Capacity_Sweep step, the simulated interval from the end of that step's configured warm-up interval to the end of that step's simulated duration. The Service_Objective is evaluated over this interval alone, so that arrivals during warm-up are excluded from the step's verdict, per Requirement 38 criterion 19.
- **Service_Objective**: A user-specified pass condition for a run, consisting of a maximum end-to-end p99 latency in milliseconds and a maximum total error rate as a fraction.
- **Terminal_Node**: A node holding no outgoing edge, determined from the directed graph alone and independent of node type, per Requirement 39 criterion 1. An Object_Store node is always a Terminal_Node because Requirement 30 permits it no outgoing edge.
- **Single_Point_Of_Failure**: A node, other than a Traffic_Generator node or a Scheduler node, for which at least one source node reaches 1 or more Terminal_Nodes in the intact directed graph and reaches 0 Terminal_Nodes in the graph with that node and every edge incident to it removed, per Requirement 39 criterion 2.
- **Blast_Radius**: The percentage of requests and Jobs reaching a terminal status in a run whose recorded path, taken together with the recorded path of every branch dispatched for that request, holds a given node, per Requirement 39 criterion 4.
- **Finding**: A structured, evidence-backed analysis result. Its required fields are defined in Requirement 35 criterion 1.
- **Primary_Evidence_Entry**: The single entry of a Finding's evidence set designated as that Finding's headline quantity, per Requirement 35 criterion 2. Its absolute magnitude breaks ties in the Finding display order of Requirement 35 criterion 8.
- **Fan_Out_Depth**: The count of Fan_Out dispatches a request has undergone along its lineage. A request emitted by a Traffic_Generator node or a Scheduler node holds a Fan_Out_Depth of 0, each branch holds its parent's Fan_Out_Depth plus 1, and a request arriving at a Fan_Out node at a Fan_Out_Depth of 4 is forwarded along one edge without further branching, per Requirement 32 criteria 7 and 8.
- **Analysis_Report**: The exportable collection of all Findings for a run, together with the topology, configuration, seed, and run duration that produced them.
- **Baseline_Run**: A completed run whose metrics and topology have been retained for comparison against a later run.
- **Controlled_Comparison**: A comparison of two runs holding an identical PRNG seed, an identical simulated duration in milliseconds, and total offered loads differing by less than 0.01 RPS, so that metric differences are attributable to topology or configuration differences, per Requirement 40 criterion 9.

## Requirements

### Requirement 1: Drag-and-Drop Node Placement

**User Story:** As a systems engineer, I want to drag nodes from a palette onto a canvas, so that I can visually model my backend architecture topology.

#### Acceptance Criteria

1. THE System SHALL display a side palette listing the nine originally supported node types: Traffic Generator, API Gateway, Rate Limiter, Load Balancer, Circuit Breaker, App Server, Cache, Database, Message Queue, and SHALL list the six node types added by Requirements 23 through 28 as required by Requirement 29 criterion 1.
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

### Requirement 23: Authentication Service Node

**User Story:** As a backend engineer, I want to model a dedicated authentication service that every request passes through, so that I can see whether identity verification becomes a shared bottleneck and whether caching token introspection is worth the added complexity.

#### Acceptance Criteria

1. THE System SHALL offer an Auth_Service node type with the configurable parameters: verification mode (Local, Introspection), verification latency distribution (mean 0-60,000 ms, standard deviation 0-30,000 ms), concurrency limit (1-10,000 simultaneous verifications), queue depth (0-10,000 waiting requests), token cache hit ratio (0.0-1.0), and credential failure rate (0.0-1.0), and SHALL apply the token cache hit ratio parameter only where the node's verification mode is Introspection.
2. WHEN a request occupies a verification slot at an Auth_Service node, THE Simulation_Engine SHALL draw exactly one verification latency sample from the node's configured distribution, treat a sampled value below 0 ms as 0 ms, and add that sample to the request's accumulated latency, whether or not the request is subsequently terminated as Unauthenticated.
3. WHEN verification completes at an Auth_Service node, THE Simulation_Engine SHALL terminate the request with an Unauthenticated status with probability equal to the node's configured credential failure rate, release the verification slot that request occupied, and route the request to no downstream node, so that a credential failure rate of 0.0 terminates no request and a credential failure rate of 1.0 terminates every request that completes verification.
4. WHERE an Auth_Service node's verification mode is Local, THE Simulation_Engine SHALL complete verification once the request's verification latency has elapsed without issuing any downstream call, so that the node's cost for that request is its verification latency and its verification slot occupancy only.
5. WHERE an Auth_Service node's verification mode is Introspection, WHEN a request's token cache hit test fails against the node's configured token cache hit ratio, THE Simulation_Engine SHALL issue exactly one downstream call along the outgoing edge selected by the node's routing policy defined in Requirement 32, SHALL keep that request's verification slot occupied until the call settles, and SHALL count that call as one hop against the request's max-hop limit defined in Requirement 13, so that a token cache hit ratio of 0.0 issues one downstream call for every request that completes verification.
6. WHERE an Auth_Service node's verification mode is Introspection, WHEN a request's token cache hit test succeeds against the node's configured token cache hit ratio, THE Simulation_Engine SHALL complete verification without issuing a downstream call and SHALL record the outcome as a token cache hit in the current metrics window, so that a token cache hit ratio of 1.0 issues no downstream call.
7. WHILE an Auth_Service node has its concurrency limit fully occupied, THE Simulation_Engine SHALL hold arriving requests in the node's queue in arrival order up to its configured queue depth, SHALL admit the longest-waiting queued request into a verification slot when a slot is released, and SHALL add each queued request's waiting time to that request's accumulated latency, so that a node configured with a queue depth of 0 holds no arriving request.
8. IF a request arrives at an Auth_Service node whose concurrency limit is fully occupied and whose queue already holds its configured queue depth of requests, THEN THE Simulation_Engine SHALL terminate that request with a Dropped status, record the drop against that node, add no verification latency to that request, and route it to no downstream node.
9. THE Telemetry_Dashboard SHALL report for each Auth_Service node, over the current metrics window and with the unit of each value shown, the verification throughput in verifications per second, the observed token cache hit ratio as a fraction of requests that completed verification, the Unauthenticated termination rate as a fraction of requests that arrived at the node, the concurrency Utilization as a fraction of the configured concurrency limit, and the queue depth as a count of waiting requests.
10. IF a request at an Auth_Service node whose verification mode is Introspection fails its token cache hit test and that node has no outgoing edge, THEN THE Simulation_Engine SHALL terminate the request with a NO_ROUTE status, release the verification slot it occupied, and record the termination against that node, in the same manner as Requirement 14.
11. IF a downstream introspection call issued by an Auth_Service node settles with any terminal status other than success, THEN THE Simulation_Engine SHALL terminate the originating request with an Unauthenticated status, release the verification slot it occupied, and record an error against that Auth_Service node.
12. THE Simulation_Engine SHALL draw the pseudorandom values for a request at an Auth_Service node from the seeded PRNG in the fixed order verification latency sample, token cache hit test, credential failure test, so that the same topology, configuration, and seed produce identical Auth_Service outcomes across runs, in the same manner as Requirement 5.

### Requirement 24: Authorization Service Node

**User Story:** As a software architect, I want to model policy evaluation separately from authentication, so that I can quantify the cost of per-request permission lookups and decide whether to cache policy decisions or move them into the calling service.

#### Acceptance Criteria

1. THE System SHALL offer an Authz_Service node type with the configurable parameters: policy evaluation latency distribution (mean 0-60,000 ms, standard deviation 0-30,000 ms), policy cache hit ratio (0.0-1.0), lookups per request (1-50), deny rate (0.0-1.0), concurrency limit (1-10,000), and queue depth (0-10,000).
2. WHEN a request arrives at an Authz_Service node and a concurrency slot is available, THE Simulation_Engine SHALL admit that request into the slot, SHALL hold the slot occupied until the request either terminates at that node or is forwarded to its next node, including the interval spent awaiting lookup calls, and SHALL add a policy evaluation latency drawn from the node's configured distribution to that request's accumulated latency, treating a sampled value below 0 ms as 0 ms.
3. WHEN a request is admitted at an Authz_Service node and the policy cache hit test succeeds against the node's configured policy cache hit ratio, THE Simulation_Engine SHALL evaluate policy without issuing any downstream call and SHALL record the outcome as a policy cache hit.
4. WHERE an Authz_Service node has at least one outgoing edge, WHEN a request is admitted and the policy cache hit test fails against the node's configured policy cache hit ratio, THE Simulation_Engine SHALL issue exactly `lookups per request` downstream calls at a single simulated timestamp, SHALL select the target of each call using the node's configured downstream routing policy defined in Requirement 32, SHALL resume the request only after every issued call has settled, and SHALL add to that request's accumulated latency the greatest round-trip latency among those calls.
5. WHERE an Authz_Service node has no outgoing edge, WHEN a request is admitted and the policy cache hit test fails against the node's configured policy cache hit ratio, THE Simulation_Engine SHALL evaluate policy without issuing any downstream call and SHALL record the outcome as a lookup-unavailable evaluation, counted separately from policy cache hits.
6. WHEN a request's policy evaluation latency has elapsed at an Authz_Service node and every lookup call issued for that request under criterion 4 has settled with a success status, THE Simulation_Engine SHALL apply the deny test against the node's configured deny rate and SHALL terminate a request selected by that test with a Forbidden status recorded against that node, so that a denied request has already incurred that node's policy evaluation latency and lookup latency and reaches no node downstream of the Authz_Service node other than the lookup targets of criterion 4.
7. IF a lookup call issued by an Authz_Service node under criterion 4 settles with a terminal status other than success, THEN THE Simulation_Engine SHALL terminate the request that issued that call with the same terminal status, SHALL record the identifier of the lookup target node that produced that status with the termination, and SHALL release the request's occupied concurrency slot at the Authz_Service node.
8. WHILE an Authz_Service node has its concurrency limit fully occupied, THE Simulation_Engine SHALL hold each arriving request in that node's queue in arrival order up to the node's configured queue depth, and SHALL admit the longest-waiting queued request into the next concurrency slot that is released.
9. IF a request arrives at an Authz_Service node whose concurrency limit is fully occupied and whose queue holds a number of requests equal to its configured queue depth, THEN THE Simulation_Engine SHALL terminate that request with a Dropped status, SHALL record the drop against that node, and SHALL leave that request's accumulated latency unchanged.
10. WHILE at least one request was admitted at an Authz_Service node during a metrics window, THE Telemetry_Dashboard SHALL report that node's downstream call amplification ratio for that window as the number of downstream lookup calls issued divided by the number of requests admitted, and SHALL otherwise report that ratio as not applicable rather than as zero, in the same manner as Requirement 8.
11. THE Telemetry_Dashboard SHALL report, for each Authz_Service node, the evaluation throughput in evaluations per second, the policy cache hit ratio observed during the run as a fraction from 0.0 to 1.0, the Forbidden termination rate in requests per second, the downstream call amplification ratio as calls per request, the concurrency Utilization as a fraction of the configured concurrency limit, and the queue depth as a count of waiting requests, each with its unit.

### Requirement 25: Worker Pool Node

**User Story:** As a backend engineer, I want to model a pool of workers consuming jobs from a queue with a fixed concurrency and a retry policy, so that I can size the pool against a job arrival rate and see how long a backlog takes to drain.

#### Acceptance Criteria

1. THE System SHALL offer a Worker_Pool node type with the configurable parameters: concurrency (1-10,000 simultaneous Jobs), job processing time distribution (mean 0-600,000 ms, standard deviation 0-300,000 ms), prefetch buffer depth (0-10,000 Jobs), job failure rate (0.0-1.0), max retries (0-10), retry backoff strategy (Fixed, Exponential), retry base delay (1-300,000 ms), and job timeout (1-600,000 ms).
2. WHILE a Worker_Pool node has fewer executing Jobs than its configured concurrency, THE Simulation_Engine SHALL admit Jobs into execution, selecting first any Job whose retry delay has elapsed in ascending order of the simulated time at which that delay elapsed, and thereafter Jobs held in the prefetch buffer in ascending order of the simulated time at which each Job entered the buffer.
3. WHILE a Worker_Pool node has its concurrency fully occupied, THE Simulation_Engine SHALL append each arriving Job to the tail of the node's prefetch buffer until the buffer holds a number of Jobs equal to the configured prefetch buffer depth.
4. WHILE a Worker_Pool node has its concurrency fully occupied and its prefetch buffer holds a number of Jobs equal to the configured prefetch buffer depth, THE Simulation_Engine SHALL stop consuming from the upstream Message_Queue, so that the Job_Backlog accumulates in the upstream queue and is bounded by that queue's configured capacity.
5. WHEN a Job completes execution at a Worker_Pool node, THE Simulation_Engine SHALL draw a value independently for that attempt from the seeded PRNG and SHALL fail the attempt with probability equal to the node's configured job failure rate, and SHALL otherwise mark the attempt successful.
6. WHEN a Job attempt fails at a Worker_Pool node and the Job has been attempted fewer than `max retries + 1` times, THE Simulation_Engine SHALL release the concurrency slot that attempt occupied, SHALL schedule a further attempt after a delay computed from the configured backoff strategy and retry base delay, and SHALL count the attempt as a retry.
7. WHERE the retry backoff strategy is Exponential, THE Simulation_Engine SHALL compute the delay before attempt number `n` as `retry base delay * 2^(n-1)` with no jitter applied, for `n` counted from 1 for the first retry, and SHALL cap the computed delay at 300,000 ms.
8. WHEN a Job at a Worker_Pool node reaches Retry_Exhaustion and the node has an outgoing edge to a Dead_Letter_Queue node, THE Simulation_Engine SHALL route the Job along that edge to that Dead_Letter_Queue node, carrying the Job's total attempt count and the Worker_Pool node's identifier, and SHALL count the Job as one Retry_Exhaustion at the Worker_Pool node.
9. WHEN a Job at a Worker_Pool node reaches Retry_Exhaustion and the node has no outgoing edge to a Dead_Letter_Queue node, THE Simulation_Engine SHALL terminate the Job with a Retry_Exhausted status, record it as an error at that node, and count it as one Retry_Exhaustion at that node.
10. IF a Job attempt at a Worker_Pool node remains in execution for the configured job timeout measured from the simulated time at which the attempt occupied its concurrency slot, excluding any prefetch buffer wait and any retry delay, THEN THE Simulation_Engine SHALL terminate that attempt with a Timeout status, release the occupied concurrency slot, add the configured job timeout to the Job's accumulated latency, and count the attempt as a failed attempt for retry accounting.
11. THE Telemetry_Dashboard SHALL report, for each Worker_Pool node, the Job completion rate in Jobs per second, the concurrency Utilization as a fraction in the range 0.0-1.0, the Job_Backlog in Jobs, the Backlog_Age in simulated milliseconds reported as 0 ms while the Job_Backlog is zero, the retry rate in retries per second, and the Retry_Exhaustion rate in Jobs per second.
12. WHILE a Worker_Pool node's Job completion rate exceeds its Job arrival rate and its Job_Backlog is greater than zero, THE Telemetry_Dashboard SHALL report the projected Drain_Time in simulated seconds.
13. WHILE a Worker_Pool node's Job arrival rate is at or above its Job completion rate and its Job_Backlog is greater than zero, THE Telemetry_Dashboard SHALL report that the Job_Backlog is not draining instead of reporting a Drain_Time figure.
14. WHEN a Job is admitted into execution at a Worker_Pool node, THE Simulation_Engine SHALL draw a job processing time independently for that attempt from the node's configured job processing time distribution, clamped to a minimum of 0 ms, and SHALL occupy one concurrency slot for that attempt until the attempt completes or reaches the configured job timeout, whichever occurs first.
15. WHEN a Job at a Worker_Pool node is awaiting a scheduled retry delay, THE Simulation_Engine SHALL hold that Job outside the node's prefetch buffer so that it counts against neither the configured prefetch buffer depth nor the Job_Backlog, and SHALL add the elapsed retry delay to that Job's accumulated latency.
16. WHERE the retry backoff strategy is Fixed, THE Simulation_Engine SHALL compute the delay before every retry attempt as exactly the configured retry base delay, with no jitter applied and no growth across attempts.

### Requirement 26: Dead Letter Queue Node

**User Story:** As a backend engineer, I want to model a dead letter queue, so that I can see poison messages accumulate, measure how much work is being permanently lost, and evaluate a redrive policy before implementing one.

#### Acceptance Criteria

1. THE System SHALL offer a Dead_Letter_Queue node type with the configurable parameters: capacity (1-1,000,000 messages), retention period (1-2,592,000,000 ms), redrive mode (Manual, Automatic), redrive interval (1-300,000 ms), redrive batch size (1-10,000), and max redrive attempts (0-10).
2. WHEN a Job arrives at a Dead_Letter_Queue node, THE Simulation_Engine SHALL record the arrival with a Dead_Lettered status, SHALL count it in the node's error accounting rather than in its success accounting, and SHALL set that message's retention start time to the simulated time of arrival.
3. WHILE a Dead_Letter_Queue node holds fewer messages than its configured capacity, THE Simulation_Engine SHALL retain each arriving Job together with the identifier of the node at which it reached Retry_Exhaustion, its cumulative attempt count across every attempt it has made, and its redrive attempt count, which SHALL be zero for a Job that has not previously been retained at that node.
4. IF a Job arrives at a Dead_Letter_Queue node that is at its configured capacity, THEN THE Simulation_Engine SHALL discard the retained message with the earliest retention start time, record a dead-letter overflow event naming that node identifier in the event log, and retain the arriving Job.
5. WHEN a metrics window boundary is reached and a retained message's age since its retention start time exceeds the configured retention period, THE Simulation_Engine SHALL discard that message and record a retention-expiry event naming that node identifier in the event log, so that expiry is evaluated on the metrics window schedule rather than on access to the message.
6. WHERE a Dead_Letter_Queue node's redrive mode is Automatic, WHEN a redrive interval elapses, THE Simulation_Engine SHALL route up to `redrive batch size` retained messages whose redrive attempt count is below the configured max redrive attempts along the node's outgoing edges, selecting them in ascending order of retention start time, SHALL increment the redrive attempt count of each routed message, and SHALL remove each routed message from the node's retained set at the simulated instant it is routed, so that a message in flight from a Redrive is subject to neither retention expiry nor overflow discard at that node.
7. WHERE a Dead_Letter_Queue node's redrive mode is Automatic, WHILE a retained message's redrive attempt count is at or above the configured max redrive attempts, THE Simulation_Engine SHALL retain that message without further Redrive until its retention period expires or it is discarded by overflow.
8. WHERE a Dead_Letter_Queue node's redrive mode is Manual, THE Chaos_Panel SHALL offer a redrive control for that node that, when activated during a running simulation, routes up to `redrive batch size` retained messages whose redrive attempt count is below the configured max redrive attempts along the node's outgoing edges in ascending order of retention start time, applying the same increment and removal behavior stated in criterion 6.
9. THE Telemetry_Dashboard SHALL report, for each Dead_Letter_Queue node, the retained message count, the fill fraction against capacity in the range 0.0-1.0, the dead-letter arrival rate in messages per second, the age of the oldest retained message in simulated milliseconds, the count of retained messages grouped by the node identifier at which Retry_Exhaustion occurred, the cumulative count of messages routed by Redrive, and the cumulative count of discarded messages separated by overflow and by retention expiry.
10. WHILE a Dead_Letter_Queue node's retained message count at the end of each of the 3 most recent metrics windows is greater than its count at the end of the preceding window, THE System SHALL display a warning indicator on that node on the Canvas.
11. WHEN a retained message is routed out of a Dead_Letter_Queue node by Redrive, THE Simulation_Engine SHALL clear that Job's Dead_Lettered terminal status and its contribution to that node's error accounting, so that the Job is counted under exactly one terminal status as required by Requirement 31.
12. WHEN a Job routed out of a Dead_Letter_Queue node by Redrive arrives at a Worker_Pool node, THE Simulation_Engine SHALL reset that Job's retry attempt count to zero, so that the Job receives a full budget of `max retries + 1` attempts in that Redrive round.
13. WHEN a Job that was previously retained at a Dead_Letter_Queue node reaches Retry_Exhaustion again at a Worker_Pool node that has an outgoing edge to that same Dead_Letter_Queue node, THE Simulation_Engine SHALL retain the Job at that Dead_Letter_Queue node with its redrive attempt count carried forward unchanged and its retention start time set to the simulated time of the new arrival.

### Requirement 27: Object Storage Node

**User Story:** As a software architect, I want to model file and object storage whose latency depends on object size and bandwidth, so that I can distinguish bandwidth saturation from CPU or connection saturation when uploads and downloads slow down.

#### Acceptance Criteria

1. THE System SHALL offer an Object_Store node type with the configurable parameters: object size distribution (mean 1-10,485,760 KB, standard deviation 0-10,485,760 KB), throughput capacity (0.1-100,000 MB per second), base latency distribution (mean 0-60,000 ms, standard deviation 0-30,000 ms), max concurrent transfers (1-100,000), transfer queue depth (0-10,000 waiting requests), read fraction (0.0-1.0), and write latency multiplier (1.0-100.0).
2. WHEN a request arrives at an Object_Store node, THE Simulation_Engine SHALL draw a value from the seeded PRNG and SHALL classify the request as a read with probability equal to the configured read fraction and as a write otherwise.
3. WHEN the Simulation_Engine samples an object size for a request at an Object_Store node, THE Simulation_Engine SHALL clamp the sampled size to at least 1 KB and at most 10,485,760 KB before using it in any latency computation.
4. WHEN a request begins transferring at an Object_Store node, THE Simulation_Engine SHALL add to that request's accumulated latency the sum of a base latency drawn from the node's configured base latency distribution and clamped to at least 0 ms, and the transfer time computed under criteria 5 and 6, where 1 MB equals 1,024 KB and 1 second equals 1,000 ms.
5. THE Simulation_Engine SHALL divide an Object_Store node's configured throughput capacity equally among the transfers concurrently active at that node, so that each active transfer's bandwidth share in MB per second equals the configured throughput capacity divided by the active transfer count, and SHALL compute a transfer's remaining transfer time in milliseconds as its remaining untransferred size in KB divided by 1,024, divided by its bandwidth share in MB per second, multiplied by 1,000.
6. WHEN a transfer begins or completes at an Object_Store node, THE Simulation_Engine SHALL recompute the bandwidth share of every transfer still active at that node and SHALL reschedule each such transfer's completion from its remaining untransferred size and its recomputed bandwidth share, so that a transfer's effective rate follows the concurrent demand present during each portion of that transfer.
7. WHEN a request is classified as a write at an Object_Store node, THE Simulation_Engine SHALL multiply its computed transfer time by the configured write latency multiplier, applying the multiplier to the transfer time while leaving the sampled base latency unchanged.
8. WHILE an Object_Store node has its max concurrent transfers fully occupied and its transfer queue holds fewer requests than the configured transfer queue depth, THE Simulation_Engine SHALL hold each arriving request in that queue, SHALL admit held requests into a released transfer slot in arrival order, and SHALL add each held request's simulated waiting time in milliseconds to that request's accumulated latency.
9. IF a request arrives at an Object_Store node whose max concurrent transfers are fully occupied and whose transfer queue holds its configured transfer queue depth of requests, THEN THE Simulation_Engine SHALL terminate the request with a Dropped status, SHALL record the drop against that node, and SHALL record the request's accumulated latency as the latency accumulated before it reached that node.
10. THE Telemetry_Dashboard SHALL report, for each Object_Store node, the aggregate transfer rate in MB per second computed as the total size transferred during the metrics window in KB divided by 1,024 divided by the window duration in seconds, that transfer rate as a fraction of the configured throughput capacity in the range 0.0-1.0, the active transfer count, the queued request count, the mean transfer time in milliseconds, the drop rate in requests per second, and the read and write request counts.
11. WHILE an Object_Store node's aggregate transfer rate is at or above 0.85 of its configured throughput capacity, THE System SHALL report the node's Utilization as bandwidth Utilization and SHALL name bandwidth as the limiting resource in the node's Activity view.

### Requirement 28: Scheduler Node

**User Story:** As a backend engineer, I want to model cron jobs and periodic batch triggers, so that I can see how periodic bursts interact with steady request traffic and whether my workers absorb the burst before the next trigger.

#### Acceptance Criteria

1. THE System SHALL offer a Scheduler node type with the configurable parameters: interval (100-86,400,000 ms), jobs per trigger (1-100,000), start offset (0-86,400,000 ms), jitter (0-86,400,000 ms), overlap policy (Allow, Skip, Queue), and max deferred triggers (1-1,000).
2. WHEN a simulation starts, THE Simulation_Engine SHALL set each Scheduler node's scheduled trigger time for trigger index `n`, counted from 0, to `start offset + n * interval` measured from t=0, so that the first scheduled trigger occurs at t=0 when the start offset is 0 and every subsequent interval is measured from the preceding scheduled trigger time rather than from any actual fire time.
3. WHERE a Scheduler node's jitter is greater than zero, THE Simulation_Engine SHALL treat the effective jitter as the lesser of the configured jitter and the configured interval, SHALL fire each trigger at its scheduled trigger time plus one offset drawn per trigger from the seeded PRNG as a uniform value in the inclusive range 0 to the effective jitter, and SHALL leave every subsequent scheduled trigger time unchanged by that offset, so that jitter never accumulates as drift and the fire time of trigger index `n` is never later than the fire time of trigger index `n+1`.
4. WHEN a Scheduler node triggers, THE Simulation_Engine SHALL emit exactly `jobs per trigger` Jobs at that single simulated timestamp and SHALL route each emitted Job along the node's outgoing edges according to the node's downstream routing policy defined in Requirement 32.
5. WHERE a Scheduler node's overlap policy is Skip, IF a trigger fires while at least one Job emitted by an earlier trigger of that node has not reached a terminal status, THEN THE Simulation_Engine SHALL emit no Jobs for that trigger, SHALL count that trigger as a skipped trigger, and SHALL record a skipped-trigger event in the event log naming the node and the simulated fire time.
6. WHERE a Scheduler node's overlap policy is Queue, IF a trigger fires while at least one Job emitted by an earlier trigger of that node has not reached a terminal status, THEN THE Simulation_Engine SHALL append that trigger to the end of the node's deferred trigger list in ascending trigger index order as a separate entry, retaining every previously deferred trigger as its own entry, and SHALL count it as a deferred trigger.
7. WHERE a Scheduler node's overlap policy is Allow, IF a trigger fires while at least one Job emitted by an earlier trigger of that node has not reached a terminal status, THEN THE Simulation_Engine SHALL emit that trigger's Jobs at its fire time without deferral and without skipping, so that Jobs emitted by two or more triggers of that node are in flight simultaneously.
8. THE Simulation_Engine SHALL treat a Scheduler node as a source node that requires no incoming edge, in the same manner as a Traffic_Generator node under Requirement 14, including terminating each emitted Job immediately with a NO_ROUTE status when the Scheduler node has no outgoing edge.
9. THE Telemetry_Dashboard SHALL report, for each Scheduler node, the trigger count in triggers, the Jobs emitted count in Jobs, the skipped-trigger count in triggers, the deferred-trigger count in triggers, the current deferred trigger list length in triggers, the count of emitted Jobs that have not reached a terminal status in Jobs, and the simulated time of the most recent trigger in milliseconds, each with its unit.
10. THE per-node Activity view SHALL present a Scheduler node's latency percentiles and Little's Law figures as not applicable, in the same manner as it does for a Traffic_Generator node under Requirement 8.
11. WHERE a Scheduler node's overlap policy is Queue, WHEN every Job emitted by every earlier trigger of that node has reached a terminal status and the node's deferred trigger list holds at least one entry, THE Simulation_Engine SHALL emit the Jobs of the earliest deferred entry at that simulated timestamp, SHALL remove exactly that one entry from the list, and SHALL leave every remaining deferred entry in the list.
12. WHERE a Scheduler node's overlap policy is Queue, IF a trigger fires while the node's deferred trigger list length equals the configured max deferred triggers, THEN THE Simulation_Engine SHALL emit no Jobs for that trigger, SHALL count it as a skipped trigger, and SHALL record a deferred-trigger-overflow event in the event log naming the node and the simulated fire time.
13. WHEN a simulation enters the Complete state while at least one Job emitted by a Scheduler node has not reached a terminal status, THE Simulation_Engine SHALL retain the count of those Jobs as that node's unfinished Job count, SHALL discard every entry remaining in that node's deferred trigger list without emitting Jobs for it, and SHALL report both figures with the run's final metrics.

### Requirement 29: New Node Type Integration

**User Story:** As a backend engineer, I want the six new node types to behave exactly like the existing nine everywhere in the product, so that I do not have to learn separate interaction rules for them.

#### Acceptance Criteria

1. THE System SHALL list all fifteen node types in the node palette, each with a distinct icon and a distinct text label, organized into the five named groups Sources (Traffic_Generator, Scheduler), Admission (API_Gateway, Rate_Limiter, Circuit_Breaker, Load_Balancer, Auth_Service, Authz_Service), Compute (App_Server, Worker_Pool), Data (Cache, Database, Object_Store), and Messaging (Message_Queue, Dead_Letter_Queue).
2. THE System SHALL assign each of the fifteen node types to exactly one palette group, SHALL display each group under its group name, and SHALL make every group and every node type within it reachable by keyboard alone.
3. WHEN a node of one of the six new types is placed on the Canvas, THE System SHALL populate a default value for every parameter listed in Requirements 23 through 28 for that type, and each default value SHALL lie within the range stated there for that parameter.
4. THE System SHALL produce identical default values for a given new node type whether the node is placed by drag-and-drop or by the palette's keyboard placement path.
5. WHEN a node of one of the six new types is placed on the Canvas at its default configuration, connected to a Traffic_Generator node or a Scheduler node at that source node's default configuration, and the simulation is started, THE Simulation_Engine SHALL run for 60 simulated seconds, SHALL report no configuration validation error, SHALL raise no engine error, and SHALL record at least one request or Job reaching a terminal status at that node.
6. WHEN a node of one of the six new types is selected, THE System SHALL open the configuration panel with an editable control for every parameter listed in Requirements 23 through 28 for that type, and SHALL display each numeric parameter's valid range alongside its control.
7. IF a value outside the range stated in Requirements 23 through 28 is entered for a parameter of a new node type, THEN THE System SHALL display an inline error message naming the parameter and its valid minimum and maximum, SHALL leave the node's stored configuration at its previous value, and SHALL leave the simulation's use of that node unchanged.
8. IF a non-numeric, empty, or non-finite value is entered for a numeric parameter of a new node type, THEN THE System SHALL display an inline error message naming the parameter and SHALL leave the node's stored configuration at its previous value.
9. WHEN a topology containing a node of one of the six new types is imported, THE System SHALL clamp each out-of-range or non-finite numeric parameter to the nearest bound stated in Requirements 23 through 28 and SHALL record a normalization warning naming the node's label, the parameter, the imported value, and the applied bound, in the same manner as Requirement 15.
10. THE System SHALL compute Utilization for each new node type in the range 0.0 to 1.0 as the following quotient: for Auth_Service and Authz_Service, occupied concurrency slots divided by the configured concurrency limit; for Worker_Pool, executing Jobs divided by the configured concurrency; for Dead_Letter_Queue, retained messages divided by the configured capacity; for Object_Store, aggregate transfer rate divided by the configured throughput capacity.
11. THE System SHALL report Utilization for a Scheduler node as not applicable, together with a plain-language explanation that a Scheduler node holds no bounded resource, in the same manner as Requirement 8.
12. IF the denominator of the Utilization quotient defined in criterion 10 is zero or is unavailable for a node, THEN THE System SHALL report that node's Utilization as not applicable together with a plain-language explanation naming the missing or zero bounded resource, and SHALL report no numeric Utilization value for that node.
13. WHILE a node of one of the six new types recorded no arrivals during the current metrics window and the denominator of its Utilization quotient is greater than zero, THE System SHALL report its Utilization as 0.0 annotated as an idle state, so that an idle node is distinguishable from a node whose Utilization is not applicable, in the same manner as Requirement 8.
14. THE System SHALL derive health status for each new node type from its Utilization and its error rate using the same thresholds defined in Requirement 8.
15. WHERE a new node type's Utilization is reported as not applicable, THE System SHALL derive that node's health status from its error rate alone using the error-rate thresholds defined in Requirement 8.
16. WHEN a topology containing nodes of the six new types is saved and then loaded, or exported and then imported, THE System SHALL restore every parameter of every such node to the value it held before the operation, with no parameter omitted and no value altered.
17. WHILE a simulation is running, THE Canvas SHALL render animated packet dots along every edge into and out of nodes of the six new types, in the same manner as Requirement 6.
18. WHERE a metric does not apply to a new node type, THE per-node Activity view SHALL display a plain-language explanation of why it does not apply instead of a numeric value, in the same manner as Requirement 8.

### Requirement 30: Connection Rules and Edge Protocols for New Node Types

**User Story:** As a software architect, I want the canvas to reject connections that cannot exist in a real backend, so that a topology I build is structurally plausible before I run it.

#### Acceptance Criteria

1. THE System SHALL permit an outgoing edge from a Traffic_Generator node to an Auth_Service node under the Synchronous protocol.
2. THE System SHALL permit outgoing edges from an API_Gateway node to Auth_Service and Authz_Service nodes under the Synchronous protocol.
3. THE System SHALL permit outgoing edges from an Auth_Service node to Cache and Database nodes under the Synchronous protocol, and SHALL treat those two target types as the complete set of permitted outgoing target types for an Auth_Service node.
4. THE System SHALL permit outgoing edges from an Authz_Service node to Cache and Database nodes under the Synchronous protocol, and SHALL treat those two target types as the complete set of permitted outgoing target types for an Authz_Service node.
5. THE System SHALL permit outgoing edges from an App_Server node to Auth_Service, Authz_Service, and Object_Store nodes under the Synchronous protocol.
6. THE System SHALL permit an outgoing edge from a Message_Queue node to a Worker_Pool node under the Asynchronous protocol.
7. THE System SHALL permit outgoing edges from a Worker_Pool node to Database, Cache, Object_Store, and App_Server nodes under the Synchronous protocol and to Message_Queue and Dead_Letter_Queue nodes under the Asynchronous protocol, SHALL treat those six target types as the complete set of permitted outgoing target types for a Worker_Pool node, and SHALL reject a connection whose source node and target node are both Worker_Pool nodes.
8. THE System SHALL permit outgoing edges from a Scheduler node to Message_Queue and Worker_Pool nodes under the Asynchronous protocol and to App_Server and API_Gateway nodes under the Synchronous protocol, and SHALL treat those four target types as the complete set of permitted outgoing target types for a Scheduler node.
9. THE System SHALL permit outgoing edges from a Dead_Letter_Queue node to Message_Queue and Worker_Pool nodes under the Asynchronous protocol, and SHALL treat those two target types as the complete set of permitted outgoing target types for a Dead_Letter_Queue node.
10. THE System SHALL treat an Object_Store node as a terminal node whose permitted incoming edges are those stated in criteria 5 and 7, and SHALL reject every connection whose source node is an Object_Store node with a message naming the source node type as terminal.
11. THE System SHALL permit at most one outgoing edge to a Dead_Letter_Queue node from any single Worker_Pool node, SHALL permit incoming edges from two or more distinct Worker_Pool nodes to the same Dead_Letter_Queue node up to the edge count stated in Requirement 34, and, IF a second outgoing edge to a Dead_Letter_Queue node is attempted from a Worker_Pool node that already has one, THEN THE System SHALL reject the connection and display a message naming that Worker_Pool node's label and the label of the Dead_Letter_Queue node its existing edge targets.
12. THE System SHALL treat the union of the source-type-and-target-type pairs enumerated in criteria 1 through 11 and the pairs permitted by the connection rules defined for the nine pre-existing node types as the complete set of permitted connections, and SHALL treat every source-type-and-target-type pair outside that union as denied, so that the six new node types introduce no permitted pair beyond those enumerated in criteria 1 through 11.
13. IF a user attempts a connection whose source-type-and-target-type pair lies outside the permitted set defined in criterion 12, or whose selected protocol differs from the protocol stated for that pair in criteria 1 through 9, THEN THE System SHALL reject the connection, SHALL leave the Canvas edge set unchanged, and SHALL display a message naming the source node type, the target node type, and, for a protocol mismatch, the protocol permitted for that pair.
14. IF a user attempts a connection whose source node and target node are the same node, or a connection whose ordered source-node-and-target-node pair is already held by an existing edge, THEN THE System SHALL reject the connection, SHALL leave the Canvas edge set unchanged, and SHALL display a message naming whether the rejection was for a self-referencing edge or a duplicate edge, in the same manner as Requirement 2, so that each ordered node pair carries at most one edge and each node's stored outgoing edge order used by the routing policy of Requirement 32 lists each target node at most once.
15. THE System SHALL permit an edge that is permitted under criterion 12 and that closes a directed cycle, SHALL display the cycle warning badge on every node participating in that cycle, and SHALL terminate any request or Job whose traversal exceeds the configured max-hop limit with a LOOP_DETECTED status, in the same manner as Requirement 13.
16. IF a topology import contains an edge that violates criterion 12, criterion 13, criterion 14, or the cardinality limit of criterion 11, THEN THE System SHALL reject the import, SHALL leave the Canvas unmodified, and SHALL display a message naming the source node label, the target node label, and which of those criteria the edge violated, in the same manner as Requirement 18.

### Requirement 31: Terminal Status Partition and Error Taxonomy

**User Story:** As a backend engineer, I want failures broken down by cause rather than lumped into one error rate, so that I can tell a rejected-credentials problem apart from a capacity problem.

#### Acceptance Criteria

1. THE Simulation_Engine SHALL support exactly nine terminal statuses, being Success, Timeout, Dropped, LOOP_DETECTED, and NO_ROUTE as defined in Requirement 6, Requirement 13, and Requirement 14 together with Unauthenticated, Forbidden, Retry_Exhausted, and Dead_Lettered, and SHALL treat the In_Flight status as a non-terminal status that is counted under none of the nine.
2. WHEN a request or Job reaches a terminal status, THE Simulation_Engine SHALL assign it exactly one of the nine terminal statuses and SHALL record with that assignment the identifier of the node at which the status was assigned, so that at any simulated instant a request or Job holds at most one terminal status and is counted against exactly one node.
3. WHEN a Job's Dead_Lettered status is cleared by a Redrive under Requirement 26, THE Simulation_Engine SHALL decrement by one the cumulative Dead_Lettered count of the Dead_Letter_Queue node that retained that Job at the simulated instant the Job is routed, SHALL return that Job to the In_Flight status, and SHALL count that Job again only when it next reaches a terminal status, so that the sum of the nine cumulative terminal status counts equals the number of requests and Jobs that have left the system and are not currently In_Flight.
4. THE Telemetry_Dashboard SHALL report, both system-wide and for each node, the cumulative count of each of the nine terminal statuses in requests and the rate of each in terminations per second computed as the count recorded within the current metrics window divided by that window's duration in seconds, attributing each per-node count to the node identifier recorded under criterion 2.
5. THE Telemetry_Dashboard SHALL classify Unauthenticated and Forbidden as admission-control outcomes, Timeout, Dropped, Retry_Exhausted, and Dead_Lettered as capacity-or-reliability outcomes, and LOOP_DETECTED and NO_ROUTE as topology-configuration outcomes, SHALL classify Success under none of the three classes, SHALL report a separate rate for each of the three classes in terminations per second, and SHALL compute the total error rate as a fraction in the range 0.0 to 1.0 equal to the count of terminations in the three classes within the current metrics window divided by the count of all nine terminal statuses within that same window.
6. WHERE a node's routing policy is Fan_Out, THE Simulation_Engine SHALL record each branch's terminal status against the node at which that branch terminated and SHALL count only the parent request in the system-wide terminal status counts, so that a parent request and every branch it issued together contribute exactly one termination to the system-wide total.
7. WHEN a simulation enters the Complete state, THE Simulation_Engine SHALL report the count of requests and Jobs still holding the In_Flight status as that run's unfinished count in requests, SHALL exclude that count from every cumulative terminal status count, and SHALL exclude it from the denominator of the percentages required by criterion 8.
8. WHEN a run completes, THE Telemetry_Dashboard SHALL display for each of the nine terminal statuses the cumulative count in requests, the rate in terminations per second computed as that count divided by the run's simulated duration in seconds, and the percentage of terminated requests computed as that count divided by the sum of the nine cumulative counts multiplied by 100, each shown with its unit, and SHALL display each such percentage as not applicable together with a plain-language explanation that no request left the system while that sum is zero, in the same manner as Requirement 8.
9. WHILE the admission-control outcome rate has exceeded the capacity-or-reliability outcome rate by at least 20 percent of the capacity-or-reliability outcome rate in each of the 3 most recent metrics windows and at least 30 terminations of statuses other than Success were recorded across those 3 windows, THE Analysis_Engine SHALL emit a Finding of category Reliability naming both rates in terminations per second and stating that the dominant failure mode is admission control rather than capacity.

### Requirement 32: Downstream Routing, Fan-Out, and Branch Accounting

**User Story:** As a software architect, I want a service to call several dependencies rather than only its first one, so that I can model a request that reads a cache, queries a database, and publishes an event.

#### Acceptance Criteria

1. THE System SHALL offer a per-node downstream routing policy parameter accepting exactly the values First, Round_Robin, Weighted, and Fan_Out on every node type that permits two or more outgoing edges, SHALL store that parameter independently for each node so that two nodes of the same type may hold different values, and SHALL set that parameter to First when a node is placed on the Canvas.
2. WHERE a node's routing policy is First, THE Simulation_Engine SHALL make every forwarding decision at that node along that node's outgoing edge of lowest stored index, where an outgoing edge's stored index is its position in the topology's serialized edge collection counted from 0, and THE System SHALL preserve every edge's stored index unchanged across save, load, export, and import, so that a node forwards along the same edge before and after a round trip through persistence.
3. WHERE a node's routing policy is Round_Robin, THE Simulation_Engine SHALL hold exactly one cursor for that node, SHALL set that cursor to the node's outgoing edge of lowest stored index when a simulation is started and when a simulation is reset, SHALL make each forwarding decision along the outgoing edge at that cursor, SHALL advance the cursor by exactly one edge in ascending stored index order per forwarding decision, SHALL return the cursor to the outgoing edge of lowest stored index after the edge of highest stored index, and SHALL leave the cursor unchanged across a pause and a subsequent resume, so that the same topology, configuration, and seed produce an identical sequence of edge selections across runs.
4. WHERE a node's routing policy is Weighted, THE System SHALL offer a weight parameter in the range 0.0 to 1.0 on each of that node's outgoing edges and SHALL set that weight to 1.0 when an edge is created, and THE Simulation_Engine SHALL make each forwarding decision by drawing exactly one value from the seeded PRNG and selecting the outgoing edge whose cumulative normalized weight, accumulated in ascending stored index order, first exceeds that drawn value.
5. WHERE a node's routing policy is Weighted and the sum of that node's outgoing edge weights is greater than 0.0, THE System SHALL compute each edge's normalized weight as that edge's configured weight divided by that sum, SHALL display each normalized weight to 2 decimal places in the configuration panel alongside its configured weight, and SHALL leave every configured weight stored unchanged, so that normalizing an already-normalized set of weights yields the same normalized set.
6. IF a forwarding decision is required at a node whose routing policy is Weighted and the sum of that node's outgoing edge weights is 0.0 or is non-finite, THEN THE Simulation_Engine SHALL treat every outgoing edge of that node as holding a normalized weight equal to 1 divided by that node's outgoing edge count, and THE System SHALL display a normalization warning naming that node's user-assigned label in the configuration panel, so that no forwarding decision divides by a zero weight sum and no request is terminated for want of a weight.
7. WHERE a node's routing policy is Fan_Out, WHEN a request whose fan-out depth is below 4 arrives at that node, THE Simulation_Engine SHALL dispatch exactly one branch along every outgoing edge of that node at a single simulated timestamp, SHALL record each branch as a request carrying the parent request's identifier, the fan-out node's identifier, and a path whose first entry is the fan-out node, SHALL set each branch's fan-out depth to the parent request's fan-out depth plus 1, SHALL set each branch's hop count to the parent request's hop count at the dispatch timestamp, and SHALL count each node a branch subsequently visits as one hop against the max-hop limit defined in Requirement 13, so that a request emitted by a Traffic_Generator node or a Scheduler node holds a fan-out depth of 0 and a Fan_Out node holding exactly one outgoing edge dispatches exactly one branch.
8. IF a request whose fan-out depth is 4 arrives at a node whose routing policy is Fan_Out, THEN THE Simulation_Engine SHALL forward that request along that node's outgoing edge of lowest stored index alone, SHALL dispatch no further branch for that request at that node, and SHALL record a fan-out-depth-limit event in the event log naming that node's identifier and that request's identifier.
9. WHERE a node's routing policy is Fan_Out, THE Simulation_Engine SHALL treat a branch as settled when that branch reaches a terminal status or when that branch's response traversal reaches the fan-out node, SHALL treat a branch dispatched along an Asynchronous edge as settled at the simulated instant its target node accepts or terminates it, SHALL resume the parent request at the fan-out node only after every branch of that request is settled, SHALL add to the parent request's accumulated latency the greatest interval between the dispatch timestamp and the settle timestamp among that request's branches, and SHALL add no other branch latency to that parent request.
10. WHEN a branch dispatched at a Fan_Out node reaches a success status, THE Simulation_Engine SHALL traverse that branch's response along that branch's own path in reverse from its last visited node to the fan-out node and to no node upstream of the fan-out node, and SHALL leave the parent request's path unchanged by that branch, so that the parent request's response traversal after resumption follows the parent request's own path in reverse and exactly one response traversal reaches the origin node per request.
11. WHEN a branch dispatched at a Fan_Out node settles, THE Simulation_Engine SHALL record that branch's arrival and departure at every node the branch visited, SHALL count that branch under no system-wide terminal status, and SHALL exclude that branch from the system-wide in-flight request count, and THE Simulation_Engine SHALL count the parent request exactly once in the system-wide in-flight request count for the whole interval during which its branches are unsettled, so that the time-weighted active-request figure counts each end-to-end request once and the terminal-status partition of Requirement 31 holds.
12. IF a branch dispatched at a Fan_Out node reaches a terminal status other than success, THEN THE Simulation_Engine SHALL terminate the parent request with that branch's terminal status, SHALL record with that termination the identifier of the branch's target node that produced that status, SHALL discard every branch of that parent request that has not settled without counting any discarded branch under a system-wide terminal status, and SHALL select as the terminating branch, where two or more branches of that request reach a non-success terminal status at the same simulated timestamp, the branch dispatched along the outgoing edge of lowest stored index.
13. WHEN a topology recorded under schema version 1 is loaded, THE System SHALL set every node's downstream routing policy to First and every edge's weight to 1.0, so that a run of that topology at a given seed produces the same metrics it produced before this feature.
14. THE Telemetry_Dashboard SHALL report, for each node holding two or more outgoing edges, the count of requests forwarded along each of that node's outgoing edges during the current metrics window in requests, identifying each outgoing edge by the user-assigned label of its target node, and SHALL report for each node whose routing policy is Fan_Out the count of branches dispatched during that window in branches.

### Requirement 33: Subsystem Grouping

**User Story:** As a software architect, I want to group a complete backend into named subsystems that I can collapse, so that a sixty-node architecture stays readable while I focus on one tier at a time.

#### Acceptance Criteria

1. WHEN 2 or more nodes are selected on the Canvas and a group action is invoked, THE System SHALL create a Subsystem_Group containing exactly those selected nodes, SHALL assign it a default name that is unique among existing Subsystem_Group names under case-insensitive comparison, and SHALL make that name editable by the user.
2. IF a group action is invoked while fewer than 2 nodes are selected, while more than 50 nodes are selected, while the topology already contains 20 Subsystem_Groups, or while at least one selected node already belongs to a Subsystem_Group, THEN THE System SHALL create no Subsystem_Group, SHALL display a message naming the violated limit together with the labels of any selected nodes that already belong to a Subsystem_Group, and SHALL leave every existing Subsystem_Group and every node position unchanged.
3. THE System SHALL assign each node to at most one Subsystem_Group and SHALL permit no Subsystem_Group to be a member of another Subsystem_Group, so that Subsystem_Group membership is exactly one level deep.
4. WHEN a Subsystem_Group name is submitted, THE System SHALL store that name where it holds 1 to 40 characters after removal of leading and trailing whitespace and differs from every other Subsystem_Group name in the topology under case-insensitive comparison.
5. IF a submitted Subsystem_Group name is empty after removal of leading and trailing whitespace, holds more than 40 characters after that removal, or equals another Subsystem_Group's name under case-insensitive comparison, THEN THE System SHALL display an inline error message naming the violated constraint and SHALL leave that group's stored name at its previous value.
6. WHEN a Subsystem_Group is collapsed, THE Canvas SHALL render that group as a single element, SHALL render every edge that crosses the group boundary as an edge attached to that element, and SHALL render no element for any edge whose source node and target node are both contained in that group.
7. WHILE a Subsystem_Group is collapsed, WHERE two or more boundary-crossing edges connect contained nodes to the same external node in the same direction, THE Canvas SHALL render those edges as exactly one merged edge and SHALL display on that merged edge the count of underlying edges it represents.
8. WHEN a merged edge on a collapsed Subsystem_Group is hovered or activated, THE Canvas SHALL list the label of every contained node whose edge is merged into it and the protocol of each of those edges.
9. WHILE a Subsystem_Group is collapsed, THE Canvas SHALL render no element for any node contained in that group, so that the rendered element count is reduced by the number of contained nodes less one.
10. WHEN a collapsed Subsystem_Group element is dragged on the Canvas, THE System SHALL apply the drag displacement to the stored position of every node contained in that group, so that the relative positions of the contained nodes are unchanged.
11. WHEN a Subsystem_Group is expanded, THE Canvas SHALL render every contained node at its stored position, so that a group collapsed and expanded with no intervening drag restores every contained node to the position it held before the collapse.
12. THE Simulation_Engine SHALL produce identical metrics for a topology whether its Subsystem_Groups are collapsed or expanded and whether or not its nodes belong to any Subsystem_Group, so that grouping is a presentation concern only.
13. THE System SHALL permit creating, renaming, collapsing, expanding, and deleting a Subsystem_Group and changing a Subsystem_Group's membership while the simulation is in the Idle, Running, Paused, or Complete state, and SHALL leave the Simulation_Engine's pending events, virtual clock, and retained metrics unchanged by each of those operations.
14. WHILE a Subsystem_Group is collapsed and a simulation has produced metrics for at least one metrics window, THE Canvas SHALL display for that group the summed throughput of its contained nodes in requests per second, the summed error count of its contained nodes in requests, and the least healthy health status among its contained nodes, each with its unit.
15. THE System SHALL order the health statuses defined in Requirement 8 from least healthy to most healthy as red, then yellow, then green, and SHALL exclude from the comparison required by criterion 14 every contained node for which no health status is available.
16. WHILE a Subsystem_Group is collapsed and no contained node has an available health status, THE Canvas SHALL report that group's health status as not applicable together with a plain-language explanation that no contained node has reported metrics, in the same manner as Requirement 8.
17. THE Telemetry_Dashboard SHALL offer a per-Subsystem_Group breakdown reporting, for each group, the summed throughput of its contained nodes in requests per second, the summed error count of its contained nodes by terminal status in requests, the highest Utilization among those contained nodes whose Utilization is reported as a numeric value, and the user-assigned label of the node holding that highest Utilization.
18. WHILE every contained node of a Subsystem_Group reports its Utilization as not applicable, THE Telemetry_Dashboard SHALL report that group's highest Utilization as not applicable, SHALL report no node label for it, and SHALL report no numeric Utilization value for that group.
19. WHEN a node contained in a Subsystem_Group is deleted from the Canvas, THE System SHALL remove that node from the group's membership and SHALL retain the group with its stored name and collapsed or expanded state where 2 or more contained nodes remain.
20. WHEN deletion of contained nodes leaves a Subsystem_Group with fewer than 2 contained nodes, THE System SHALL delete that Subsystem_Group, SHALL retain every remaining node and every edge on the Canvas at its stored position, and SHALL report no error.
21. WHEN one or more nodes belonging to no Subsystem_Group are selected together with an existing Subsystem_Group and an add-to-group action is invoked, THE System SHALL add exactly those nodes to that group's membership and SHALL leave the stored position of each added node unchanged.
22. IF an add-to-group action would raise a Subsystem_Group's membership above 50 nodes or would add a node that already belongs to another Subsystem_Group, THEN THE System SHALL add no node to that group, SHALL display a message naming the violated limit together with the labels of any nodes that already belong to another Subsystem_Group, and SHALL leave every Subsystem_Group membership unchanged.
23. WHEN a remove-from-group action is invoked for one or more nodes contained in a Subsystem_Group, THE System SHALL remove exactly those nodes from that group's membership, SHALL retain each removed node and its edges on the Canvas at its stored position, and SHALL delete that Subsystem_Group where fewer than 2 contained nodes remain.
24. WHEN a Subsystem_Group is deleted, THE System SHALL retain every contained node and every edge on the Canvas and SHALL render every previously contained node at its stored position, whether that group was collapsed or expanded at the time of deletion.
25. THE System SHALL include every Subsystem_Group's name, its member node identifiers, and its collapsed or expanded state in save, load, export, and import operations, so that a loaded or imported topology presents the same groups, the same memberships, and the same collapsed states it held when it was saved or exported.
26. WHEN an imported topology contains a Subsystem_Group whose name violates criterion 4, whose membership names a node identifier absent from the topology, whose membership names a node identifier that also appears in another Subsystem_Group, or whose membership holds fewer than 2 or more than 50 node identifiers, THE System SHALL truncate a name longer than 40 characters to its first 40 characters, SHALL append a numeric suffix to a name that duplicates another group's name, SHALL drop absent and duplicate member identifiers, SHALL retain the first 50 member identifiers in stored order, SHALL drop the group where fewer than 2 member identifiers remain, and SHALL record a normalization warning naming the group, the violation, and the applied change, in the same manner as Requirement 15.

### Requirement 34: Complete-Architecture Scale, Schema Version 2, and Migration

**User Story:** As a backend engineer, I want to model my whole production backend in one topology, so that the analysis reflects the interactions between tiers rather than one isolated tier.

#### Acceptance Criteria

1. WHILE a topology containing 80 nodes drawn from all fifteen node types and 200 edges is present on the Canvas, and a continuous sequence of pan, zoom, and select operations is applied for a measurement interval of 10 wall-clock seconds, THE System SHALL present a mean of 30 or more frames per second over that interval and 24 or more frames in every 1-second subinterval of it, where the frame rate is measured as frames presented divided by elapsed wall-clock time on a device with 4 or more physical CPU cores and 8 GB or more of RAM, running a browser from the Browser Compatibility list of this document at a viewport of 1,920 by 1,080 logical pixels with no other simulation running.
2. WHILE a topology containing 80 nodes drawn from all fifteen node types and 200 edges is running at the maximum supported speed multiplier, THE Simulation_Engine SHALL process 1,000 or more events per wall-clock second, measured as the count of events the Simulation_Engine reports as processed divided by elapsed wall-clock seconds over a measurement interval of 10 wall-clock seconds beginning 5 wall-clock seconds after the simulation enters the Running state, on the same device, browser, and viewport baseline stated in criterion 1, meeting the throughput target of Requirement 5.
3. WHEN a topology is saved to localStorage or exported to a file and that topology contains at least one node of the six new node types, at least one routing policy other than First, at least one edge weight, or at least one Subsystem_Group, THE System SHALL write the record at schema version 2, including every parameter listed in Requirements 23 through 28 for each such node, the Object_Store transfer queue depth, and the Scheduler max deferred triggers.
4. WHEN a topology recorded at schema version 1 is imported, THE System SHALL load it at schema version 2 by setting every node's routing policy to First, setting the Subsystem_Group set to empty, and setting each parameter of Requirements 23 through 28 that is absent from a record of one of the six new node types, including the Object_Store transfer queue depth and the Scheduler max deferred triggers, to the default value defined in Requirement 29 criterion 3, SHALL record a normalization warning naming the node's label, the parameter, and the applied default for each such parameter, and SHALL complete the import with no error reported.
5. WHEN a topology recorded at schema version 2 is imported by a build that supports schema version 2, THE System SHALL restore every node position, every node configuration parameter listed in Requirements 23 through 28, every per-node routing policy, every edge protocol, every edge weight, and every Subsystem_Group name and membership to the value held in the record, so that exporting the loaded topology again produces a record equal to the imported one.
6. IF a topology recorded at a schema version above 2 is imported, THEN THE System SHALL reject the import with a message naming the record's schema version and the required version, SHALL leave the Canvas unmodified, and SHALL leave every topology stored in localStorage unmodified, in the same manner as Requirement 18.
7. WHEN a save to localStorage is invoked and the serialized topology occupies more than 4,194,304 bytes when encoded as UTF-8, THE System SHALL complete the save, SHALL retain the saved record in a state from which it can be loaded, and SHALL display a warning naming the serialized size in bytes and the 4,194,304-byte threshold, in the same manner as Requirement 17.
8. WHEN a topology recorded at schema version 2 is imported in which a per-node routing policy, an edge weight, the Subsystem_Group set, or a parameter listed in Requirements 23 through 28 is absent, THE System SHALL set that field to the default defined for it in Requirement 29 criterion 3 or Requirement 32 criteria 1 and 4, SHALL record a normalization warning naming the node or edge label, the field, and the applied default, and SHALL complete the import, so that an absent field of this set is defaulted rather than treated as a validation failure.
9. IF an imported record's schema version field is absent, is not an integer, or is below 1, THEN THE System SHALL reject the import with a message naming that field and the value found, and SHALL leave the Canvas unmodified.
10. WHEN a topology stored in localStorage at schema version 1 is loaded, THE System SHALL apply the migration of criterion 4 to the in-memory topology only, SHALL leave the stored record at schema version 1 with its original field values, and SHALL write that topology at schema version 2 on the next save invoked for it.

### Requirement 35: Finding Model and Analysis Report

**User Story:** As a software architect, I want each analysis result to name the constraint, show the evidence, and state the tradeoff of acting on it, so that I can defend a design decision to my team from the simulation output.

#### Acceptance Criteria

1. THE Analysis_Engine SHALL represent every analysis result as a Finding carrying exactly the fields: a stable identifier; a category drawn from the eight values Bottleneck, Saturation, Instability, Capacity, Single_Point_Of_Failure, Reliability, Configuration, and Comparison; a severity drawn from the three values Critical, Warning, and Info; a subject node set holding 0 to 200 node identifiers; an evidence set holding 1 to 20 entries; a constraint statement of 1 to 500 characters; a recommended action; a tradeoff statement of 1 to 500 characters; a confidence drawn from the three values High, Medium, and Low; and an analysis window given as an inclusive start and an inclusive end in simulated milliseconds.
2. THE Analysis_Engine SHALL populate each entry of a Finding's evidence set with a metric name of 1 to 100 characters, a finite numeric value, a unit of measurement of 1 to 20 characters, and either the identifier of one of that Finding's subject nodes or a system-wide scope marker where that Finding's subject node set is empty, and SHALL designate exactly one entry of that set as the primary evidence entry.
3. WHERE a Finding's subject node set holds at least one node identifier, THE Analysis_Engine SHALL populate that Finding's constraint statement with the identifier of the subject node whose bounded resource limits it, the name of the configuration parameter that bounds that resource, and the configured value of that parameter with its unit.
4. THE Analysis_Engine SHALL populate a Finding's recommended action with the identifier of the node holding the parameter to change, the name of that configuration parameter, a direction of change drawn from the two values increase and decrease, and either a target value with its unit or a multiplier of the currently configured value.
5. THE Analysis_Engine SHALL populate a Finding's tradeoff statement with the cost or risk that its recommended action introduces, naming the node, resource, or metric that the recommended action degrades.
6. THE Analysis_Engine SHALL set a Finding's confidence from the lowest count of requests that completed within that Finding's analysis window among its subject nodes as follows: High where that count is 200 or greater and every subject node was in Steady_State throughout that window; Medium where that count is 200 or greater and at least one subject node was not in Steady_State throughout that window; Medium where that count is 30 to 199; and Low where that count is fewer than 30.
7. THE Analysis_Panel SHALL display every Finding with its severity as a text label, its subject node labels or its system-wide scope, its constraint statement, its recommended action, its tradeoff statement, its confidence, and the inclusive start and end of its analysis window in simulated milliseconds.
8. THE Analysis_Panel SHALL order displayed Findings by severity with Critical first, Warning second, and Info third; SHALL order Findings of equal severity by descending absolute magnitude of the value of their primary evidence entry; SHALL order Findings of equal severity and equal primary evidence magnitude by the position of their category in the eight-value order stated in criterion 1; and SHALL order Findings that remain tied by ascending lexicographic order of their identifier, so that a given Finding set yields exactly one display order.
9. THE Analysis_Panel SHALL identify each subject node of a Finding by that node's user-assigned label, SHALL fall back to a shortened form of that node's identifier where the label is unavailable because the node is no longer present in the topology, and SHALL present a Finding whose subject node set is empty under a system-wide scope label rather than a node label, in the same manner as Requirement 8.
10. WHEN an export action is invoked in the Analysis_Panel, THE System SHALL download an Analysis_Report containing a report schema version, every Finding then displayed with every field listed in criterion 1, the topology, every node configuration, the PRNG seed, the simulated duration in milliseconds, and the offered load in RPS of the run that produced the Findings.
11. THE System SHALL offer the Analysis_Report in a JSON format that carries every field listed in criterion 1 for every Finding and in a Markdown format intended for reading, and SHALL accept only the JSON format for import.
12. WHEN an exported Analysis_Report in JSON format whose report schema version the build supports is imported, THE Analysis_Panel SHALL display every Finding that report carries with every field value equal to the exported value and in the display order defined by criterion 8.
13. THE Analysis_Engine SHALL derive a Finding's stable identifier from the identifier of the analysis rule that produced it, that Finding's category, and the ascending-sorted identifiers of its subject nodes, SHALL emit at most one Finding per identifier within a single analysis result, and SHALL leave that identifier unchanged across recomputations within a run, across repeated runs of the same topology, configuration, PRNG seed, and offered load, and across any change to a subject node's user-assigned label.
14. IF an imported Analysis_Report carries a report schema version the build does not support, omits a field listed in criterion 1 for any Finding it carries, or carries a value outside the stated value set for a Finding's category, severity, or confidence, THEN THE System SHALL reject the import, SHALL display an error message naming the report schema version the build requires and each omitted field or unrecognized value, and SHALL leave the Findings currently displayed in the Analysis_Panel unchanged, in the same manner as Requirement 18.
15. WHERE a Finding's subject node set is empty, THE Analysis_Engine SHALL populate its constraint statement with the name of the system-wide metric that limits the run, that metric's observed value with its unit, and the configured or Service_Objective value it is measured against, and SHALL set its confidence from the total count of requests that completed system-wide within its analysis window using the count boundaries stated in criterion 6.

### Requirement 36: Bottleneck Identification and Ranking

**User Story:** As a backend engineer, I want the analysis to tell me which single node is limiting my system, so that I spend my effort on the component that actually constrains throughput.

#### Acceptance Criteria

1. WHILE a simulation has produced metrics for at least 3 completed metrics windows, THE Analysis_Engine SHALL compute, for every node whose Utilization is applicable under Requirement 29 criteria 10 through 13, that node's analysis Utilization as the arithmetic mean of its per-window Utilization values over the analysis window comprising the 3 most recently completed metrics windows, SHALL rank those nodes in descending analysis Utilization, SHALL order two nodes whose analysis Utilization values differ by less than 0.001 by descending aggregate Latency_Share as computed in criterion 10, then by descending throughput in requests per second, then by ascending node identifier in lexicographic order, and SHALL expose that ranking in the Analysis_Panel with each analysis Utilization shown as a fraction in the range 0.0 to 1.0.
2. WHILE a simulation has produced metrics for at least 3 completed metrics windows and at least one node is eligible under criterion 9, THE Analysis_Engine SHALL designate exactly one node as the Bottleneck for that recomputation, selecting the eligible node with the highest analysis Utilization among those eligible nodes whose analysis Utilization is at or above 0.85, selecting otherwise the eligible node with the greatest aggregate Latency_Share, and resolving a tie in either selection by the ordering stated in criterion 1.
3. WHEN the Analysis_Engine designates a Bottleneck, THE Analysis_Engine SHALL emit exactly one Finding of category Bottleneck that names that node, names the configuration parameter bounding its Utilization using the mapping defined in Requirement 29 criterion 10 for the six new node types and the equivalent bounded resource for the existing nine node types, and names the configured value of that parameter with its unit.
4. WHEN the Analysis_Engine designates a Bottleneck, THE Analysis_Engine SHALL include in that Finding's evidence set the node's analysis Utilization as a fraction from 0.0 to 1.0, its aggregate Latency_Share as a percentage from 0 to 100, its mean queue depth in requests over the analysis window, its throughput in requests per second over the analysis window, its count of requests and Jobs that reached a terminal status within the analysis window, and which of the two selection rules of criterion 2 produced the designation.
5. WHEN the Analysis_Engine designates a Bottleneck whose aggregate Latency_Share is S percent, THE Analysis_Engine SHALL state in that Finding that reducing that node's accumulated time-in-system contribution to 0 ms reduces end-to-end p99 latency by at most S percent.
6. WHILE the node designated as the Bottleneck under criterion 2 has an analysis Utilization at or above 0.85 and at least one other eligible node has an analysis Utilization within 0.05 of that value, THE Analysis_Engine SHALL emit one additional Finding of category Bottleneck naming every such node as co-limiting, naming each named node's analysis Utilization as a fraction from 0.0 to 1.0, stating that raising the capacity of one named node alone leaves every remaining named node at an analysis Utilization at or above 0.85 and therefore raises system throughput no further, and SHALL leave the single Bottleneck designation of criterion 2 unchanged.
7. WHILE every node whose Utilization is applicable has an analysis Utilization below 0.60 and no node meets the definition of Instability, THE Analysis_Engine SHALL emit, in addition to the Finding emitted under criterion 3, exactly one Finding of category Bottleneck with severity Info that states that no node constrains the offered load, names the highest analysis Utilization observed as a fraction from 0.0 to 1.0 together with the label of the node holding it, and names the offered load in requests per second over the analysis window.
8. IF the node designated as the Bottleneck under criterion 2 recorded fewer than 30 completed requests within the analysis window, THEN THE Analysis_Engine SHALL set that Finding's confidence to Low in the same manner as Requirement 35 criterion 6, SHALL state that node's completed request count in the Finding, and SHALL state that a longer simulated duration reaching at least 200 completed requests at that node is required for confidence High.
9. THE Analysis_Engine SHALL treat a node as eligible for Bottleneck designation while that node's Utilization is applicable under Requirement 29 criteria 10 through 13 and that node recorded at least 1 request or Job arrival within the analysis window, SHALL keep such a node eligible while its throughput is 0 requests per second, and SHALL list every node excluded from Bottleneck candidacy in the Analysis_Panel with its exclusion reason stated as either a not-applicable Utilization or zero recorded arrivals within the analysis window.
10. THE Analysis_Engine SHALL compute a node's aggregate Latency_Share across all request paths as the sum, over every request and Job that reached a terminal status within the analysis window, of the time-in-system that request or Job accumulated at that node, divided by the sum over those same requests and Jobs of the time-in-system they accumulated at every node on their recorded path, expressed as a percentage from 0 to 100, so that a node lying on several request paths receives one share weighted by the requests that traversed it, and SHALL report that share as not applicable while that divisor is 0 ms.
11. IF a simulation has produced metrics for at least 3 completed metrics windows and no node is eligible under criterion 9, THEN THE Analysis_Engine SHALL emit exactly one Finding of category Bottleneck with severity Info stating that no Bottleneck was identified for the analysis window, naming the count of nodes excluded for a not-applicable Utilization and the count of nodes excluded for zero recorded arrivals.

### Requirement 37: Saturation and Instability Detection

**User Story:** As a backend engineer, I want to be told when a queue is growing without bound rather than reading it off a chart, so that I catch an unstable configuration before it reaches production.

#### Acceptance Criteria

1. WHILE a node's Utilization is applicable under Requirement 29 criteria 10 through 13 and that node's per-window Utilization is at or above 0.85 in each of the 3 most recently completed metrics windows, THE Analysis_Engine SHALL emit exactly one Finding of category Saturation and severity Warning whose subject node set holds that node's identifier, whose analysis window begins at the start of the earliest of those 3 windows and ends at the end of the most recently completed of them, and whose evidence set holds that node's sustained Utilization as a fraction in the range 0.0 to 1.0 computed as the arithmetic mean of its per-window Utilization values over the maximal run of consecutive completed metrics windows ending at the most recently completed window in which its per-window Utilization was at or above 0.85, the length of that run in windows, and that node's throughput over the analysis window in requests per second, and SHALL state as that Finding's recommended action an increase of the configuration parameter bounding that node's Utilization under Requirement 29 criterion 10 for the six new node types or the equivalent bounded resource for the existing nine node types, and as its tradeoff the additional load that raising that bound places on that node's downstream nodes.
2. WHILE at least 5 metrics windows have completed, a node is eligible for Instability under criterion 9, that node's monitored depth measure at the end of each of the 4 most recently completed metrics windows is greater than its value at the end of the window preceding it, and its value at the end of the most recently completed window exceeds its value at the end of the earliest of the 5 inspected windows by at least 20 percent of that earliest value, THE Analysis_Engine SHALL emit exactly one Finding of category Instability and severity Critical whose subject node set holds that node's identifier, whose analysis window begins at the start of the earliest of those 5 windows and ends at the end of the most recently completed of them, and whose evidence set holds that node's arrival rate, its service rate, and its arrival rate minus its service rate, each in items per second measured over that analysis window under criterion 9, together with its monitored depth measure at the end of the most recently completed window in items.
3. WHEN the Analysis_Engine emits a Finding of category Instability for a node whose monitored depth measure has an available configured bound, THE Analysis_Engine SHALL compute that node's growth rate in items per simulated second as its monitored depth measure at the end of the most recently completed metrics window minus its value at the end of the earliest window inspected under criterion 2, divided by the elapsed simulated time across those windows in seconds, SHALL compute the projected time to that bound in simulated seconds as that bound minus the monitored depth measure at the end of the most recently completed window, divided by that growth rate, SHALL state that the projection holds while that computed growth rate continues, and SHALL include the growth rate, the bound, and the projected time with their units in that Finding's evidence set, where that bound is the sum of the node's configured prefetch buffer depth in Jobs and the configured capacity of every Message_Queue node holding an edge into it for a Worker_Pool node, the configured max capacity for a Message_Queue node, and the configured max queue depth for every other node type.
4. WHEN the Analysis_Engine emits a Finding of category Instability for a node, THE Analysis_Engine SHALL state as that Finding's recommended action either an increase of that node's service capacity to at least its measured arrival rate in items per second or a reduction of the offered load to at most its measured service rate in items per second, SHALL name the required magnitude of that change in items per second as its measured arrival rate minus its measured service rate, SHALL name the configuration parameter to change and the direction of change as required by Requirement 35 criterion 4, and SHALL state as its tradeoff that raising service capacity increases the load placed on that node's downstream nodes and that reducing the offered load leaves the difference in offered demand unserved.
5. WHILE a node's Little's Law deviation as defined in Requirement 6 exceeds 5 percent at the end of each of the 3 most recently completed metrics windows, THE Analysis_Engine SHALL emit exactly one Finding of category Instability and severity Warning whose subject node set holds that node's identifier, stating that the node has not reached Steady_State and naming that deviation as a percentage for each of those 3 windows, SHALL suppress every Finding of category Capacity whose subject node set holds that node's identifier, SHALL state in the Analysis_Panel which analysis was suppressed and for which node in the same manner as Requirement 41 criterion 5, and SHALL continue to report that node's per-node Headroom and the system Headroom required by Requirement 38 criteria 1 and 3 with each such figure annotated as measured outside Steady_State.
6. WHILE at least 4 metrics windows have completed and a Dead_Letter_Queue node's retained message count at the end of each of the 3 most recently completed metrics windows is greater than its retained message count at the end of the window preceding it, THE Analysis_Engine SHALL emit exactly one Finding of category Reliability and severity Warning whose subject node set holds that Dead_Letter_Queue node's identifier, SHALL populate its evidence set with that node's retained message count at the end of the most recently completed window in messages, its dead-letter arrival rate over those 3 windows in messages per second, and the retained message count attributed to each upstream node identifier at which Retry_Exhaustion occurred as reported under Requirement 26 criterion 9 in messages, and SHALL state as its tradeoff that reducing the named upstream node's job failure rate or raising its retry budget increases the mean time a failing Job occupies a concurrency slot at that upstream node.
7. WHILE a Worker_Pool node's Job_Backlog is reported as not draining under Requirement 25 criterion 13 at the end of each of the 3 most recently completed metrics windows and at least 1 Job attempt completed at that node within those 3 windows, THE Analysis_Engine SHALL emit exactly one Finding of category Capacity and severity Warning whose subject node set holds that node's identifier, SHALL compute the required concurrency in Jobs as that node's measured Job arrival rate in Jobs per second over those 3 windows multiplied by its observed mean job processing time in seconds over those same windows, rounded up to the next integer, SHALL name that required concurrency in Jobs together with the node's configured concurrency in Jobs and, where the computed value exceeds 10,000 Jobs, the configured maximum of 10,000 Jobs, and SHALL state as its tradeoff that raising concurrency increases the load that node places on its downstream nodes.
8. WHILE two Scheduler nodes have each fired at least 2 triggers within the 3 most recently completed metrics windows and, for 2 or more consecutive trigger indices of the Scheduler node holding the greater configured interval, each of those triggers fired within 1,000 simulated milliseconds of a trigger of the other Scheduler node, THE Analysis_Engine SHALL emit exactly one Finding of category Configuration and severity Info per such pair of Scheduler nodes, whose subject node set holds both node identifiers and whose evidence set holds the count of coinciding trigger pairs in triggers, the greatest absolute difference between the fire times of those coinciding pairs in simulated milliseconds, and the total Jobs emitted by those coinciding triggers in Jobs, and SHALL state as its recommended action an increase of the start offset of one named Scheduler node and as its tradeoff that shifting a start offset changes the simulated times at which that node's Jobs are emitted.
9. THE Analysis_Engine SHALL measure, over a Finding's analysis window, a node's monitored depth measure as its Job_Backlog in Jobs for a Worker_Pool node, its buffered message count in messages for a Message_Queue node, and its reported queue depth in requests for every other node type that reports a queue depth; its arrival rate as the count of requests and Jobs that arrived at that node within that window divided by that window's duration in simulated seconds; and its service rate as the count of requests and Jobs that departed that node within that window, counting each request or Job that was forwarded to a downstream node, that completed at that node, or that reached a terminal status at that node, divided by that window's duration in simulated seconds; and THE Analysis_Engine SHALL treat as eligible for a Finding of category Instability every node that reports a monitored depth measure other than a Dead_Letter_Queue node, and SHALL list each node excluded from Instability evaluation in the Analysis_Panel with its exclusion reason stated as either a reported node type holding no monitored depth measure or a Dead_Letter_Queue node evaluated under criterion 6 instead.
10. WHILE a node satisfies the conditions of both criterion 1 and criterion 2 within the same recomputation, THE Analysis_Engine SHALL emit the Finding of category Instability required by criterion 2, SHALL suppress the Finding of category Saturation required by criterion 1 for that node, and SHALL include that node's sustained Utilization as computed under criterion 1 as a fraction in the range 0.0 to 1.0 in the evidence set of the emitted Instability Finding, so that exactly one of those two Findings is emitted for that node per recomputation.
11. IF the Analysis_Engine emits a Finding of category Instability for a node whose growth rate computed under criterion 3 is at or below 0 items per simulated second or whose monitored depth measure has no available configured bound, THEN THE Analysis_Engine SHALL report that Finding's projected time to the bound as not applicable together with a plain-language explanation naming either the non-positive growth rate or the unavailable bound, and SHALL report no numeric projected time for that Finding, in the same manner as Requirement 8.

### Requirement 38: Capacity Headroom and Sustainable Load

**User Story:** As a software architect, I want to know how much more load my design absorbs and where it breaks, so that I can decide whether the current shape survives next quarter's growth or needs to change now.

#### Acceptance Criteria

1. WHILE a simulation has produced metrics for at least 3 completed metrics windows, THE Analysis_Engine SHALL report, for every node eligible under Requirement 36 criterion 9, that node's Headroom as `(1 - analysis Utilization) * 100` expressed as a percentage from 0 to 100, computing analysis Utilization over the analysis window comprising the 3 most recently completed metrics windows as defined in Requirement 36 criterion 1, and SHALL show that percentage together with the name of the configuration parameter bounding that node's resource and the configured value of that parameter with its unit.
2. WHILE a node's Utilization is reported as not applicable under Requirement 29 criteria 10 through 13, or that node recorded 0 arrivals within the analysis window, THE Analysis_Engine SHALL report that node's Headroom as not applicable together with a plain-language explanation stating either a not-applicable Utilization or zero recorded arrivals, and SHALL report no numeric Headroom percentage for that node, in the same manner as Requirement 8.
3. WHILE a simulation has produced metrics for at least 3 completed metrics windows, at least one node is eligible under Requirement 36 criterion 9, the highest analysis Utilization among those eligible nodes is above 0.0 and below 0.85, and the offered load over the analysis window is above 0 RPS, THE Analysis_Engine SHALL report system Headroom as the percentage `(0.85 / U - 1) * 100` and as the absolute figure `L * (0.85 / U - 1)` in RPS, where `U` is the highest analysis Utilization among eligible nodes and `L` is the offered load in RPS computed as the count of requests emitted by every Traffic_Generator node within the analysis window divided by that window's duration in seconds, and SHALL name the user-assigned label of the node holding `U` and that node's analysis Utilization as a fraction from 0.0 to 1.0.
4. WHILE the highest analysis Utilization among nodes eligible under Requirement 36 criterion 9 is at or above 0.85, THE Analysis_Engine SHALL report system Headroom as 0 percent and 0 RPS, SHALL name the user-assigned label of the node holding that analysis Utilization, and SHALL state that the topology absorbs no additional offered load before that node reaches Saturation.
5. IF fewer than 3 metrics windows have completed, no node is eligible under Requirement 36 criterion 9, the highest analysis Utilization among eligible nodes is 0.0, or the offered load over the analysis window is 0 RPS, THEN THE Analysis_Engine SHALL report system Headroom as not applicable together with a plain-language explanation naming which of those conditions held, and SHALL report no numeric system Headroom percentage and no numeric system Headroom RPS figure.
6. WHERE system Headroom is reported as a numeric figure, THE Analysis_Panel SHALL state alongside it that the figure assumes the analysis Utilization of the node holding the highest analysis Utilization grows in direct proportion to offered load and that no other node reaches Saturation at a lower offered load, and SHALL state that a Capacity_Sweep produces a measured Sustainable_Load in place of that projection.
7. THE System SHALL offer a Capacity_Sweep control accepting a starting offered load (1-100,000 RPS), an ending offered load (1-100,000 RPS), a step count (2-20 steps), a simulated duration per step (1,000-1,800,000 ms), a warm-up interval per step (0 ms to 1 ms below the simulated duration per step, default 10,000 ms), a speed multiplier drawn from the values offered by Requirement 4, and a Service_Objective consisting of a maximum end-to-end p99 latency (1-600,000 ms) and a maximum total error rate (0.0-1.0), and SHALL populate each of those parameters with a default value lying within the range stated here.
8. IF a Capacity_Sweep is started while a parameter of criterion 7 holds a value outside its stated range, holds a non-numeric, empty, or non-finite value, or while the ending offered load is at or below the starting offered load, THEN THE System SHALL start no Capacity_Sweep, SHALL display an inline error message naming the violated parameter and its valid minimum and maximum, and SHALL leave the Canvas topology and every node configuration unchanged.
9. WHEN a Capacity_Sweep of `N` steps is started, THE System SHALL set the offered load of step index `n`, counted from 0, to `starting offered load + n * (ending offered load - starting offered load) / (N - 1)` rounded to the nearest whole RPS with a value of exactly one half rounded up, so that step index 0 holds the starting offered load and step index `N - 1` holds the ending offered load.
10. IF a Capacity_Sweep is started for which `ending offered load - starting offered load + 1` is below the configured step count, THEN THE System SHALL start no Capacity_Sweep and SHALL display an error message naming the requested step count and the highest step count that yields a distinct whole-RPS value per step for the requested range; and WHERE the rounding of criterion 9 yields a step whose offered load equals that of the preceding step, THE System SHALL set that step's offered load to the preceding step's offered load plus 1 RPS, so that the offered load of every step exceeds that of the step preceding it.
11. WHEN a Capacity_Sweep step of offered load `S` is executed, THE Simulation_Engine SHALL set each Traffic_Generator node's RPS for that step to `S * (that node's configured RPS at sweep start / B)` rounded to the nearest whole RPS with a value of exactly one half rounded up and clamped to a minimum of 1 RPS, where `B` is the sum of the configured RPS of every Traffic_Generator node on the Canvas at sweep start, SHALL assign any residual between `S` and the sum of the rounded per-node values to the Traffic_Generator node holding the highest configured RPS at sweep start with a tie resolved by ascending node identifier in lexicographic order, and SHALL leave every Traffic_Generator node's distribution, spike multiplier, and spike duration at the value it held at sweep start.
12. IF a per-node RPS value computed under criterion 11 exceeds 100,000 RPS, THEN THE Simulation_Engine SHALL clamp that value to 100,000 RPS, SHALL record a normalization warning naming the Traffic_Generator node's label, the step index, the computed value, and the applied bound, and THE Analysis_Panel SHALL report that step's applied offered load in RPS as the sum of the per-node values actually applied alongside that step's requested offered load in RPS.
13. IF a Capacity_Sweep is started while the Canvas holds no Traffic_Generator node or while the sum of the configured RPS of its Traffic_Generator nodes is 0 RPS, THEN THE System SHALL start no Capacity_Sweep and SHALL display an error message stating that a Capacity_Sweep requires at least one Traffic_Generator node with a configured RPS above 0.
14. WHEN a Capacity_Sweep is executed, THE Simulation_Engine SHALL leave every Scheduler node's interval, jobs per trigger, start offset, jitter, overlap policy, and max deferred triggers at the value it held at sweep start, SHALL exclude Jobs emitted by Scheduler nodes from each step's requested and applied offered load in RPS, and THE Analysis_Panel SHALL report each step's Scheduler-emitted Job count in Jobs separately from that step's offered load, so that Scheduler load is a constant additive background load across every step.
15. WHEN a Capacity_Sweep is started, THE Simulation_Engine SHALL execute exactly one run per step in ascending order of offered load, SHALL clear all simulation state and return the virtual clock to t=0 before each step in the same manner as Requirement 4, SHALL run each step for the configured simulated duration per step, and SHALL hold the PRNG seed, the topology, the speed multiplier, every routing policy, every edge weight, and every node configuration other than the Traffic_Generator RPS values set under criterion 11 constant across every step.
16. IF a Capacity_Sweep is started while the simulation is in the Running or Paused state, THEN THE System SHALL display a confirmation naming that the current run will be stopped and its metrics discarded, SHALL start the Capacity_Sweep only after that confirmation is accepted, and SHALL leave the current run in its existing state where that confirmation is declined, in the same manner as Requirement 11.
17. WHEN a Capacity_Sweep completes or is cancelled, THE System SHALL present every node position, every node configuration parameter including every Traffic_Generator node's configured RPS, every routing policy, every edge weight, and every Subsystem_Group on the Canvas at the value it held at sweep start, so that a Capacity_Sweep changes the Canvas topology in no respect.
18. WHILE a Capacity_Sweep is running, THE System SHALL present the Start, Pause, Resume, and chaos injection controls as disabled, SHALL present the node configuration panel as read-only, and SHALL offer a cancel control for the Capacity_Sweep.
19. WHEN a Capacity_Sweep step completes, THE Analysis_Engine SHALL evaluate the Service_Objective over that step's measurement interval, being the simulated interval from the end of the configured warm-up interval to the end of the step's simulated duration, SHALL treat the step as satisfying the Service_Objective while the end-to-end p99 latency of the requests that reached a terminal status within that measurement interval is at or below the configured maximum end-to-end p99 latency and the total error rate over that measurement interval computed as defined in Requirement 31 criterion 5 is at or below the configured maximum total error rate, and SHALL treat the step as violating the Service_Objective otherwise.
20. IF no request or Job reached a terminal status within a Capacity_Sweep step's measurement interval, THEN THE Analysis_Panel SHALL report that step as not evaluated together with a plain-language explanation that the measurement interval recorded no terminations, and THE Analysis_Engine SHALL exclude that step from the Knee_Point and Sustainable_Load determinations of criteria 22 and 24.
21. WHEN a Capacity_Sweep completes, THE Analysis_Panel SHALL report for each step the step index counted from 1, the requested offered load in RPS, the applied offered load in RPS, the achieved throughput in requests per second, the end-to-end p50, p90, and p99 latency in milliseconds, the total error rate as a fraction from 0.0 to 1.0, the count of each of the nine terminal statuses of Requirement 31 in requests, the measurement interval as an inclusive start and an inclusive end in simulated milliseconds, and whether the step satisfied, violated, or was not evaluated against the Service_Objective, each numeric value with its unit.
22. WHEN a Capacity_Sweep completes and at least one evaluated step violated the Service_Objective, THE Analysis_Engine SHALL report the Knee_Point as the lowest offered load in RPS among the violating evaluated steps and SHALL report Sustainable_Load as the highest offered load in RPS among the evaluated steps that satisfied the Service_Objective and whose offered load is below that Knee_Point.
23. IF a Capacity_Sweep completes, at least one evaluated step violated the Service_Objective, and every evaluated step whose offered load is below the Knee_Point either violated the Service_Objective or was not evaluated, THEN THE Analysis_Engine SHALL report that Sustainable_Load is below the starting offered load in RPS and SHALL state that the swept range contains no offered load that satisfies the Service_Objective; and WHERE at least one evaluated step whose offered load exceeds the Knee_Point satisfied the Service_Objective, THE Analysis_Panel SHALL report the count of those steps and the offered load in RPS of each, together with a statement that the measured results are not monotonic in offered load.
24. WHEN a Capacity_Sweep completes and every evaluated step satisfied the Service_Objective, THE Analysis_Engine SHALL report that Sustainable_Load is at or above the ending offered load in RPS, naming that ending offered load, and SHALL state that no Knee_Point was found within the swept range.
25. WHEN a Capacity_Sweep reports a Knee_Point and at least one node met the definition of Saturation during the Knee_Point step, THE Analysis_Engine SHALL emit exactly one Finding of category Capacity naming the node that reached Saturation at the earliest simulated time during that step, the configuration parameter bounding that node's resource under Requirement 29 criterion 10 or the equivalent bounded resource for the existing nine node types, and the configured value of that parameter with its unit, resolving a tie in earliest simulated time by descending analysis Utilization and then by ascending node identifier in lexicographic order.
26. IF a Capacity_Sweep reports a Knee_Point and no node met the definition of Saturation during the Knee_Point step, THEN THE Analysis_Engine SHALL emit exactly one Finding of category Capacity naming the node holding the highest analysis Utilization during that step, that analysis Utilization as a fraction from 0.0 to 1.0, and which of the two Service_Objective conditions of criterion 19 the step violated together with the observed value and the configured limit of that condition, each with its unit.
27. WHILE a Capacity_Sweep is running, THE Analysis_Panel SHALL display the index counted from 1 of the step in progress, the total step count, the requested offered load in RPS of the step in progress, the elapsed simulated time of that step in milliseconds, and the reported results of every step already completed in that sweep.
28. WHEN a Capacity_Sweep is cancelled, THE System SHALL retain and report the results of every step that completed its configured simulated duration before cancellation, SHALL discard the metrics of the step in progress at cancellation, SHALL report the sweep as cancelled naming the index counted from 1 of the step in progress at cancellation, and SHALL determine the Knee_Point and Sustainable_Load under criteria 22 through 24 from the retained steps alone.
29. WHILE a Capacity_Sweep of 8 steps at a simulated duration of 60,000 ms per step runs at the 50x speed multiplier on the device, browser, and viewport baseline stated in Requirement 34 criterion 1, THE System SHALL complete every step and report the results of criterion 21 within 90 wall-clock seconds of the sweep being started.

### Requirement 39: Single Point of Failure, Blast Radius, and Node Failure Simulation

**User Story:** As a software architect, I want to know which components take the whole system down when they fail, so that I can decide where redundancy is worth its cost.

#### Acceptance Criteria

1. WHILE a topology holding at least one Traffic_Generator node or Scheduler node is present on the Canvas, THE Analysis_Engine SHALL compute Single_Point_Of_Failure results over that topology's directed graph, treating each edge as directed from its source node to its target node irrespective of that edge's protocol, weight, and its source node's routing policy, treating every node holding no outgoing edge as a terminal node irrespective of its node type so that an Object_Store node is always a terminal node under Requirement 30, treating every Traffic_Generator node and every Scheduler node as a source node, treating Subsystem_Group membership and collapsed state as having no effect on the graph, and SHALL produce those results whether or not any run has completed.
2. WHEN the Analysis_Engine computes Single_Point_Of_Failure results, THE Analysis_Engine SHALL test every node that is neither a Traffic_Generator node nor a Scheduler node by computing, for each source node, the set of terminal nodes reachable from that source node by directed path and the set of terminal nodes reachable from that source node in the graph with the tested node and every edge incident to it removed, and SHALL designate the tested node a Single_Point_Of_Failure where at least one source node's first set holds 1 or more terminal nodes and that same source node's second set holds 0 terminal nodes, so that a node that is the sole path to a terminal node for one source node among several is designated a Single_Point_Of_Failure, a node whose removal leaves every source node with 1 or more reachable terminal nodes is designated none, and a source node is designated none.
3. WHEN the Analysis_Engine designates a node a Single_Point_Of_Failure, THE Analysis_Engine SHALL emit exactly one Finding of category Single_Point_Of_Failure whose subject node set holds that node's identifier alone, SHALL name in that Finding the identifier of every source node whose reachable terminal node set becomes empty under that node's removal, and SHALL populate that Finding's evidence set with that node's fan-in count in nodes, the count of source nodes losing all terminal reachability in nodes, and the count of source nodes in the topology in nodes.
4. WHERE a completed run is retained, THE Analysis_Engine SHALL compute Blast_Radius for each node as the count of requests and Jobs that reached a terminal status in the most recently completed run whose recorded path, taken together with the recorded path of every branch dispatched for that request under Requirement 32, holds that node, divided by the count of all requests and Jobs that reached a terminal status in that run, multiplied by 100, SHALL include that value in that node's Single_Point_Of_Failure Finding evidence set with the unit percent as that Finding's primary evidence entry, and SHALL report Blast_Radius as not applicable together with a plain-language explanation that no request left the system while that divisor is 0.
5. WHERE no completed run is retained, WHEN the Analysis_Engine emits a Single_Point_Of_Failure Finding, THE Analysis_Engine SHALL exclude the Blast_Radius entry from that Finding's evidence set, SHALL state in that Finding that Blast_Radius is not applicable because no run has completed, SHALL designate the count of source nodes losing all terminal reachability as that Finding's primary evidence entry, and SHALL set that Finding's confidence to Low in the same manner as Requirement 35 criterion 6.
6. THE Analysis_Engine SHALL compute each node's fan-in count as the number of distinct nodes holding an edge whose target is that node, counting each such distinct node exactly once, SHALL set a Single_Point_Of_Failure Finding's severity to Critical where its subject node's fan-in count is 3 or greater, and SHALL set that severity to Warning where that fan-in count is 2 or fewer.
7. WHEN the Analysis_Engine emits a Single_Point_Of_Failure Finding, THE Analysis_Engine SHALL populate that Finding's recommended action with the subject node's identifier, that node's type, a structural change drawn from the two values add-redundant-instance-behind-a-Load_Balancer-node and add-alternative-path, and the count of nodes and the count of edges that change adds, in place of the configuration parameter, direction of change, and target value stated in Requirement 35 criterion 4, and SHALL populate that Finding's tradeoff statement with the count of nodes the change adds against the 200-node canvas limit and the name of the metric the change degrades.
8. THE System SHALL offer in the Chaos_Panel a failure-simulation control that accepts a target node identifier of any of the fifteen node types and a failure duration in the inclusive range 100 to 600,000 simulated milliseconds, SHALL accept that control while the simulation is in the Running state without requiring a pause, and SHALL record a chaos event in the event log naming the target node's user-assigned label, the failure duration in simulated milliseconds, and the simulated time at which that node was marked unreachable, in the same manner as Requirement 10.
9. WHILE a node is marked unreachable by the failure-simulation control, THE Simulation_Engine SHALL terminate with a Timeout status recorded against that node every request and Job that occupied one of that node's bounded resources or was held in that node's queue, prefetch buffer, or transfer queue at the simulated instant the node was marked unreachable together with every request and Job that arrives at that node while it is marked unreachable, SHALL hold each of that node's bounded resources at 0 occupancy, SHALL forward each such request and Job to no downstream node, and SHALL retain without termination every message a Dead_Letter_Queue node held at that instant while performing no Redrive from that node.
10. IF the failure-simulation control is applied to a node that is already marked unreachable, THEN THE System SHALL reject that application, SHALL leave that node's failure duration and scheduled restoration time unchanged, SHALL hold no deferred failure for that node, and SHALL display a message naming that node's user-assigned label and the remaining failure duration in simulated milliseconds.
11. WHEN a node's failure duration elapses, THE Simulation_Engine SHALL restore that node to reachable, SHALL admit arriving requests and Jobs at that node with each of its bounded resources at 0 occupancy, and SHALL record a recovery event in the event log naming that node's user-assigned label and the simulated time of restoration.
12. WHEN a node's failure duration has elapsed, THE Analysis_Panel SHALL report the change in system success rate as a fraction in the range 0.0 to 1.0 and the change in end-to-end p99 latency in milliseconds between the pre-failure window, being the most recent metrics window that completed at or before the simulated time at which that node was marked unreachable, and the failure windows, being every metrics window whose start and end both lie within the interval from that simulated time to the simulated time of restoration, SHALL exclude from both sides every metrics window that overlaps that interval only in part, SHALL report each change as a signed absolute difference and as a signed percentage difference of the pre-failure value, SHALL report a percentage difference as not applicable together with a plain-language explanation while the pre-failure value is 0, and SHALL report both changes as not applicable together with a plain-language explanation that the failure interval contained no complete metrics window while no metrics window lies wholly within that interval, in the same manner as Requirement 8.
13. WHILE a topology holds 1 or more nodes eligible for testing under criterion 2 and no node is designated a Single_Point_Of_Failure, THE Analysis_Panel SHALL state that every source node retains a directed path to at least one terminal node it could previously reach under the removal of any single tested node, SHALL list every node excluded from testing with its exclusion reason stated as being a source node, and SHALL list every source node whose reachable terminal node set holds 0 terminal nodes before any removal with the reason that it reaches no terminal node.
14. WHILE a topology holds 80 nodes and 200 edges, THE Analysis_Engine SHALL complete the Single_Point_Of_Failure analysis of criteria 2 through 7 within 500 milliseconds of wall-clock time measured from the invocation of that analysis to the availability of its Findings, and SHALL block the main thread for at most 33 consecutive milliseconds during that analysis, on the device, browser, and viewport baseline stated in Requirement 34 criterion 1.

### Requirement 40: Run Comparison and Baselines

**User Story:** As a backend engineer, I want to compare two variants of my design against each other, so that I can choose between adding a cache and enlarging a connection pool on evidence rather than intuition.

#### Acceptance Criteria

1. WHERE a name submitted with a retain-as-baseline action holds 1 to 40 characters after removal of leading and trailing whitespace and differs from every stored Baseline_Run name under case-insensitive comparison, WHEN that action is invoked while the simulation is in the Complete state, THE System SHALL write exactly one Baseline_Run record to localStorage at schema version 2 holding that name, a creation timestamp, the run's PRNG seed, the run's simulated duration in milliseconds, the run's total offered load in RPS, the run's Service_Objective where one was specified, the topology including every node identifier, every node type, every node position, every node configuration parameter, every per-node routing policy, every edge protocol, every edge weight, and every Subsystem_Group name and membership, the whole-run aggregate metrics listed in criterion 6, and the per-node aggregate metrics listed in criterion 7.
2. THE System SHALL retain up to 5 Baseline_Run records, SHALL list each stored Baseline_Run by its user-assigned name and its creation timestamp, and SHALL offer for each listed Baseline_Run a delete control that removes exactly that record from localStorage and leaves every other stored Baseline_Run record unchanged.
3. IF a retain-as-baseline action is invoked while 5 Baseline_Run records are stored, or is invoked with a name that is empty after removal of leading and trailing whitespace, holds more than 40 characters after that removal, or equals a stored Baseline_Run name under case-insensitive comparison, THEN THE System SHALL write no Baseline_Run record, SHALL display an inline error message naming the violated constraint together with the names of the stored Baseline_Runs where the 5-record limit is the violated constraint, and SHALL leave every stored Baseline_Run record and the current run's metrics unchanged.
4. WHEN the application is loaded, THE System SHALL restore into the Baseline_Run list every stored Baseline_Run record that carries schema version 2 and every field listed in criterion 1, SHALL exclude from that list every stored record that carries a schema version other than 2 or omits a field listed in criterion 1, SHALL display a warning naming each excluded record's name together with the schema version found or the omitted field, and SHALL leave every stored record unmodified, so that a Baseline_Run retained before a page reload remains available for comparison after that reload.
5. WHEN a comparison is invoked, THE Analysis_Panel SHALL accept exactly two selections drawn from the stored Baseline_Runs and the most recently completed run, SHALL designate the first selection run A and the second selection run B, SHALL compute every signed difference required by criteria 6 and 7 as the run B value minus the run A value, and IF both selections name the same run, THEN THE Analysis_Panel SHALL report no comparison result and SHALL display a message stating that a comparison requires two distinct runs.
6. WHEN two runs are compared, THE Analysis_Panel SHALL report for each of end-to-end p50 latency in milliseconds, end-to-end p90 latency in milliseconds, end-to-end p99 latency in milliseconds, total throughput in requests per second, total error rate as a fraction in the range 0.0 to 1.0, and the rate in terminations per second of each of the nine terminal statuses defined in Requirement 31: the value held in run A, the value held in run B, the signed absolute difference in that metric's unit, and the signed percentage difference computed as that signed absolute difference divided by the absolute value of the run A value multiplied by 100 and displayed to 2 decimal places, taking each reported value from that run's final cumulative metrics over its full simulated duration rather than from any single metrics window or from a mean across metrics windows.
7. WHEN two runs are compared, THE Analysis_Panel SHALL report for every node present in both runs the mean Utilization as a fraction in the range 0.0 to 1.0 computed as the arithmetic mean of that node's per-window Utilization values over every metrics window that run completed, the throughput in requests per second computed as that node's Success terminations in the run divided by the run's simulated duration in seconds, the error rate as a fraction in the range 0.0 to 1.0 computed over that run's full simulated duration, and the mean queue depth in requests computed as the arithmetic mean of that node's per-window queue depth values, each value shown for run A and for run B together with the signed absolute difference in that metric's unit, and SHALL treat a node as present in both runs where a node identifier appears in the retained topology of both runs with the same node type recorded in both, or where that identifier appears in one run only and exactly one node in each run holds the same node type and the same user-assigned label under case-insensitive comparison.
8. WHEN two runs are compared, THE Analysis_Panel SHALL list every node that is not present in both runs under criterion 7 together with the name of the run holding it, and SHALL list every configuration parameter whose value differs between the two runs for a node present in both runs, naming that node's user-assigned label, the parameter, the value in run A, and the value in run B.
9. WHERE two compared runs hold an identical PRNG seed, an identical simulated duration in milliseconds, and total offered loads that differ by less than 0.01 RPS, THE Analysis_Panel SHALL label the comparison a Controlled_Comparison.
10. WHERE two compared runs differ in PRNG seed, differ in simulated duration in milliseconds, or hold total offered loads that differ by 0.01 RPS or more, THE Analysis_Panel SHALL label the comparison uncontrolled, SHALL name each of those three attributes that differs together with its value in run A and its value in run B, and SHALL report the results required by criteria 6, 7, and 8.
11. WHEN two runs are compared and a Service_Objective is specified, THE Analysis_Engine SHALL emit exactly one Finding of category Comparison carrying every field defined in Requirement 35 with an empty subject node set, naming the run that satisfies the Service_Objective where exactly one run satisfies it, naming the run holding the lower end-to-end p99 latency in milliseconds where both runs satisfy it or neither run satisfies it, naming the run holding the lower total error rate where those p99 latencies are equal, and naming run A where those p99 latencies and those total error rates are equal.
12. WHEN two runs are compared, THE Analysis_Engine SHALL emit exactly one Finding of category Comparison carrying every field defined in Requirement 35 for each node present in both runs whose mean Utilization computed under criterion 7 is reported as a numeric value in both runs and differs between the runs by 0.10 or more in absolute value, naming that node in the Finding's subject node set, naming the direction of change from run A to run B as increase or decrease, and carrying as evidence entries that node's mean Utilization in run A, its mean Utilization in run B, and the signed difference, each as a fraction in the range 0.0 to 1.0.
13. WHEN a Baseline_Run is selected for reuse, THE System SHALL restore that record's topology, every node position, every node configuration parameter, every per-node routing policy, every edge protocol, every edge weight, and every Subsystem_Group name, membership, and collapsed or expanded state to the Canvas, SHALL leave that stored Baseline_Run record unchanged, SHALL display a confirmation dialog before replacing the current topology while unsaved changes exist on the Canvas in the same manner as Requirement 11, and SHALL leave the Canvas, every node configuration, and every Subsystem_Group unchanged where that confirmation is declined.

### Requirement 41: Analysis Integrity and Reproducibility

**User Story:** As a software architect, I want the analysis to be reproducible and never to assert more than the data supports, so that I can trust a Finding enough to act on it.

#### Acceptance Criteria

1. WHEN two runs are executed with the same topology, the same node and edge configuration, the same PRNG seed, the same simulated duration, and the same offered load, THE Analysis_Engine SHALL produce for each run a Finding set holding the same count of Findings, holding for each Finding the same stable identifier derived under Requirement 35 criterion 13, holding for each Finding of a given identifier an equal value for its category, severity, confidence, constraint statement, recommended action, tradeoff statement, analysis window start and end, subject node identifier set, and evidence metric names and units under exact character-for-character comparison, holding for each numeric evidence value and each numeric field an equal value after the rounding required by criterion 2, and presenting both sets in the same display order defined by Requirement 35 criterion 8.
2. THE Analysis_Engine SHALL round every numeric value it places in a Finding field or evidence entry to 6 decimal places using half-up rounding before that value is stored, displayed, or exported, and SHALL store every such value as a finite number, so that two computations of the same quantity from the same inputs compare equal under exact numeric comparison and no comparison depends on floating-point representation beyond 6 decimal places.
3. THE Analysis_Engine SHALL derive every Finding solely from the metrics snapshots emitted by the Simulation_Engine, including the per-node time-in-system, path-traversal, and terminal-status aggregates those snapshots carry, from event log entries, and from topology structure, and SHALL derive no Finding from any per-request record that those snapshots do not carry, so that the Latency_Share of Requirement 36 criterion 10 and the Blast_Radius of Requirement 39 criterion 4 are each computed from an aggregate carried in a metrics snapshot rather than from individual request paths.
4. WHILE the Analysis_Panel is displaying Findings loaded from an imported Analysis_Report, THE Analysis_Panel SHALL display each imported Finding with every field value carried in that report, SHALL perform no recomputation of any imported Finding, SHALL label the displayed set with the PRNG seed, simulated duration, and offered load recorded in that report, and SHALL retain the imported set until a subsequent run produces a recomputed Finding set, so that every value an imported Finding displays comes from the report rather than from a re-run of the simulation.
5. IF a metric required by an analysis rule is reported as not applicable under Requirement 29 criteria 11 through 13 or is absent from the metrics snapshots of the analysis window, THEN THE Analysis_Engine SHALL emit no Finding from that rule for the affected nodes, SHALL emit the Findings of every other rule unchanged, and SHALL state in the Analysis_Panel the identifier of the suppressed rule, the name of the missing or not-applicable metric, and the user-assigned label of each affected node.
6. WHILE a simulation has produced fewer than 3 completed metrics windows, THE Analysis_Panel SHALL display no Finding and SHALL state the count of completed metrics windows together with the 3 completed metrics windows required before Findings are computed.
7. WHILE a simulation is in the Running state, THE Analysis_Engine SHALL perform exactly one recomputation of its Finding set per completed metrics window boundary and no recomputation between two consecutive boundaries, and WHEN a simulation enters the Complete state, THE Analysis_Engine SHALL perform exactly one further recomputation over the final analysis window.
8. WHILE a topology containing 80 nodes drawn from all fifteen node types and 200 edges is present, THE Analysis_Engine SHALL complete a full recomputation of all Findings within 500 milliseconds of wall-clock time, measured as the interval from the start of a recomputation to the emission of its complete Finding set and reported as the maximum over 10 consecutive recomputations within a single run, on a device with 4 or more physical CPU cores and 8 GB or more of RAM, running a browser from the Browser Compatibility list of this document at a viewport of 1,920 by 1,080 logical pixels with no other simulation running.
9. WHILE the Analysis_Engine is performing a recomputation on the device, browser, and viewport baseline stated in criterion 8, THE Analysis_Engine SHALL occupy the main thread for at most 33 consecutive milliseconds per slice, measured as the longest contiguous main-thread interval attributable to the Analysis_Engine between two yields across that whole recomputation, and WHERE a single analysis rule requires more than 33 milliseconds of main-thread work, THE Analysis_Engine SHALL divide that rule's work into slices, SHALL yield the main thread at the end of each slice, and SHALL resume that rule in a subsequent slice, so that a rule's total duration may exceed 33 milliseconds while each of its main-thread occupancies remains at or below 33 milliseconds and the frame-rate target of Requirement 4 continues to hold.
10. IF the cumulative wall-clock duration of a recomputation reaches 500 milliseconds before every analysis rule has completed, THEN THE Analysis_Engine SHALL stop that recomputation at the end of the slice in progress, SHALL retain and continue to display the Finding set produced by the most recently completed recomputation, SHALL display no partially computed Finding set, and SHALL state in the Analysis_Panel the count of analysis rules that did not complete, the identifier of each such rule, and the simulated time of the metrics window boundary at which the recomputation stopped.
11. THE Analysis_Engine SHALL express every numeric value in a Finding with a unit of measurement of 1 to 20 characters as required by Requirement 35 criterion 2, SHALL express a dimensionless ratio in the range 0.0 to 1.0 with the unit fraction, and SHALL express a value scaled to 100 with the unit percent, so that every numeric value the Analysis_Panel displays for a Finding carries a stated unit.

### Requirement 42: Reference Architecture Presets

**User Story:** As a backend engineer evaluating the tool, I want to load a complete, realistic backend rather than a single failure scenario, so that I can see what a full model looks like before building my own.

#### Acceptance Criteria

1. THE System SHALL offer in the presets control exactly the three reference architecture presets named Authenticated Web API, Asynchronous Job Platform, and Scheduled Batch With Live Traffic in addition to the three failure-mode presets of Requirement 11, SHALL present the reference architecture presets under a group label distinguishing them from the failure-mode presets, and SHALL hold every preset name unique under case-insensitive comparison.
2. THE System SHALL construct each reference architecture preset from 12 to 80 nodes and from 3 to 20 Subsystem_Groups, SHALL assign each Subsystem_Group 2 to 50 member nodes, and SHALL assign each node of the preset to at most one Subsystem_Group, so that every preset satisfies the Subsystem_Group limits of Requirement 33 and the scale envelope of Requirement 34.
3. THE System SHALL include across the set of three reference architecture presets at least one node of each of Auth_Service, Authz_Service, Worker_Pool, Dead_Letter_Queue, Object_Store, and Scheduler, and SHALL construct every edge of every reference architecture preset from a source-type-and-target-type pair and protocol permitted under Requirement 30 criterion 12, so that loading a preset produces no connection-rule violation.
4. THE System SHALL construct the Authenticated Web API preset with exactly one Traffic_Generator node, one API_Gateway node, one Rate_Limiter node, one Auth_Service node whose verification mode is Introspection and which holds an outgoing edge to the Cache node, one Authz_Service node, one Load_Balancer node, one Cache node, one Database node, one Object_Store node, and 2 or more App_Server nodes, and SHALL make every node of that preset reachable from its Traffic_Generator node along a directed path of that preset's edges.
5. THE System SHALL construct the Asynchronous Job Platform preset with at least one Traffic_Generator node, one App_Server node, one Message_Queue node, one Worker_Pool node, one Dead_Letter_Queue node, one Database node, and one Object_Store node, and SHALL configure that Worker_Pool node with a job failure rate of 0.05 or greater and a max retries value of 1 to 3, so that a run of that preset at its stored PRNG seed and stored simulated duration records at least 1 Retry_Exhaustion at that Worker_Pool node and retains at least 1 message at that Dead_Letter_Queue node.
6. THE System SHALL construct the Scheduled Batch With Live Traffic preset with at least one Scheduler node and at least one Traffic_Generator node each holding a directed path to the same Database node, and SHALL configure that Scheduler node's interval and start offset so that 3 or more triggers fire within that preset's stored simulated duration, so that periodic Burst_Load contends with continuous load at a shared dependency for 3 or more triggers.
7. THE System SHALL store each reference architecture preset as a record at schema version 2 that carries the preset name, its description, its nodes with every configuration parameter, its edges with every protocol and weight, its per-node routing policies, its Subsystem_Group names and memberships, its chaos timeline, its PRNG seed, its simulated duration in milliseconds, its speed multiplier, its total offered load in RPS, the node identifier of its expected Bottleneck, and the expected dominant terminal status drawn from the eight non-Success terminal statuses of Requirement 31 criterion 1, and SHALL hold each such stored simulated duration at a value spanning 3 or more completed metrics windows.
8. WHEN a reference architecture preset is loaded and the Canvas holds no unsaved change, THE System SHALL leave the Canvas holding exactly that preset's nodes, edges, and Subsystem_Groups, SHALL set each node's routing policy and each edge's weight to the value held in that preset's record, SHALL set each Subsystem_Group's name, membership, and collapsed state to the value held in that record, and SHALL place every node so that the axis-aligned bounding box of each rendered node element at 100 percent zoom is separated from the bounding box of every other rendered node element by 16 or more logical pixels along the x axis or by 16 or more logical pixels along the y axis.
9. IF a reference architecture preset load is invoked while the Canvas holds at least one unsaved change, THEN THE System SHALL display a confirmation dialog naming the preset and stating that the current topology is replaced, SHALL apply criterion 8 when the replacement is confirmed, and SHALL leave the Canvas nodes, edges, and Subsystem_Groups and every topology stored in localStorage unchanged when the replacement is cancelled, in the same manner as Requirement 11 criterion 2.
10. WHEN a reference architecture preset is loaded, THE System SHALL set the Simulation_Engine's PRNG seed, simulated duration, and speed multiplier to the values held in that preset's record, SHALL apply that record's chaos timeline, and SHALL auto-start the simulation, in the same manner as Requirement 11 criterion 3.
11. WHEN a reference architecture preset is loaded and run to the Complete state at the PRNG seed, simulated duration, speed multiplier, offered load, and chaos timeline held in its record, THE Analysis_Engine SHALL emit at least one Finding of category Bottleneck whose subject node set contains the node identifier stored as that preset's expected Bottleneck.
12. WHEN a reference architecture preset is loaded and run to the Complete state at the PRNG seed, simulated duration, speed multiplier, offered load, and chaos timeline held in its record, THE Telemetry_Dashboard SHALL report the terminal status stored as that preset's expected dominant terminal status as holding the greatest cumulative count among the eight non-Success terminal statuses of Requirement 31 criterion 1 for that run.
13. WHEN a reference architecture preset is selected, THE System SHALL display the node identifier stored as that preset's expected Bottleneck using that node's user-assigned label, the stored expected dominant terminal status, the stored simulated duration in seconds, and the stored offered load in RPS, each read from that preset's record.
14. WHEN a reference architecture preset is loaded, THE System SHALL complete the load and present a frame containing every node and edge of that preset within 2,000 milliseconds of wall-clock time measured from the load invocation, on the device, browser, and viewport baseline stated in Requirement 34 criterion 1.
15. WHEN a loaded reference architecture preset is exported and the resulting record is imported, THE System SHALL restore every node position, every node configuration parameter, every per-node routing policy, every edge protocol, every edge weight, and every Subsystem_Group name, membership, and collapsed state to the value held in that preset's record, in the same manner as Requirement 34 criterion 5.

### Requirement 43: Analysis Panel Presentation, Keyboard Operation, and Accessibility

**User Story:** As a backend engineer, I want the analysis surfaces to be readable and keyboard-operable, so that I can work through findings without fighting the interface.

#### Acceptance Criteria

1. WHEN a control that opens the Analysis_Panel is activated in the Telemetry_Dashboard by pointer or by keyboard alone, THE System SHALL display the Analysis_Panel, SHALL keep the Canvas rendered, and SHALL leave the Canvas pan position, zoom level, and node selection unchanged, so that reaching the Analysis_Panel replaces no part of the Canvas view.
2. WHILE the Analysis_Panel displays a Finding set holding at least 1 Finding, THE Analysis_Panel SHALL group those Findings under their category, SHALL display each category holding at least 1 Finding under its category name together with the count of Findings it holds in Findings, SHALL order the category groups by the position of each category in the eight-value order stated in Requirement 35 criterion 1, SHALL order the Findings within each group by the display order defined in Requirement 35 criterion 8, and SHALL present every Finding of that set up to the 200-Finding maximum stated in the Scalability section within 500 milliseconds of wall-clock time from the completion of the recomputation that produced it, so that a category holding no Finding contributes no group and every Finding of the set is displayed.
3. WHEN a Finding holding at least 1 subject node identifier that is present in the topology is activated in the Analysis_Panel, THE System SHALL expand every collapsed Subsystem_Group that contains such a node, SHALL set the Canvas node selection to exactly those subject nodes present in the topology, and SHALL set the Canvas pan position and zoom level to the highest zoom level at or above 0.25 at which every one of those selected nodes lies within the visible Canvas viewport.
4. THE Analysis_Panel SHALL display each Finding's severity as exactly one of the three text labels Critical, Warning, and Info rendered as text alongside that Finding, and SHALL render each such text label at a contrast ratio of at least 4.5:1 against its background, so that a Finding's severity is determined from its text label without reference to color, in the same manner as the health-status labelling of Requirement 8.
5. THE Analysis_Panel SHALL place the Finding list in the keyboard tab order, SHALL move focus to the next and to the previous Finding in the display order defined in Requirement 35 criterion 8 on the Down Arrow key and the Up Arrow key respectively, SHALL make every Finding of the displayed set up to the 200-Finding maximum focusable by repetition of those keys, SHALL activate the focused Finding on the Enter key and on the Space key, and SHALL move focus out of the Finding list to the next and previous focusable control on the Tab key and the Shift+Tab combination, so that the Finding list is entered, traversed, and left using the keyboard alone.
6. WHILE the Analysis_Panel displays comparison results, THE Analysis_Panel SHALL present them as a table in which each data cell is programmatically associated with both its row header and its column header, SHALL expose that table with a programmatic name naming the two compared runs, and SHALL make every row header, column header, and data cell reachable by keyboard alone.
7. WHEN one or more Findings of severity Critical whose identifiers have not been announced during the current run first appear during a running simulation, THE System SHALL emit exactly one announcement through the assertive live region used for chaos-event announcements, SHALL name in that announcement the count of those Findings in Findings together with the category and subject node label of the first of them in the display order defined in Requirement 35 criterion 8, SHALL emit at most one such announcement per metrics window, and SHALL record each announced Finding identifier as announced for the remainder of that run, so that a Critical Finding that persists across metrics windows produces exactly one announcement per run.
8. THE Analysis_Panel SHALL render text at a contrast ratio of at least 4.5:1 against its background, SHALL render text of 24 px or larger and bold text of 18.66 px or larger at a contrast ratio of at least 3:1 against its background, SHALL render every non-text status indicator and every keyboard focus indicator at a contrast ratio of at least 3:1 against adjacent colors, SHALL expose every interactive control in the panel with a programmatic name and a programmatic role, and SHALL return keyboard focus to the control that opened the panel on the Escape key, consistent with the WCAG 2.1 AA target of the Accessibility section.
9. WHERE no zoom level at or above 0.25 places every subject node of a Finding within the visible Canvas viewport, WHEN that Finding is activated in the Analysis_Panel, THE System SHALL set the Canvas zoom level to 0.25, SHALL center the Canvas viewport on the midpoint of the bounding box of that Finding's selected subject nodes, and SHALL display the count of those selected subject nodes lying outside the visible Canvas viewport in nodes.
10. IF a Finding whose subject node set is empty, or a Finding every one of whose subject node identifiers is absent from the topology, is activated in the Analysis_Panel, THEN THE System SHALL leave the Canvas node selection, pan position, and zoom level unchanged, SHALL display the system-wide scope label defined in Requirement 35 criterion 9 where that Finding's subject node set is empty, and SHALL display the shortened identifier form defined in Requirement 35 criterion 9 for each absent subject node identifier together with a statement that those nodes are absent from the current topology.
11. WHILE a simulation has produced metrics for at least 3 completed metrics windows and the most recent recomputation produced a Finding set holding 0 Findings, THE Analysis_Panel SHALL display a statement that the analysis completed and that no Finding met its emission conditions, SHALL display the inclusive start and the inclusive end of that analysis window in simulated milliseconds, and SHALL keep every control of the panel operable by keyboard alone, so that this state is distinguishable from the insufficient-data state of Requirement 41 criterion 6.

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
| Canvas interaction at 80 nodes / 200 edges, over a 10 s interval of continuous pan, zoom and select (Req 34) | Mean ≥ 30 fps, and ≥ 24 frames in every 1 s subinterval |
| Simulation throughput at 80 nodes / 200 edges with all fifteen node types, at max speed, over a 10 s interval beginning 5 s after entering Running (Req 34) | ≥ 1,000 events per wall-clock second |
| Capacity_Sweep of 8 steps at 60,000 ms simulated duration per step, 50x speed (Req 38) | ≤ 90 s wall-clock to complete every step and report its results |
| Single-point-of-failure analysis at 80 nodes / 200 edges (Req 39) | ≤ 500 ms wall-clock from invocation to availability of Findings |
| Longest main-thread block during single-point-of-failure analysis (Req 39) | ≤ 33 consecutive ms |
| Full Finding recomputation at 80 nodes / 200 edges, reported as the maximum over 10 consecutive recomputations in a run (Req 41) | ≤ 500 ms wall-clock |
| Longest main-thread block per slice during Finding recomputation (Req 41) | ≤ 33 consecutive ms |
| Finding recomputation frequency while Running (Req 41) | Exactly 1 per completed metrics window boundary, plus 1 on entering Complete |
| Reference architecture preset load and first frame containing every node and edge (Req 42) | ≤ 2,000 ms wall-clock from load invocation |
| Analysis_Panel presentation of a recomputed Finding set (Req 43) | ≤ 500 ms wall-clock from completion of the recomputation |

**Measurement baseline for the Requirement 34 and later targets above**: a device with 4 or more physical CPU cores and 8 GB or more of RAM, running a browser from the Browser Compatibility list below, at a viewport of 1,920 by 1,080 logical pixels, with no other simulation running.

### Scalability

| Dimension | Supported Range |
|-----------|----------------|
| Nodes on canvas | 1–200 |
| Edges on canvas | 0–500 |
| Concurrent simulated in-flight requests | Up to 50,000 |
| Simulation time window | Up to 30 minutes (simulated) |
| Saved topologies in localStorage | Up to 50 (with size warnings at 4MB) |
| Node types | 15 (9 original + 6 added by Requirements 23–28) |
| Nodes in a reference-scale complete architecture | Up to 80 with all fifteen types present |
| Subsystem_Groups per topology | 0–20 |
| Nodes per Subsystem_Group | 2–50 |
| Subsystem_Group name length | 1–40 characters after removal of leading and trailing whitespace |
| Fan_Out_Depth per request | 0–4 |
| Retained Baseline_Runs | Up to 5 |
| Baseline_Run name length | 1–40 characters after removal of leading and trailing whitespace |
| Capacity_Sweep steps | 2–20 |
| Findings per analysis | Up to 200, ordered by severity then primary evidence magnitude |
| Evidence entries per Finding | 1–20 |
| Subject nodes per Finding | 0–200 |
| Retained Dead_Letter_Queue messages | Up to 1,000,000 per node |

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
- Findings, comparison tables, Capacity_Sweep results, and Subsystem_Group controls meet WCAG 2.1 AA.
- Finding severity is conveyed by a text label in addition to color.
- Grouping, collapsing, and Finding activation are operable by keyboard alone.
- Critical Findings appearing during a run are announced to assistive technology, at most one announcement per metrics window.

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
| Main → Worker | `CHAOS_EVENT` (extended) | Adds chaos type `DISABLE_NODE` carrying a target node identifier and a failure duration in simulated ms in the inclusive range 100 to 600,000 (Req 39.8), and chaos type `REDRIVE_DLQ` carrying a target Dead_Letter_Queue node identifier for a manual Redrive of up to that node's redrive batch size (Req 26.8) |
| Main → Worker | `SWEEP_STEP` | Step index from 0, requested offered RPS, the applied per-Traffic_Generator RPS map, simulated duration per step in ms, warm-up interval in ms, speed multiplier, PRNG seed (Req 38.11, 38.12, 38.15, 38.19) |
| Main → Worker | `SWEEP_CANCEL` | Index from 0 of the step in progress, whose metrics the Worker discards (Req 38.28) |
| Worker → Main | `METRICS_BATCH` (extended) | Adds per-node concurrency occupancy against its configured bound, Job_Backlog in Jobs, Backlog_Age in ms, Monitored_Depth_Measure, retained dead-letter count with per-upstream-node attribution, transfer rate in MB/s, per-terminal-status counts for the nine statuses (Req 31.1), the summed time-in-system accumulated at that node by requests and Jobs terminating in the window together with the summed time-in-system those same requests and Jobs accumulated across their whole recorded path for Latency_Share (Req 36.10), the count of terminating requests and Jobs whose recorded or dispatched-branch path held that node for Blast_Radius (Req 39.4), and per-edge forwarded-request and per-node dispatched-branch counts (Req 32.14, 41.3) |
| Worker → Main | `NODE_STATE_CHANGE` | Target node identifier, whether the node is unreachable or restored, and the simulated time of the transition (Req 39.8, 39.11) |
| Worker → Main | `SWEEP_STEP_COMPLETE` | Step index from 0, requested offered RPS, applied offered RPS, achieved throughput, end-to-end p50/p90/p99 latency, total error rate, per-terminal-status counts for the nine statuses, Scheduler-emitted Job count, the inclusive bounds of the Measurement_Interval in simulated ms, and any per-generator RPS clamp warnings (Req 38.12, 38.14, 38.20, 38.21) |

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

## Out of Scope

- Automatic topology generation, and automatic application of a Finding's recommended action.
- Cost modeling in currency terms.
- Multi-region or network-partition topology semantics beyond the node-unreachable chaos control of Requirement 39.
- Import of real observability data (traces, metrics) to calibrate node configurations.
- Additional node types beyond the six added by Requirements 23 through 28, including search indexes, service meshes, and CDNs.

---

## Open Questions / Future Considerations

- **Collaborative editing**: Should multiple users be able to edit the same topology in real-time (WebSocket/CRDT)?
- **Export to infrastructure-as-code**: Generate Terraform/Pulumi stubs from the topology?
- **Historical simulation replay**: Record full event logs for scrubbing through past runs?
- **Custom node plugins**: Allow users to define custom node types with scripted behavior?
- **Backend persistence**: Optional cloud save (auth + API) for cross-device access?
- Should Auth_Service and Authz_Service be a single node type with a mode switch, given how often the two are deployed as one service?
- Should Capacity_Sweep steps run in parallel Web Workers to reduce wall-clock time, at the cost of higher peak memory?
