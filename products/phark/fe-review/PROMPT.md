# FE Review Prompt — phark

你是負責 **phark** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `products/phark/`
- **一句話：** Social stream deck：React 19 + Vite 8 + Tailwind 4 + Radix 的 SPA（`frontend/`），後端是 Spring（Maven）。
- **技術棧：** React 19、Vite 8、Tailwind 4、Radix；後端 Spring Boot（`backend/`，Maven）、SQLite
- **UI 入口：** `products/phark/frontend/`（`/api` 代理到 `http://localhost:8080`）

## 啟動線索（未驗證）

- 先依 `backend/` 的說明以本機 SQLite 起 Spring 服務（8080）並建立測試帳號與假貼文。
- 在 `frontend/` 執行 `npm ci` 與 `npm run dev -- --host 127.0.0.1 --port 5173`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → 多欄 deck → 發文（Composer）→ 回覆串 → 通知 → 個人頁 → 搜尋 → 檢舉

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 多欄 deck 在 mobile 的呈現（水平捲動 vs 單欄切換）。
- PostCard 的長文、media、回覆串縮排。
- 檢舉與帳號控制等危險操作的確認流程。

## 可重用的既有資產

- （無）

## 待補的頁面

無路由；以互動腳本切換各 view。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs products/phark/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/phark/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
