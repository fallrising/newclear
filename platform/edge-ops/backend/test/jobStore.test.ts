// AC-CON-02, AC-ID-02, AC-AUTH-01, AC-JOB-03 (server side) against the local SQLite stand-in.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { JobStore } from "../src/adapters/sql/jobStore.ts";
import { sql } from "../src/adapters/sql/sqlDatabase.ts";
import { FakeClock, SeqIds, SqliteDatabase } from "./support/sqlite.ts";

let db: SqliteDatabase;
let clock: FakeClock;
let store: JobStore;

const WS = "ws_a";
const NODE = "node_a";
const COURIER = "cred_courier_a";
const ctx = { workspaceId: WS, nodeId: NODE, generation: 1, credentialId: COURIER, leaseSeconds: 60 };

function seed(): void {
  const now = clock.now();
  db.exec(`INSERT INTO workspaces (id, dispatch_enabled, created_at) VALUES ('ws_a', 1, ?), ('ws_b', 1, ?)`, now, now);
  for (const [id, ws] of [
    [NODE, WS],
    ["node_b", "ws_b"],
  ]) {
    db.exec(
      `INSERT INTO nodes (id, workspace_id, enrollment_generation, display_name, os, arch, agent_version, host_authority, status, created_at)
       VALUES (?, ?, 1, 'synthetic', 'linux', 'amd64', '0.1.0-dev', 'edge-ops', 'active', ?)`,
      id!,
      ws!,
      now,
    );
  }
  db.exec(
    `INSERT INTO node_credentials (id, workspace_id, node_id, generation, public_key, purpose, valid_from)
     VALUES (?, ?, ?, 1, 'pk_courier', 'jobs', ?), ('cred_collector_a', ?, ?, 1, 'pk_collector', 'telemetry', ?)`,
    COURIER,
    WS,
    NODE,
    now,
    WS,
    NODE,
    now,
  );
}

async function queuedJob(key: string): Promise<string> {
  const created = await store.create({
    workspaceId: WS,
    nodeId: NODE,
    generation: 1,
    manifestSha256: key.padEnd(64, "0"),
    expiresAt: clock.now() + 3600,
    idempotencyKey: key,
    createdBy: "user_operator",
  });
  assert.equal(created.kind, "created");
  const jobId = (created as { jobId: string }).jobId;
  assert.equal((await store.transitionJob(WS, jobId, "draft", "awaiting_approval", "operator", "user_operator", 1)).kind, "applied");
  assert.equal((await store.transitionJob(WS, jobId, "awaiting_approval", "queued", "server", "system", 2)).kind, "applied");
  return jobId;
}

const jobState = (id: string) =>
  db.db.prepare(`SELECT state, revision, cancel_requested_at FROM jobs WHERE id = ?`).get(id) as {
    state: string;
    revision: number;
    cancel_requested_at: number | null;
  };

beforeEach(() => {
  db = new SqliteDatabase();
  clock = new FakeClock();
  store = new JobStore(db, clock, new SeqIds());
  seed();
});

test("competing claims for one job: exactly one transition, one attempt, one audit", async () => {
  const job = await queuedJob("k1");
  const [a, b] = await Promise.all([store.claim(ctx), store.claim({ ...ctx })]);
  const kinds = [a.kind, b.kind].sort();
  // The loser either lost the CAS or observed the winner's attempt as a redelivery; never two attempts.
  assert.ok(
    JSON.stringify(kinds) === JSON.stringify(["claimed", "conflict"]) || JSON.stringify(kinds) === JSON.stringify(["claimed", "redelivered"]),
    JSON.stringify(kinds),
  );
  assert.equal(db.count("job_attempts"), 1);
  assert.equal(db.count("audit_events", "action = 'job.leased'"), 1);
  assert.equal(db.count("outbox", "resource = ?", `job:${job}`), 4); // created, awaiting, queued, leased
  assert.equal(jobState(job).state, "leased");
});

test("lost claim response is answered with the same attempt", async () => {
  const j1 = await queuedJob("k1");
  const j2 = await queuedJob("k2");
  const first = await store.claim(ctx);
  assert.equal(first.kind, "claimed");
  const again = await store.claim(ctx);
  assert.deepEqual({ ...again, kind: "claimed" }, first);
  assert.equal(again.kind, "redelivered");
  assert.equal(jobState(j1).state, "leased");
  assert.equal(jobState(j2).state, "queued");
  assert.equal(db.count("job_attempts"), 1);
});

test("partial unique index turns a second active attempt into a full rollback", async () => {
  const j1 = await queuedJob("k1");
  const j2 = await queuedJob("k2");
  assert.equal((await store.claim(ctx)).kind, "claimed");
  const before = jobState(j2);
  const audits = db.count("audit_events");
  // Bypass the redelivery short-cut to force the race the index protects against.
  db.exec(`UPDATE job_attempts SET lease_owner = 'cred_other' WHERE job_id = ?`, j1);
  const r = await store.claim(ctx);
  assert.equal(r.kind, "busy");
  assert.deepEqual(jobState(j2), before, "UPDATE of j2 rolled back with the failed attempt insert");
  assert.equal(db.count("audit_events"), audits, "no audit for a rolled-back claim");
  assert.equal(db.count("job_attempts"), 1);
});

test("0-row CAS writes no audit or outbox", async () => {
  const job = await queuedJob("k1");
  const audits = db.count("audit_events");
  const outbox = db.count("outbox");
  const stale = await store.transitionJob(WS, job, "queued", "cancelled", "operator", "user_operator", 1);
  assert.equal(stale.kind, "conflict");
  assert.equal(db.count("audit_events"), audits);
  assert.equal(db.count("outbox"), outbox);
  assert.equal(jobState(job).state, "queued");
});

test("a failing statement mid-batch rolls back earlier statements", async () => {
  const job = await queuedJob("k1");
  const audits = db.count("audit_events");
  await assert.rejects(
    db.batch([
      sql(`UPDATE jobs SET state = 'cancelled', last_transition_id = 'tr_x' WHERE id = ?`, job),
      sql(`INSERT INTO audit_events (id, workspace_id, actor, action, resource, transition_id, detail, received_at) VALUES ('a_x', ?, 'x', 'x', 'x', 'tr_x', '{}', 0)`, WS),
      sql(`INSERT INTO batch_assertions (violation) SELECT NULL`),
    ]),
    /NOT NULL/,
  );
  assert.equal(jobState(job).state, "queued");
  assert.equal(db.count("audit_events"), audits);
});

test("assertion rolls back an attempt update when the job row is out of sync", async () => {
  const job = await queuedJob("k1");
  const claim = await store.claim(ctx);
  assert.equal(claim.kind, "claimed");
  const { attemptId, fence } = claim as { attemptId: string; fence: number };
  db.exec(`UPDATE jobs SET state = 'running' WHERE id = ?`, job); // corrupt: job ahead of attempt
  await assert.rejects(
    store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId, fence, from: "leased", to: "running" }),
    /NOT NULL/,
  );
  const a = db.db.prepare(`SELECT state FROM job_attempts WHERE id = ?`).get(attemptId) as { state: string };
  assert.equal(a.state, "leased");
});

test("attempt reports are fenced", async () => {
  await queuedJob("k1");
  const claim = (await store.claim(ctx)) as { attemptId: string; fence: number };
  const wrongFence = await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence + 1, from: "leased", to: "running" });
  assert.equal(wrongFence.kind, "conflict");
  const wrongOwner = await store.reportAttempt({ workspaceId: WS, credentialId: "cred_collector_a", attemptId: claim.attemptId, fence: claim.fence, from: "leased", to: "running" });
  assert.equal(wrongOwner.kind, "conflict");
  const ok = await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence, from: "leased", to: "running" });
  assert.equal(ok.kind, "applied");
});

test("expired lease becomes reconciling, never a new attempt", async () => {
  const job = await queuedJob("k1");
  const claim = (await store.claim(ctx)) as { attemptId: string; fence: number };
  await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence, from: "leased", to: "running" });
  clock.t += 61;
  assert.deepEqual(await store.expireLeases(), { reconciling: 1 });
  assert.equal(jobState(job).state, "reconciling");
  assert.equal(db.count("audit_events", "action = 'job.reconciling'"), 1);
  assert.equal((await store.claim(ctx)).kind, "none");
  assert.equal(db.count("job_attempts"), 1);
  assert.deepEqual(await store.expireLeases(), { reconciling: 0 }, "sweep is idempotent");
  // Reconciliation can still close the attempt from journal evidence.
  const done = await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence, from: "reconciling", to: "succeeded" });
  assert.equal(done.kind, "applied");
  assert.equal(jobState(job).state, "succeeded");
});

test("claim authorization is rechecked inside the write", async (t) => {
  const cases: [string, () => void][] = [
    ["dispatch disabled", () => db.exec(`UPDATE workspaces SET dispatch_enabled = 0 WHERE id = ?`, WS)],
    ["external host authority", () => db.exec(`UPDATE nodes SET host_authority = 'external' WHERE id = ?`, NODE)],
    ["node revoked", () => db.exec(`UPDATE nodes SET status = 'revoked' WHERE id = ?`, NODE)],
    ["credential revoked", () => db.exec(`UPDATE node_credentials SET revoked_at = 1 WHERE id = ?`, COURIER)],
    ["generation bumped", () => db.exec(`UPDATE nodes SET enrollment_generation = 2 WHERE id = ?`, NODE)],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, async () => {
      db = new SqliteDatabase();
      store = new JobStore(db, clock, new SeqIds());
      seed();
      const job = await queuedJob("k1");
      mutate();
      const r = await store.claim(ctx);
      assert.equal(r.kind, "conflict");
      assert.equal(jobState(job).state, "queued");
      assert.equal(db.count("job_attempts"), 0);
    });
  }
});

test("collector credential cannot claim jobs", async () => {
  const job = await queuedJob("k1");
  assert.equal((await store.claim({ ...ctx, credentialId: "cred_collector_a" })).kind, "conflict");
  assert.equal(jobState(job).state, "queued");
});

test("cross-workspace node and idempotency conflicts", async () => {
  const cross = await store.create({ workspaceId: WS, nodeId: "node_b", generation: 1, manifestSha256: "f".repeat(64), expiresAt: clock.now() + 60, idempotencyKey: "x", createdBy: "u" });
  assert.equal(cross.kind, "node_not_found");
  assert.equal(db.count("jobs"), 0);
  const first = await store.create({ workspaceId: WS, nodeId: NODE, generation: 1, manifestSha256: "a".repeat(64), expiresAt: clock.now() + 60, idempotencyKey: "same", createdBy: "u" });
  const replay = await store.create({ workspaceId: WS, nodeId: NODE, generation: 1, manifestSha256: "a".repeat(64), expiresAt: clock.now() + 60, idempotencyKey: "same", createdBy: "u" });
  const changed = await store.create({ workspaceId: WS, nodeId: NODE, generation: 1, manifestSha256: "b".repeat(64), expiresAt: clock.now() + 60, idempotencyKey: "same", createdBy: "u" });
  assert.equal(first.kind, "created");
  assert.deepEqual(replay, { kind: "existing", jobId: (first as { jobId: string }).jobId });
  assert.equal(changed.kind, "idempotency_conflict");
  assert.equal(db.count("audit_events", "action = 'job.created'"), 1);
});

test("cancel is a request flag, not a stop", async () => {
  const job = await queuedJob("k1");
  const claim = (await store.claim(ctx)) as { attemptId: string; fence: number };
  await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence, from: "leased", to: "running" });
  assert.equal((await store.requestCancel(WS, job, "user_operator")).kind, "applied");
  assert.equal((await store.requestCancel(WS, job, "user_operator")).kind, "conflict", "second request is a no-op");
  const s = jobState(job);
  assert.equal(s.state, "running");
  assert.notEqual(s.cancel_requested_at, null);
  const queued = await queuedJob("k2");
  await store.requestCancel(WS, queued, "user_operator");
  const stopped = await store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: claim.attemptId, fence: claim.fence, from: "running", to: "cancelled" });
  assert.equal(stopped.kind, "applied");
  assert.equal((await store.claim(ctx)).kind, "none", "cancel-requested queued job is never claimed");
});

test("disallowed transitions are rejected before touching the database", async () => {
  const job = await queuedJob("k1");
  await assert.rejects(store.transitionJob(WS, job, "queued", "succeeded", "operator", "u", 3));
  await assert.rejects(store.transitionJob(WS, job, "queued", "leased", "courier", "u", 3));
  await assert.rejects(store.reportAttempt({ workspaceId: WS, credentialId: COURIER, attemptId: "a", fence: 1, from: "reconciling", to: "unknown" }));
});
