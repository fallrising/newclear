# 009：公開文章搜尋設計

> 狀態：Complete

## 邊界與資料流

```text
V8 migration
  └─ CREATE VIRTUAL TABLE search_posts USING fts5(content, content='posts', ...)
       └─ migration-time rebuild indexes existing posts.content
       └─ AFTER INSERT/UPDATE/DELETE triggers keep FTS in sync with posts writes

GET /api/search?q=&limit=&before=        (public, viewer-aware, private no-store)
  └─ SearchService (@Transactional(readOnly=true))
       ├─ SearchQueryCompiler: trim → bounds → per-term phrase AND → bound MATCH param
       ├─ SearchCursorCodec: Base64URL("s1:<epochSecond>:<positiveId>") ordering boundary
       └─ SearchRepository: FTS MATCH + JOIN posts/accounts + keyset (created_at DESC, id DESC)
            └─ limit + 1 → hasMore → nextCursor

/search?q=... (SPA route)
  └─ typed search API → SearchView → PostCard reuse → request-version stale guard + id dedupe
     └─ account/session change → rerun current query as new (or anonymous) viewer
```

Matching 用 FTS5、ordering 用 posts keyset；兩者分離，避免 rank 漂移破壞 stable pagination。

## Schema V8

SQLite immutable migration `V8__add_post_search.sql` 支援 empty 與 populated V7 upgrade。

```sql
-- External-content FTS5 over posts.content; original post content only (replies stay in
-- the replies table and are NOT indexed). External content keeps posts as source of truth;
-- the FTS table stores only the index and rowid.
CREATE VIRTUAL TABLE search_posts USING fts5(
    content,
    content='posts',
    content_rowid='id',
    tokenize='unicode61 remove_diacritics 2'
);

-- Migration-time rebuild: indexes every existing posts row so all current posts are
-- searchable immediately after V8. This is explicit backfill (unlike SDD-008 no-backfill).
INSERT INTO search_posts(search_posts) VALUES('rebuild');

-- Keep the FTS index synchronized for all future writes. Each trigger runs in the same
-- transaction as the posts mutation: any trigger failure rolls back the post write
-- (fail-closed, mirroring SDD-008 notification emission).
CREATE TRIGGER posts_search_ai AFTER INSERT ON posts BEGIN
    INSERT INTO search_posts(rowid, content) VALUES (new.id, new.content);
END;

CREATE TRIGGER posts_search_ad AFTER DELETE ON posts BEGIN
    INSERT INTO search_posts(search_posts, rowid, content)
    VALUES ('delete', old.id, old.content);
END;

CREATE TRIGGER posts_search_au AFTER UPDATE ON posts BEGIN
    INSERT INTO search_posts(search_posts, rowid, content)
    VALUES ('delete', old.id, old.content);
    INSERT INTO search_posts(rowid, content) VALUES (new.id, new.content);
END;
```

- external-content 讓 FTS 只保存 index/rowid，內容仍以 posts 為真值；`rebuild` 語法把 index 與
  posts 對齊。
- `ON UPDATE` trigger 以 delete+insert 覆蓋 content 變更的 case；搜尋的 keyset timestamp 一律
  由 source-of-truth `posts` join 取得，FTS index 不複製 `created_at`。
- Migration 測試確認 `sqlite_master` 含 FTS **virtual table** 與三個 trigger、rebuild 後每篇既有
  post 都能以內容配對（backfill 等價）、trigger 行為與 `PRAGMA integrity_check`。External-content
  table 的 shadow schema 是 SQLite implementation detail；不把確切 shadow-table 清單寫成契約。
- V8 需再確認/建立支持 keyset 的 `(created_at DESC, id DESC)` index（T-001 指出 V2 已有
  cursor indexes；若 timeline index 已覆蓋此鍵則沿用，否則由 migration 補齊；由 migration tests
  驗證）。

## Query compilation

`SearchQueryCompiler` 只接受 plain terms，輸出單一 bound `MATCH` parameter：

1. `q` 做 Unicode-aware trim；0 或 > 100 code points → `INVALID_QUERY`。
2. 依 Unicode-aware whitespace 分割；terms 數 0 或 > 8 → `INVALID_QUERY`。
3. 除 whitespace 外不接受 ISO control code point；每個 term 必須含 ≥ 1 Unicode
   letter/digit，否則 `INVALID_QUERY`（punctuation-only term 例如 `***` 是 invalid）。
4. 依已切分好的每個完整 term 各自包成一個 FTS5 quoted phrase（term 內 `"` 以 `""` escape），
   多 term 以 `AND` join；每個 term 就是一個 phrase。例如 plain input `ship the` 編譯成
   `"ship" AND "the"`（**不是** `"ship the"`）。
5. Quoting neutralizes operator syntax，`*`、`^`、`NOT`、`OR`、`AND`、`(`, `)`, `:col` 都是
   literal text；`foo*` 編譯為 `"foo*"`，unicode61 視 `*` 為 separator，不產生 prefix/prefix
   matching。**不加入** wildcard/prefix 行為。
6. Compiled string 以 `:q` bound argument 傳入 `MATCH`；所有資料值都是 parameter，永不
   string-concatenation，SQL 注入與 FTS syntax-injection 都不成立。Compiler 保證輸出有效 MATCH
   語法；malformed syntax 不會以語法形態到達 `MATCH`。

## Cursor 與 keyset

- 排序鍵 `(posts.created_at DESC, posts.id DESC)`，pagination 用 `limit + 1`：
  `WHERE MATCH = :q AND (created_at < :bCreatedAt OR (created_at = :bCreatedAt AND id < :bId))`
  `ORDER BY posts.created_at DESC, posts.id DESC LIMIT :limit + 1`。
- `bCreatedAt` 由 cursor 的 epoch-second 以 `datetime(:epoch, 'unixepoch')` 還原；`bId` 直接
  取用，全部 bound。
- `SearchCursor`/`SearchCursorCodec` 是獨立 namespace（SDD-008 禁令：不與 mixed timeline /
  notification cursor 共用 codec/model、不共用版本相容分支）。
- Canonical encode payload **`s1:<epochSecond>:<positiveId>`** → URL-safe、無 padding Base64URL raw
  編碼。`s1` 開頭確保與 legacy timeline `1:<epoch>:<id>`、timeline v2 `2:<epoch>:<kind>:<id>` 及
  notification `1:<id>` byte-distinct。
- Epoch second 使用 canonical signed decimal；post ID 使用 canonical positive decimal。Strict
  decode 拒絕 padding、illegal alphabet、malformed UTF-8、錯誤 version/shape、plus sign、`-0`、
  leading zero/whitespace、non-positive ID、overflow、錯誤 namespace，以及 re-encode 不 canonical
  的 token。Boundary cursor 不驗證 post 存在或 ownership。

## Repository / service

- `SearchRepository.findResults(q, viewerAccountId?, before, limit+1)`：單一 parameterized query，
  FTS `MATCH` + JOIN posts/accounts 計算 reply/like/repost counts 與
  `liked_by_viewer`/`reposted_by_viewer`，`COALESCE(a.display_name, p.author)` 做 legacy
  fallback；**復用/鏡像 `PostRepository` 的 viewer projection**，避免第二種 Post shape。Search
  只回 original rows：`timeline_entry_id = 'post:' || p.id`，`reposted_by/reposted_by_handle/
  reposted_at` 為 null；`liked_by_viewer`/`reposted_by_viewer` 是 boolean，anonymous viewer 為
  false。
- `SearchService`：`@Transactional(readOnly = true)`；以 nullable request 參數接收 `q` 後驗證
  query/limit、decode cursor、取 `limit + 1` 頁、由最後 delivered row 產生 next cursor。Query 驗證
  失敗（含缺失 `q`）→ `INVALID_QUERY`；**不**把 repository/database/FTS operational failures 轉成
  `INVALID_QUERY`，unexpected failure 沿用 `INTERNAL_ERROR` 並 log。不回 partial page。
- 復用既有 `PostPage`（`items` + `nextCursor`），不新增同形 page model；單頁不回 rank/score。

## Controller、security 與 cache

- `GET /api/search` 參數：`q`（nullable `@RequestParam`，必填語意由 service 驗證）、`limit`、
  `before`；viewer ID 只取自 `@AuthenticationPrincipal`（optional，anonymous 為 null）。
- Security：**public**（維持在 `.requestMatchers(GET, "/**").permitAll()` 之下，不新增
  authenticated matcher）；確認沒有更特定 matcher 擋住 anonymous。
- Cache：controller 明確 `Cache-Control: private, no-store`（viewer-aware payload 不可快取，與
  既有 posts endpoint 一致）。
- `limit` → `INVALID_LIMIT`；cursor 失敗 → `INVALID_CURSOR`；query 違規或缺失 `q` →
  `INVALID_QUERY`（新增 `ApiErrorCode`，沿用 RFC 9457 writer 與 `X-Request-ID`）。Missing `q`
  統一由 service 回 `INVALID_QUERY`，不走 framework 預設 malformed-request 分支。

## Frontend

- 新增 typed search API（`api/search.ts`）並復用 `types/post.ts` 的 `PostPage`，沿用 same-origin cookie 與
  in-memory CSRF client（search 是 safe GET，不需額外 CSRF header 邏輯）。
- App 新增 `{ kind: "search" }` route 與 `/search` path parser；支援 direct load、`navigate*`、
  `popstate` 與 per-route title。header（`AccountControls`）放 Search entry。
- Query/route/account 改變時 bump `refreshVersion`；舊 response 一律丟棄（stale-response guard，
  與 notifications/timeline 相同 pattern）。
- `SearchView` 以 post id append/dedup、保存 next cursor、依 `PostPage` 顯示 loading/empty/error、
  Load more；結果 render 復用 `PostCard`，因此 authenticated reply/like/repost 互動沿用既有
  list 工具，不新增 dependency。
- Account/session 改變（登入、切換、logout）時以新 viewer 身份重跑目前 query，確保 viewer
  booleans 不會 stale；logout 後以 anonymous 重跑同一條 public 搜尋 route，不 disabled、不清掉
  route、不 drop 目前 query。

## Failure、atomicity 與相容性

- FTS trigger 與 posts mutation 同一 transaction；trigger 失敗 rollback post 寫入，兩者無部分
  狀態。
- Migration `rebuild` 失敗則整個 migration 失敗（fail-closed），不會有半套 index。
- Rebuild/trigger 都是 parameterized/immutable SQL，iterator 以 SQLite 內建機制完成，不新增
  scheduler。
- Compiler 保證有效 MATCH 語法；unexpected FTS/operational failure 回 `INTERNAL_ERROR` 並 log，
  不廣義映射成 `INVALID_QUERY`。
- Existing HTTP JSON 不變；search 只新增 endpoint/model/codec，不更動既有 repository 回傳型別。
  Search item 就直接是既有 `Post` shape（boolean viewer flags、`post:<id>` timelineEntryId、null
  repost attribution），不發明第二種 shape。

## 驗證策略

1. Migration：empty、populated V7→V8 upgrade、rebuild backfill 等價（每篇既有 post 可配對）、
   `sqlite_master` 的 FTS virtual table/triggers、trigger 同步與 fail-closed rollback、
   `PRAGMA integrity_check`、keyset index。不設 external-content FTS shadow-table 期望。
2. Query compile：trim/length/term 數/字元集邊界、quote escape、operator/wildcard 不改變
   structure、bound parameter、無 wildcard/prefix、punctuation-only term invalid、malformed
   syntax 到不了 MATCH。
3. Cursor/keyset：canonical `s1:` codec、strict invalid cases、timeline v2/legacy/notification token
   rejection、equal-timestamp tiebreak、between-page insert、invalid boundary、分頁不漏不重。
4. API/security：public anonymous + authenticated viewer-aware（boolean false/true）、`private,
   no-store`、RFC 碼（`INVALID_QUERY`/`INVALID_LIMIT`/`INVALID_CURSOR`）、matcher 不擋 anonymous、
   missing `q` 走 service validation、operational failure 回 `INTERNAL_ERROR`。
5. Frontend：lint、TypeScript/Vite build；runtime 驗證 direct route、stale query、session
   change refresh、logout anonymous rerun、load-more dedupe。
6. Delivery：multi-stage Docker build、clean/populated V7→V8 migration、production runtime smoke、
   GitHub Actions final-head 與 post-merge master。
