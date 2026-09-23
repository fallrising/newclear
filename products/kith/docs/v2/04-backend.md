# 04 — 後端：相容矩陣與擴充

[回 v2 索引](README.md) · 既有契約：v1 [04 協定](../sdd/04-protocol.md)、[03 資料模型](../sdd/03-data-model.md)

## 1. 原則

- **只做加法。** 既有端點、欄位、錯誤碼、WS 封包的語意不變。新前端與舊前端在 W7 切換前必須能同時對同一個後端運作。
- 新端點沿用 v1 慣例：JSON strict（unknown field → 400 `invalid_request`）、錯誤 envelope `{ "error": { "code", "message" } }`、CSRF、session／bot token。
- 新的 persisted 格式先寫 migration 與 ADR（v1 SDD §12）。
- Room DO 仍然不呼叫 LLM、不跑分類器（INV-08）。

## 2. 既有 API 與 v2 前端的使用

| 端點 | v1 前端 | v2 前端 | v2 變動 |
| --- | --- | --- | --- |
| `GET /api/csrf`、`POST /api/auth/login`、`/logout` | 用 | 用 | 無 |
| `GET /api/me` | 用 | 用 | B-08 加欄位 |
| `GET /api/rooms` | 用 | 用 | B-02 加摘要欄位 |
| `POST /api/rooms` | 用 | 用 | 無 |
| `GET /api/rooms/:id/messages` | 用（有缺陷） | 用 | B-01、B-05 加參數 |
| `POST /api/rooms/:id/messages` | 未用 | 備援送出 | 無 |
| `GET/POST /api/rooms/:id/members` | 用 | 用 | B-04 相關 |
| `DELETE /api/rooms/:id/members/:mid` | 未用 | 用（控制台） | 無 |
| `PATCH …/members/:mid/attention` | 未用 | 用（控制台） | 無 |
| `GET /api/rooms/:id/ws` | 用 | 用 | B-10、B-11 加封包 |
| `POST /api/agents`、`/tokens` 系列 | 未用 | 用（控制台） | B-03、B-09 |
| `GET /api/metrics` | 未用 | 選用（控制台） | 無 |
| `POST /mcp`、`GET /mcp/events` | — | — | B-12 加選填欄位 |

## 3. 擴充項 B-xx

每項標出：目的、契約輪廓、相容性、里程碑。完整 JSON Schema 在 Phase 2 寫進 `contracts/v2/`。

### B-01 最新一頁與往前翻頁（W1，必做）

- 目的：修 [00](00-overview.md) §2 的長房間缺陷。
- 契約：`GET /api/rooms/:id/messages?before_seq=N&limit=L&order=desc`。
  - 新參數 `order ∈ {asc, desc}`，預設 `asc`（相容）。
  - `order=desc` 時 SQL 為 `ORDER BY seq DESC LIMIT ?`；**回應陣列仍依 seq 升冪排列**（伺服器反轉），前端不用處理兩種方向。
  - 不帶 `before_seq` 且 `order=desc` → 最新 L 則。
  - 回應加 `has_more: bool`（該方向是否還有更早的列）。舊 client 忽略未知欄位。
- 相容：不帶 `order` 時行為與 v1 位元級相同。
- 驗收：`E2E-W1-04`。
- Phase 2：契約 [`contracts/v2/http-messages-list.json`](../../contracts/v2/http-messages-list.json)；`order=asc` 時 `has_more` 表示還有更新的列；實作逐字寫在 [W1](milestones/W1.md) §4.1，已對 1,200 則房間實測。

### B-02 房間摘要（W2）

- Phase 2：契約 [`contracts/v2/http-rooms.json`](../../contracts/v2/http-rooms.json)；實作與實測見 [W2](milestones/W2.md) §4.2.4。`last_message` 另含 `sender_display_name`、`sender_handle`（非 operator 無法查成員目錄，列表預覽需要名字）；新增 `?all=1`（operator 列出所有房間，控制台用）。

- `GET /api/rooms` 每房加：`last_seq`（int 或 null）、`last_message`（`{seq, sender_id, body_preview ≤ 140 字, created_at}` 或 null，只取 `kind=message`）、`member_count`、`archived_at`。
- 實作提示：每房一次 `MAX(seq)` 與最後一列查詢；房間 ≤ 64，可接受。Phase 2 評估是否以 D1 單一查詢完成。

### B-03 agent 清單與詳情（W4）

- `GET /api/agents`（operator）：`[{id, handle, display_name, runtime, quota_class, created_at, disabled_at, rooms: [room_id], token_count, runtime_status}]`。
- `GET /api/agents/:id`、`PATCH /api/agents/:id`（改 display_name、disabled）。
- `runtime_status`：`ok`、`unconfigured`、`connection_error`、`runner_offline`、`disabled`；前端用它畫成員格的限制句，取代 v1 `reply_limit` 的推斷（`reply_limit` 保留給舊前端）。

### B-04 成員目錄（W2）

- Phase 2：契約 [`contracts/v2/http-members.json`](../../contracts/v2/http-members.json)；另加 `PATCH /api/members/:id`（改顯示名、停用）；密碼 12–128 字；新帳號 `must_change_password=1`（Q-03）。見 [W2](milestones/W2.md) §4.2.5。

- `GET /api/members?q=`（operator）：實例內所有未停用成員，`q` 以 handle／display_name 前綴比對，最多 20 筆。給邀請表單補全用。
- `POST /api/members`（operator）：建立人類帳號 `{handle, display_name, password}`（BR-02）。回應不含密碼。
- `POST /api/members/:id/password`（operator 重設，或本人改自己的；本人需帶舊密碼）。

### B-05 thread 篩選（W6）

- `GET /api/rooms/:id/messages?thread_id=X`：只回該 thread 的列（含根訊息）。
- 主時間線查詢加 `top_level=1`：只回 `thread_id IS NULL` 的列，並為每則根訊息附 `thread_reply_count`、`thread_last_seq`。
- **seq 補洞規則不變**：前端補洞仍以全房 seq 為準（含 thread 內的列），只是顯示時分流。詳見 [05](05-frontend-architecture.md) FE-12。

### B-06 使用者事件流（W5，選做）

- `GET /api/me/events`（SSE 或 WS）：房間層級的輕量事件 `{type: "room_activity", room_id, last_seq}`、`{type: "membership", room_id, change}`。
- 目的：未讀數即時、被邀請後不用重新整理。
- 實作提示：一個 per-member 的 DO 或在 Room 廣播時對成員的 user channel 發一個小封包。Phase 2 評估成本；W2 先以「視窗聚焦時重抓 `GET /api/rooms`＋每 60 s 輪詢」代替。

### B-07 provider 連線 CRUD（W4）

- `GET/POST /api/providers`、`GET/PATCH/DELETE /api/providers/:id`（operator）。
- 欄位：`name`、`preset`、`api_format`、`base_url`、`secret`（只寫）或 `secret_env`、`extra_headers`、`default_quota_class`。
- `POST /api/providers/:id/test`：用該連線做一次最小呼叫（列模型；不支援列模型則送 1 token 的 completion），回 `{ok, models?, error_class?}`。不回上游原文。
- `DELETE` 時若有 agent 引用 → 409 `in_use`，除非帶 `?force=1`（引用的 agent 變 `unconfigured`）。

### B-08 自己的資料（W2）

- Phase 2：契約 [`contracts/v2/http-me.json`](../../contracts/v2/http-me.json)；`GET /api/me` 另回 `must_change_password`、`operator_display_name`。見 [W2](milestones/W2.md) §4.2.3。

- `GET /api/me` 加 `display_name`、`handle`、`kind`（v1 已回，前端未用）。
- `PATCH /api/me`：改 `display_name`。

### B-09 agent runtime 設定（W4）

- `PUT /api/agents/:id/runtime`（operator）。可以改變 runtime 種類（RT-01）；body 必含 `runtime` 與 `quota_class`，其餘依 runtime：
  - `hosted`：`{connection_id, model, system_prompt_addendum?, max_output_tokens?, temperature?, stream?}`
  - `runner`：`{adapter_kind}`（其餘設定在 runner 主機的 toml，伺服器只記錄種類以便顯示）
  - `external`：`{}`
  - 選填 `revoke_tokens: bool`（預設 false；前端在 runner／external → hosted 時預設送 true）。
  - 回應含新的 `runtime_epoch`。
- `GET /api/agents/:id/generations?limit=`：最近 generation 的狀態、`error_class`、耗時、usage（W5）。

### B-10 WS `draft` 封包（W5）

Server → client：

```json
{ "v": 1, "type": "draft", "member_id": "...", "generation_id": "...", "text": "目前累積的全文", "done": false }
```

- 全文覆蓋（不是增量），client 不需要處理順序拼接；同一 `generation_id` 以最後收到的為準。
- 正式 `event` 到達（同 `generation_id`）或收到 `reply ended`／`reply failed` 時，client 丟棄草稿。
- 不寫 D1、不佔 seq、不進 `/mcp/events`、不喚醒（V2-INV-03）。
- 大小：`text` ≤ 8 KiB；超過時停止發草稿，等最終訊息。

### B-11 WS 失敗狀態（W3）

- 沿用 v1 `type=status`。新增 body 值 `reply failed`，並加選填欄位 `error_class`（只對 operator 的連線附上；其他人只有 body）。
- 前端規則：`reply failed` 清掉該成員的回覆中狀態，顯示一行失敗提示 8 s（BR-45）。

### B-12 `/mcp/events` 喚醒提示（W6）

- live 事件（`replay:false`）加選填 `wake: {mentioned, wake_allowed}`；`replay:true` 不帶。
- `wake_allowed` 以與 Inbox 相同的純函式計算（attention＋quota＋self／agent 規則），但**不**計入 cooldown 與 wake budget（那是 hosted／runner 的 dispatch 狀態）。

### B-13 trace 全文（W6）

- `GET /api/rooms/:id/traces/:message_id`：從 R2 取完整 payload（≤ 1 MiB），只有房內成員可讀。前端 trace 卡片展開時才抓。

### B-14 房間管理（W2）

- Phase 2：檢查放在 Room DO `persistSend` 的查重之後，WS、REST、MCP 三條路徑一次涵蓋；錯誤碼加入 [`contracts/v2/http-error.json`](../../contracts/v2/http-error.json)。見 [W2](milestones/W2.md) §4.2.6。

- `PATCH /api/rooms/:id`（operator）：`{name?, archived?: bool}`。
- 封存房（BR-14）：send 路徑（WS、REST、MCP）回 409 `room_archived`；Inbox 不 dispatch；`/mcp/events` 只允許 catch-up。新錯誤碼 `room_archived` 加入錯誤碼表。

## 4. 資料模型增量（DDL 輪廓）

只追加。Phase 2 改為每個里程碑各自一個 migration：`0002_v2_rooms_members.sql`（W2：`rooms.archived_at`、`members.must_change_password`，[W2](milestones/W2.md) §4.1），provider 與 runtime 相關表在 W4 的 `0003`。

```sql
CREATE TABLE provider_connections (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  preset TEXT NOT NULL,
  api_format TEXT NOT NULL CHECK (api_format IN
    ('openai_chat','openai_responses','anthropic_messages','gemini','fake')),
  base_url TEXT NOT NULL,
  secret_source TEXT NOT NULL CHECK (secret_source IN ('stored','env','none')),
  secret_ciphertext TEXT,          -- stored 時必填；AES-GCM {iv,ct} base64url
  secret_env TEXT,                 -- env 時必填；Worker secret 名稱
  secret_last4 TEXT,
  extra_headers_json TEXT NOT NULL DEFAULT '{}',
  default_quota_class TEXT NOT NULL DEFAULT 'api_key'
    CHECK (default_quota_class IN ('api_key','operator_personal')),
  last_error_class TEXT,
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  disabled_at TEXT
);

CREATE TABLE agent_runtimes (
  agent_id TEXT PRIMARY KEY REFERENCES members(id),
  runtime TEXT NOT NULL CHECK (runtime IN ('hosted','runner','external')),
  connection_id TEXT REFERENCES provider_connections(id),   -- hosted 必填
  model TEXT,                                               -- hosted 必填
  params_json TEXT NOT NULL DEFAULT '{}',                   -- max_output_tokens, temperature, stream
  system_prompt_addendum TEXT NOT NULL DEFAULT '',
  adapter_kind TEXT,                                        -- runner 顯示用
  runtime_epoch INTEGER NOT NULL DEFAULT 1,                 -- RT-01：每次改 runtime +1
  runner_last_seen_at TEXT,                                 -- 事件流最近連線時間
  updated_at TEXT NOT NULL
);

ALTER TABLE generations ADD COLUMN error_class TEXT;
ALTER TABLE generations ADD COLUMN input_tokens INTEGER;
ALTER TABLE generations ADD COLUMN output_tokens INTEGER;
ALTER TABLE generations ADD COLUMN connection_id TEXT;
ALTER TABLE generations ADD COLUMN model TEXT;

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

ALTER TABLE generations ADD COLUMN runtime_epoch INTEGER;

-- B-14 / BR-14
ALTER TABLE rooms ADD COLUMN archived_at TEXT;
```

注意：`generations.state` 的 CHECK 已含 `failed`，不需 rebuild。`members.quota_class` 仍是權威；建 agent 時由連線的 `default_quota_class` 帶入預設值。

## 5. 不變量增補

| ID | 陳述 | 驗收 |
| --- | --- | --- |
| V2-INV-01 | provider 憑證不出現在任何回應、封包、log、trace、metrics、錯誤訊息（RT-09） | E2E-W4-05：掃描 API 回應、WS 封包與 wrangler log，找不到 canary key |
| V2-INV-02 | HostedGeneration 只透過 `LlmAdapter` 呼叫上游；adapter 只打該連線的 base URL（取代 v1 的 xAI 白名單） | adapter FM fixtures＋E2E-W4-03 |
| V2-INV-03 | `draft` 不寫 D1、不佔 seq、不進 `/mcp/events`、不喚醒 | E2E-W5-02：串流前後 D1 列數差恰為 1 |
| V2-INV-04 | 所有 v1 端點在不帶新參數時，回應與 v1 相同（只可能多出新欄位） | E2E-W1-01：舊前端 smoke 仍通過 |
| V2-INV-06 | runtime 改動後，任何帶舊 `runtime_epoch` 的 generation 都不能落盤（RT-01） | E2E-W4-08 |
| V2-INV-07 | 封存房不接受任何 send，也不喚醒 agent（BR-14） | E2E-W2-05 |
| V2-INV-05 | runtime 設定錯誤（無連線、連線停用、模型不存在）時，mention 落盤但不喚醒；不產生 generation 列 | E2E-W4-06 |

v1 的 INV-01–INV-19 全部保留。INV-15（LLM fetch 只在 HostedGeneration DO）不變；v1 協定 §7「允許清單只有官方 xAI」由 V2-INV-02 取代（見 [10](10-decisions.md) 修訂表）。

## 6. Feature flags

沿用 v1 四個 flag，新增：

| Flag | 預設 | 用途 |
| --- | --- | --- |
| `ff_providers` | off | B-07、B-09 與多格式 adapter。off 時 hosted 走 v1 路徑 |
| `ff_drafts` | off | B-10 串流草稿 |
| `ff_user_events` | off | B-06 |
| `KITH_DEV_ALLOW_HTTP_PROVIDERS` | off | 本機／E2E 允許 `http://127.0.0.1` 的 fake provider（RT-10） |

## 7. Phase 2 待細化

- [ ] 每個 B-xx 的完整 request／response JSON Schema（`contracts/v2/*.json`）、錯誤碼表、權限表。
- [ ] `migrations/0002_v2.sql` 完整 DDL、正反例、遷移腳本步驟（[03](03-agent-runtime.md) §7）。
- [ ] B-02 的 SQL 與效能估算（64 房）。
- [ ] B-06 的實作選擇（per-member DO vs 其他）與成本。
- [ ] 每個 B-xx 在 Worker 中的檔案位置（例如 `worker/routes/providers.ts`）。
