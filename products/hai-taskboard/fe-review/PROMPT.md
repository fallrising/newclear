# FE Review Prompt — hai-taskboard

你是負責 **hai-taskboard** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `products/hai-taskboard/`
- **一句話：** Human–AI delivery control plane 的看板：React 19 + Vite 8 + Tailwind 4 的 SPA（`web/`，目前以 fixtures 驅動），後端是 Go。
- **技術棧：** React 19、Vite 8、Tailwind 4；Vitest、Playwright、axe；後端 Go
- **UI 入口：** `products/hai-taskboard/web/`（單一路由 SPA，資料來自 `src/fixtures.ts`，畫面切換靠元件狀態而非 URL）

## 啟動線索（未驗證）

- 在 `web/` 執行 `npm ci` 與 `npm run dev -- --host 127.0.0.1 --port 5173`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 看板總覽 → 開啟 work item 詳情 → 嘗試狀態轉移（含被 guard 拒絕的情況）→ attention／recovery 狀態

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 因為沒有 URL 路由，需要在 capture 後用 Playwright 互動腳本補拍詳情面板、轉移對話框等狀態，並把腳本放在 `fe-review/`。
- 卡片密度、欄位捲動、拖曳或鍵盤轉移的可達性（參考既有 `board-transition-accessibility.spec.tsx`）。
- 主題與縮放（既有 `responsive-theme-zoom.spec.tsx`）：200% zoom 下不破版。

## 可重用的既有資產

- `web/src/*.spec.tsx`：既有互動與 a11y 測試，對照其涵蓋範圍。

## 待補的頁面

無路由參數；以互動腳本擷取次級狀態。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs products/hai-taskboard/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/hai-taskboard/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
