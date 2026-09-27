# FE Review Prompt — flowshot

你是負責 **flowshot** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `apps/flowshot/`
- **一句話：** Local-first 唯讀 Markdown annotation 桌面 App：Tauri 2（Rust）包 React 19 + Vite 8 前端。
- **技術棧：** Tauri 2（Rust）、React 19、Vite 8
- **UI 入口：** `apps/flowshot/`（Vite dev port 1420；原生視窗由 `npm run tauri dev` 開啟）

## 啟動線索（未驗證）

- headless 只擷取 Web 層：`npm ci` 後 `npm run dev -- --host 127.0.0.1`。
- 瀏覽器中沒有 Tauri IPC；若 App 因 `@tauri-apps/api` 失敗，以 Playwright `addInitScript` 注入最小的 IPC mock（放在 `fe-review/`），並在報告註明哪些畫面依賴原生能力。
- 原生視窗截圖需桌面環境或 xvfb，屬選用；`scripts/macos-window-check.swift` 只適用 macOS。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 開啟 Markdown 文件 → 閱讀 → 新增 annotation → 檢視 annotation 列表

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- Markdown 排版（標題、表格、程式碼區塊、長行）。
- annotation 標記與側欄的對應、對比、focus。
- 視窗縮小時的版面。

## 可重用的既有資產

- `src/App.test.tsx` 等既有測試。

## 待補的頁面

無路由；以 IPC mock 提供文件內容。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs apps/flowshot/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs apps/flowshot/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
