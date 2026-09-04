# 005：帳號與個人資料任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。

## A：規格與安全契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 列出 schema、author 欄位與 migration 相容限制。
  - [x] A.1.2 列出 backend/controller/repository extension points。
  - [x] A.1.3 列出 frontend identity state 與既有 test conventions。
- [x] **A.2 定義 account/auth contract**
  - [x] A.2.1 定義 handle、profile 與 password boundary。
  - [x] A.2.2 定義 register/login/logout/session/CSRF endpoints。
  - [x] A.2.3 定義 session cookie、fixation 與 CSRF lifecycle。
- [x] **A.3 定義 ownership 與驗收**
  - [x] A.3.1 定義 nullable FK、legacy snapshot 與不認領策略。
  - [x] A.3.2 定義 content/profile response compatibility。
  - [x] A.3.3 定義 RED/GREEN、Docker/runtime 與 CI quality gates。

## B：Schema 與 account persistence

- [x] **B.1 RED — V4 migration contract**
  - [x] B.1.1 測試 empty database 建立 accounts 與 ownership columns/indexes。
  - [x] B.1.2 測試 V3 database 保留 posts/replies/IDs/timestamps。
  - [x] B.1.3 測試 legacy baseline upgrade 且 ownership 保持 null。
- [x] **B.2 GREEN — Account schema/repository**
  - [x] B.2.1 新增 immutable `V4__add_accounts_and_ownership.sql`。
  - [x] B.2.2 新增 account domain/public profile models 與 repository。
  - [x] B.2.3 驗證 case-insensitive unique handle 與 profile update。
- [x] **B.3 GREEN/REFACTOR — Account service**
  - [x] B.3.1 實作 canonical handle/profile validation。
  - [x] B.3.2 以 delegating BCrypt encoder 保存並驗證 password。
  - [x] B.3.3 執行 focused migration/repository/service 與完整 regression tests。

## C：Session authentication 與 CSRF

- [x] **C.1 RED — Security contract**
  - [x] C.1.1 測試 CSRF token 取得、缺失拒絕與無副作用。
  - [x] C.1.2 測試 registration/login generic failure/session persistence。
  - [x] C.1.3 測試 session-ID rotation、logout invalidation 與 cookie attributes。
- [x] **C.2 GREEN — Spring Security wiring**
  - [x] C.2.1 新增 starter/test dependency、filter chain 與 route policy。
  - [x] C.2.2 實作 UserDetails、AuthenticationManager 與 session repository。
  - [x] C.2.3 實作 RFC 9457 authentication entry point/access denied handler。
- [x] **C.3 GREEN/REFACTOR — Auth API**
  - [x] C.3.1 實作 csrf/register/login/logout/session endpoints。
  - [x] C.3.2 確保 password/session/CSRF secrets 不進 response 或 log。
  - [x] C.3.3 執行 focused security tests 與完整 backend regression。

## D：Authenticated authorship 與 profile API

- [x] **D.1 RED — Ownership contract**
  - [x] D.1.1 測試具有效 CSRF 的 anonymous post/reply create 回 401 且 row count 不變。
  - [x] D.1.2 測試 authenticated create 忽略 spoofed author 並保存 owner。
  - [x] D.1.3 測試 legacy content 保留 author 且 `authorHandle=null`。
- [x] **D.2 GREEN — Content ownership**
  - [x] D.2.1 Create DTO 移除 author，controller 使用 authenticated principal。
  - [x] D.2.2 Repository 寫 ownership/snapshot，read 使用 account LEFT JOIN。
  - [x] D.2.3 保持 timeline/replies cursor ordering、reply count 與 seed behavior。
- [x] **D.3 GREEN/REFACTOR — Profile API**
  - [x] D.3.1 實作 public profile read 與 404 contract。
  - [x] D.3.2 實作 current profile update 與 auth/validation contract。
  - [x] D.3.3 實作 author posts cursor page 並跑完整 backend suite。

## E：Frontend identity 與 profile experience

- [x] **E.1 API client boundary**
  - [x] E.1.1 抽出共用 Problem Details/same-origin fetch client。
  - [x] E.1.2 實作 in-memory CSRF lifecycle 與 fail-closed mutation。
  - [x] E.1.3 實作 accounts/session/profile typed API functions。
- [x] **E.2 Authentication/authorship UI**
  - [x] E.2.1 App boot 載入 CSRF/session，加入 register/login/logout flows。
  - [x] E.2.2 Composer 移除自由作者輸入並顯示目前 identity/登入提示。
  - [x] E.2.3 Reply composer 同步 session identity 並保留 error fallback。
- [x] **E.3 Profile UI 與 gate**
  - [x] E.3.1 實作 `/profiles/{handle}` view、author links 與 posts pagination。
  - [x] E.3.2 實作 owner display name/bio edit 與全頁 state refresh。
  - [x] E.3.3 執行 frontend lint、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 auth/profile API、CSRF client sequence 與 error codes。
  - [x] F.1.2 記錄 session timeout、cookie Secure 與 restart logout 限制。
  - [x] F.1.3 更新 architecture、migration runbook、roadmap 與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean V4 migration。
  - [x] F.2.2 Runtime register/login/rotation/authenticated authorship smoke。
  - [x] F.2.3 Runtime profile/logout/anonymous/CSRF failure smoke。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠。
  - [x] F.3.3 固化 verification evidence 並完成 SDD-005。
