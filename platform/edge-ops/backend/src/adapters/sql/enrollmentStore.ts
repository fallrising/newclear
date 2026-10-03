// Enrollment consume (AC-ID-01): one token → at most one node identity. The same key may
// recover a lost response; any other key is refused. Transitions are CAS + conditional inserts.

import { sha256, toHex } from "../../domain/contract/bytes.ts";
import type { EnrollRequest } from "../../domain/contract/enrollment.ts";
import { sql, type Clock, type IdSource, type SqlDatabase } from "./sqlDatabase.ts";

export type EnrollOutcome =
  | { kind: "enrolled"; nodeId: string; credentialId: string; status: "pending_confirmation" | "active" }
  | { kind: "recovered"; nodeId: string; credentialId: string }
  | { kind: "rejected"; code: "enrollment_invalid" | "enrollment_expired" | "enrollment_consumed" | "fingerprint_mismatch" };

interface EnrollmentRow {
  id: string;
  workspace_id: string;
  status: string;
  expires_at: number;
  consumed_by_key: string | null;
  node_id: string | null;
  expected_fingerprint: string | null;
}

export class EnrollmentStore {
  readonly db: SqlDatabase;
  readonly clock: Clock;
  readonly ids: IdSource;
  constructor(db: SqlDatabase, clock: Clock, ids: IdSource) {
    this.db = db;
    this.clock = clock;
    this.ids = ids;
  }

  async enroll(req: EnrollRequest): Promise<EnrollOutcome> {
    const fingerprint = toHex(await sha256(req.publicKey));
    for (let round = 0; round < 2; round++) {
      const row = await this.load(req.tokenHash);
      if (!row || row.status === "revoked") return { kind: "rejected", code: "enrollment_invalid" };
      if (row.status === "consumed") return this.recover(row, req.publicKeyB64);
      if (row.expires_at <= this.clock.now()) return { kind: "rejected", code: "enrollment_expired" };
      // A mismatching key never consumes the token, so a token thief cannot burn it with a wrong key.
      if (row.expected_fingerprint !== null && row.expected_fingerprint !== fingerprint) {
        return { kind: "rejected", code: "fingerprint_mismatch" };
      }
      const outcome = await this.consume(row, req, row.expected_fingerprint !== null);
      if (outcome) return outcome;
      // CAS lost to a concurrent enroll: re-read and fall into the consumed branch.
    }
    return { kind: "rejected", code: "enrollment_consumed" };
  }

  private async load(tokenHash: string): Promise<EnrollmentRow | undefined> {
    const rows = await this.db.all<EnrollmentRow>(
      sql(
        `SELECT id, workspace_id, status, expires_at, consumed_by_key, node_id, expected_fingerprint
           FROM enrollments WHERE token_hash = ?`,
        tokenHash,
      ),
    );
    return rows[0];
  }

  private async recover(row: EnrollmentRow, publicKeyB64: string): Promise<EnrollOutcome> {
    if (row.consumed_by_key !== publicKeyB64) return { kind: "rejected", code: "enrollment_consumed" };
    const creds = await this.db.all<{ id: string }>(
      sql(
        `SELECT c.id FROM node_credentials c JOIN nodes n ON n.id = c.node_id
          WHERE c.node_id = ? AND c.purpose = 'telemetry' AND c.public_key = ?
            AND c.generation = n.enrollment_generation AND c.revoked_at IS NULL AND n.status <> 'revoked'`,
        row.node_id,
        publicKeyB64,
      ),
    );
    if (!creds[0]) return { kind: "rejected", code: "enrollment_invalid" };
    return { kind: "recovered", nodeId: row.node_id!, credentialId: creds[0].id };
  }

  private async consume(row: EnrollmentRow, req: EnrollRequest, fingerprintConfirmed: boolean): Promise<EnrollOutcome | null> {
    const now = this.clock.now();
    const nodeId = this.ids.next("node");
    const credentialId = this.ids.next("cred");
    const transitionId = this.ids.next("tr");
    const status = fingerprintConfirmed ? "active" : "pending_confirmation";
    const results = await this.db.batch([
      sql(
        `UPDATE enrollments SET status = 'consumed', consumed_by_key = ?, node_id = ?
          WHERE id = ? AND status = 'pending' AND expires_at > ?`,
        req.publicKeyB64,
        nodeId,
        row.id,
        now,
      ),
      sql(
        `INSERT INTO nodes (id, workspace_id, enrollment_generation, display_name, os, arch, agent_version,
                            host_authority, status, created_at)
         SELECT ?, workspace_id, 1, display_name, ?, ?, ?, host_authority, ?, ?
           FROM enrollments WHERE id = ? AND node_id = ? AND consumed_by_key = ?`,
        nodeId,
        req.os,
        req.arch,
        req.agentVersion,
        status,
        now,
        row.id,
        nodeId,
        req.publicKeyB64,
      ),
      sql(
        `INSERT INTO node_credentials (id, workspace_id, node_id, generation, public_key, purpose, valid_from)
         SELECT ?, workspace_id, id, enrollment_generation, ?, 'telemetry', ? FROM nodes WHERE id = ?`,
        credentialId,
        req.publicKeyB64,
        now,
        nodeId,
      ),
      sql(
        `INSERT INTO audit_events (id, workspace_id, actor, action, resource, transition_id, detail, received_at)
         SELECT ?, workspace_id, 'node:' || id, 'node.enrolled', 'node:' || id, ?, ?, ? FROM nodes WHERE id = ?`,
        this.ids.next("audit"),
        transitionId,
        JSON.stringify({ status, fingerprint_confirmed: fingerprintConfirmed }),
        now,
        nodeId,
      ),
    ]);
    if (results[0]!.changes !== 1) return null;
    return { kind: "enrolled", nodeId, credentialId, status };
  }
}
