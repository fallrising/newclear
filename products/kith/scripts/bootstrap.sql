-- Kith M1 bootstrap seed template (not executed here; no wrangler d1 execute).
--
-- Semantics (matches README / SDD 03):
--   1. Exactly one human with is_operator = 1 (the instance operator).
--   2. One rooms row; created_by is that operator member id.
--   3. One room_members row: operator, role='owner', attention_mode='mention'.
--   4. A second human member with is_operator = 0 who is NOT in room_members.
--      Owner later joins them with POST /api/rooms/:id/members (M1).
--   5. No agent rows. No bot tokens. No API keys. No real passwords.
--
-- Produce a real password_hash on the operator machine (do not commit it):
--   node cmd/kithctl.mjs hash-password
--     WebCrypto PBKDF2-SHA-256, iterations=100000, salt 16 bytes, dk 32 bytes,
--     format pbkdf2-sha256$100000$<salt_b64url>$<dk_b64url>
--
-- Prefer generating this file's INSERT statements instead of editing hashes by hand:
--   node cmd/kithctl.mjs bootstrap \
--     --operator-id ID --operator-handle HANDLE --operator-hash HASH \
--     --room-id ID --room-slug SLUG --room-name NAME \
--     --second-id ID --second-handle HANDLE --second-hash HASH
--
-- CHANGE_ME_OPERATOR_HASH and CHANGE_ME_SECOND_HASH are placeholders, not PBKDF2
-- of any known password (including "password"). Replace before applying to D1.

INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
VALUES (
  'operator',
  'human',
  'owner',
  'owner',
  'CHANGE_ME_OPERATOR_HASH',
  '[]',
  'api_key',
  1, -- is_operator = 1
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO members (id, kind, handle, display_name, password_hash, capabilities_json, quota_class, is_operator, created_at)
VALUES (
  'second',
  'human',
  'guest',
  'guest',
  'CHANGE_ME_SECOND_HASH',
  '[]',
  'api_key',
  0, -- is_operator = 0
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO rooms (id, slug, name, created_by, created_at)
VALUES (
  'room-1',
  'lobby',
  'Lobby',
  'operator',
  '1970-01-01T00:00:00.000Z'
);

INSERT INTO room_members (room_id, member_id, role, attention_mode, keywords_json, cooldown_ms, debounce_ms, classifier, policy_epoch)
VALUES (
  'room-1',
  'operator',
  'owner',
  'mention',
  '[]',
  15000,
  2000,
  'heuristic',
  1
);
