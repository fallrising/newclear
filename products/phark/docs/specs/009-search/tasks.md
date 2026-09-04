# 009：公開文章搜尋任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。

## A：規格與搜尋契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 盤點 posts/accounts schema、FTS5 支援與 V7→V8 migration extension points。
  - [x] A.1.2 盤點 timeline/notification cursor codec、keyset page、viewer projection 與
    security/cache patterns。
  - [x] A.1.3 盤點 frontend api/types、route、stale-response guard 與 PostCard 復用點。
- [x] **A.2 定義 query/cursor/pagination contract**
  - [x] A.2.1 定義 plain-term 正規化、長度/term 上限與 literal operator 語意。
  - [x] A.2.2 定義 canonical `s1:` search cursor 編碼、keyset boundary 與 invalid 錯誤。
  - [x] A.2.3 定義 public viewer-aware GET、完整 Post JSON shape、`private, no-store` 與錯誤契約。
- [x] **A.3 定義 migration/BDD/gates**
  - [x] A.3.1 定義 V8 external-content FTS5、migration-time rebuild 與 trigger 同步政策。
  - [x] A.3.2 定義 BDD 情境（backfill/trigger/query-structure/auth/timestamps/dedupe/session）。
  - [x] A.3.3 定義 RED/GREEN、Docker/runtime 與 final-head/post-merge CI gates。

## B：V8 FTS migration

- [x] **B.1 RED — Migration contract**
  - [x] B.1.1 測試 empty database 建立 `search_posts` FTS virtual table、triggers 與
    `PRAGMA integrity_check`。
  - [x] B.1.2 測試 populated V7 upgrade 保留資料且 rebuild 後每篇既有 post 都可配對搜尋。
  - [x] B.1.3 測試 rebuild 的 migration 原子性與 `flyway_schema_history` 一致。
- [x] **B.2 RED — Trigger/backfill contract**
  - [x] B.2.1 測試 AFTER INSERT 同步新 post 且原文可搜尋。
  - [x] B.2.2 測試 AFTER UPDATE/DELETE 同步、無殘留/缺漏。
  - [x] B.2.3 測試 trigger 寫入失敗時 post 寫入一起 rollback（fail-closed）。
- [x] **B.3 GREEN/REFACTOR — V8 schema**
  - [x] B.3.1 新增 immutable `V8__add_post_search.sql`（FTS virtual table、rebuild、triggers）。
  - [x] B.3.2 確認/補齊 `(created_at DESC, id DESC)` keyset index。
  - [x] B.3.3 執行 focused migration/trigger 與完整 backend regression。

## C：Query compilation 與 dedicated cursor

- [x] **C.1 RED — Query compile contract**
  - [x] C.1.1 測試 trim、1–100 code points 與 1–8 terms 邊界。
  - [x] C.1.2 測試每 term 至少一個 Unicode letter/digit、non-whitespace control 與
    punctuation-only term invalid、quote escape。
  - [x] C.1.3 測試 operator/wildcard 樣式 input（`NOT`、`OR`、`*`、`^`、`(`、`)`）被 compile 為
    逐字 quoted phrase AND，structure 不可被改變、malformed syntax 到不了 MATCH、無
    wildcard/prefix。
- [x] **C.2 RED — Cursor codec contract**
  - [x] C.2.1 測試 `s1:<epoch-second>:<positive-id>` canonical encode/decode。
  - [x] C.2.2 測試 signed epoch round-trip 與 rejection：padding、illegal alphabet、wrong version、
    plus sign/`-0`/leading zero、non-positive ID、overflow 與 non-canonical re-encode。
  - [x] C.2.3 測試 rejection：legacy timeline `1:<epoch>:<id>`、timeline v2 `2:<epoch>:<kind>:<id>`
    與 notification `1:<id>` 等其他 namespace cursor。
- [x] **C.3 GREEN/REFACTOR — Compile/codec wiring**
  - [x] C.3.1 實作 `SearchQueryCompiler`（bounded plain-term → bound FTS5 phrase AND，輸出保證有效語法）。
  - [x] C.3.2 實作 `SearchCursor`/`SearchCursorCodec` model。
  - [x] C.3.3 執行 focused compile/codec 與完整 backend suite。

## D：Search repository/service/HTTP API

- [x] **D.1 RED — Repository/service contract**
  - [x] D.1.1 測試 FTS MATCH + keyset `(created_at DESC, id DESC)` limit+1 分頁不漏不重。
  - [x] D.1.2 測試 viewer projection：完整 Post shape（channel、`post:<id>` timelineEntryId、null
    repost attribution）、counts、boolean viewer flags、legacy `display_name` fallback。
  - [x] D.1.3 測試相同 timestamp tiebreak、頁間新 post、invalid boundary 與 next cursor 正確；
    unexpected FTS/operational failure 回 `INTERNAL_ERROR` 而非 `INVALID_QUERY`。
- [x] **D.2 RED — Controller/security contract**
  - [x] D.2.1 測試 public GET `/api/search`：anonymous（viewer booleans false）與 authenticated
    viewer-aware response。
  - [x] D.2.2 測試 invalid query/limit/cursor → RFC 9457 `INVALID_QUERY`（含缺失 `q` 走 service
    validation）/`INVALID_LIMIT`/`INVALID_CURSOR`。
  - [x] D.2.3 測試 `Cache-Control: private, no-store`、matcher 不擋 anonymous、無 unprotected 狀態。
- [x] **D.3 GREEN/REFACTOR — Service/controller wiring**
  - [x] D.3.1 實作 `SearchRepository`/`SearchService`（read-only transaction、bound MATCH、
    limit+1、next cursor）。
  - [x] D.3.2 實作 `SearchController`、新增 `INVALID_QUERY` API error code 與 cache header。
  - [x] D.3.3 執行 focused repository/API/security 與完整 backend suite。

## E：Frontend search

- [x] **E.1 Typed API**
  - [x] E.1.1 復用既有 `PostPage` type 並新增 typed search GET client，不建立同形 page type。
  - [x] E.1.2 Header 新增 Search entry，query 帶入 `/search` route。
  - [x] E.1.3 Anonymous 身份仍可 public search，viewer booleans 為 `false`（非 null）。
- [x] **E.2 Route 與 view**
  - [x] E.2.1 App 新增 `/search` client route，支援 direct load、navigation 與 popstate。
  - [x] E.2.2 `SearchView` 顯示 loading/empty/error與 Load more，復用 `PostCard`。
  - [x] E.2.3 Query/route/account 改變時 bump request version 丟棄 stale response。
- [x] **E.3 Interaction/gate**
  - [x] E.3.1 Load-more 以 post id append/dedup；account/session 改變（含 logout）以新 viewer 身份
    重跑目前 query，logout 後以 anonymous 重跑而不 disabled 有效 public route。
  - [x] E.3.2 保留既有 authenticated reply/like/repost 互動且不新增 dependency。
  - [x] E.3.3 執行 frontend lint、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 search API、`s1:` query/cursor contract 與 V8 rebuild/trigger 語意。
  - [x] F.1.2 記錄 V8 upgrade/backup/rollback、FTS maintenance 與 keyset constraints。
  - [x] F.1.3 更新 architecture、development、roadmap 與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean/populated V7→V8 migration。
  - [x] F.2.2 Runtime 驗證 FTS5 compile options、backfill 完整性與 trigger 同步。
  - [x] F.2.3 Runtime 驗證 pagination/query/auth/cache/direct SPA route/session refresh。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠。
  - [x] F.3.3 Post-merge `master` CI 全綠、固化 verification evidence 並完成 SDD-009。
