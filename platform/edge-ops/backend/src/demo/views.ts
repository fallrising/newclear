// Loopback demo read model (S0 mock chain). These are response views for the demo UI, not wire
// contracts: the only accepted input is the M0 `edgeops.telemetry.v1` report
// (contracts/schemas/telemetry-report.v1.schema.json), which each sample carries verbatim in
// `report`. `metrics` is derived from that report for display; `null` means the report said the
// metric is unsupported and is never rendered as 0.

export type Connectivity = "never-seen" | "online" | "stale" | "offline";
export type Health = "healthy" | "warning" | "unknown";

export interface DerivedMetrics {
  cpu_avg_percent: number | null;
  cpu_max_percent: number | null;
  memory_used_percent: number | null;
  disk_used_percent: number | null;
  network_rx_bytes: string | null;
  network_tx_bytes: string | null;
}

export interface Sample {
  boot_id: string;
  seq: number;
  observed_at: string;
  received_at: string;
  body_sha256: string;
  metrics: DerivedMetrics;
  /** The accepted M0 telemetry report, as received. */
  report: Record<string, unknown>;
}

export interface NodeView {
  id: string;
  display_name: string;
  workspace_id: string;
  enrollment_generation: number;
  os: string;
  arch: string;
  agent_version: string;
  host_authority: "none";
  mode: "monitor-only";
  connectivity: Connectivity;
  health: Health;
  data_fresh: boolean;
  last_seen_received_at: string | null;
  latest: Sample | null;
  sample_count: number;
}

export interface Snapshot {
  mode: "demo";
  auth: "mock-loopback-only";
  transport: "http-poll";
  server_time: string;
  nodes: NodeView[];
  capabilities: { telemetry: true; logs: false; jobs: false; bootstrap: false };
}

export interface History {
  node_id: string;
  from: string;
  to: string;
  samples: Sample[];
  truncated: boolean;
}

export interface Ack {
  accepted: true;
  duplicate: boolean;
  seq: number;
  received_at: string;
}

export interface Envelope<T> {
  data: T;
  request_id: string;
}

export interface Failure {
  code: string;
  message: string;
  retryable: boolean;
  request_id: string;
}
