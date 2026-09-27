# FE Review Prompt — aweshore

你是負責 **aweshore** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**暫緩（退役）**。擁有者決定退役元件不進入第 2、3 輪；本檔只保留供日後恢復時參考。見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `labs/aweshore/`
- **一句話：** 早期 PKM 實驗：Qwik + Qwik City（SSR）+ Bulma 的 UI（`ui/`），後端是 Go。
- **技術棧：** Qwik、Qwik City（SSR）、Vite 5、Bulma；後端 Go
- **UI 入口：** `labs/aweshore/ui/`（`npm run dev` 以 SSR 模式啟動 Vite）

## 啟動線索（未驗證）

- 在 `ui/` 執行 `npm ci` 與 `npm run dev -- --host 127.0.0.1 --port 5173`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 首頁 → demo/notes → demo/todolist

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- SSR 與 hydration 後畫面一致（無閃爍、無 hydration error）。
- Bulma 元件與自訂 CSS 的混用。

## 可重用的既有資產

- （無）

## 待補的頁面

無。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs labs/aweshore/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs labs/aweshore/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
