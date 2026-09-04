# 006：文章按讚任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。

## A：規格與契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 盤點 account identity、post ownership 與 legacy compatibility。
  - [x] A.1.2 盤點 repository query、migration 與 security extension points。
  - [x] A.1.3 盤點 frontend feed/profile state 與現有 validation gates。
- [x] **A.2 定義 like contract**
  - [x] A.2.1 定義冪等 PUT/DELETE、LikeState 與 post response 欄位。
  - [x] A.2.2 定義 session/CSRF、viewer isolation 與 no-side-effect errors。
  - [x] A.2.3 定義 self/legacy likes、cache policy 與非目標。
- [x] **A.3 定義設計與驗收**
  - [x] A.3.1 定義 V5 composite key、FK 與 transaction boundary。
  - [x] A.3.2 定義 optimistic/reconcile/rollback frontend state machine。
  - [x] A.3.3 定義 RED/GREEN、Docker/runtime 與 CI quality gates。

## B：V5 persistence

- [x] **B.1 RED — Migration contract**
  - [x] B.1.1 測試 empty database 建立 post_likes、composite PK 與 foreign keys。
  - [x] B.1.2 測試 V4/V3 upgrade 保留 accounts/posts/replies 與 IDs。
  - [x] B.1.3 測試 legacy baseline upgrade 到 V5 且既有內容未被 like。
- [x] **B.2 GREEN — Schema 與 repository**
  - [x] B.2.1 新增 immutable `V5__add_post_likes.sql`。
  - [x] B.2.2 實作 conflict-safe like 與精確 unlike operations。
  - [x] B.2.3 實作 authoritative count/viewer state query。
- [x] **B.3 GREEN/REFACTOR — Persistence behavior**
  - [x] B.3.1 驗證同 actor 重送 like/unlike 都冪等。
  - [x] B.3.2 驗證兩 actor 各自 state 與共享 count。
  - [x] B.3.3 執行 focused migration/repository 與附近 regression tests。

## C：Viewer-aware post reads

- [x] **C.1 RED — Read contract**
  - [x] C.1.1 測試 anonymous timeline count 正確且 viewer state false。
  - [x] C.1.2 測試 liker/non-liker session 得到各自 viewer state。
  - [x] C.1.3 測試 profile timeline、legacy post 與 cache headers。
- [x] **C.2 GREEN — Query/model wiring**
  - [x] C.2.1 擴充 Post model 與 row mapping 的 non-null like fields。
  - [x] C.2.2 以 bounded query 計算 count 與 authenticated EXISTS。
  - [x] C.2.3 從 timeline/profile controller 傳遞 optional viewer ID。
- [x] **C.3 GREEN/REFACTOR — Read regressions**
  - [x] C.3.1 保持 channel/profile cursor page ordering 與 bounds。
  - [x] C.3.2 保持 replyCount、author snapshot 與 ownership behavior。
  - [x] C.3.3 執行 focused controller/repository 與完整 backend suite。

## D：Authenticated like API

- [x] **D.1 RED — Mutation contract**
  - [x] D.1.1 測試 like/unlike lifecycle、重送與 authoritative response。
  - [x] D.1.2 測試 invalid/missing post、self-like 與 legacy post。
  - [x] D.1.3 測試 anonymous/CSRF 拒絕且 database 無副作用。
- [x] **D.2 GREEN — API/service wiring**
  - [x] D.2.1 實作 LikeState、transactional service 與 controller。
  - [x] D.2.2 明確保護 PUT/DELETE route 並只信任 principal actor。
  - [x] D.2.3 對齊 existing validation、Problem Details 與 request ID。
- [x] **D.3 GREEN/REFACTOR — Mutation regressions**
  - [x] D.3.1 驗證兩 actor interleaving 不覆蓋彼此 relation。
  - [x] D.3.2 驗證 mutation 不改 post timestamp/cursor membership。
  - [x] D.3.3 執行 focused security/API 與完整 backend suite。

## E：Frontend optimistic experience

- [x] **E.1 Typed API 與 pure state helpers**
  - [x] E.1.1 擴充 Post/LikeState type 與 PUT/DELETE client functions。
  - [x] E.1.2 實作 optimistic、server reconcile 與 snapshot rollback helpers。
  - [x] E.1.3 驗證 count floor、functional update 與 viewer-dependent reload。
- [x] **E.2 Like interaction**
  - [x] E.2.1 PostCard 顯示 count/state 並提供可存取的 toggle button。
  - [x] E.2.2 以 per-post pending guard 防止 rapid/out-of-order mutations。
  - [x] E.2.3 Anonymous/security-not-ready 不送 request 並顯示 actionable feedback。
- [x] **E.3 Cross-view synchronization 與 gate**
  - [x] E.3.1 App 同步更新所有 feed copies 並以 server state 對齊。
  - [x] E.3.2 ProfileView 使用相同 helper 並在 failure 復原。
  - [x] E.3.3 執行 frontend lint、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 like API、viewer-aware post fields 與 error contract。
  - [x] F.1.2 記錄 V5 upgrade/backup/rollback 與 query constraints。
  - [x] F.1.3 更新 architecture、development、roadmap 與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean/V4-to-V5 migration。
  - [x] F.2.2 Runtime 驗證 register/login/like/idempotency/viewer isolation。
  - [x] F.2.3 Runtime 驗證 unlike/anonymous/CSRF/profile/SPA failure paths。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠。
  - [x] F.3.3 固化 verification evidence、完成 SDD-006 並 merge。
