// D1 is the only job authority (ADR-02). Every transition is one atomic batch:
//   1. a CAS UPDATE keyed on state/revision/fence that stamps a fresh transition_id;
//   2. dependent writes (attempt, audit, outbox) that SELECT only rows carrying that transition_id;
//   3. assertions that turn a half-applied transition into a batch error (full rollback).
// A 0-row CAS therefore produces no attempt, audit or outbox row (AC-CON-02).

import { isAllowedTransition, type JobState, type TransitionActor } from "../../domain/jobStateMachine.ts";
import { isUniqueViolation, sql, type Clock, type IdSource, type SqlDatabase, type SqlStatement } from "./sqlDatabase.ts";

export interface NewJob {
  workspaceId: string;
  nodeId: string;
  generation: number;
  manifestSha256: string;
  expiresAt: number;
  idempotencyKey: string;
  createdBy: string;
}

export type CreateOutcome =
  | { kind: "created" | "existing"; jobId: string }
  | { kind: "idempotency_conflict" }
  | { kind: "node_not_found" };

export type TransitionOutcome = { kind: "applied"; transitionId: string } | { kind: "conflict" };

export interface ClaimContext {
  workspaceId: string;
  nodeId: string;
  generation: number;
  credentialId: string;
  leaseSeconds: number;
}

export interface ClaimedAttempt {
  jobId: string;
  attemptId: string;
  fence: number;
  leaseUntil: number;
}

export type ClaimOutcome =
  | ({ kind: "claimed" | "redelivered" } & ClaimedAttempt)
  | { kind: "none" }
  | { kind: "busy" }
  | { kind: "conflict" };

export interface AttemptReport {
  workspaceId: string;
  credentialId: string;
  attemptId: string;
  fence: number;
  from: JobState;
  to: JobState;
  resultDigest?: string;
}

const assertion = (condition: string, ...params: (string | number)[]): SqlStatement =>
  sql(`INSERT INTO batch_assertions (violation) SELECT NULL WHERE ${condition}`, ...params);

export class JobStore {
  readonly db: SqlDatabase;
  readonly clock: Clock;
  readonly ids: IdSource;
  constructor(db: SqlDatabase, clock: Clock, ids: IdSource) {
    this.db = db;
    this.clock = clock;
    this.ids = ids;
  }

  private audit(tid: string, actor: string, action: string, detail: object): SqlStatement {
    return sql(
      `INSERT INTO audit_events (id, workspace_id, actor, action, resource, transition_id, detail, received_at)
       SELECT ?, workspace_id, ?, ?, 'job:' || id, ?, ?, ? FROM jobs WHERE last_transition_id = ?`,
      this.ids.next("audit"),
      actor,
      action,
      tid,
      JSON.stringify(detail),
      this.clock.now(),
      tid,
    );
  }

  private outbox(tid: string): SqlStatement {
    return sql(
      `INSERT INTO outbox (id, workspace_id, topic, resource, transition_id, created_at)
       SELECT ?, workspace_id, 'job.changed', 'job:' || id, ?, ? FROM jobs WHERE last_transition_id = ?`,
      this.ids.next("outbox"),
      tid,
      this.clock.now(),
      tid,
    );
  }

  /** Idempotency-Key scoped per workspace; the node must exist in that workspace (no IDOR). */
  async create(job: NewJob): Promise<CreateOutcome> {
    const now = this.clock.now();
    const jobId = this.ids.next("job");
    const tid = this.ids.next("tr");
    const [insert] = await this.db.batch([
      sql(
        `INSERT INTO jobs (id, workspace_id, node_id, enrollment_generation, manifest_sha256, state, expires_at,
                           idempotency_key, created_by, last_transition_id, created_at, updated_at)
         SELECT ?, workspace_id, id, enrollment_generation, ?, 'draft', ?, ?, ?, ?, ?, ?
           FROM nodes WHERE id = ? AND workspace_id = ? AND enrollment_generation = ? AND status = 'active'
         ON CONFLICT (workspace_id, idempotency_key) DO NOTHING`,
        jobId,
        job.manifestSha256,
        job.expiresAt,
        job.idempotencyKey,
        job.createdBy,
        tid,
        now,
        now,
        job.nodeId,
        job.workspaceId,
        job.generation,
      ),
      this.audit(tid, job.createdBy, "job.created", { state: "draft" }),
      this.outbox(tid),
    ]);
    if (insert!.changes === 1) return { kind: "created", jobId };
    const existing = await this.db.all<{ id: string; node_id: string; manifest_sha256: string }>(
      sql(`SELECT id, node_id, manifest_sha256 FROM jobs WHERE workspace_id = ? AND idempotency_key = ?`, job.workspaceId, job.idempotencyKey),
    );
    const e = existing[0];
    if (!e) return { kind: "node_not_found" };
    if (e.node_id !== job.nodeId || e.manifest_sha256 !== job.manifestSha256) return { kind: "idempotency_conflict" };
    return { kind: "existing", jobId: e.id };
  }

  /** Job-level transitions that have no attempt (approval, cancel before claim, expiry). */
  async transitionJob(
    workspaceId: string,
    jobId: string,
    from: JobState,
    to: JobState,
    by: TransitionActor,
    actor: string,
    expectedRevision: number,
  ): Promise<TransitionOutcome> {
    // Courier and attempt-bound transitions go through claim()/reportAttempt(), which are fenced.
    if (!isAllowedTransition(from, to, by) || by === "courier" || ["leased", "running", "reconciling"].includes(from)) {
      throw new Error(`transition ${from} -> ${to} by ${by} is not a job-level transition`);
    }
    const tid = this.ids.next("tr");
    const [cas] = await this.db.batch([
      sql(
        `UPDATE jobs SET state = ?, revision = revision + 1, last_transition_id = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND state = ? AND revision = ?`,
        to,
        tid,
        this.clock.now(),
        jobId,
        workspaceId,
        from,
        expectedRevision,
      ),
      this.audit(tid, actor, `job.${to}`, { from, to }),
      this.outbox(tid),
    ]);
    return cas!.changes === 1 ? { kind: "applied", transitionId: tid } : { kind: "conflict" };
  }

  /** Idempotent request; for leased/running work it only records cancel_requested_at. */
  async requestCancel(workspaceId: string, jobId: string, actor: string): Promise<TransitionOutcome> {
    const tid = this.ids.next("tr");
    const [cas] = await this.db.batch([
      sql(
        `UPDATE jobs SET cancel_requested_at = ?, revision = revision + 1, last_transition_id = ?, updated_at = ?
          WHERE id = ? AND workspace_id = ? AND cancel_requested_at IS NULL
            AND state NOT IN ('expired', 'succeeded', 'failed', 'timed_out', 'cancelled', 'unknown')`,
        this.clock.now(),
        tid,
        this.clock.now(),
        jobId,
        workspaceId,
      ),
      this.audit(tid, actor, "job.cancel_requested", {}),
      this.outbox(tid),
    ]);
    return cas!.changes === 1 ? { kind: "applied", transitionId: tid } : { kind: "conflict" };
  }

  async claim(ctx: ClaimContext): Promise<ClaimOutcome> {
    const now = this.clock.now();
    // A lost claim response is answered with the same attempt, never a second one.
    const active = await this.db.all<{ id: string; job_id: string; fence: number; lease_until: number }>(
      sql(
        `SELECT id, job_id, fence, lease_until FROM job_attempts
          WHERE workspace_id = ? AND node_id = ? AND generation = ? AND lease_owner = ? AND state IN ('leased', 'running')`,
        ctx.workspaceId,
        ctx.nodeId,
        ctx.generation,
        ctx.credentialId,
      ),
    );
    if (active[0]) {
      const a = active[0];
      return { kind: "redelivered", jobId: a.job_id, attemptId: a.id, fence: a.fence, leaseUntil: a.lease_until };
    }
    const candidates = await this.db.all<{ id: string; revision: number }>(
      sql(
        `SELECT id, revision FROM jobs
          WHERE workspace_id = ? AND node_id = ? AND enrollment_generation = ? AND state = 'queued'
            AND cancel_requested_at IS NULL AND expires_at > ?
          ORDER BY created_at, id LIMIT 1`,
        ctx.workspaceId,
        ctx.nodeId,
        ctx.generation,
        now,
      ),
    );
    const job = candidates[0];
    if (!job) return { kind: "none" };
    const tid = this.ids.next("tr");
    const attemptId = this.ids.next("attempt");
    const leaseUntil = now + ctx.leaseSeconds;
    try {
      const [cas] = await this.db.batch([
        // Authorization is re-checked inside the write, against the primary (SDD 02 §2).
        sql(
          `UPDATE jobs SET state = 'leased', revision = revision + 1, last_transition_id = ?, updated_at = ?
            WHERE id = ? AND workspace_id = ? AND state = 'queued' AND revision = ?
              AND cancel_requested_at IS NULL AND expires_at > ?
              AND EXISTS (SELECT 1 FROM workspaces w WHERE w.id = jobs.workspace_id AND w.dispatch_enabled = 1)
              AND EXISTS (SELECT 1 FROM nodes n WHERE n.id = jobs.node_id AND n.workspace_id = jobs.workspace_id
                            AND n.enrollment_generation = jobs.enrollment_generation
                            AND n.status = 'active' AND n.host_authority = 'edge-ops')
              AND EXISTS (SELECT 1 FROM node_credentials c WHERE c.id = ? AND c.node_id = jobs.node_id
                            AND c.generation = jobs.enrollment_generation AND c.purpose = 'jobs'
                            AND c.revoked_at IS NULL)`,
          tid,
          now,
          job.id,
          ctx.workspaceId,
          job.revision,
          now,
          ctx.credentialId,
        ),
        sql(
          `INSERT INTO job_attempts (id, job_id, workspace_id, node_id, generation, fence, lease_owner, lease_until,
                                     state, last_transition_id, created_at)
           SELECT ?, id, workspace_id, node_id, enrollment_generation,
                  (SELECT COALESCE(MAX(fence), 0) + 1 FROM job_attempts WHERE node_id = jobs.node_id),
                  ?, ?, 'leased', ?, ?
             FROM jobs WHERE last_transition_id = ?`,
          attemptId,
          ctx.credentialId,
          leaseUntil,
          tid,
          now,
          tid,
        ),
        this.audit(tid, `cred:${ctx.credentialId}`, "job.leased", { attempt_id: attemptId }),
        this.outbox(tid),
      ]);
      if (cas!.changes !== 1) return { kind: "conflict" };
    } catch (err) {
      if (isUniqueViolation(err)) return { kind: "busy" };
      throw err;
    }
    const fence = await this.db.all<{ fence: number }>(sql(`SELECT fence FROM job_attempts WHERE id = ?`, attemptId));
    return { kind: "claimed", jobId: job.id, attemptId, fence: fence[0]!.fence, leaseUntil };
  }

  /** Courier-reported attempt transition, fenced by attempt/fence/lease owner. */
  async reportAttempt(r: AttemptReport): Promise<TransitionOutcome> {
    if (!isAllowedTransition(r.from, r.to, "courier") || !["leased", "running", "reconciling"].includes(r.from)) {
      throw new Error(`transition ${r.from} -> ${r.to} is not a courier attempt transition`);
    }
    const tid = this.ids.next("tr");
    const now = this.clock.now();
    const [cas] = await this.db.batch([
      sql(
        `UPDATE job_attempts SET state = ?, result_digest = COALESCE(?, result_digest), revision = revision + 1,
                                 last_transition_id = ?
          WHERE id = ? AND workspace_id = ? AND fence = ? AND lease_owner = ? AND state = ?`,
        r.to,
        r.resultDigest ?? null,
        tid,
        r.attemptId,
        r.workspaceId,
        r.fence,
        r.credentialId,
        r.from,
      ),
      sql(
        `UPDATE jobs SET state = ?, revision = revision + 1, last_transition_id = ?, updated_at = ?
          WHERE id = (SELECT job_id FROM job_attempts WHERE last_transition_id = ?) AND state = ?`,
        r.to,
        tid,
        now,
        tid,
        r.from,
      ),
      assertion(
        `EXISTS (SELECT 1 FROM job_attempts WHERE last_transition_id = ?) AND NOT EXISTS (SELECT 1 FROM jobs WHERE last_transition_id = ?)`,
        tid,
        tid,
      ),
      this.audit(tid, `cred:${r.credentialId}`, `job.${r.to}`, { attempt_id: r.attemptId, fence: r.fence, from: r.from }),
      this.outbox(tid),
    ]);
    return cas!.changes === 1 ? { kind: "applied", transitionId: tid } : { kind: "conflict" };
  }

  /** Cron: an expired lease means "outcome unknown to the server", never "stopped" or "retry". */
  async expireLeases(): Promise<{ reconciling: number }> {
    const tid = this.ids.next("tr");
    const now = this.clock.now();
    const [attempts] = await this.db.batch([
      sql(
        `UPDATE job_attempts SET state = 'reconciling', revision = revision + 1, last_transition_id = ?
          WHERE state IN ('leased', 'running') AND lease_until < ?`,
        tid,
        now,
      ),
      sql(
        `UPDATE jobs SET state = 'reconciling', revision = revision + 1, last_transition_id = ?, updated_at = ?
          WHERE id IN (SELECT job_id FROM job_attempts WHERE last_transition_id = ?) AND state IN ('leased', 'running')`,
        tid,
        now,
        tid,
      ),
      assertion(
        `(SELECT COUNT(*) FROM job_attempts WHERE last_transition_id = ?) <> (SELECT COUNT(*) FROM jobs WHERE last_transition_id = ?)`,
        tid,
        tid,
      ),
      sql(
        `INSERT INTO audit_events (id, workspace_id, actor, action, resource, transition_id, detail, received_at)
         SELECT ? || ':' || id, workspace_id, 'cron', 'job.reconciling', 'job:' || job_id, ?, '{"reason":"lease_expired"}', ?
           FROM job_attempts WHERE last_transition_id = ?`,
        tid,
        tid,
        now,
        tid,
      ),
      sql(
        `INSERT INTO outbox (id, workspace_id, topic, resource, transition_id, created_at)
         SELECT ? || ':' || id, workspace_id, 'job.changed', 'job:' || id, ?, ? FROM jobs WHERE last_transition_id = ?`,
        tid,
        tid,
        now,
        tid,
      ),
    ]);
    return { reconciling: attempts!.changes };
  }
}
