-- Edge Ops M0 schema (SDD 02 §2). Every row carries workspace_id; queries never cross workspaces.
-- Timestamps are Unix seconds (INTEGER). Synthetic IDs only; no host data belongs in fixtures.

CREATE TABLE workspaces (
  id TEXT PRIMARY KEY,
  -- Restored/isolated environments start with dispatch disabled (SDD 07 §5).
  dispatch_enabled INTEGER NOT NULL DEFAULT 0 CHECK (dispatch_enabled IN (0, 1)),
  created_at INTEGER NOT NULL
);

CREATE TABLE enrollments (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  token_hash TEXT NOT NULL UNIQUE,
  expected_fingerprint TEXT,
  display_name TEXT NOT NULL,
  host_authority TEXT NOT NULL CHECK (host_authority IN ('none', 'external')),
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'consumed', 'revoked')),
  consumed_by_key TEXT,
  node_id TEXT,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  CHECK ((status = 'consumed') = (consumed_by_key IS NOT NULL AND node_id IS NOT NULL))
);

CREATE TABLE nodes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  enrollment_generation INTEGER NOT NULL CHECK (enrollment_generation >= 1),
  display_name TEXT NOT NULL,
  os TEXT NOT NULL,
  arch TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  -- 'edge-ops' is only reachable through an explicit authority migration, never at enrollment.
  host_authority TEXT NOT NULL CHECK (host_authority IN ('none', 'external', 'edge-ops')),
  status TEXT NOT NULL CHECK (status IN ('pending_confirmation', 'active', 'revoked')),
  mode TEXT NOT NULL DEFAULT 'monitor-only' CHECK (mode IN ('monitor-only', 'managed')),
  init_state TEXT NOT NULL DEFAULT 'none',
  last_seen_received_at INTEGER,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX nodes_by_workspace ON nodes (workspace_id, id);

CREATE TABLE node_credentials (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  node_id TEXT NOT NULL REFERENCES nodes (id),
  generation INTEGER NOT NULL,
  public_key TEXT NOT NULL,
  -- collector and courier never share a purpose (SDD 05 §1).
  purpose TEXT NOT NULL CHECK (purpose IN ('telemetry', 'logs', 'jobs')),
  valid_from INTEGER NOT NULL,
  revoked_at INTEGER,
  UNIQUE (node_id, generation, purpose)
);

-- Replay window for signed machine requests; rows older than the skew window can be purged.
CREATE TABLE request_nonces (
  credential_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  PRIMARY KEY (credential_id, nonce)
);

CREATE TABLE metric_samples (
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  boot_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  observed_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  body_sha256 TEXT NOT NULL,
  payload TEXT NOT NULL,
  PRIMARY KEY (node_id, generation, boot_id, seq)
);
CREATE INDEX metric_samples_by_time ON metric_samples (workspace_id, node_id, observed_at);

CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces (id),
  node_id TEXT NOT NULL REFERENCES nodes (id),
  enrollment_generation INTEGER NOT NULL,
  manifest_sha256 TEXT NOT NULL,
  approval_ref TEXT,
  state TEXT NOT NULL CHECK (state IN (
    'draft', 'awaiting_approval', 'queued', 'leased', 'running', 'reconciling',
    'expired', 'succeeded', 'failed', 'timed_out', 'cancelled', 'unknown')),
  cancel_requested_at INTEGER,
  expires_at INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  created_by TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  last_transition_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (workspace_id, idempotency_key)
);
CREATE INDEX jobs_claimable ON jobs (workspace_id, node_id, state, created_at);
CREATE INDEX jobs_by_transition ON jobs (last_transition_id);

CREATE TABLE job_attempts (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs (id),
  workspace_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  fence INTEGER NOT NULL,
  lease_owner TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN (
    'leased', 'running', 'reconciling', 'succeeded', 'failed', 'timed_out', 'cancelled', 'unknown')),
  result_digest TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  last_transition_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (node_id, fence)
);
-- At most one host-mutation attempt in flight per node (SDD 02 §4). A competing claim fails the
-- whole batch instead of silently leasing a second job.
CREATE UNIQUE INDEX one_active_attempt_per_node ON job_attempts (node_id)
  WHERE state IN ('leased', 'running', 'reconciling');
CREATE INDEX job_attempts_by_transition ON job_attempts (last_transition_id);
CREATE INDEX job_attempts_by_lease ON job_attempts (state, lease_until);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  detail TEXT NOT NULL,
  received_at INTEGER NOT NULL
);
CREATE INDEX audit_by_resource ON audit_events (workspace_id, resource, received_at);

-- Never holds rows. A batch appends `INSERT INTO batch_assertions SELECT NULL WHERE <violated>`
-- so a broken invariant raises a NOT NULL error and D1 rolls back the whole batch, instead of
-- relying on 0-row statements (which D1 does not treat as failures).
CREATE TABLE batch_assertions (
  violation TEXT NOT NULL
);

CREATE TABLE outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  resource TEXT NOT NULL,
  transition_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  delivered_at INTEGER,
  attempts INTEGER NOT NULL DEFAULT 0
);
