# FE Review — cms-scaffold — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認）。每次修改都走 PR。

## 目標

cms-scaffold 的前端正在依 v2 路線圖（`docs/v2/README.md`）逐波重寫；畫面、元件、路由的修改都已寫成施工圖（W1～W5、W3b），由 v2 波次交付。fe-review 不另起一套前端修改，而是讓自己的擷取工作包跟上 v2：第 2 輪結束時，三個 app（web-front、web-back、web-admin）能在 PROTOCOL 第 0 節的隔離環境內以 `dev:mock`（MSW、合成 fixture，不需要後端或 JDK）只綁 `127.0.0.1` 啟動，`targets.json` 的頁面清單與 v2 完成後的路由一致並改為 `verified: true`，第 3 輪可以直接擷取。第 3 輪發現、且不屬於任何 v2 稽核 ID 的問題，才由新的第 2 輪 PR 修改前端。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **D1 採 (a)**：第 2 輪可以直接修改 `packages/ui`，條件是三個 app 的 `lint`／`typecheck`／`test`／`build` 與 `test:bundle` 都通過；PR 說明列出受影響的 app。本設計的修改項目目前都不需要動 `packages/ui`，這個假設約束的是第 3 輪之後的修正 PR。
- 相關規範：
  - 元件 `AGENTS.md`「v2」一節：一波一個 PR、只碰該波列出的路徑；元件只用 shadcn/ui（經 `packages/ui`）；前端閘門是 `lint`／`typecheck`／`test`／`build`，W0 起加 `test:bundle` 與 `e2e:mock`。
  - `docs/v2/01-frontend-sdd.md` §0：前端架構、視覺語言、元件、實作波次以 01 為權威；權限與資料可見性以 `docs/specs/surface-*.md` 為準。fe-review 的修改不得與兩者衝突。
  - v2 施工圖以「W(n-1) 的結果」為起點，`修改` 類檔案用帶行號的 diff 套用（`docs/v2/waves/W2.md`～`W4.md` 開頭的說明）。波次實作前改動同一批檔案，會讓後續施工圖無法套用（REVIEW.md C2）。
  - `docs/v2/01-frontend-sdd.md` Q-19（owner 2026-09-26）：`e2e:mock` 只在整個專案完成後執行。fe-review 第 3 輪同樣排在 v2 前端波次全部 `VERIFIED` 之後。
  - `docs/v2/01-frontend-sdd.md` Q-04 與 `packages/ui/src/tokens.css:4`：作業面（Back、Admin）在 v2 不做深色模式；Front 相簿站的深色是站點配色（`packages/ui/src/tokens.css:46` 的 `[data-scheme="gallery-dark"]`），不跟隨 `prefers-color-scheme`。

## 不做的事

- 不修改任何已列入 v2 稽核（`docs/v2/00-v1-frontend-audit.md` 的 F-、S-、C-、U-、E- 編號）或 v2 施工圖範圍的問題；它們由對應波次處理。
- v2 前端波次（W1、W2、W3、W3b、W4、W5）尚未 `VERIFIED` 前，不修改 `apps/*/src/`、`packages/*`、`apps/*/vite.config.ts`、`e2e-mock/`。
- 不修改後端（`services/cms-api`）、`openapi.yaml`、`packages/mocks` 的 fixture 與 handler、CI、依賴版本。
- 不改 `apps/*/vite.config.ts` 的 `host: true`（REVIEW.md D2 待決定；擷取改用啟動指令覆寫）。
- 不為作業面加深色模式，不做 v2 非目標（Front prerender、批次操作、token 預覽、Polaris 套件）。
- 不跑接真實 API 的 `npm run e2e`，不啟動 Compose 或後端。

## 修改項目

### M1 在隔離環境驗證目前 `main` 的擷取設定

- 對應：REVIEW.md「進入第 2 輪的條件」；PROTOCOL 第 1 節第 2 輪完成條件。
- 現況：`targets.json` 為 `verified: false`，頁面清單、`?mockUser=` 路徑與啟動指令都由原始碼推斷。本 PR 已依原始碼修正：Back 登入頁是 `/sign-in`（`apps/web-back/src/routes.tsx:16` 把 `/login` 轉址）；`capture.mjs` 每張截圖開新的 browser context（`docs/fe-review/capture.mjs:114-119`），而 mock 的登入身分只存在 `sessionStorage`（`packages/mocks/src/state.ts:48-57`），所以需要登入的頁面都在路徑上帶 `?mockUser=`；`colorSchemes` 改為只有 `light`。
- 修改：只改 `apps/cms-scaffold/fe-review/`。
  1. 在 `apps/cms-scaffold/` 執行 `npm ci`，再從 repository root 執行 `node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --dry-run`。
  2. 用 `--start` 啟動三個 app 並擷取；逐頁確認 HTTP 200、沒有 page error、`?mockUser=` 頁面沒有被轉到 `/sign-in`、帶參數的路由（`coast-light-2026`、`coast-harbour`、`cms-scaffold`、`30000000-0000-4000-8000-000000000001`）在 fixture 裡存在。
  3. 依結果修正 `targets.json`、`PROMPT.md`；擷取失敗的原因寫進 `REVIEW.md`。本步驟不改 `verified`（見 M2）。
- 驗證：`--dry-run` 輸出的頁面數等於 `targets.json` 的頁面數；`capture.json` 每筆 `status` 為 200、`pageErrors` 為空。截圖不提交；`runs/<ts>/capture.json` 只在第 3 輪提交。
- 風險與回滾：只動文件，回滾即 revert 該 PR。擷取可能因 Chromium 系統庫缺失失敗，屬環境問題，記錄後改用元件已有的 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 做法（`playwright.mock.config.ts:25`）。

### M2 v2 前端波次全部完成後，同步頁面清單並改為 `verified: true`

- 對應：REVIEW.md C2；PROTOCOL 第 1 節第 2 輪完成條件。
- 現況：v2 會改動路由，例如 Admin 的 `/users`（`apps/web-admin/src/routes.tsx:15`）在 W4 改為 `/principals`（`docs/v2/waves/W4.md` 的「01 §7.3 路由」列），W1～W3b 另外新增 Back 的 `/media`、`/audit`、Front 的 `/clinic/vets`、`/clinic/me` 等頁面。現在標 `verified: true` 的清單在 W1 合併後就會過期。
- 修改：在 W1、W2、W3、W3b、W4、W5 都 `VERIFIED` 之後，依 `docs/v2/01-frontend-sdd.md` §7 的路由與 `packages/mocks` 的 fixture 重寫 `targets.json` 的 `pages`（每個 app 至少涵蓋 §7 的每條路由一次，帶參數的路由取 fixture 中存在的值），更新 `PROMPT.md` 的「主要流程」，再依 M1 的步驟跑一次，全部通過後把 `verified` 改為 `true`、`verifiedNote` 寫上日期與 commit。中途個別波次合併時不必同步；需要時可以只更新受影響的頁面。
- 驗證：同 M1；另外 `targets.json` 的每條路徑都能在該 app 的 `routes.tsx` 找到對應的 route。
- 風險與回滾：只動文件。若 v2 延後或中止，owner 可以決定在某個波次的結果上提前做 M2，並在本檔記錄基準波次。

## 啟動方式（第 2 輪要驗證的版本）

- 環境：PROTOCOL 第 0 節的容器（獨立 network namespace，不用 `--network host`）。Node 與 npm 依 `package-lock.json`；不需要 JDK、PostgreSQL、Docker。
- 安裝：`cd apps/cms-scaffold && npm ci`。
- 啟動：三個 app 各自在自己的目錄執行 `npm run dev:mock -- --host 127.0.0.1 --strictPort`（port 5173／5174／5175）。`--host 127.0.0.1` 必須帶，因為 `vite.config.ts` 預設 `host: true` 會綁所有介面（REVIEW.md C3）。
- 合成資料：`packages/mocks/fixtures/*.json`（MSW，在瀏覽器內攔截 API）。登入用 `?mockUser=<種子帳號>`，任何非空密碼都能登入（`wrong-password` 除外）；情境用 `?mock=slow|error500|empty|conflict`。不需要密碼檔或 token。

## 第 3 輪驗收

- 時機：v2 前端波次全部 `VERIFIED`、M2 完成之後。
- 頁面與流程：`targets.json` 的全部頁面；`PROMPT.md` 的「主要流程」與「狀態擷取」。
- 通過條件：
  - 無 blocker／major。
  - axe 無 critical／serious（與 v2 V2-AC-14 相同）。
  - 三種 viewport 無水平溢出；Back 在 390px 側欄收合、看板一次一欄（V2-AC-13）。
  - 可見文字不含 `PATCH`、`sortOrder`、`origin`、`(string)`（V2-AC-15）。
  - 載入中只出現 skeleton、不先出現空狀態文案（V2-AC-02，用 `?mock=slow` 擷取）。
- 已知不在驗收範圍：作業面深色模式（v2 不做）；接真實 API 的畫面（`npm run e2e`）；production build 的 bundle 大小以 `docs/v2/frontend-records.md` 的紀錄為準，不重測。

## 開放問題

- REVIEW.md D2：`apps/*/vite.config.ts` 的 `host: true` 是否改成只綁 loopback。本設計不處理，擷取以啟動指令覆寫。
