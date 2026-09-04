# 007：文章轉發任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。

## A：規格與 activity 契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 盤點 post identity、likes/replies 與 legacy ownership boundaries。
  - [x] A.1.2 盤點 cursor/query/migration/security extension points。
  - [x] A.1.3 盤點 frontend render key、dedup 與 cross-copy state flow。
- [x] **A.2 定義 repost contract**
  - [x] A.2.1 定義冪等 PUT/DELETE、RepostState 與 viewer-aware fields。
  - [x] A.2.2 定義 original attribution、timeline entry identity 與 shared interactions。
  - [x] A.2.3 定義 self/legacy repost、auth/CSRF/cache 與非目標。
- [x] **A.3 定義 fan-out/cursor 與驗收**
  - [x] A.3.1 定義 global channel/profile activity membership 與 unrepost semantics。
  - [x] A.3.2 定義 versioned mixed cursor 與 legacy token compatibility。
  - [x] A.3.3 定義 BDD、RED/GREEN、Docker/runtime 與 CI gates。

## B：V6 repost persistence

- [x] **B.1 RED — Migration contract**
  - [x] B.1.1 測試 empty database 建立 event ID、unique relation、FK 與 indexes。
  - [x] B.1.2 測試 populated V5/V4/V3 upgrade 保留 content/likes/ownership/IDs。
  - [x] B.1.3 測試 legacy baseline upgrade 到 V6 且既有內容沒有 repost activity。
- [x] **B.2 GREEN — Schema 與 repository**
  - [x] B.2.1 新增 immutable `V6__add_post_reposts.sql`。
  - [x] B.2.2 實作 conflict-safe repost 與精確 unrepost operations。
  - [x] B.2.3 實作 authoritative count/viewer state 並保存 activity timestamp。
- [x] **B.3 GREEN/REFACTOR — Persistence behavior**
  - [x] B.3.1 驗證同 actor 重送不增 row 且不 bump activity time。
  - [x] B.3.2 驗證兩 actor shared count、isolated state 與 cascade constraints。
  - [x] B.3.3 執行 focused migration/repository 與完整 backend regression。

## C：Mixed timeline 與 attribution

- [x] **C.1 RED — Cursor/read contract**
  - [x] C.1.1 測試同秒 original/repost mixed ordering 與逐頁不漏不重。
  - [x] C.1.2 測試 legacy cursor decode、v2 canonical validation 與 invalid tokens。
  - [x] C.1.3 測試 channel/profile fan-out、attribution 與 activity identity。
- [x] **C.2 GREEN — Query/model/cursor wiring**
  - [x] C.2.1 擴充 Post、TimelinePost projection 與 RepostState models。
  - [x] C.2.2 實作 original/repost UNION、tuple predicate 與 limit+1 page。
  - [x] C.2.3 實作 versioned encoder/decoder 與 legacy positive-post compatibility。
- [x] **C.3 GREEN/REFACTOR — Viewer/shared state regressions**
  - [x] C.3.1 計算 repost count/EXISTS 並保持 private no-store cache。
  - [x] C.3.2 保持原文 ID、reply/like fields、author snapshot 與 channel semantics。
  - [x] C.3.3 執行 focused cursor/controller/repository 與完整 backend suite。

## D：Authenticated repost API

- [x] **D.1 RED — Mutation contract**
  - [x] D.1.1 測試 repost/unrepost lifecycle、重送與 authoritative response。
  - [x] D.1.2 測試 invalid/missing/self/legacy post 與 actor identity boundary。
  - [x] D.1.3 測試 anonymous/CSRF 拒絕且 relation/timeline 無副作用。
- [x] **D.2 GREEN — API/service wiring**
  - [x] D.2.1 實作 transactional service 與 PUT/DELETE controller。
  - [x] D.2.2 明確保護 repost routes 並只信任 authenticated principal。
  - [x] D.2.3 對齊既有 validation、Problem Details 與 request ID。
- [x] **D.3 GREEN/REFACTOR — Mutation regressions**
  - [x] D.3.1 驗證兩 actor interleaving 與 DELETE 只移除 actor activity。
  - [x] D.3.2 驗證 mutation 不改原文 timestamp/content/likes/replies。
  - [x] D.3.3 執行 focused security/API 與完整 backend suite。

## E：Frontend repost experience

- [x] **E.1 Typed API 與 pure state helpers**
  - [x] E.1.1 擴充 Post/RepostState types 與 PUT/DELETE client functions。
  - [x] E.1.2 實作 repost snapshot、optimistic、reconcile 與 rollback helpers。
  - [x] E.1.3 驗證 count floor、repost-only patch 與 multi-copy functional update。
- [x] **E.2 Attribution、keys 與 interaction**
  - [x] E.2.1 PostCard 顯示 reposter attribution、count/state 與 accessible toggle。
  - [x] E.2.2 Render/load-more dedup 改用 timelineEntryId，互動同步仍用 post ID。
  - [x] E.2.3 以 shared per-post guard 防止 like/repost out-of-order mutations。
- [x] **E.3 Activity refresh 與 gate**
  - [x] E.3.1 App 成功後 reconcile 並刷新三欄權威 activity membership。
  - [x] E.3.2 ProfileView 同步 optimistic fields 並刷新 profile activity page。
  - [x] E.3.3 執行 frontend lint、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 repost API、timeline JSON、fan-out 與 cursor contract。
  - [x] F.1.2 記錄 V6 upgrade/backup/rollback、indexes 與 query constraints。
  - [x] F.1.3 更新 architecture、development、roadmap 與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean/populated V5-to-V6 migration。
  - [x] F.2.2 Runtime 驗證 two-viewer repost/idempotency/attribution/fan-out。
  - [x] F.2.3 Runtime 驗證 mixed cursor/unrepost/anonymous/CSRF/profile/SPA paths。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠。
  - [x] F.3.3 固化 verification evidence、完成 SDD-007 並 merge。
