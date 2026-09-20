# 03 — 資料模型

[回主 SDD](../../SDD.md) · Requirements: FR-01, FR-02, FR-10 · Milestones: M0, M1, M2

**單一權威：** D1 `messages` 是耐久 log（INV-01）。Room DO SQLite 只 cache `next_seq`、presence、`ambient_lock`、wake-budget 視窗、尚未 notify 成功的極短 outbox、ephemeral status map。KV 存 session。R2 存 trace 全文與未來附件。

v1 遷移（M1）就包含 agent enum、attention 全集合、`quota_class`、以及 `messages.kind IN ('message','trace')`。M1 零 agent 列；M2 只 INSERT + `bot_tokens` 表，不 rebuild CHECK。**status 不進 messages。** 沒有從 EdgeChat 或 bee-swarm 匯入資料的路徑。

SQLite **禁止 CHECK 內 subquery**。INV-02 用 trigger + Worker 雙重強制。

---

## 1. DDL（v1）

M0 將下列 SQL 收成可測 fixture（正反例）。M1 以 D1 migration 執行。本 pass 不建立 `scripts/`。

```sql
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
```

### v1 enum 決策

| 欄位 | v1 已包含 | 註記 |
| --- | --- | --- |
| `members.kind` | `'human','agent'` | M1 零 agent 列，但仍建此 CHECK，避免 M2 rebuild |
| `room_members.attention_mode` | `'silent','mention','keyword','ambient'` | M6 前程式路徑不 dispatch ambient |
| `members.quota_class` | `'api_key','operator_personal'` | 預設 `api_key` |
| `messages.kind` | `'message','trace'` | **沒有 `status`**。違反者 INSERT 失敗 |
| `messages.origin` | `'local'` | 核心版唯一值 |
| `generations.state` | 見上 | M4 起使用 |

`quota_class` 的權威在 `members`。Notify envelope 的 `quota_class` 從 `members` 填入，不是 per-room 覆寫。`classifier` 僅 ambient 使用（MVP `heuristic`）；M6 前可存在但不被 alarm 讀取。

`kind` 與 `is_operator` 一經插入即不可改成讓 INV 崩潰的值。Worker 拒絕 `UPDATE members SET kind=...`。不靠 CHECK subquery 防「human owner 被改成 agent」。

---

## 2. 補充規則

### members

- `handle`：`[a-z0-9_]{2,32}`，房間內 `@handle`，NOCASE unique。
- 恰好一列 `is_operator=1`（partial unique index）。Bootstrap 寫死 `operator_member_id`。
- Human：`password_hash` 為 PBKDF2-SHA-256；`iterations ≥ 100_000`。Agent：`password_hash` 必須 NULL。
- Agent `quota_class`：hosted Grok 預設 `api_key`；Codex sidecar 若宣告 device-login 則強制 `operator_personal`。API-key Codex 須在 sidecar.toml **顯式**寫出 `api_key`。

### room_members

- 每房成員總數 ≤ 32；第 33 個 INSERT 前 Worker 回 409 `room_full`。D1 無 cheap 跨列 COUNT CHECK，故 cap 在 Worker + 測試 M1-MEM-01。
- 不可移除最後一個 owner。
- `PATCH attention` 時 `policy_epoch = policy_epoch + 1`。Inbox 丟棄較舊 epoch 的 pending ambient，不中斷已 dispatch 的 mention。
- 人類 membership 的 `attention_mode` 核心版忽略（M1–M6 只 notify `kind=agent`）。

### messages

- `seq` INTEGER NOT NULL，每房 UNIQUE。從 0 開始。
- `body` 應用層 ≤ 8 KiB UTF-8；超過不 INSERT。
- `client_message_id` 與 EdgeChat `UNIQUE(channel_id, sender_id, client_message_id)` 同一精神。重送回同一 `id/seq`。
- `mentions_json` 為 member id 陣列（tokenizer 產物），不是 handle 字串。
- `generation_id` 可為 NULL（人類發言）。Agent 回覆 mention/ambient 時必須帶。

### bot_tokens

- 明文 `kith_bot_` + 32 bytes random，只在建立時回傳。
- `token_hash` = SHA-256(utf8(token)) hex。比對時對 Bearer 做同一 hash。
- `revoked_at` 非 NULL 即 401。`expires_at` 過期同 401。
- `room_scope_json` 空陣列 = 該 agent 已加入的所有房，仍受 `room_members` 限制。

### generations

- 建立於 Inbox dispatch。HostedGeneration DO 名 `gen:{id}`。
- 狀態機：`queued → dispatched → streaming → completed`，或 `dropped` / `failed`。不可從 `completed` 回到 `streaming`。
- Room send 綁定見 INV-06。

---

## 3. 非 D1 狀態

| 儲存 | 鍵 | 值 | TTL / 生命週期 |
| --- | --- | --- | --- |
| KV | `session:{id}` | `{ member_id, expires_at }` | 7 天；login 後換 session id |
| R2 | `traces/{room_id}/{message_id}` | 完整 tool payload | 隨 trace GC |
| Room DO | `next_seq` | integer cache | 重啟以 D1 MAX 覆蓋 |
| Room DO | `ambient_lock` | `{ generation_id, agent_id, expires_at }` | 120 s |
| Room DO | wake-budget 視窗 | 滑動 60 s 成功 dispatch 計數 | 每分鐘重置語意 |
| Room DO | ephemeral status map | `{ member_id, body, expires_at }` | 60–120 s；不寫 D1 |
| Room DO | hibernated WS | attachments | 平台 hibernation |
| Room DO | notify outbox | 尚未成功的 Inbox RPC | 極短；重啟 replay 或 gap-fill |
| Inbox DO | pending ambient | envelope + deadline + policy_epoch | 被新 epoch 丟棄 |
| Inbox DO | live ring buffer | ≤ 128 已 persist seq | 溢出 → SSE `gap` |
| HostedGeneration DO | in-flight LLM | 部分 token | 完成後可銷毀 |

---

## 4. D1 recovery 演算法

Room DO 單執行緒。M0 golden：四個切點各一條測試（ST-D1-01–04）。

```
on send (Room DO, single-threaded):
  stored = DO.get("next_seq") ?? 0
  seq = max(stored, D1 SELECT COALESCE(MAX(seq),-1)+1 WHERE room_id=?)
  INSERT D1 messages (... seq ...)     -- constraint/error => fail closed, do not broadcast
  DO.put("next_seq", seq+1)
  broadcast the persisted row
  enqueue outbox notifies for agent members only; flush in chunks of 6 DO RPC
  waitUntil(flush remaining chunks)    -- notify only, never LLM

on DO restart / alarm:
  next_seq = D1 SELECT COALESCE(MAX(seq),-1)+1  -- D1 wins
  replay unflushed outbox if any; else agents gap-fill via after_seq

on client (WS / MCP events):
  if received seq != last+1: GET /api/rooms/:id/messages?after_seq=last
```

`COALESCE(MAX(seq),-1)+1` 在空房得到 0。GC 刪列後 MAX 仍是歷史最大值，故不重用 seq。

| 故障 | 結果 | 測試 |
| --- | --- | --- |
| D1 INSERT 成功、DO 在 persist `next_seq` 或 broadcast 前 crash | 重啟後 `next_seq = MAX(seq)+1`；WS 以 `after_seq` 補洞；不重用已插入 seq | ST-D1-01 |
| D1 timeout（unknown） | 不 broadcast；retry 用同一 `client_message_id`；UNIQUE 命中則回原列，不配新 seq | ST-D1-02 |
| Broadcast 到但 D1 未見 | **不允許**：broadcast 只在 INSERT 成功之後 | ST-D1-03 |
| GC 刪 `trace` | seq 可出現洞；recovery **永遠**用 `MAX(seq)`，不用 COUNT | ST-D1-04 |

Idempotency：`UNIQUE (room_id, sender_id, client_message_id)`。衝突時 SELECT 原列回傳，HTTP 200／WS `event` 帶原 seq，不是 409。

---

## 5. Bootstrap seed 語意（不執行）

見 [README bootstrap](../../README.md)。最小列：

1. `members`：operator human，`is_operator=1`，`password_hash` 來自未來 `kithctl hash-password`。
2. `rooms`：第一個房間，`created_by` = operator id。
3. `room_members`：`(room_id, operator_id, role='owner', attention_mode='mention')`。

禁止 seed 裡放真實密碼、API key、bot token 明文。本 pass 不執行 `wrangler d1 execute`。

---

## 6. GC

預設每房保留 30 天或 50,000 則 `kind=message|trace`，先到先 GC。屬 M7。`status` 早已不在 D1，不靠 GC 清 typing。刪 `trace` 造成 seq 洞合法。**永不**重用 seq。不刪 `kind=message` 除非另立 ADR。

---

## 7. 遷移策略

只追加。破壞性變更先雙寫再切。Rollback = `wrangler rollback` 到上一 Worker version，**不**自動 DROP 欄。M2 追加 `bot_tokens`（若 v1 已含該表則 M2 只 INSERT 列）。沒有 EdgeChat schema 相容層。
