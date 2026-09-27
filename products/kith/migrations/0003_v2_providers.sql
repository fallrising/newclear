-- v2 W4: provider connections, agent runtimes, runtime change log, generation details.
-- 04 §4 (B-03, B-07, B-09), 03 RT-01..RT-12. Append-only; no v1 table is rebuilt.
CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  preset TEXT NOT NULL,
  api_format TEXT NOT NULL CHECK (api_format IN
    ('openai_chat', 'openai_responses', 'anthropic_messages', 'gemini', 'fake')),
  base_url TEXT NOT NULL,
  secret_source TEXT NOT NULL CHECK (secret_source IN ('stored', 'env', 'none')),
  secret_ciphertext TEXT,
  secret_env TEXT,
  secret_last4 TEXT,
  secret_updated_at TEXT,
  extra_headers_json TEXT NOT NULL DEFAULT '{}',
  default_quota_class TEXT NOT NULL DEFAULT 'api_key'
    CHECK (default_quota_class IN ('api_key', 'operator_personal')),
  token_param TEXT NOT NULL DEFAULT 'max_tokens'
    CHECK (token_param IN ('max_tokens', 'max_completion_tokens')),
  last_error_class TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK (
    (secret_source = 'stored' AND secret_ciphertext IS NOT NULL AND secret_env IS NULL) OR
    (secret_source = 'env' AND secret_env IS NOT NULL AND secret_ciphertext IS NULL) OR
    (secret_source = 'none' AND secret_ciphertext IS NULL AND secret_env IS NULL)
  )
);

CREATE TABLE agent_runtimes (
  agent_id TEXT PRIMARY KEY REFERENCES members(id),
  runtime TEXT NOT NULL CHECK (runtime IN ('hosted', 'runner', 'external')),
  connection_id TEXT REFERENCES provider_connections(id),
  model TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  system_prompt_addendum TEXT NOT NULL DEFAULT '',
  adapter_kind TEXT,
  runtime_epoch INTEGER NOT NULL DEFAULT 1,
  runner_last_seen_at TEXT,
  last_error_class TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX agent_runtimes_connection ON agent_runtimes(connection_id);

CREATE TABLE agent_runtime_changes (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES members(id),
  changed_by TEXT NOT NULL REFERENCES members(id),
  from_runtime TEXT,
  to_runtime TEXT NOT NULL,
  from_epoch INTEGER,
  to_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX agent_runtime_changes_agent ON agent_runtime_changes(agent_id, created_at);

ALTER TABLE generations ADD COLUMN error_class TEXT;
ALTER TABLE generations ADD COLUMN input_tokens INTEGER;
ALTER TABLE generations ADD COLUMN output_tokens INTEGER;
ALTER TABLE generations ADD COLUMN connection_id TEXT;
ALTER TABLE generations ADD COLUMN model TEXT;
ALTER TABLE generations ADD COLUMN runtime_epoch INTEGER;
