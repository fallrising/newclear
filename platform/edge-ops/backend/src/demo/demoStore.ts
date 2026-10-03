// Loopback demo store on the M0 persistence port and schema (migrations/0001_initial.sql).
// Sample insert, dedupe and conflict detection are M0's TelemetryStore (SDD 02 §3, AC-MON-01);
// this file only adds the demo enrollment shortcut, a synthetic clock offset
// (migrations/0002_demo_clock.sql) and the read model in views.ts.

import { utf8Encode } from "../domain/contract/bytes.ts";
import { formatUtcSeconds } from "../domain/contract/fields.ts";
import { parseTelemetryReport, type TelemetryReport } from "../domain/contract/telemetry.ts";
import { sql, type SqlDatabase } from "../adapters/sql/sqlDatabase.ts";
import { TelemetryStore } from "../adapters/sql/telemetryStore.ts";
import { HttpError } from "./http.ts";
import type { Ack, DerivedMetrics, NodeView, Sample } from "./views.ts";

export const WORKSPACE = "ws_demo";
export const DEMO_NODE = /^node_demo(?:0[1-9]|10)$/;
export const MAX_SAMPLES_PER_NODE = 4096;
const STALE_AFTER = 90;
const OFFLINE_AFTER = 210;

interface NodeRow {
  id: string;
  workspace_id: string;
  display_name: string;
  enrollment_generation: number;
  os: string;
  arch: string;
  agent_version: string;
  last_seen_received_at: number | null;
}

interface SampleRow {
  boot_id: string;
  seq: number;
  observed_at: number;
  received_at: number;
  body_sha256: string;
  payload: string;
}

const iso = (seconds: number): string => formatUtcSeconds(seconds);

/** Percent with two decimals from uint64 decimal strings, without float precision loss. */
function usedPercent(total: string, free: string): number | null {
  const t = BigInt(total);
  if (t === 0n) return null;
  const used = t - BigInt(free);
  return used < 0n ? null : Number((used * 10000n) / t) / 100;
}

export function derive(report: TelemetryReport): DerivedMetrics {
  const m = report.metrics;
  const root = m.mounts?.find((x) => x.mount === "/") ?? m.mounts?.[0];
  return {
    cpu_avg_percent: m.cpu_busy_bp ? m.cpu_busy_bp.avg / 100 : null,
    cpu_max_percent: m.cpu_busy_bp ? m.cpu_busy_bp.max / 100 : null,
    memory_used_percent: m.mem_total_bytes !== null && m.mem_available_bytes !== null ? usedPercent(m.mem_total_bytes, m.mem_available_bytes) : null,
    disk_used_percent: root ? usedPercent(root.total_bytes, root.avail_bytes) : null,
    network_rx_bytes: m.net?.[0]?.rx_bytes_total ?? null,
    network_tx_bytes: m.net?.[0]?.tx_bytes_total ?? null,
  };
}

export class DemoStore {
  readonly db: SqlDatabase;
  constructor(db: SqlDatabase) {
    this.db = db;
  }

  /** Demo time in UTC seconds: wall clock plus the synthetic offset. */
  async now(clockMs: () => number): Promise<number> {
    const [row] = await this.db.all<{ offset_seconds: number }>(sql("SELECT offset_seconds FROM demo_clock WHERE id = 1"));
    return Math.floor(clockMs() / 1000) + (row?.offset_seconds ?? 0);
  }

  async advance(seconds: number): Promise<void> {
    await this.db.batch([sql("UPDATE demo_clock SET offset_seconds = offset_seconds + ? WHERE id = 1", seconds)]);
  }

  /** Deletes only the synthetic demo workspace, atomically. */
  async reset(): Promise<void> {
    await this.db.batch([
      sql("DELETE FROM metric_samples WHERE workspace_id = ?", WORKSPACE),
      sql("DELETE FROM nodes WHERE workspace_id = ?", WORKSPACE),
      sql("UPDATE demo_clock SET offset_seconds = 0 WHERE id = 1"),
    ]);
  }

  /** Demo shortcut for AC-ID-01: no token or key proof; the node is active at generation 1. */
  async enroll(id: string, name: string, now: number): Promise<void> {
    await this.db.batch([
      sql("INSERT INTO workspaces (id, dispatch_enabled, created_at) VALUES (?, 0, ?) ON CONFLICT (id) DO NOTHING", WORKSPACE, now),
      sql(
        `INSERT INTO nodes (id, workspace_id, enrollment_generation, display_name, os, arch, agent_version, host_authority, status, mode, created_at)
         VALUES (?, ?, 1, ?, 'linux', 'amd64', '0.1.0-dev', 'none', 'active', 'monitor-only', ?)
         ON CONFLICT (id) DO NOTHING`,
        id,
        WORKSPACE,
        name,
        now,
      ),
    ]);
  }

  async row(id: string, workspace: string = WORKSPACE): Promise<NodeRow> {
    const [r] = await this.db.all<NodeRow>(
      sql(
        `SELECT id, workspace_id, display_name, enrollment_generation, os, arch, agent_version, last_seen_received_at
           FROM nodes WHERE id = ? AND workspace_id = ? AND status = 'active'`,
        id,
        workspace,
      ),
    );
    if (!r) throw new HttpError(404, "node_not_found", "Node not found in this workspace");
    return r;
  }

  async ingest(report: TelemetryReport, payload: string, bodySha256: string, now: number): Promise<Ack> {
    const node = await this.row(report.node_id);
    if (report.enrollment_generation !== node.enrollment_generation) {
      throw new HttpError(409, "generation_mismatch", "Report enrollment_generation does not match the node");
    }
    if (report.window_end > now + 5 || report.window_end < now - 7 * 86400) {
      throw new HttpError(422, "outside_retention", "window_end must be within the 7-day retention window and not in the future");
    }
    const key = [node.id, node.enrollment_generation, report.boot_id, report.seq] as const;
    const identity = sql("SELECT received_at FROM metric_samples WHERE node_id = ? AND generation = ? AND boot_id = ? AND seq = ?", ...key);
    if ((await this.db.all(identity)).length === 0) {
      const [count] = await this.db.all<{ n: number }>(sql("SELECT COUNT(*) AS n FROM metric_samples WHERE node_id = ?", node.id));
      if ((count?.n ?? 0) >= MAX_SAMPLES_PER_NODE) {
        throw new HttpError(429, "demo_capacity", `Demo limit of ${MAX_SAMPLES_PER_NODE} retained samples per node reached; no receipt issued`);
      }
    }
    const outcome = await new TelemetryStore(this.db, { now: () => now }).ingest(
      { workspaceId: WORKSPACE, nodeId: node.id, generation: node.enrollment_generation },
      report,
      bodySha256,
      payload,
    );
    if (outcome.kind === "conflict") throw new HttpError(409, "sample_conflict", "This sample identity already has different content");
    const [saved] = await this.db.all<{ received_at: number }>(identity);
    return { accepted: true, duplicate: outcome.kind === "duplicate", seq: report.seq, received_at: iso(saved!.received_at) };
  }

  sample(row: SampleRow): Sample {
    // Stored payloads were accepted by the same parser; re-parsing keeps the view typed.
    const report = parseTelemetryReport(utf8Encode(row.payload));
    return {
      boot_id: row.boot_id,
      seq: row.seq,
      observed_at: iso(row.observed_at),
      received_at: iso(row.received_at),
      body_sha256: row.body_sha256,
      metrics: derive(report),
      report: JSON.parse(row.payload) as Record<string, unknown>,
    };
  }

  async view(node: NodeRow, now: number): Promise<NodeView> {
    // Latest by observed time: a late backfill of an older window never replaces it.
    const [latestRow] = await this.db.all<SampleRow>(
      sql("SELECT * FROM metric_samples WHERE node_id = ? ORDER BY observed_at DESC, received_at DESC, seq DESC LIMIT 1", node.id),
    );
    const [count] = await this.db.all<{ n: number }>(sql("SELECT COUNT(*) AS n FROM metric_samples WHERE node_id = ?", node.id));
    const latest = latestRow ? this.sample(latestRow) : null;
    const seen = node.last_seen_received_at;
    const age = seen === null ? Infinity : Math.max(0, now - seen);
    const connectivity = seen === null ? "never-seen" : age > OFFLINE_AFTER ? "offline" : age > STALE_AFTER ? "stale" : "online";
    const data_fresh = !!latestRow && now - latestRow.observed_at <= STALE_AFTER && connectivity === "online";
    const m = latest?.metrics;
    const values = [m?.cpu_avg_percent, m?.memory_used_percent, m?.disk_used_percent].filter((x): x is number => typeof x === "number");
    const health = !data_fresh || values.length === 0 ? "unknown" : values.some((x) => x >= 80) ? "warning" : "healthy";
    return {
      id: node.id,
      display_name: node.display_name,
      workspace_id: node.workspace_id,
      enrollment_generation: node.enrollment_generation,
      os: node.os,
      arch: node.arch,
      agent_version: node.agent_version,
      host_authority: "none",
      mode: "monitor-only",
      connectivity,
      health,
      data_fresh,
      last_seen_received_at: seen === null ? null : iso(seen),
      latest,
      sample_count: count?.n ?? 0,
    };
  }

  async list(now: number, workspace: string = WORKSPACE): Promise<NodeView[]> {
    const rows = await this.db.all<NodeRow>(
      sql(
        `SELECT id, workspace_id, display_name, enrollment_generation, os, arch, agent_version, last_seen_received_at
           FROM nodes WHERE workspace_id = ? AND status = 'active' ORDER BY id LIMIT 10`,
        workspace,
      ),
    );
    return Promise.all(rows.map((r) => this.view(r, now)));
  }

  async history(id: string, from: number, to: number, limit: number): Promise<{ samples: Sample[]; truncated: boolean }> {
    const rows = await this.db.all<SampleRow>(
      sql(
        "SELECT * FROM metric_samples WHERE node_id = ? AND observed_at >= ? AND observed_at <= ? ORDER BY observed_at DESC, seq DESC LIMIT ?",
        id,
        from,
        to,
        limit + 1,
      ),
    );
    return { samples: rows.slice(0, limit).reverse().map((r) => this.sample(r)), truncated: rows.length > limit };
  }
}
