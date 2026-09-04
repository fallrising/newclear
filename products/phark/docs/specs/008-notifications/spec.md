# 008：帳號通知

> 狀態：Complete
> 日期：2026-09-02

## 問題

Phark 已有帳號、回覆、like 與 repost，但文章作者只能反覆查看 timeline 才能知道誰與
自己的文章互動。通知同時牽涉事件只產生一次、收件者隔離、未讀狀態與有限資料留存；
若只在讀取時從 replies/likes/reposts 動態拼接，已取消的互動會讓歷史消失，且無法建立
穩定的 unread high-water mark。

## 目標

- 已登入的文章作者收到其他帳號對其文章建立 reply、like 或 repost 的通知。
- Self interaction 與沒有 owner 的 legacy 文章不產生通知。
- 重送仍有效的 like/repost 不重複通知；unlike/unrepost 不撤回歷史通知，取消後再建立則
  產生新事件。
- 事件與來源 mutation 在同一 transaction 成功或失敗。
- 提供 authenticated、viewer-isolated 的通知分頁、未讀數與 monotonic read-through cursor。
- 每個收件者只保留最新 500 筆通知，且留存不破壞分頁與未讀計算。
- Frontend 提供通知頁、header 未讀徽章、逐頁載入與明確的「全部標為已讀」操作。

## 非目標

- 不實作 email、push、WebSocket、polling、跨裝置即時 delivery 或背景 queue。
- 不通知 self interaction、follow、mention、登入、profile edit 或取消 like/repost。
- 不做事件聚合、通知偏好、逐筆已讀、刪除通知或 admin cleanup API。
- 不新增 post detail route、notification deep link、通用 event bus 或 production dependency。
- 不回填 V7 之前既有 replies、likes 或 reposts 的通知。

## 事件契約

| Type | 產生時機 | 收件者 | 不產生時機 |
|------|----------|--------|------------|
| `REPLY` | authenticated reply row 成功建立 | 原文 `author_account_id` | self reply、legacy owner null |
| `LIKE` | like relation 確實插入新 row | 原文 `author_account_id` | 重送 PUT、self like、legacy owner null |
| `REPOST` | repost relation 確實插入新 row | 原文 `author_account_id` | 重送 PUT、self repost、legacy owner null |

- Actor 只取自 authenticated principal；request body 不接受 actor/recipient/type。
- Unlike/unrepost 只移除目前 relation，不刪歷史事件。其後的新 PUT 是新 interaction，會建立
  新通知與新 ID。
- Reply POST 沿用現有 non-idempotent contract；每個新 reply row 最多對應一筆通知。
- Event insert、來源 mutation 與收件者 retention prune 必須在同一 transaction；任一寫入
  失敗就全部 rollback。
- Actor、recipient、post 或 reply 未來若被刪除，相關通知依 V7 foreign key cascade 移除；
  本輪沒有上述 delete API，也不保存 identity/content snapshot。

## HTTP 與 JSON 契約

所有 endpoint 沿用 RFC 9457 Problem Details、`X-Request-ID`、session authentication 與
CSRF boundary。

| Method | Path | Auth | 成功 |
|--------|------|------|------|
| `GET` | `/api/notifications?limit=20&before=<opaque>` | Session | `200 NotificationPage` |
| `PUT` | `/api/notifications/read` | Session + CSRF | `200 NotificationReadState` |

`GET` response：

```json
{
  "items": [
    {
      "id": 91,
      "type": "REPLY",
      "actor": "Alice",
      "actorHandle": "alice_ops",
      "postId": 42,
      "postContent": "Ship the boring fix first.",
      "replyId": 12,
      "replyContent": "Agreed.",
      "createdAt": "2026-09-02T10:00:00Z",
      "read": false
    }
  ],
  "nextCursor": null,
  "latestCursor": "MTo5MQ",
  "readThroughCursor": null,
  "unreadCount": 1
}
```

- Items 固定依 `notification.id DESC`，`limit` 預設 20、範圍 1–100；採 `limit + 1`
  keyset pagination。
- `postContent` 是目前原文內容；`replyContent` 只在 `REPLY` non-null。事件不複製 snapshot。
- `latestCursor` 是該收件者目前最新 retained item 的 cursor，與目前 page 的 `before` 無關；
  沒有通知時為 null。
- `readThroughCursor` 是已保存 high-water ID 的 opaque encoding；尚未讀取時為 null。
- `unreadCount` 只計算 retained rows 中 `id > readThroughId` 的數量。
- 每個 item 的 `read` 等同 `id <= readThroughId`。
- Authenticated GET 一律 `Cache-Control: private, no-store`。

`PUT /api/notifications/read` request/response：

```json
{ "through": "MTo5MQ" }
```

```json
{ "readThroughCursor": "MTo5MQ", "unreadCount": 0 }
```

- `through` 必須 decode 成該 principal 目前仍 retained 的 notification；其他帳號、已 prune、
  malformed 或 non-canonical cursor 回 `400 INVALID_CURSOR`，且 read state 不變。
- 更新使用 `max(currentReadThroughId, requestedId)`，所以較舊的有效 cursor 不會把已讀狀態
  倒退。
- Empty body、額外 identity 欄位或不合法 JSON 沿用 request validation/Problem Details。
- Anonymous GET/PUT 回 `401 AUTHENTICATION_REQUIRED`；PUT 缺失或錯誤 CSRF 回
  `403 CSRF_TOKEN_INVALID`，且不得改變 read state。

## Cursor 與 retention

- Notification cursor 是 URL-safe、無 padding、canonical Base64URL token；decode 前的唯一
  合法 payload 是 `1:<positive-notification-id>`。
- Notification cursor 與 mixed timeline cursor 是不同 codec/model，不接受 timeline legacy
  token，也不共用版本相容分支。
- `before` 使用 strict `id < decodedId`；cursor 不必屬於收件者，因它只是 opaque ordering
  boundary 且 response 仍只查 principal recipient。Read mutation 則必須驗證 ownership。
- 每次成功建立通知後，同一 transaction 內刪除該 recipient 排名 501 以後的 rows，只保留
  最新 500 筆。Prune 不重寫 ID，也不降低 `readThroughId`。
- 留存後 pagination、latest cursor 與 unread count 都只反映 retained rows；V7 migration 不
  回填舊 interaction，因此部署當下從 0 筆開始。

## BDD 驗收情境

### Scenario：三種互動送到文章作者

Given Bob 擁有原文 42，Alice 已登入
When Alice 依序 reply、like 並 repost 原文 42
Then Bob 的通知依 event ID 倒序包含 REPOST、LIKE、REPLY
And 每筆 actor 是 Alice、post 是 42，reply 通知另有 reply ID/content
And Alice 看不到 Bob 的通知

### Scenario：不產生重複或 self/legacy 通知

Given Alice 對 Bob 原文連續送出兩次 like PUT 與兩次 repost PUT
And Bob 對自己的原文 reply/like/repost
And Alice 對沒有 owner 的 legacy 原文互動
When Bob 讀取通知
Then Alice 的 like 與 repost 各只有一筆事件
And self 與 legacy interactions 沒有事件

### Scenario：取消不撤回，重做產生新事件

Given Alice 已 like 並 repost Bob 原文
When Alice unlike/unrepost，再次 like/repost
Then 舊通知仍存在
And 新 interaction 各新增一筆不同 ID 的通知
And relation count 仍只反映目前 active relation

### Scenario：未讀 cursor 單調且隔離

Given Bob 有三筆未讀通知，Carol 也有一筆通知
When Bob 以自己的第二筆 cursor 標為已讀，再送較舊 cursor
Then Bob read-through 不倒退且只剩較新的通知未讀
And Bob 使用 Carol cursor 會得到 INVALID_CURSOR，兩人的 state 都不變

### Scenario：每個收件者只保留最新 500 筆

Given Bob 已有 500 筆 retained notifications
When 新 interaction 成功建立第 501 筆
Then Bob 最舊一筆在同一 transaction 被刪除
And 分頁恰好遍歷 500 筆、沒有重複，unread count 與 retained state 一致
And 其他收件者的留存資料不受影響

### Scenario：安全拒絕沒有副作用

Given anonymous client 或缺少有效 CSRF 的 authenticated client
When 它讀通知或更新 read cursor
Then request 回既有 401/403 Problem Details
And notification 與 read state 都不改變

### Scenario：前端只在成功後清除徽章

Given authenticated viewer 的 header 顯示未讀徽章且通知頁已載入 latest cursor
When viewer 點「全部標為已讀」
Then UI 呼叫 read endpoint，成功後把 retained items 標為 read 並清除徽章
And 失敗時保留原 unread state 並顯示可操作錯誤

## 約束與相容性

- SQLite/Flyway 下一個 immutable migration 是 V7；V1–V6 不修改。
- V7 支援 empty、V6/V5/V4/V3 與 pre-Flyway legacy upgrade，既有資料與 IDs 不變。
- Notification/read APIs 是 additive；既有 post/reply/like/repost responses 不變。
- Like/repost repository insert 會回傳是否確實建立 row；database unique constraint 仍是
  concurrent truth，不先 read-before-write。
- GET notification security matcher 必須排在既有 public `GET /**` matcher 前面。
- Hikari pool size 1 不是 transaction/uniqueness correctness 保證。
- Frontend 沒有 test runner；不為本輪新增 dependency，以 backend contract、lint、build 與
  production runtime smoke 補足 evidence。

## 假設與未知

- 已驗證：owned replies/likes/reposts 都從 authenticated account ID 寫入，legacy post 的
  `author_account_id` 可為 null。
- 已驗證：like/repost insert 使用 `ON CONFLICT DO NOTHING`，可用 update count 區分新 relation。
- 已驗證：ReplyService 尚無 transaction；like/repost services 已有 transaction boundary。
- 已驗證：現有 public GET matcher 會先匹配所有 GET，notifications 必須明確前置保護。
- 已驗證：header `AccountControls` 與 App 的 session lifecycle 是徽章/route integration point。
- 未量測：單一收件者高頻事件下 synchronous prune latency；本輪以 500-row hard bound 與
  `(recipient_account_id, id DESC)` index 控制，若 telemetry 顯示瓶頸再 benchmark。

## 完成條件

- V7 migration、event uniqueness/transaction/retention、cursor/read API 與 security tests 通過。
- Reply/like/repost 既有 behavior 有 regression evidence，拒絕與 rollback path 無副作用。
- Frontend lint/build、Docker build、clean/populated migration 與 two-viewer runtime smoke 通過。
- 文件、ROADMAP、runtime evidence 與 GitHub Actions final head 一致。
- 每個階段獨立 commit、push；draft PR checks 全綠後才 ready 並 merge。
