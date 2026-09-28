-- S0 synthetic data only. No production credentials or executable jobs.
CREATE TABLE IF NOT EXISTS demo_clock (
  id INTEGER PRIMARY KEY CHECK(id=1), offset_seconds INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO demo_clock(id,offset_seconds) VALUES(1,0);
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, display_name TEXT NOT NULL,
  generation INTEGER NOT NULL CHECK(generation=1),
  os TEXT NOT NULL, arch TEXT NOT NULL, agent_version TEXT NOT NULL,
  last_seen TEXT
);
CREATE TABLE IF NOT EXISTS samples (
  node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, boot_id TEXT NOT NULL, seq INTEGER NOT NULL,
  observed_at TEXT NOT NULL, received_at TEXT NOT NULL, request_id TEXT NOT NULL,
  digest TEXT NOT NULL, payload TEXT NOT NULL,
  PRIMARY KEY(node_id,generation,boot_id,seq)
);
CREATE INDEX IF NOT EXISTS samples_node_time ON samples(node_id,observed_at DESC,seq DESC);
