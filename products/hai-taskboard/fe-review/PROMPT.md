# FE Review Prompt — hai-taskboard

你是負責 **hai-taskboard** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**，[`DESIGN.md`](DESIGN.md) 已草擬待確認。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `products/hai-taskboard/`
- **一句話：** Human–AI delivery control plane 的看板：React 19 + Vite 8 + Tailwind 4 的 SPA（`web/`，目前以 fixtures 驅動），後端是 Go。
- **技術棧：** React 19、Vite 8、Tailwind 4；Vitest、Playwright、axe；後端 Go
- **UI 入口：** `products/hai-taskboard/web/`（單一路由 SPA，資料來自 `src/fixtures.ts`，畫面切換靠元件狀態而非 URL）

## 啟動線索（未驗證）

- 專案釘選 Node 24.20.0、pnpm 11.25.0（`docs/reproducibility.md`），只有 `pnpm-lock.yaml`，不能用 `npm ci`。
- 在 `web/` 執行 `corepack pnpm install --frozen-lockfile`，再 `corepack pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 四個 surface（Board、Work item、Attention、Impact preview，由導覽按鈕切換）
- Board 選取 work item → 一次被接受的轉移 → 一次被 QA guard 拒絕的轉移 → Attention 的 recovery／stale 狀態
- 用畫面上的主題按鈕切到深色後重拍（主題不跟隨系統設定，`colorSchemes` 無效）

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 因為沒有 URL 路由，需要在 capture 後用 Playwright 互動腳本補拍各 surface、轉移結果與深色主題（畫面上沒有對話框），腳本放在 `fe-review/`。
- 轉移被拒絕時，畫面上是否有可見回饋（目前只有 `sr-only` 的 live region，見 REVIEW.md C3）。
- 卡片密度、欄位捲動、拖曳或鍵盤轉移的可達性（參考既有 `board-transition-accessibility.spec.tsx`）。
- 主題與縮放（既有 `responsive-theme-zoom.spec.tsx`）：200% zoom 下不破版。

## 可重用的既有資產

- `web/src/*.spec.tsx`：既有互動與 a11y 測試（Vitest + jsdom），對照其涵蓋範圍。
- `web/package.json` 已有 `@playwright/test` 與 `@axe-core/playwright` devDependencies，擷取腳本直接使用，不另裝。

## 待補的頁面

無路由參數；以互動腳本擷取次級狀態。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs products/hai-taskboard/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/hai-taskboard/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
