// Telemetry ingest (SDD 02 §3, AC-MON-01). Durable ack only after the sample row exists.
// Same (node, generation, boot_id, seq) with a different body digest is a conflict, not an
// overwrite. last_seen is the receive time of this valid request, independent of observed_at,
// so backfilled windows never make a node look fresh by themselves.

import type { TelemetryReport } from "../../domain/contract/telemetry.ts";
import { sql, type Clock, type SqlDatabase } from "./sqlDatabase.ts";

export type IngestOutcome = { kind: "stored" | "duplicate"; seq: number } | { kind: "conflict"; seq: number };

export interface NodeIdentity {
  workspaceId: string;
  nodeId: string;
  generation: number;
}

export class TelemetryStore {
  readonly db: SqlDatabase;
  readonly clock: Clock;
  constructor(db: SqlDatabase, clock: Clock) {
    this.db = db;
    this.clock = clock;
  }

  async ingest(identity: NodeIdentity, report: TelemetryReport, bodySha256: string, payload: string): Promise<IngestOutcome> {
    const now = this.clock.now();
    const [insert] = await this.db.batch([
      sql(
        `INSERT INTO metric_samples (workspace_id, node_id, generation, boot_id, seq, observed_at, received_at, body_sha256, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (node_id, generation, boot_id, seq) DO NOTHING`,
        identity.workspaceId,
        identity.nodeId,
        identity.generation,
        report.boot_id,
        report.seq,
        report.window_end,
        now,
        bodySha256,
        payload,
      ),
      sql(
        `UPDATE nodes SET last_seen_received_at = MAX(COALESCE(last_seen_received_at, 0), ?)
          WHERE id = ? AND workspace_id = ? AND enrollment_generation = ?`,
        now,
        identity.nodeId,
        identity.workspaceId,
        identity.generation,
      ),
    ]);
    if (insert!.changes === 1) return { kind: "stored", seq: report.seq };
    const existing = await this.db.all<{ body_sha256: string }>(
      sql(
        `SELECT body_sha256 FROM metric_samples WHERE node_id = ? AND generation = ? AND boot_id = ? AND seq = ?`,
        identity.nodeId,
        identity.generation,
        report.boot_id,
        report.seq,
      ),
    );
    return existing[0]?.body_sha256 === bodySha256 ? { kind: "duplicate", seq: report.seq } : { kind: "conflict", seq: report.seq };
  }

  /** Latest window by observed time; a late backfill of an older window never replaces it. */
  async latest(workspaceId: string, nodeId: string): Promise<{ seq: number; boot_id: string; observed_at: number } | undefined> {
    const rows = await this.db.all<{ seq: number; boot_id: string; observed_at: number }>(
      sql(
        `SELECT seq, boot_id, observed_at FROM metric_samples
          WHERE workspace_id = ? AND node_id = ? ORDER BY observed_at DESC, received_at DESC LIMIT 1`,
        workspaceId,
        nodeId,
      ),
    );
    return rows[0];
  }
}
