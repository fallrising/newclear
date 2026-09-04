# 009：公開文章搜尋

> 狀態：Complete
> 日期：2026-09-03

## 問題

Phark 已有 timeline、replies、likes、reposts 與 notifications，但沒有搜尋。使用者無法依內容找到
既有文章。SDD-008 之後，SQLite FTS5 已隨 sqlite-jdbc 3.53.2.0 編入，並由 production image
runtime 確認 SQLite 3.53.2 與 `ENABLE_FTS5`，可以建立全文索引而不新增 dependency。搜尋是多步驟
的 user-visible change：需要新的 migration、query/cursor 契約、API 與 frontend route，因此先以
live spec 固定契約再實作（documentation-first）。

## 目標

- 以 FTS5 全文索引搜尋「original post content only」的新增、既有與未來 post。
- `GET /api/search` 是 public、viewer-aware、newest-first、bounded、有 dedicated cursor 的分頁 API。
- Query 只接受正規化 plain terms，raw FTS operators/wildcards 一律視為 literal text，不能改變
  compiled MATCH 的結構。
- 每個結果只出現一次；pagination 以 `(created_at DESC, id DESC)` 做確定性 keyset。
- Invalid query/limit/cursor 回 RFC 9457 Problem Details，永不變成 unhandled SQLite error。
- `/search?q=...` 支援 direct load、navigation、loading/empty/error、load-more dedupe 與
  stale-response 防護，且不新增 frontend dependency。
- 既有 V1–V7 與所有既有 HTTP JSON 契約不變；本輪以 live docs、TDD、Docker/runtime 與
  final-head/post-merge CI 提供 evidence。

## 非目標

- 不搜尋 replies、profiles、notification content 或 repost fan-out duplicates；僅 original
  `posts.content`。
- 不做 wildcard/prefix、fuzzy、stemming toggle、ranking 排序或 autocomplete；FTS5 只用來配對，
  排序一律 keyset。
- 不公開 raw FTS5 MATCH syntax；native operators 是 literal text，punctuation（含 `*`、`^` 等）
  依 unicode61 視為 separator，不另行索引。
- 不新增 frontend dependency、post detail route、search history 或 admin cleanup API。
- 不採用 rank-based 排序或 rank cursor，因其隨新 index 改變會造成分頁跳漏。
- 不新增 search delete API；posts 刪除只由既有資料庫刪除路徑帶動。

## HTTP 與 JSON 契約

沿用 RFC 9457 Problem Details、`X-Request-ID` 與既有 session auth boundary。

| Method | Path | Auth | 成功 |
|--------|------|------|------|
| `GET` | `/api/search?q=<plain terms>&limit=20&before=<opaque>` | Public（viewer-aware） | `200 PostPage` |

`GET` response（anonymous 時 `likedByViewer`/`repostedByViewer` 為 boolean `false`，**永不為
null**；`timelineEntryId` 為 `post:<id>`，repost attribution 恒為 null）：

```json
{
  "items": [
    {
      "id": 42,
      "author": "Alice",
      "authorHandle": "alice_ops",
      "content": "Ship the boring fix first.",
      "channel": "tech",
      "createdAt": "2026-09-02T10:00:00Z",
      "replyCount": 0,
      "likeCount": 3,
      "likedByViewer": false,
      "timelineEntryId": "post:42",
      "repostCount": 1,
      "repostedByViewer": false,
      "repostedBy": null,
      "repostedByHandle": null,
      "repostedAt": null
    }
  ],
  "nextCursor": "<opaque search cursor>"
}
```

- `items` 的 JSON shape 必須與 timeline `Post` 完全相同（`channel`、`timelineEntryId`、nullable
  repost attribution 都在內）：`id`、`author`、`authorHandle`、`content`、`channel`、`createdAt`、
  `replyCount`、`likeCount`、`likedByViewer`、`timelineEntryId`、`repostCount`、`repostedByViewer`、
  `repostedBy`（nullable）、`repostedByHandle`（nullable）、`repostedAt`（nullable）。Search 不產生
  第二種 Post shape。
- 每個 search item 都是 original post row：`timelineEntryId` 固定為 `'post:' || p.id`（如
  `post:42`），`repostedBy`/`repostedByHandle`/`repostedAt` 恒為 `null`，因為 search 不含 repost
  fan-out copies。
- `likedByViewer`/`repostedByViewer` 是 boolean；anonymous viewer 一律 `false`，與既有 timeline
  contract 一致，永不序列化 null。
- `items` 是 matched original posts，依 `(posts.created_at DESC, posts.id DESC)` 排序。
- `nextCursor` 為 `null` 表示已到最後一頁；非 null 時是 `s1:<epoch-second>:<positive-id>` 的
  canonical Base64URL 編碼（見 pagination 契約）。
- Response 一律 `Cache-Control: private, no-store`（與既有 viewer-aware posts endpoint 一致）：
  結果含 viewer 相依欄位，不得被 browser/CDN 快取。
- `q` 為必填 query parameter，但以 nullable request 參數綁定後交由 service 驗證；缺漏回
  `400 INVALID_QUERY`（不能落入 framework 預設的 malformed-request 處理）。

### Query 契約（plain-term compilation）

1. `q` 先做 Unicode-aware trim 前後空白。
2. Trimmed 長度必須為 1–100 個 Unicode code points；超出回 `400 INVALID_QUERY`。
3. Trimmed 後依 Unicode-aware whitespace 切分為 1–8 個 terms；0 或大於 8 個回 `400 INVALID_QUERY`。
4. 除 whitespace 外不接受 ISO control code point；每個 term 必須包含至少一個 Unicode letter
   或 digit，否則回 `400 INVALID_QUERY`。因此
   punctuation-only term（例如 `***`、`( )`）是 invalid，不會進入 MATCH。
5. 依已切分好的每個完整 term 各自包成一個 FTS5 quoted phrase，再以 `AND` join 成單一 compiled
   query string；每個 term 就是一個 phrase，不是把整段 query 包成單一 phrase。例如 plain input
   `ship the` 編譯成 `"ship" AND "the"`（不是 `"ship the"`）。
6. Quoted phrase 內的 `"` 以 doubled-quote escape（`""`）。Quoting 會 neutralizes FTS operator
   syntax：`NOT`、`OR`、`AND`、`NEAR`、`(`、`)`、`^`、`:col` 等在 quoted phrase 內都是 literal
   text。unicode61 tokenizer 把 punctuation 視為 separator，punctuation 本身不被索引、也不可被
   搜尋；`foo*` 編譯成 `"foo*"`，`*` 不會變成 prefix operator、也不擴充成 prefix matching。
7. Compiled query 以 **bound parameter** 傳入 `MATCH`，永不 string-concatenation；因此搜尋
   不會造成 SQL 注入，也讓任何 malformed syntax 無法以語法形態到達 `MATCH`（compile 的輸出
   永遠是 well-formed quoted-phrase AND）。
8. Compiler 保證輸出有效 MATCH 語法；unexpected FTS/operational 失敗不視為 `INVALID_QUERY`，
   而是 `INTERNAL_ERROR` 並記錄 log（見 Error 契約）。

### Pagination 契約（dedicated keyset cursor）

- `limit` 預設 20、範圍 1–50；範圍外回 `400 INVALID_LIMIT`（沿用既有錯誤碼）。
- Repository 讀 `limit + 1` rows；最後一筆 delivered row 產生 next cursor，指向其
  `(created_at, id)` boundary。
- 排序鍵是 `(posts.created_at DESC, posts.id DESC)`；`created_at` 相同時間的 post 以 `id DESC`
  tiebreak，保證全序且無重複/缺漏。
- Cursor 是無 padding、URL-safe、canonical Base64URL payload **`s1:<epoch-second>:<positive-id>`**：
  - `<epoch-second>`：boundary row 的 `posts.created_at`（UTC signed epoch seconds；decimal 必須
    canonical，拒絕 plus sign、`-0` 與 leading zero）。
  - `<positive-id>`：該 row 的 `posts.id`（> 0）。
  - 比較規則：`(created_at < boundary) OR (created_at = boundary AND id < boundary_id)`。
- `s1` 開頭讓 search cursor 與 legacy timeline `1:<epoch>:<id>`、timeline v2
  `2:<epoch>:<kind>:<id>` 與 notification `1:<id>` 都是 byte-distinct 的 namespace；這是 search
  專屬 codec/model，不接受 timeline/notification token，不共用版本相容分支。
- Cursor **只當 ordering boundary**，不驗證該 post 是否仍存在、也不驗證 ownership；response
  仍只回 matched posts。Malformed、non-canonical、overflow、錯誤 version 或越界值回
  `400 INVALID_CURSOR`，且無 side effect。

### Error 契約

| 情境 | Status | Code |
|------|--------|------|
| `q` 缺失/空/超長/term 數或字元集違規 | `400` | `INVALID_QUERY`（新增到 `ApiErrorCode`，required） |
| `limit` 非正整數或超出 1–50 | `400` | `INVALID_LIMIT` |
| `before` 無法 canonical decode 或非 search namespace | `400` | `INVALID_CURSOR` |

- `INVALID_QUERY` 是**必須新增**的 error code，不是 open alternative；`q` 缺失透過 nullable
  request 參數進到 service validation，統一以 RFC 9457 Problem Details 回 `400 INVALID_QUERY`，
  不交給 framework 的 malformed-request 分支。
- 所有錯誤走既有 RFC 9457 writer 與 `X-Request-ID` filter；response 不含可被推測的內部資料。
- Compiler 只接受上述 bounded 輸入並輸出有效 MATCH 語法，因此 malformed FTS syntax 本身不會
  發生；若 compile 之外的 FTS/repository/operational failure（例如 index 損壞、I/O）意外發生，
  必須回 `INTERNAL_ERROR` 並記錄 log，**不得**廣義地把 repository/database failures 轉成
  `INVALID_QUERY`。

## BDD 驗收情境

### Scenario：V8 migration-time backfill 讓既有文章可搜尋

Given 一份已升級到 V8 的 warm V7 database，含有既有 original posts
When anonymous client 搜尋任一段既有 post 內容
Then 該 post 出現在結果中一次
And migration 完成後 `PRAGMA integrity_check` 為 ok，`sqlite_master` 含 FTS virtual table 與
  trigger，且每篇既有 post 都能以內容配對（backfill 等價）

### Scenario：trigger 同步與 fail-closed rollback

Given 應用已執行 V8 migration
When 新增/更新/刪除一篇 original post
Then search index 立即反映該變更，可見內容可/不可搜尋與 posts 一致
And 若 FTS trigger 寫入失敗，post 本身的寫入一起 rollback，兩者都不留下部分狀態

### Scenario：plain input 不能改變 query 結構或注入 FTS 語法

Given plain input 含 FTS operator 樣式文字（例如 `NOT`、`OR`、`AND`、`(`, `)`, `^`、`:col`、
  quote）或 wildcard 樣式（例如 `foo*`、`*bar`）
When service 編譯並執行搜尋
Then compiled MATCH 永遠是逐字 quoted phrase 的 AND 結構，operator/wildcard 不會被解讀為語法
And malformed syntax 無法以語法形態到達 `MATCH`（quote escaping neutralizes），`foo*` 不會變成
  prefix matching
And unicode61 把 punctuation 視為 separator；punctuation-only term 回 `400 INVALID_QUERY`
And 非 ASCII letter/digit（例如中文或 accented Latin）仍以 token 精確配對

### Scenario：anonymous 與 authenticated viewer state

Given anonymous client 與已登入 viewer 各自呼叫相同 query
When 兩者收到結果
Then anonymous 的 `likedByViewer`/`repostedByViewer` 為 boolean `false`（非 null）
And authenticated 的回傳對應 boolean，且 shared counts 兩者一致
And viewer state 只來自 session principal，不來自 request body

### Scenario：相同 timestamp 的確定性分頁

Given 多篇 post 的 `created_at` 完全相同
When client 以預設 limit 逐頁讀取
Then 依 `id DESC` tiebreak 產生全序，跨頁遍歷不重複、不缺漏

### Scenario：頁與頁之間的新 post

Given client 已取得第一頁 boundary cursor
When 另一篇 post 在讀取第二頁前建立
Then 新 post 只在符合 boundary 方向的一頁出現一次，不會造成已讀項目重複
And 已在第一頁作為 boundary 的 post 不會在後續頁再次回傳

### Scenario：invalid boundaries 無 side effect

Given query、limit 或 cursor 任一違反契約（含缺失 `q`、timeline/notification cursor）
When client 發出 request
Then 回對應 `400 INVALID_QUERY`/`INVALID_LIMIT`/`INVALID_CURSOR` Problem Details
And 不產生未處理 SQLite error、不改變任何資料

### Scenario：account/session 改變時刷新目前公開結果

Given 已登入 viewer 已看到一頁含其 viewer booleans 的結果
When viewer 登出、切換帳號或新的 session 建立
Then 目前 query 以新 viewer 身份重新執行；結果的 `likedByViewer`/`repostedByViewer` 不會殘留
  舊 session 值
And logout 後以 anonymous 重跑同一條有效 public 搜尋 route，不會 disabled 或清掉 route

### Scenario：UI stale query response

Given viewer 先送出慢的 q1 再送出快的 q2
When q2 的 response 先到、q1 較晚到
Then UI 只顯示 q2 結果；q1 的 stale response 被 request-version guard 丟棄
And 切換 query/route/account 後舊 state 不殘留

### Scenario：/search 直接載入

Given browser 直接載入 `/search?q=...`
When SPA 解析 route
Then 顯示該 query 的第一頁結果，url 保留 query、popstate/back 可回 to nav state

### Scenario：load-more pagination dedupe

Given query 結果跨多頁
When viewer 連續 load-more 到最後一頁
Then 每個 matched post 恰好出現一次，以 post id 去重
And `nextCursor` 為 null 後不再有額外項目

## 約束與相容性

- SQLite/Flyway 下一個 immutable migration 是 V8；V1–V7 不修改。
- V8 支援 empty 與 populated V7 upgrade；既有資料與 IDs 不變，migration-time rebuild 是
  backfill policy（有別於 SDD-008 的 no-backfill，因為 FTS 冷啟動無法配對）。
- Search API 是 additive；既有 post/reply/like/repost/notification responses 不變。
- 搜尋結果排序不用 FTS rank；matching 用 FTS，ordering 用 `(created_at DESC, id DESC)`。
- Security matcher：search GET 是 public viewer-aware，**不**加 authenticated matcher，維持在
  既有 `GET /**` permitAll 之下；但必須確認它不被其他更 specific matcher 擋住 anonymous。
- `INVALID_QUERY` 新增至 `ApiErrorCode`；`INTERNAL_ERROR` 沿用既有 operational error 路徑。
- Hikari pool size 1 不是 transaction/uniqueness correctness 保證。
- Frontend 沒有 test runner；不為本輪新增 dependency，以 backend contract、lint、build 與
  production runtime smoke 補足 evidence。

## 假設與未知

- 已驗證（T-001，binary inspection）：sqlite-jdbc 3.53.2.0 內嵌 SQLite 含 `fts5` module；尚未在
  production runtime 以 `PRAGMA compile_options`/indexing smoke 複驗（見 verification）。
- 已驗證（T-001）：`posts.content` 是 original post content 唯一來源，replies 在 `replies` table；
  search 只蓋 `posts`；`Post` JSON 是 boolean `likedByViewer`/`repostedByViewer`（anonymous 為
  false），`timelineEntryId` 對 original row 為 `post:<id>`。
- 已定案：`INVALID_QUERY` 新增到 `ApiErrorCode`；missing `q` 以 nullable request 參數進入 service
  validation。unexpected FTS/operational failure 回 `INTERNAL_ERROR` 並 log。
- 未量測：migration-time rebuild 在既有 posts 數量下的成本；V8 回填 policy 範圍是全部既有
  original posts（orchestrator 決策 V8 全量回填）。
- 未量測：single-query FTS 語法多 term 成本與 length/term bound 是否足夠；以 1–100 code points、
  1–8 terms 為現階段 hard bound，runtime 若顯示瓶頸再 benchmark。
- 未驗證：`created_at` 若存在非 `datetime('now')` 的格式或 fractional seconds，cursor 的
  epoch-second round-trip 是否精確；live migration test 與 runtime scenario 必須覆蓋 homogeneous
  timestamps 的確定性。

## 完成條件

- V8 migration（FTS5 virtual table + rebuild + triggers）、query compile/cursor codec、repository/
  service/controller 與 security/cache、frontend route 的 TDD 全部通過。
- Migration 驗證 empty/populated V7→V8、backfill 完整性與 trigger fail-closed rollback。
- Cursor/query 契約（Unicode、literal operators、equal timestamps、between-page inserts、
  invalid boundaries）有 contract tests 證據；search cursor 使用 `s1:` namespace 並拒絕
  timeline/notification token。
- Frontend lint/build、Docker build、clean/populated migration 與 production runtime smoke 通過；
  復用的 `PostPage` 結果與 timeline viewer projection（含 boolean viewer flags、`post:<id>`
  timelineEntryId、null repost attribution）一致。
- 文件、ROADMAP、runtime evidence 與 GitHub Actions final-head **及 post-merge master** 一致。
- 每個階段獨立 commit、push；draft PR checks 全綠後才 ready 並 merge。
