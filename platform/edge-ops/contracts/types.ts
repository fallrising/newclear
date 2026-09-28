/** S0 demo contract only. Never accepts real machine credentials or commands. */
export const VERSION = 'edgeops.telemetry.demo.v1' as const;
export const WORKSPACE = 'ws_demo' as const;
export type Connectivity = 'never-seen' | 'online' | 'stale' | 'offline';
export type Health = 'healthy' | 'warning' | 'unknown';
export interface Metrics {
  cpu_avg_percent: number | null;
  cpu_max_percent: number | null;
  memory_used_bytes: string | null;
  memory_total_bytes: string | null;
  disk_used_percent: number | null;
  network_rx_bytes: string | null;
  network_tx_bytes: string | null;
}
export interface Telemetry {
  schema_version: typeof VERSION;
  node_id: string;
  enrollment_generation: number;
  boot_id: string;
  seq: number;
  sent_at: string;
  observed_at: string;
  window_seconds: number;
  sample_count: number;
  metrics: Metrics;
}
export interface Sample extends Telemetry {
  received_at: string;
  request_id: string;
}
export interface NodeView {
  id: string;
  display_name: string;
  workspace_id: string;
  enrollment_generation: number;
  os: string;
  arch: string;
  agent_version: string;
  host_authority: 'none';
  mode: 'monitor-only';
  connectivity: Connectivity;
  health: Health;
  data_fresh: boolean;
  last_seen_received_at: string | null;
  latest: Sample | null;
  sample_count: number;
}
export interface Snapshot {
  mode: 'demo';
  auth: 'mock-loopback-only';
  transport: 'http-poll';
  server_time: string;
  nodes: NodeView[];
  capabilities: {telemetry: true; logs: false; jobs: false; bootstrap: false};
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
  persisted_request_id: string;
}
export interface Envelope<T> {data: T; request_id: string}
export interface Failure {code: string; message: string; retryable: boolean; request_id: string}
