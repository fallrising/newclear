// AC-ID-01 (enrollment identity) and AC-MON-01 (sample dedupe / freshness) on the SQLite stand-in.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";
import { EnrollmentStore } from "../src/adapters/sql/enrollmentStore.ts";
import { TelemetryStore } from "../src/adapters/sql/telemetryStore.ts";
import { ed25519PublicFromSeed, ed25519SignWithSeed, sha256, toBase64Url, toHex, utf8Encode } from "../src/domain/contract/bytes.ts";
import { enrollmentTokenHash, enrollSigningMessage, parseAndVerifyEnroll, type EnrollRequest } from "../src/domain/contract/enrollment.ts";
import { parseTelemetryReport, type TelemetryReport } from "../src/domain/contract/telemetry.ts";
import { seed } from "../tools/vectors.ts";
import { FakeClock, SeqIds, SqliteDatabase } from "./support/sqlite.ts";

let db: SqliteDatabase;
let clock: FakeClock;
let enrollments: EnrollmentStore;

const TOKEN = toBase64Url(new Uint8Array(32).fill(7));

async function enrollRequest(keyLabel: string, token = TOKEN): Promise<EnrollRequest> {
  const s = await seed(keyLabel);
  const pub = await ed25519PublicFromSeed(s);
  const proof = await ed25519SignWithSeed(s, await enrollSigningMessage(token, pub));
  const body = JSON.stringify({
    schema_version: "edgeops.enroll.v1",
    enrollment_token: token,
    public_key: toBase64Url(pub),
    proof: toBase64Url(proof),
    agent_version: "0.1.0-dev",
    os: "linux",
    arch: "arm64",
  });
  return parseAndVerifyEnroll(utf8Encode(body));
}

async function addEnrollment(opts: { ttl?: number; fingerprintOf?: string } = {}): Promise<void> {
  const fp = opts.fingerprintOf ? toHex(await sha256(await ed25519PublicFromSeed(await seed(opts.fingerprintOf)))) : null;
  db.exec(
    `INSERT INTO enrollments (id, workspace_id, token_hash, expected_fingerprint, display_name, host_authority, expires_at, status, created_by, created_at)
     VALUES ('enr_1', 'ws_a', ?, ?, 'synthetic-node', 'none', ?, 'pending', 'user_admin', ?)`,
    await enrollmentTokenHash(TOKEN),
    fp,
    clock.now() + (opts.ttl ?? 600),
    clock.now(),
  );
}

beforeEach(() => {
  db = new SqliteDatabase();
  clock = new FakeClock();
  enrollments = new EnrollmentStore(db, clock, new SeqIds());
  db.exec(`INSERT INTO workspaces (id, dispatch_enabled, created_at) VALUES ('ws_a', 0, 0)`);
});

test("concurrent enrollment with different keys yields one identity", async () => {
  await addEnrollment();
  const [a, b] = await Promise.all([enrollments.enroll(await enrollRequest("node-1")), enrollments.enroll(await enrollRequest("attacker-1"))]);
  const kinds = [a.kind, b.kind].sort();
  assert.deepEqual(kinds, ["enrolled", "rejected"]);
  assert.equal(db.count("nodes"), 1);
  assert.equal(db.count("node_credentials"), 1);
  assert.equal(db.count("audit_events", "action = 'node.enrolled'"), 1);
});

test("same key recovers a lost response; token is single-use for other keys", async () => {
  await addEnrollment();
  const req = await enrollRequest("node-1");
  const first = await enrollments.enroll(req);
  assert.equal(first.kind, "enrolled");
  assert.equal((first as { status: string }).status, "pending_confirmation", "no fingerprint: operator must confirm");
  const again = await enrollments.enroll(req);
  assert.deepEqual(again, { kind: "recovered", nodeId: (first as { nodeId: string }).nodeId, credentialId: (first as { credentialId: string }).credentialId });
  assert.deepEqual(await enrollments.enroll(await enrollRequest("node-2")), { kind: "rejected", code: "enrollment_consumed" });
  assert.equal(db.count("nodes"), 1);
});

test("expired token and unknown token are rejected without writes", async () => {
  await addEnrollment({ ttl: 10 });
  clock.t += 10;
  assert.deepEqual(await enrollments.enroll(await enrollRequest("node-1")), { kind: "rejected", code: "enrollment_expired" });
  assert.deepEqual(await enrollments.enroll(await enrollRequest("node-1", toBase64Url(new Uint8Array(32).fill(9)))), {
    kind: "rejected",
    code: "enrollment_invalid",
  });
  assert.equal(db.count("nodes"), 0);
});

test("expected fingerprint: mismatch does not burn the token, match activates", async () => {
  await addEnrollment({ fingerprintOf: "node-1" });
  assert.deepEqual(await enrollments.enroll(await enrollRequest("attacker-1")), { kind: "rejected", code: "fingerprint_mismatch" });
  assert.equal(db.count("enrollments", "status = 'pending'"), 1);
  const ok = await enrollments.enroll(await enrollRequest("node-1"));
  assert.equal(ok.kind, "enrolled");
  assert.equal((ok as { status: string }).status, "active");
});

test("new nodes never start with edge-ops host authority", async () => {
  await addEnrollment();
  await enrollments.enroll(await enrollRequest("node-1"));
  const row = db.db.prepare(`SELECT host_authority, mode FROM nodes`).get() as { host_authority: string; mode: string };
  assert.deepEqual({ ...row }, { host_authority: "none", mode: "monitor-only" });
  assert.throws(() => db.exec(`INSERT INTO enrollments (id, workspace_id, token_hash, display_name, host_authority, expires_at, status, created_by, created_at) VALUES ('e2', 'ws_a', 'h2', 'n', 'edge-ops', 0, 'pending', 'u', 0)`), /CHECK/);
});

// ---------- telemetry ----------

const vectors = JSON.parse(readFileSync(new URL("../../contracts/vectors/telemetry.json", import.meta.url), "utf8"));

function report(patch: Record<string, unknown>): { report: TelemetryReport; text: string } {
  const text = JSON.stringify({ ...vectors.base, ...patch });
  return { report: parseTelemetryReport(utf8Encode(text)), text };
}

test("telemetry dedupe, conflicting replay and backfill freshness", async () => {
  db.exec(
    `INSERT INTO nodes (id, workspace_id, enrollment_generation, display_name, os, arch, agent_version, host_authority, status, created_at)
     VALUES ('node_example', 'ws_a', 1, 'n', 'linux', 'amd64', '0.1.0-dev', 'none', 'active', 0)`,
  );
  const telemetry = new TelemetryStore(db, clock);
  const id = { workspaceId: "ws_a", nodeId: "node_example", generation: 1 };
  const digest = async (t: string) => toHex(await sha256(utf8Encode(t)));

  const live = report({ seq: 10, window_start: "2026-01-01T00:10:00Z", window_end: "2026-01-01T00:11:00Z" });
  assert.equal((await telemetry.ingest(id, live.report, await digest(live.text), live.text)).kind, "stored");
  assert.equal((await telemetry.ingest(id, live.report, await digest(live.text), live.text)).kind, "duplicate");
  const forged = report({ seq: 10, window_start: "2026-01-01T00:10:00Z", window_end: "2026-01-01T00:11:00Z", sample_count: 1 });
  assert.equal((await telemetry.ingest(id, forged.report, await digest(forged.text), forged.text)).kind, "conflict");
  assert.equal(db.count("metric_samples"), 1);

  clock.t += 300;
  const backfill = report({ seq: 3, window_start: "2026-01-01T00:03:00Z", window_end: "2026-01-01T00:04:00Z" });
  assert.equal((await telemetry.ingest(id, backfill.report, await digest(backfill.text), backfill.text)).kind, "stored");
  const latest = await telemetry.latest("ws_a", "node_example");
  assert.equal(latest?.seq, 10, "backfilled window does not replace the latest observation");
  const seen = db.db.prepare(`SELECT last_seen_received_at AS t FROM nodes WHERE id = 'node_example'`).get() as { t: number };
  assert.equal(seen.t, clock.now(), "last_seen follows the receive time of a valid request");

  const otherBoot = report({ seq: 10, boot_id: "00000000-0000-4000-8000-000000000002" });
  assert.equal((await telemetry.ingest(id, otherBoot.report, await digest(otherBoot.text), otherBoot.text)).kind, "stored", "seq restarts per boot");
});
