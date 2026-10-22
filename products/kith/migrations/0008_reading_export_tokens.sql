-- Separate capability: only reading export and revision-conditional ACK.
CREATE TABLE reading_export_tokens (
  id TEXT NOT NULL PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX reading_export_tokens_owner ON reading_export_tokens(member_id, created_at);
