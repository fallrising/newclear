# FE Review — dim-gate — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認假設）。每次修改都走 PR。

## 目標

第 2 輪結束時，dim-gate 能在 PROTOCOL 第 0 節的隔離環境內，以 demo 模式和合成 seed 單獨啟動，只綁 `127.0.0.1`。fe-review 能擷取三個中心（RD／Ops／Admin）主要頁面在三種 viewport、淺色與深色主題下的截圖和 `capture.json`，而且不需要改動元件的產品程式碼。`targets.json` 已實際跑通，並改為 `verified: true`。流程正確性仍由既有 `e2e/` 負責，fe-review 不另寫一套流程斷言。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **A1（對應 D1，採建議 (a)）**：fe-review 只負責截圖與視覺／a11y／水平溢出檢查；流程正確性（狀態機、權限、審批、回滾）交給既有 `e2e/`。fe-review 的腳本只做「導航到頁面並擷取」，不新增流程斷言，也不從 `e2e/` 產生頁面清單。
  - **A2（由 A1 推出）**：需要切換示範身分或主題才看得到的頁面，另寫一支只做擷取的 Playwright 腳本放在 `fe-review/`（PROMPT.md「執行步驟」第 3 輪已允許），不修改 `docs/fe-review/capture.mjs`（共用腳本，不在本元件範圍）。
- 相關規範：
  - 元件 `AGENTS.md`：Mock-first、fixtures 不放真實資料、「文件先行」、不自動 merge／部署；驗證指令見「驗證與交付」一節。
  - `SDD.md` 第 7 節：桌面優先、繁中介面、可鍵盤操作、明暗主題與密度切換；拓撲首屏最多 100 nodes／200 edges。
  - PROTOCOL 第 0 節（只綁 loopback、合成資料）、第 2 節（`runs/.state/`、`storageState` 不提交）、第 4 節（第 2 輪修改範圍）。

## 不做的事

- 不修改元件的產品程式碼、樣式、`e2e/`、依賴或 CI。本設計的修改只在 `platform/dim-gate/fe-review/` 內。第 3 輪截圖發現的前端問題寫回 `REVIEW.md`，由新的第 2 輪 PR 處理，不在本設計範圍內。
- 不修改共用的 `docs/fe-review/capture.mjs`，不為它加上互動或身分切換功能。
- 不重寫或搬移既有 `e2e/` 的流程測試，fe-review 也不重複斷言流程（A1）。
- 不做 live 模式、真實雲端連線、Service Worker 以外的後端，也不做 major 依賴升級。
- 不擷取 synthetic 5,000 CI benchmark dataset（`pnpm benchmark`）的畫面。

## 修改項目

### M1 修正並驗證 `targets.json` 的啟動方式與頁面路徑
- 對應：demo 模式啟用方式與頁面路徑（本 PR 已對照原始碼釐清，REVIEW.md 不再列為矛盾點）
- 現況：
  - 元件用 pnpm（`package.json:6`、`README.md:24-29`），但 `targets.json` 原本寫 `npm ci`／`npm run dev`。
  - demo 模式只從 `.env.demo:1` 載入，需要 `--mode demo`。沒帶時 `src/app/main.tsx:8-12` 會顯示 `DATA_MODE_REQUIRED` 啟動錯誤頁，而不是 demo 資料。
  - Vite base 是 `/dim-gate/`（`vite.config.ts:7`）。`capture.mjs:132` 用 `new URL(pg.path, app.baseUrl)` 解析路徑，以 `/` 開頭的 path 會丟掉 base。
  - 原清單中的 `/cis/ci-aws-checkout-01`、`/alert-rules`、`/slo-policies` 是 mock API 路徑（`src/domain/monitoring-views.ts:37`、`src/domain/engine.ts:346`），不是 UI 路由。UI 路由以 `src/app/routes/AppRoutes.tsx:50-105` 為準，CI 詳情是 `/ops/cmdb/:ciId`（`AppRoutes.tsx:64`）。
- 修改：本 PR 已先依原始碼改寫 `targets.json`：pnpm、`pnpm dev --mode demo --port 5173 --strictPort`、`ready: /dim-gate/`、所有 path 都帶 `/dim-gate/` 前綴，頁面換成實際 UI 路由。第 2 輪在隔離環境實跑 `--dry-run` 與正式擷取，修正不符之處，再改成 `verified: true` 並寫上日期。
- 驗證：`node docs/fe-review/capture.mjs platform/dim-gate/fe-review/targets.json --dry-run`；再以 `--start` 實跑，確認每頁 HTTP 200、沒有 `DATA_MODE_REQUIRED`／page error，截圖不是白屏。
- 風險與回滾：只改 fe-review 設定，不影響產品。回滾即還原 `targets.json`。

### M2 以身分與主題為參數的擷取腳本
- 對應：C3、C4（本 PR 新增）；假設 A1、A2
- 現況：
  - `capture.mjs:114-120` 每頁都開新的 browser context。demo session 存在各分頁的 `sessionStorage`，並由 Web Locks 綁定分頁（`src/demo/browser.ts:15-37`），所以每頁都是新 seed 加上預設身分 `user-rd-commerce`（`src/demo/controller.ts:72`）。這個身分只有 RD 中心（`src/demo/seed/core.ts:4`），Ops／Admin 頁面只會顯示 403（`src/app/layouts/CenterLayout.tsx:9`）。
  - 主題由 `localStorage` 的 `dim-gate.ui.v1` 決定（`src/app/shell/AppShell.tsx:27-31`、`:61`），不跟隨 `prefers-color-scheme`。`capture.mjs` 的 `colorSchemes: ["dark"]` 只會擷取到淺色主題。
- 修改：新增 `platform/dim-gate/fe-review/capture-personas.mjs`（只做擷取）：
  - 參數：身分（`user-ops`、`user-admin`、`user-rd-commerce`）× 主題（light／dark）× 三種預設 viewport。
  - 每個組合開一個 context，用 `addInitScript` 寫入 `dim-gate.ui.v1` 的主題值（非機密的 UI 偏好）。先載入 `/dim-gate/`，再用頁首「示範身分」combobox 切換身分（與 `e2e/foundation.spec.ts:22` 相同的操作），然後在同一分頁依序 `goto` 該身分的頁面清單。`sessionStorage` 在重新載入後仍保留。
  - 頁面清單寫在同目錄的 `personas.json`：Ops 是 `/ops`、`/ops/cmdb`、`/ops/cmdb/ci-aws-checkout-01`、`/ops/topology`、`/ops/incidents`、`/ops/releases`、`/ops/alerting`、`/ops/capacity`；Admin 是 `/admin`、`/admin/access`、`/admin/users`、`/admin/features`、`/admin/audit`、`/admin/catalog`；RD 的深色主題沿用 `targets.json` 的頁面。
  - 輸出沿用 PROTOCOL 第 2 節格式：`runs/<ts>/screenshots/<persona>__<page>__<viewport>__<scheme>.png`（不提交），`capture.json` 欄位與 `capture.mjs` 相同（HTTP status、console／page error、failed requests、水平溢出、axe）。
  - 只用合成 seed 與示範身分，不產生也不寫入任何帳號、token 或 cookie。
- 驗證：從 repository root 執行 `node platform/dim-gate/fe-review/capture-personas.mjs --dry-run`，列出計畫；再實跑一次，確認 Ops／Admin 頁面不是 403，深色截圖的 `html[data-theme="dark"]` 已套用。腳本沒有流程斷言，只在頁面無法載入時記錄失敗。
- 風險與回滾：腳本只在 fe-review 使用，不進 `pnpm test:e2e`、不進 CI。回滾即刪除這兩個檔案。重點風險是頁首 combobox 名稱改變時腳本會失效，應明確報錯，不可默默退回預設身分。

### M3 讓 `PROMPT.md` 與 A1 的分工一致，並補齊帶參數的頁面
- 對應：C2、D1（假設 A1）
- 現況：`PROMPT.md` 的「主要流程」原本寫成需要「走通」的流程，與 A1 的分工不一致。「待補的頁面」與「啟動線索」也與原始碼不符（見 M1）。
- 修改：本 PR 已先改寫 `PROMPT.md`：啟動線索改為 pnpm 與 demo 模式；主要流程改為「依序擷取」，流程正確性以既有 e2e 為準；列出身分與主題的擷取方式。第 2 輪完成 M2 後，把帶參數的頁面補進 `targets.json`／`personas.json`，id 從 `src/demo/seed/` 取（例如 `app-checkout`、`env-checkout-prod`、`w2-catalog-redis`）。事件、發布、pipeline 這類執行時才產生的 id，改由腳本從列表頁點進第一筆取得，不寫死。
- 驗證：`pnpm check:docs`（元件文件的連結檢查，也涵蓋 `fe-review/*.md`）；PROMPT.md 提到的每個路徑都能在 `AppRoutes.tsx` 找到。
- 風險與回滾：只改文件。回滾即還原 `PROMPT.md`。

## 啟動方式（第 2 輪要驗證的版本）

在隔離容器內，於 `platform/dim-gate/` 執行：

```sh
pnpm install --frozen-lockfile
pnpm dev --mode demo --port 5173 --strictPort   # package.json 的 dev 已帶 --host 127.0.0.1
```

- URL：`http://127.0.0.1:5173/dim-gate/`。`/dim-gate/` 會導向目前身分的第一個中心（`AppRoutes.tsx:50`），預設是 `/dim-gate/rd`。
- 合成資料：內建 seed（`src/demo/seed/`），由 MSW Service Worker 提供（`public/mockServiceWorker.js`）。不需要後端、帳號或憑證。
- 需要 loopback（Service Worker 與 Web Locks 要求 localhost 或 HTTPS），瀏覽器必須支援 Web Locks。
- 替代方案（接近 production）：`pnpm build --mode demo && pnpm preview --port 4173 --strictPort`，與既有 `playwright.config.ts:22` 相同。第 2 輪確認哪一個比較穩定，並同步到 `targets.json`。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的全部頁面（預設 RD 身分、淺色主題，另含 Ops／Admin 的 403 狀態頁），加上 `personas.json` 中三個身分 × 兩個主題的頁面。PROMPT.md「主要流程」的每一步都要有截圖。
- 通過條件：沒有 blocker／major；axe 沒有 critical／serious；三種 viewport 都沒有水平溢出（高密度表格若設計成容器內水平捲動，要在 REPORT 註明，並確認不是整頁溢出）；console 沒有 error；Ops／Admin 頁面不是 403。
- 已知不在驗收範圍：流程正確性（由 `pnpm test:e2e`／`test:smoke` 負責，A1）；Firefox／WebKit（既有 `test:smoke` 已涵蓋）；5,000 CI benchmark；live 模式。

## 開放問題

- 若擁有者否決 A1、改採 D1 (b)（頁面清單由既有 e2e 產生），M2／M3 要改成從 `e2e/` 匯出頁面清單，本設計需要重寫後重新確認。
