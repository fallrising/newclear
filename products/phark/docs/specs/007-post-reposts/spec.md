# 007：文章轉發

> 狀態：Complete
> 日期：2026-08-09

## 問題

Phark 已能辨識帳號、保存原文 ownership，並提供 viewer-aware likes，但使用者仍無法把
別人的文章重新帶回 timeline。單純在原文上增加一個 `reposted=true` relation 只能顯示
count，無法滿足 ROADMAP 已承諾的原文歸屬與 timeline fan-out；把 repost 複製成一般
post 又會讓 likes、replies 與作者歸屬錯綁到副本。

Repost 同時是「帳號與原文的唯一關係」和「有自己時間與 actor 的 timeline activity」。
資料、cursor 與 frontend key 必須保留這兩種 identity，才能讓原文互動保持共享、同時
讓多位轉發者各自出現在 timeline。

## 目標

- 已登入帳號可對任何既有原文（包括自己與 legacy 原文）repost/unrepost。
- 同一帳號與原文最多一筆 repost；重送 PUT/DELETE 都成功且不重複 activity/count。
- Repost activity 顯示轉發者與時間，同時保留原作者、原文 ID、內容與建立時間。
- 三欄 timeline 依原文 channel 顯示 originals 與 repost activities；profile feed 顯示該
  帳號建立的原文與該帳號的 repost activities。
- Mixed timeline 維持穩定、bounded、無重複的 keyset pagination，且部署前的 cursor
  仍可使用。
- 所有原文副本共享 replies、likes、repost count 與 viewer state。
- Frontend 立即 optimistic update count/state，成功後重新取得權威 activity membership，
  失敗時只復原 repost fields。

## 非目標

- 不支援 quote post、附加評論、reply repost、reposter list 或 repost detail endpoint。
- 不實作 follower graph、個人化 delivery、ranking 或非同步 fan-out queue；目前所有
  timeline 都是共享 feed。
- 不產生 notification；SDD-008 才定義 notification event 與 unread semantics。
- 不新增 edit/delete post API、rate limiting、offline queue 或跨裝置即時推送。
- 不建立通用 activity/event framework，也不新增 production dependency。

## HTTP 與 JSON 契約

所有 endpoint 沿用 RFC 9457 Problem Details、`X-Request-ID`、session authentication
與 CSRF boundary。

| Method | Path | Auth | 成功 |
|--------|------|------|------|
| `PUT` | `/api/posts/{postId}/repost` | Session + CSRF | `200 RepostState`；已 repost 時 no-op |
| `DELETE` | `/api/posts/{postId}/repost` | Session + CSRF | `200 RepostState`；未 repost 時 no-op |
| `GET` | `/api/posts` | Public | originals + repost activities 的 mixed page |
| `GET` | `/api/profiles/{handle}/posts` | Public | 該帳號的 original/repost activity page |

`PUT`/`DELETE` response：

```json
{
  "postId": 42,
  "repostCount": 3,
  "repostedByViewer": true
}
```

每個 Post response 新增以下 non-null state：

```json
{
  "id": 42,
  "timelineEntryId": "repost:17",
  "repostCount": 3,
  "repostedByViewer": false,
  "repostedBy": "Bob",
  "repostedByHandle": "bob_ops",
  "repostedAt": "2026-08-09T12:00:00Z"
}
```

- `id` 永遠是原文 ID；reply/like/repost mutation 都繼續使用這個 ID。
- `timelineEntryId` 是每個 timeline activity 的 stable、non-null opaque key。Client 只可
  比較相等與用作 render/dedup key，不可解析。
- Original activity 的 `repostedBy`、`repostedByHandle`、`repostedAt` 都是 `null`。
- Repost activity 的三個 attribution fields 都 non-null；原文 `author`、`authorHandle`、
  `content`、`channel`、`createdAt` 不被轉發者覆蓋。
- `repostCount` 是原文目前所有 repost relations 數量；`repostedByViewer` 只代表目前
  authenticated session，anonymous 固定為 `false`。
- Viewer-aware timeline/profile response 必須送出 `Cache-Control: private, no-store`。
- `postId <= 0` 回 `400 INVALID_POST_ID`；不存在的正 ID 回
  `404 POST_NOT_FOUND`。
- 無 session mutation 回 `401 AUTHENTICATION_REQUIRED`；CSRF 缺失或錯誤回
  `403 CSRF_TOKEN_INVALID`。拒絕路徑不得建立或刪除 repost relation。

## Fan-out 與排序規則

1. 每篇原文保留一個 original activity，排序時間是原文 `createdAt`。
2. 每筆 repost relation 產生一個 activity，排序時間是 relation `createdAt`。
3. Repost activity 繼承原文 channel；由於目前沒有 follow graph，所有 viewer 都能在該
   channel 看到它。
4. Profile posts endpoint 包含 profile owner 建立的 original activities，以及該 owner
   建立的 repost activities；不包含其他人轉發 owner 原文的 activities。
5. 同一原文可因不同轉發者在同一 page 出現多次。Activity dedup 使用
   `timelineEntryId`；互動 state synchronization 使用原文 `id`。
6. 重送 PUT 不更新 relation timestamp，所以不把既有 activity bump 到頂部；DELETE 後
   再 PUT 會建立新 activity/time。
7. DELETE 只移除目前 actor 的 repost activity；不刪原文、其他人的 repost、likes 或
   replies。
8. Self-repost 與 legacy-post repost 都允許；repost activity 不可形成 repost-of-repost
   chain，因 relation 永遠指向 `posts.id` 原文。

## Cursor 相容性

- 新 mixed cursor 是 opaque、URL-safe、無 padding token，包含 activity time、entry kind
  與該 kind 的 source ID。
- 排序固定為 `activity_at DESC, entry_kind DESC, entry_id DESC`；同秒 original 與
  repost 的 precedence 必須固定且由 contract tests 鎖定。
- Decoder 必須接受 SDD-001–006 的 legacy `<epoch>:<postId>` cursor，並把它解讀為
  original activity boundary；所有新 response 只發出 versioned mixed cursor。
- Invalid/non-canonical token 繼續回 `400 INVALID_CURSOR`；`limit` 與 channel rules
  不變。

## BDD 驗收情境

### Scenario：重送 repost 不重複 activity

Given Alice 已登入且原文 42 存在
When Alice 對原文 42 連續送出兩次有效 PUT
Then 兩次都回 200、`repostedByViewer=true` 與 `repostCount=1`
And database 只有一筆 Alice/42 relation
And timeline 只有一筆 Alice 的 repost activity，timestamp 沒被第二次 PUT 改變

### Scenario：repost fan-out 保留原作者

Given Bob 建立原文 42 於 tech channel
And Alice repost 原文 42
When 任意 viewer 讀取 tech timeline
Then page 同時可包含 original 與 Alice repost activities
And repost activity 顯示 Alice 的 attribution
And 文章 ID、作者、內容與 createdAt 仍是 Bob 的原文資料

### Scenario：mixed cursor 不漏不重

Given 同一秒存在多篇 originals 與多筆 repost activities
When client 以 limit 逐頁讀取 timeline
Then 所有 activity 依指定 tuple 穩定排序
And 每個 `timelineEntryId` 恰好出現一次
And legacy positive-post cursor 仍能作為有效 boundary

### Scenario：unrepost 只移除 actor activity

Given Alice 與 Carol 都 repost 原文 42
When Alice 連續送出兩次 DELETE
Then 兩次都回 200、Alice viewer state false
And shared count 維持 1
And Alice activity 消失，但 Carol activity 與原文仍存在

### Scenario：拒絕未驗證 mutation

Given anonymous client 有或沒有有效 CSRF token
When client 嘗試 repost 或 unrepost 原文 42
Then request 回既有 401 或 403 Problem Details
And relation、count 與 timeline membership 都不變

### Scenario：optimistic repost 失敗後精確復原

Given viewer 看到同一原文的多個 activity copies，count 為 3 且 viewer state false
When viewer 點 Repost 而 server mutation 失敗
Then UI 可先把所有 copies 顯示為 count 4/viewer true
And 失敗後所有 copies 回復 count 3/viewer false 並顯示可操作錯誤
And concurrent reply/like fields 不被 rollback 覆蓋

## 約束與相容性

- SQLite/Flyway 下一個 immutable migration 是 V6；V1–V5 不修改。
- `post_reposts` 使用獨立 event ID、對 posts/accounts 的 cascade FK，以及
  `(post_id, account_id)` unique constraint。
- 既有 V5、V4、V3 與 pre-Flyway legacy database 都必須可升級且內容不變。
- Post JSON 只新增欄位；舊 consumer 可忽略。`id` 與原文語意不改。
- Cursor 是唯一有版本相容邏輯的 boundary；不為其他假想 client 新增 compatibility
  layer。
- Hikari pool size 1 是現況，不把它當 uniqueness 或 transaction correctness 保證。
- Frontend 沒有 test runner；以 backend contract tests、TypeScript build、lint 與
  production runtime smoke 提供證據，不為本輪新增 test dependency。

## 假設與未知

- 已驗證：SDD-006 likes、identity、CSRF、profile 與 viewer-aware private cache 已合併。
- 已驗證：現有 cursor token 是 Base64URL 的 `<epoch>:<positivePostId>`，可明確辨識並
  升級到 versioned mixed cursor。
- 已驗證：frontend 現在以 `post.id` 做 render/load-more dedup；mixed timeline 必須改用
  `timelineEntryId`，但互動 patch 仍應以原文 `id` 更新所有 copies。
- 已驗證：獨立 `post_reposts` table 可避免 likes/replies 指向 activity row。
- 未量測：大量 repost events 的 UNION latency；本輪以最大 100 的 bounded page 與
  timeline/account indexes 為界，若 telemetry 顯示瓶頸再 benchmark/denormalize。

## 完成條件

- V6 upgrade、relation uniqueness、mixed cursor/read、API security/idempotency tests 通過。
- Timeline/profile attribution、fan-out、dedup 與既有 reply/like behavior 有 regression
  evidence。
- 完整 backend regression、frontend lint/build、Docker build 與 production-like smoke
  通過。
- 文件、ROADMAP、runtime evidence 與 GitHub Actions final head 一致。
- 每個階段獨立 commit、push；draft PR checks 全綠後才 ready 並 merge。
