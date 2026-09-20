CREATE TABLE members (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('human', 'agent')),
  handle TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT,                  -- human only; WebCrypto PBKDF2-SHA-256
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  quota_class TEXT NOT NULL DEFAULT 'api_key'
    CHECK (quota_class IN ('api_key', 'operator_personal')),
  is_operator INTEGER NOT NULL DEFAULT 0 CHECK (is_operator IN (0, 1)),
  created_at TEXT NOT NULL,
  disabled_at TEXT,
  CHECK (
    (kind = 'human' AND password_hash IS NOT NULL) OR
    (kind = 'agent' AND password_hash IS NULL)
  )
);
CREATE UNIQUE INDEX members_one_operator ON members(is_operator) WHERE is_operator = 1;

CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES members(id)
);

CREATE TABLE room_members (
  room_id TEXT NOT NULL,
  member_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member')),
  attention_mode TEXT NOT NULL CHECK (
    attention_mode IN ('silent', 'mention', 'keyword', 'ambient')
  ),
  keywords_json TEXT NOT NULL DEFAULT '[]',
  cooldown_ms INTEGER NOT NULL DEFAULT 15000,
  debounce_ms INTEGER NOT NULL DEFAULT 2000,
  classifier TEXT NOT NULL DEFAULT 'heuristic'
    CHECK (classifier IN ('heuristic', 'llm')),
  policy_epoch INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (room_id, member_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (member_id) REFERENCES members(id)
);

-- INV-02：禁止 CHECK subquery。
CREATE TRIGGER room_members_no_agent_owner
BEFORE INSERT ON room_members
BEGIN
  SELECT RAISE(ABORT, 'agent cannot be owner')
  WHERE NEW.role = 'owner'
    AND EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND kind = 'agent');
END;

CREATE TRIGGER room_members_no_agent_owner_upd
BEFORE UPDATE ON room_members
BEGIN
  SELECT RAISE(ABORT, 'agent cannot be owner')
  WHERE NEW.role = 'owner'
    AND EXISTS (SELECT 1 FROM members WHERE id = NEW.member_id AND kind = 'agent');
END;

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('message', 'trace')),  -- status 不進 D1
  thread_id TEXT,
  reply_to TEXT,
  sender_id TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  generation_id TEXT,
  client_message_id TEXT NOT NULL,
  origin TEXT NOT NULL DEFAULT 'local' CHECK (origin = 'local'),
  created_at TEXT NOT NULL,
  UNIQUE (room_id, seq),
  UNIQUE (room_id, sender_id, client_message_id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (sender_id) REFERENCES members(id)
);
CREATE INDEX messages_room_seq ON messages(room_id, seq);
CREATE INDEX messages_room_kind_seq ON messages(room_id, kind, seq);

CREATE TABLE bot_tokens (
  id TEXT PRIMARY KEY,
  member_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  room_scope_json TEXT NOT NULL,       -- 空陣列 = 該 agent 的所有房，仍受 membership 限制
  created_at TEXT NOT NULL,
  expires_at TEXT,
  revoked_at TEXT,
  last_used_at TEXT,
  FOREIGN KEY (member_id) REFERENCES members(id)
);
CREATE INDEX bot_tokens_member ON bot_tokens(member_id);

CREATE TABLE generations (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  trigger_seq INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN ('queued', 'dispatched', 'streaming', 'completed', 'dropped', 'failed')
  ),
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (agent_id) REFERENCES members(id)
);
CREATE INDEX generations_room_agent ON generations(room_id, agent_id, created_at);
