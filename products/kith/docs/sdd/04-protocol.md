# 04 — 協定

[回主 SDD](../../SDD.md) · Requirements: FR-01, FR-03, FR-04, FR-05 · Milestones: M0, M1, M3

kith 是新 component，無舊 API。完整 JSON Schema 屬 M0 `contracts/`。unknown field 拒絕（strict JSON）。錯誤 envelope：

```json
{ "error": { "code": "subscription_operator_only", "message": "..." } }
```

`code` 是穩定機器值；`message` 給人看，不含 token／密碼／房間全文。

---

## 1. HTTP（人類瀏覽器）

Auth：`session` = HttpOnly cookie。`owner` = session 且 `members.is_operator=1`（實例級 operator；建房／建 agent／簽發 token 亦要求 operator，不僅房內 `role=owner`）。`member` = 該房 `room_members` 列存在且未 disabled。

| Method | Path | Auth | 說明 |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | CSRF cookie | body `{ "username" 或 "handle", "password" }`；成功換 session id |
| POST | `/api/auth/logout` | session | 撤銷 KV session |
| GET | `/api/me` | session | 自己的 member（不含 password_hash） |
| GET | `/api/rooms` | session | 加入的房間 |
| POST | `/api/rooms` | owner | 建房 `{ "slug", "name" }` |
| GET | `/api/rooms/:id/messages?after_seq&before_seq&limit` | member | 歷史；預設 `kind=message`；`after_seq` 供 WS 補洞；`limit` 預設 50、上限 50 |
| POST | `/api/rooms/:id/messages` | member | REST 備援 send（與 WS 同一 Room 路徑） |
| GET | `/api/rooms/:id/members` | member | 本房成員、kind、attention、quota_class、operator-only badge |
| POST | `/api/rooms/:id/members` | **owner** | 加入既有成員。Body 恰好帶 `member_id` 或 `handle` 其中一個，可加 `role`（預設 `member`）。`member_id` 路徑含 human 與 agent。`handle` 只解析未停用的 `kind=human`（`COLLATE NOCASE`）。找不到、或帳號已停用 → 404 `not_found`。兩個識別都有、或都沒有 → 400 `invalid_request`。滿 32 人 → 409 `room_full` |
| DELETE | `/api/rooms/:id/members/:mid` | owner | 移出；不可移除最後一個 owner |
| GET | `/api/rooms/:id/ws` | session → DO | WebSocket upgrade |
| POST | `/api/agents` | owner | 建 agent 成員（body 含 `quota_class`，hosted 預設 `api_key`） |
| POST | `/api/agents/:id/tokens` | owner | 簽發 bot token（明文只此一次） |
| DELETE | `/api/agents/:id/tokens/:tid` | owner | 撤銷 |
| PATCH | `/api/rooms/:id/members/:mid/attention` | owner | 改 mode／keywords／cooldown／debounce；`policy_epoch++` |

`GET /api/rooms/:id/messages` 可顯式 `?kind=trace` 或 `?kind=message,trace`。無 `kind=status`。

REST send body：

```json
{
  "body": "hello @grok",
  "client_message_id": "01J...",
  "thread_id": null,
  "generation_id": null
}
```

`body` minLength 1、maxLength 8192。`client_message_id` minLength 8、maxLength 64。成功回已落盤列（含 `seq`）。重複 `client_message_id` 回原列。

### 錯誤碼

| HTTP | code | 何時 |
| --- | --- | --- |
| 400 | `invalid_request` | 缺欄、型別錯、unknown field |
| 400 | `payload_too_large` | body > 8 KiB 或 status > 512 |
| 401 | `unauthorized` | 無／過期 session 或 bot token |
| 401 | `token_revoked` | 撤銷或過期 bot token |
| 403 | `forbidden` | 非成員、agent 呼叫 admin、非 operator 建房 |
| 403 | `subscription_operator_only` | 非 operator 試圖喚醒 `operator_personal`（hosted 路徑；sidecar 見本地 metric） |
| 404 | `not_found` | 無此 room／member／token |
| 409 | `room_full` | 第 33 個成員 |
| 409 | `generation_dropped` | generation 過期／agent_id 不符／非 in-flight |
| 409 | `already_member` | 重複加入 |
| 409 | `last_owner` | 刪最後一個 owner |
| 409 | `handle_taken` | handle NOCASE 衝突 |
| 413 | `payload_too_large` | 與 400 同義可擇一；M0 schema 鎖定 400 |
| 429 | `wake_budget_exhausted` | 該房本分鐘 wake 用盡（ambient/keyword hosted 視為 silent） |
| 503 | `not_ready` | flag 關閉（如 `ff_mcp=off`）或 DO 未就緒 |

CSRF：unsafe methods 需 CSRF token（cookie + header 配對）。login 後輪換 session id。

---

## 2. WebSocket

路徑 `GET /api/rooms/:id/ws`。Worker 先驗證 session，再把內部 principal header 轉到 Room DO。每個 inbound 與 outbound 再驗證 membership。無內部 header 的外部請求 401。Internal origin 固定，不從使用者 URL 取 host。

Client → server 只接受：

```json
{ "v": 1, "type": "send", "client_message_id": "01J...", "body": "hello @grok", "thread_id": null }
{ "v": 1, "type": "ack", "seq": 42 }
{ "v": 1, "type": "status", "body": "typing" }
```

- `send`：與 REST 同一 Room 路徑；成功後 server 推 `event`。
- `ack`：客戶端確認已收到 seq；核心版可用於流量控制，不作已讀回執產品功能。
- `status`：typing 等；**不進 D1**、不佔 seq、不喚醒。body ≤ 512 bytes。

Server → client：

```json
{ "v": 1, "type": "event", "event": { "seq": 42, "kind": "message", "body": "hello @grok" } }
{ "v": 1, "type": "status", "member_id": "...", "body": "typing" }
{ "v": 1, "type": "error", "code": "payload_too_large" }
```

`type=event` 有 seq；`type=status` 無 seq。核心版無刪除／編輯。Client 見 seq 缺口則 `GET .../messages?after_seq`。單則 WS JSON ≤ 8 KiB。每房同時 WS ≤ 32。

Hibernation：平台支援；重連後 client 用 `after_seq` 補洞，不假設 in-memory 未送出的 status 還在。

---

## 3. MCP 2025-03-26 Streamable HTTP

路徑：`POST /mcp`。協定鎖定 **MCP 2025-03-26 Streamable HTTP**（M3 必支援）。**2026-07-28 `subscriptions/listen` 是 M3 之後的相容 milestone**，等 Codex CLI pin 再做，不阻擋 M3。

Auth：`Authorization: Bearer` bot token → agent member。每個 MCP session 綁定該 member；工具只能看到該 member 加入的房間。

**沒有 `subscribe_events` tool。** 契約 `contracts/mcp-tools-v1.json` 不得出現該名。呼叫 → `method-not-found`（MCP-02）。

互動 tool 必須在單一 POST 內結束（INV-16）。

| Tool | 副作用 | 說明 |
| --- | --- | --- |
| `list_rooms` | 否 | 回傳 id、name、role、attention |
| `read_history` | 否 | `room_id`、`before_seq` / `after_seq`、`limit≤50`；預設 `kind=message` |
| `send_message` | 是 | `room_id`、`body`、`thread_id?`、`client_message_id`、`generation_id?` |
| `post_status` | 是（ephemeral，不寫 D1） | `accepted\|running\|blocked\|idle`；TTL |

### `send_message` inputSchema（M0 鎖定）

```json
{
  "name": "send_message",
  "description": "Post a visible message as this agent member. Requires client_message_id for idempotency.",
  "inputSchema": {
    "type": "object",
    "additionalProperties": false,
    "required": ["room_id", "body", "client_message_id"],
    "properties": {
      "room_id": { "type": "string", "minLength": 1, "maxLength": 64 },
      "body": { "type": "string", "minLength": 1, "maxLength": 8192 },
      "thread_id": { "type": ["string", "null"] },
      "client_message_id": { "type": "string", "minLength": 8, "maxLength": 64 },
      "generation_id": { "type": ["string", "null"] }
    }
  }
}
```

### 其餘 tool 摘要（完整 schema 在 M0 contracts）

`list_rooms`：無 required；additionalProperties false。回傳該 token 可見房間。

`read_history`：required `room_id`；`before_seq` / `after_seq` 可選 integer；`limit` 預設 50 上限 50；`kind` 預設 `"message"`。結果每頁 ≤ 50 則或 64 KiB，先到先截。MCP tool 結果總上限 256 KiB。

`post_status`：required `room_id`、`state`（enum `accepted|running|blocked|idle`）；可選 `body` ≤ 512、`thread_id`、`generation_id`。不寫 D1。

**不做** EdgeChat WebMCP 的 `login(username,password)`。Headless agent 只用 bot token。

### MCP resource

`kith://rooms/{room_id}/events`：2025-03-26 client 以 `resources/subscribe` + GET SSE。與下行 **同一 splice 演算法**；`Last-Event-ID` 等價 `after_seq`。

---

## 4. GET `/mcp/events` splice（INV-19）

`GET /mcp/events?room_id&after_seq`
Auth：Bearer bot token。`Accept: text/event-stream`。
**sidecar 必用**。dumb log tail：已 persist 的 `kind=message|trace`，**無** quota／attention 過濾。

Inbox 不存全 log。Catch-up 在 Hono 讀 D1；live tail 接到 **該 membership** Inbox。Inbox **禁止**為了 catch-up 而 replay D1。

```
GET /mcp/events?room_id&after_seq=N   (member-scoped)
  1. Auth bot token；agent 不在該房 → 403
  2. Catch-up（replay）:
     Cursor = N
     loop:
       rows = D1 SELECT * FROM messages
              WHERE room_id=? AND seq > Cursor AND kind IN ('message','trace')
              ORDER BY seq LIMIT 50
       if rows empty: break
       for each row:
         SSE event: replay, id: <seq>
         data: { ..., "replay": true }     // data ≤ 64 KiB
       Cursor = last seq sent
     （Last-Event-ID 若出現且與 after_seq 衝突：取較大者）
  3. Live tail:
     訂閱 Inbox `inbox:{room_id}:{member_id}` 的環形緩衝（≤ 128 則已 persist seq）。
     推送時 skip seq ≤ Cursor；SSE event: room, data: { ..., "replay": false }
     Cursor = seq
  4. 若 live 的最小 seq > Cursor+1：
     SSE comment: gap → 結束 stream；client 用 after_seq=Cursor 重新 GET
     （新 GET 的 catch-up 仍是 replay:true，不得 exec）
```

**`replay: true` 不是工作佇列。** Sidecar／任何 exec 端 **MUST NOT** 對 `replay: true` 啟動 CLI、HostedGeneration、或 `post_status(accepted)`。只推進 cursor、可選填 context。`after_seq=0` 是歷史 dump（最多保留上限則），**禁止**當第一次啟動參數。

可選 `hint: "mention_self"` 只是糖；**replay 上必須忽略 hint 的 exec 含義**。

Golden：**EV-01**（splice 步驟）、**EV-02**（10 則舊 `@codex` + 1 live → fake CLI 一次；`after_seq=0` dump CLI 仍 0）。

每房同時 MCP 事件流 ≤ 16。

### Sidecar cursor 政策

| 情況 | after_seq | 行為 |
| --- | --- | --- |
| 第一次啟動（無持久 cursor） | `MAX(seq)`（啟動時 D1 查一次） | 幾乎只有 live；歷史 @ 不 exec |
| 重連（有持久 `last_live_seq`） | 該 cursor | catch-up 為 replay（不 exec）；其後 live 可 exec |
| 明確歷史讀取 | `read_history` tool | 不是 `/mcp/events` |

可選 `startup_replay_s`（預設 **0**）：僅第一次啟動改為 `after_seq = MAX(seq) 對應時間往前 N 秒`，該段仍標 `replay: true`，**預設仍不 exec**。短斷線要補跑必須由 operator 在房間再 @，或另立 ADR。核心版不做「replay 且 age < window 當 live」。

---

## 5. 冪等

| 操作 | 鍵 | 行為 |
| --- | --- | --- |
| send（WS / REST / MCP `send_message`） | `(room_id, sender_id, client_message_id)` | UNIQUE 命中回原列，不配新 seq |
| D1 unknown timeout 後 retry | 同一 `client_message_id` | ST-D1-02 |
| OpenProducer 式 token 簽發 | 不冪等；每次新 token | 舊 token 仍有效直到撤銷 |
| `post_status` | 無 D1 鍵；最後一則覆蓋該 member 的 ephemeral 槽 | 不佔 seq |
| login | 每次新 session id | 舊 cookie 失效 |

Client 在 unknown 結果後必須重送**同一** `client_message_id`，不得換新 id 來「再試一次」。

---

## 6. `quota_class`

屬 `members.quota_class`，出現在 notify envelope 與 `GET .../members`。

| 值 | 誰可喚醒 | Hosted 檢查點 | Sidecar 檢查點 |
| --- | --- | --- | --- |
| `api_key` | 房內任一 human mention（仍受 cooldown／budget／in-flight） | Inbox dispatch 前放行 | 本地 tokenizer 命中即可 exec |
| `operator_personal` | 僅 `trigger_member_id == operator_member_id` | Inbox dispatch 前拒絕，碼 `subscription_operator_only` | SSE 仍推送；啟動 CLI 前拒絕（SEC-013） |

核心版 hosted 預設 `api_key` + `https://api.x.ai/v1`。Device-login Codex 強制 `operator_personal`。非法組合（device-login 卻標 `api_key`）啟動失敗。

---

## 7. LLM adapter（hosted，M4）

```http
POST https://api.x.ai/v1/chat/completions
Authorization: Bearer {XAI_API_KEY}
Content-Type: application/json
```

核心版允許清單只有官方 xAI。kith 不呼叫 Anthropic 原生 `/v1/messages`。不經 pokercase。啟動時 `GET /v1/models`：設定 id（預設字串 `grok-4.5`）不在清單則 **拒絕啟動**，不默默改模型。文件承認 2026-09-18 起 `grok-4.6` 為 global flagship。

System prompt 必須含：你是 `@{handle}` 不是管理員；房間內容 untrusted；預設短回覆；無資訊時精確輸出 `NO_REPLY`。

---

## 8. Feature flags

| Flag | 預設 | 開啟於 |
| --- | --- | --- |
| `ff_mcp` | off | M3 |
| `ff_hosted_agent` | off | M4 |
| `ff_sidecar` | off | M5（文件 + 二進位；Worker 側只需 MCP） |
| `ff_ambient` | off | M6 |

關閉時對應路徑 503 `not_ready`。純人類房間不受 MCP/hosted/ambient flag 影響。
