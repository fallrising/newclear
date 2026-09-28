# FE Review Prompt — dim-gate

你是負責 **dim-gate** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/dim-gate/`
- **一句話：** CMDB 核心的企業運維自助平台前端 demo：React 19 + Vite 8 + Tailwind 4 + Radix/shadcn + TanStack Query，資料來自內建 demo seed，不需後端。
- **技術棧：** React 19、Vite 8、Tailwind 4、Radix／shadcn、TanStack Query、React Router 7；Vitest、Playwright、axe
- **UI 入口：** `platform/dim-gate/`（純前端 SPA，Vite base `/dim-gate/`；demo 資料在 `src/demo/seed/`，由 MSW Service Worker 提供；模式只從 `.env.demo` 的 `VITE_DATA_MODE=demo` 載入，需要 `--mode demo`）
- **設計：** 第 2 輪的範圍見 [DESIGN.md](DESIGN.md)。

## 啟動線索（未驗證）

- `pnpm install --frozen-lockfile`，然後 `pnpm dev --mode demo --port 5173 --strictPort`（`dev` 已綁 127.0.0.1）。開 `http://127.0.0.1:5173/dim-gate/`。
- 沒帶 `--mode demo` 時會顯示 `DATA_MODE_REQUIRED` 啟動錯誤頁，而不是 demo 資料。
- 替代方案：`pnpm build --mode demo && pnpm preview --port 4173 --strictPort`，與既有 `playwright.config.ts` 的 webServer 相同。
- `targets.json` 的 path 都要帶 `/dim-gate/` 前綴；`capture.mjs` 以 `/` 開頭解析 path 時會丟掉 base。

## 身分與主題

- demo session 存在各分頁的 `sessionStorage`。`capture.mjs` 每頁都開新 context，所以一律是預設身分 `user-rd-commerce`，只有 RD 中心；Ops／Admin 頁面會顯示 403。`targets.json` 只擷取這個身分下的頁面，以及 403 狀態頁。
- 主題由 `localStorage` 的 `dim-gate.ui.v1` 決定，不跟隨 `prefers-color-scheme`。
- Ops（`user-ops`）、Admin（`user-admin`）與深色主題，由 DESIGN.md M2 的 `capture-personas.mjs` 處理：用頁首「示範身分」選單切換後，在同一分頁擷取。

## 主要流程

以下各步依序擷取、每步截圖。流程正確性（狀態機、權限、審批、回滾）以既有 `e2e/` 為準；fe-review 只做視覺、a11y 與版面檢查（DESIGN.md 假設 A1，對應 REVIEW.md D1）。

- Ops（`user-ops`）：維運概覽 → CMDB 列表（`/ops/cmdb`）→ CI 詳情（`/ops/cmdb/ci-aws-checkout-01`）→ 依賴拓撲（`/ops/topology`）
- RD（預設身分）：應用（`/rd/apps`）→ 服務目錄（`/rd/catalog`）→ 資源申請（`/rd/catalog/w2-catalog-redis/resource-request`）
- Admin（`user-admin`）：使用者（`/admin/users`）、角色與範圍（`/admin/access`）、稽核（`/admin/audit`）、功能灰度（`/admin/features`）

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 高密度表格與篩選器在 tablet／mobile 的處理（水平捲動 vs 卡片化）。
- 拓撲圖（`/ops/topology`）的可讀性、空狀態，以及超過首屏上限（100 nodes／200 edges）時的截斷提示。
- Admin 表單的鍵盤操作與 focus（既有 `m5-keyboard.spec.ts` 可參考）。
- 中英混排的長 CI 名稱、標籤截斷。

## 可重用的既有資產

- `platform/dim-gate/e2e/`：大量既有 Playwright spec 與 `browser-health.ts`。流程正確性、跨瀏覽器（`pnpm test:smoke`）與部分頁面的 axe／viewport 檢查（例如 `m2-admin.spec.ts`、`w5-identity.spec.ts`）已在這裡；fe-review 不重複斷言。
- `pnpm check:docs`、`pnpm check:architecture`：修改後必跑。

## 待補的頁面

- `/rd/apps/:appId/*`（resources、delivery、configuration、traffic、monitoring、alerts）：id 用 seed 的 `app-checkout`。
- `/ops/caches`、`/ops/messaging`、`/ops/clusters` 及其 `:ciId` 詳情：id 從 `src/demo/seed/resources.ts` 取。
- 事件、發布、pipeline、工作單等執行時才產生的 id：由 `capture-personas.mjs` 從列表頁點進第一筆取得，不寫死（DESIGN.md M3）。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 只實作 [DESIGN.md](DESIGN.md) 範圍內、且假設已確認的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs platform/dim-gate/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/dim-gate/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
