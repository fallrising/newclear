# 008：帳號通知任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。

## A：規格與通知契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 盤點 reply/like/repost mutation、owner/actor 與 transaction boundaries。
  - [x] A.1.2 盤點 V1–V6 schema、cursor/page/security/cache extension points。
  - [x] A.1.3 盤點 frontend session、header、routing 與 account state flow。
- [x] **A.2 定義 event/unread contract**
  - [x] A.2.1 定義三種事件、recipient、self/legacy 與 idempotency semantics。
  - [x] A.2.2 定義 notification page JSON、opaque cursor 與 monotonic read-through。
  - [x] A.2.3 定義 auth/CSRF/cache、viewer isolation 與錯誤契約。
- [x] **A.3 定義 retention 與驗收**
  - [x] A.3.1 定義每收件者 500 筆 synchronous prune 與 no-backfill policy。
  - [x] A.3.2 定義 unlike/unrepost 歷史、取消後重做與 cascade semantics。
  - [x] A.3.3 定義 BDD、RED/GREEN、Docker/runtime 與 CI gates。

## B：V7 notification persistence

- [x] **B.1 RED — Migration contract**
  - [x] B.1.1 測試 empty database 建立 notifications/read state、checks、FK 與 index。
  - [x] B.1.2 測試 populated V6/V5/V4/V3 upgrade 保留資料且不回填 events。
  - [x] B.1.3 測試 legacy baseline upgrade 到 V7 並保持既有 IDs/integrity。
- [x] **B.2 RED — Event repository contract**
  - [x] B.2.1 測試 REPLY/LIKE/REPOST projection 與 current actor/post/reply content。
  - [x] B.2.2 測試 reply uniqueness、recipient isolation 與 FK/check constraints。
  - [x] B.2.3 測試第 501 筆 prune 最舊 row 且不影響其他 recipient。
- [x] **B.3 GREEN/REFACTOR — Schema 與 persistence**
  - [x] B.3.1 新增 immutable `V7__add_notifications.sql`。
  - [x] B.3.2 實作 insert/prune 與 current-content ID-desc page repository operations。
  - [x] B.3.3 執行 focused migration/repository 與完整 backend regression。

## C：Transactional event emission

- [x] **C.1 RED — Reply event contract**
  - [x] C.1.1 測試 owned post reply 原子建立 reply + REPLY notification。
  - [x] C.1.2 測試 self/legacy reply 不通知且正常建立來源 row。
  - [x] C.1.3 測試通知寫入失敗時 reply transaction rollback。
- [x] **C.2 RED — Like/repost event contract**
  - [x] C.2.1 測試首次 PUT 建立事件、重送 PUT 不重複且 timestamp/state 不變。
  - [x] C.2.2 測試 self/legacy interaction 不通知且 shared relation 正常。
  - [x] C.2.3 測試取消不撤回、重做產生新 ID 與 notification failure rollback。
- [x] **C.3 GREEN/REFACTOR — Service wiring**
  - [x] C.3.1 讓 like/repost insert 回 affected-row signal，database unique 仍為真值。
  - [x] C.3.2 實作 owner lookup，將三種 event insert/prune 接到 transactional services。
  - [x] C.3.3 執行 focused mutation/event 與完整 backend regression。

## D：通知 read/unread API

- [x] **D.1 RED — Cursor/read model contract**
  - [x] D.1.1 測試 v1 cursor encode/decode 與 strict canonical invalid cases。
  - [x] D.1.2 測試 ID-desc limit+1 分頁、latest/read-through 與逐頁不漏不重。
  - [x] D.1.3 測試 unread count、monotonic max、owned retained cursor validation。
- [x] **D.2 RED — API/security contract**
  - [x] D.2.1 測試 authenticated page/read lifecycle 與 camelCase response。
  - [x] D.2.2 測試 invalid limit/cursor/body 與 other-account cursor 無副作用。
  - [x] D.2.3 測試 anonymous/CSRF 拒絕、private no-store 與 matcher ordering。
- [x] **D.3 GREEN/REFACTOR — Controller/service wiring**
  - [x] D.3.1 實作 cursor codec、summary/read repository、service 與 page/read models。
  - [x] D.3.2 實作 GET/PUT controller、validation 與 explicit security matchers。
  - [x] D.3.3 執行 focused cursor/API/security 與完整 backend suite。

## E：Frontend notification center

- [x] **E.1 Typed API 與 session state**
  - [x] E.1.1 新增 notification item/page/read types 與 GET/PUT client functions。
  - [x] E.1.2 將 badge summary 接到 identity success/account switch lifecycle。
  - [x] E.1.3 Logout/anonymous 清空 notification state 且不發 protected request。
- [x] **E.2 Route、page 與 badge**
  - [x] E.2.1 AccountControls 新增 accessible notifications link 與 capped badge。
  - [x] E.2.2 App 新增 `/notifications` route 與 authenticated NotificationView。
  - [x] E.2.3 顯示三 type attribution/content/read state、empty/loading/error states。
- [x] **E.3 Pagination/read interaction 與 gate**
  - [x] E.3.1 以 notification ID/cursor append/dedup 並防 stale account response。
  - [x] E.3.2 Mark-all-read 成功同步 page/header，失敗精確保留 unread state。
  - [x] E.3.3 執行 frontend lint、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 notifications/read API、event lifecycle 與 no-backfill contract。
  - [x] F.1.2 記錄 V7 upgrade/backup/rollback、retention、indexes 與 query constraints。
  - [x] F.1.3 更新 architecture、development、roadmap 與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean/populated V6-to-V7 migration。
  - [x] F.2.2 Runtime 驗證 two-viewer 三事件、self/legacy/idempotency/retention。
  - [x] F.2.3 Runtime 驗證 pagination/unread/security/cache/badge/SPA route。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠。
  - [x] F.3.3 固化 verification evidence、完成 SDD-008 並 merge。
