# 006：文章按讚

> 狀態：Complete
> 日期：2026-08-09

## 問題

Phark 已有可靠的 account identity 與 content ownership，但讀者仍不能對文章表達
輕量回饋。下一階段的 notifications 也需要一個由資料庫保證唯一、可安全重試的
「某帳號喜歡某文章」關係。

Like 是容易被重複點擊、retry 或跨頁面載入覆蓋的 mutation。若唯一性只由應用程式
檢查，重送可能重複計數；若 frontend 只做本地加減，失敗或延遲 response 會讓三欄
timeline 與 profile 顯示不同數字。

## 目標

- 已登入帳號可對任何既有文章（包括自己的文章與 legacy 文章）like/unlike。
- 同一帳號與文章最多一筆 like；重送 like/unlike 都成功且不重複計數。
- Timeline 與 profile post response 回傳權威 `likeCount` 與 viewer 專屬
  `likedByViewer`。
- Anonymous read 保持可用且 `likedByViewer=false`；anonymous mutation 不產生副作用。
- Frontend 立即 optimistic update，成功後以 server state 對齊，失敗時精確 rollback。
- 保留既有 cursor ordering、reply count、ownership 與 legacy content behavior。

## 非目標

- 不支援 reply likes、liker list、reaction types、like timestamp API 或 activity history。
- 不產生 notification；SDD-008 才定義 notification event 與 unread semantics。
- 不因 like 排序或推薦文章；timeline 仍按 `createdAt`、`id` keyset order。
- 不加入 account/post deletion API、rate limiting、offline queue 或跨裝置即時同步。
- 不增加 production dependency，也不建立通用 reaction framework。

## HTTP 契約

所有 endpoint 沿用 RFC 9457 Problem Details 與 `X-Request-ID`。Unsafe request 使用
既有 session authentication 與 CSRF token。

| Method | Path | Auth | 成功 |
|--------|------|------|------|
| `PUT` | `/api/posts/{postId}/like` | Session + CSRF | `200 LikeState`；已 like 時為 no-op |
| `DELETE` | `/api/posts/{postId}/like` | Session + CSRF | `200 LikeState`；未 like 時為 no-op |
| `GET` | `/api/posts` | Public | 每筆 post 加入 viewer-aware like state |
| `GET` | `/api/profiles/{handle}/posts` | Public | 同上 |

`PUT`/`DELETE` response：

```json
{
  "postId": 42,
  "likeCount": 3,
  "likedByViewer": true
}
```

Post response 新增兩個 non-null 欄位：

```json
{
  "id": 42,
  "replyCount": 1,
  "likeCount": 3,
  "likedByViewer": false
}
```

- `likeCount` 是目前資料庫中該文章的 like rows 數量，使用 64-bit integer。
- `likedByViewer` 只代表目前 authenticated session；anonymous 固定為 `false`。
- Viewer-aware GET response 必須送出 `Cache-Control: private, no-store`，避免共用 cache
  洩漏或重用其他 viewer 的 state。
- `postId <= 0` 回 `400 INVALID_POST_ID`；不存在的正 ID 回
  `404 POST_NOT_FOUND`。
- 無 session mutation 回 `401 AUTHENTICATION_REQUIRED`；CSRF 缺失或錯誤回
  `403 CSRF_TOKEN_INVALID`。所有拒絕路徑不改變 like rows。

## 行為規則

1. Identity 只取自 authenticated principal；request 不接受 account ID 或 actor body。
2. `PUT` 以 database unique constraint 為 correctness boundary，衝突時 no-op；不以
   read-before-write 判斷唯一性。
3. `DELETE` 刪除精確 `(post_id, account_id)`；row 不存在仍回成功 state。
4. Mutation 完成後在同一 transaction 讀回權威 count 與 viewer state。
5. 不限制 self-like；legacy post 不需 owner 也可被 like。
6. Like mutation 不改 post timestamp，不影響 cursor、channel 或 profile membership。

## BDD 驗收情境

### Scenario：重送 like 不重複計數

Given Alice 已登入且文章 42 存在
When Alice 對文章 42 連續送出兩次有效的 like request
Then 兩次都回 200 與 `likedByViewer=true`
And `likeCount` 為 1
And database 只有一筆 Alice/42 relation

### Scenario：不同 viewer 得到各自狀態

Given Alice 喜歡文章 42
When Alice、Bob 與 anonymous 分別讀取包含文章 42 的 timeline
Then 三者看到相同的 `likeCount=1`
And 只有 Alice 看到 `likedByViewer=true`

### Scenario：重送 unlike 保持成功

Given Alice 尚未喜歡文章 42
When Alice 對文章 42 連續送出兩次 unlike request
Then 兩次都回 200 與 `likedByViewer=false`
And count 不會低於 0

### Scenario：未驗證 mutation 沒有副作用

Given anonymous client 有或沒有有效 CSRF token
When client 嘗試 like 或 unlike 文章 42
Then request 回既有 401 或 403 Problem Details
And like rows 與 count 保持不變

### Scenario：optimistic like 失敗後復原

Given 已登入 viewer 看到未喜歡且 count 為 3 的文章
When viewer 點 Like 而 server mutation 失敗
Then UI 可先顯示 liked/count 4
And 失敗後復原為 unliked/count 3 並顯示可操作錯誤
And 同一文章的所有目前副本保持一致

## 約束與相容性

- SQLite/Flyway 下一個 immutable migration 是 V5；V1–V4 不修改。
- `post_likes` 必須以 foreign keys 連到 posts/accounts，並在 parent 刪除時 cascade。
- 既有 V4、V3 與 pre-Flyway legacy database 都必須可升級且內容不變。
- 單 instance、Hikari pool size 1 是現況，不把它當成唯一性保證。
- Post JSON 只新增欄位，不移除或改名；舊 consumer 可忽略新欄位。
- Frontend 沒有 test runner；以 backend contract tests、TypeScript build、lint 與
  production runtime smoke 提供證據，不為本輪新增 test dependency。

## 假設與未知

- 已驗證：SDD-005 account ID、session/CSRF、profile timeline 與 ownership 已合併。
- 已驗證：現有 post query 使用 correlated reply count；新增 count/EXISTS 在目前 bounded
  page（最大 50）可接受，runtime smoke 會驗證實際 wiring。
- 已驗證：SQLite foreign keys 已啟用，連線池固定單連線且有 busy timeout。
- 未量測：大量 like rows 下的 query latency；本輪不預先引入 aggregate counter，若未來
  telemetry 顯示瓶頸再用 migration/benchmark 決定 denormalization。

## 完成條件

- V5 upgrade、repository uniqueness、viewer-aware reads 與 API security/idempotency tests 通過。
- 完整 backend regression、frontend lint/build、Docker build 與 production-like smoke 通過。
- 文件、ROADMAP、runtime evidence 與 GitHub Actions final head 一致。
- 每個階段獨立 commit、push；draft PR checks 全綠後才 ready 並 merge。
