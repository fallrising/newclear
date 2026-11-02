-- Latest read-only inventory projection per workspace. No command or grant changes.
CREATE TABLE inventory_snapshots (
 workspace_id TEXT PRIMARY KEY,
 observed_at INTEGER NOT NULL,
 received_at INTEGER NOT NULL,
 digest TEXT NOT NULL,
 body TEXT NOT NULL CHECK(length(CAST(body AS BLOB)) <= 24576)
);
