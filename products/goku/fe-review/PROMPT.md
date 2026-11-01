# FE Review Prompt — goku

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D2 改用無敏感值環境範例並移出追蹤；D3 不做 major 升級。 第2輪 M1–M3 已實作且必要本機實測已結清；第3輪未啟動。
你是負責 **goku** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第2輪 M1–M3 local candidate; independent acceptance / current CI pending**。原生 lint/build、store 回歸與分段 synthetic runtime 已通過；原失敗、版本差異與最後補證見 [報告](tasks/round2/report.md)。入口改用 [RUNNER.md](RUNNER.md) 的 owned harness，不能使用來源樹 mock DB。

## 專案概況

- **元件路徑：** `products/goku/`
- **一句話：** 書籤 ingestion 與管理：React 18 + Vite 5 + Tailwind 3 的 SPA（`web/`），後端是 Go API，另可用 json-server mock。
- **技術棧：** React 18、Vite 5、Tailwind 3、Zustand；Tiptap 是未接線的依賴。後端 Go（API、CLI、MQTT consumer）。
- **UI 入口：** `products/goku/web/`（API base 由 `VITE_API_URL` 決定，預設 `http://localhost:3001/api`；`npm run mock` 以 json-server 在 3001 提供假資料）

## 隔離啟動介面

- 第2輪原始介面見 [DESIGN.md](DESIGN.md)：mock 使用 task 目錄的一次性合成資料、明確 loopback 與 API URL。現有 `npm run mock` 會寫來源樹且沒有明確 loopback，不直接作為隔離驗收程序。
- `web/.env` 已從工作樹刪除；`web/.env.example` 保留同值 `VITE_API_URL`。parent 已核對 staged 移出追蹤，見 [M1 證據](tasks/round2/evidence/env-staging.json)。
- 第 2／3 輪依 DESIGN 在 launcher task 目錄產生新的合成資料，明確使用本機 URL／favicon；不沿用或修改來源樹 `mock/db.json`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 書籤列表 → 搜尋 → 開啟原生編輯表單 → 儲存 → 側欄分類切換；目前 Tiptap 僅為依賴，未接線到 BookmarkEditor，篩選行為也仍須實測。

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- BookmarkGrid 在三種寬度的欄數與卡片高度一致性。
- 原生編輯表單的 focus、長內容、notes 與儲存狀態，不擷取不存在的 Tiptap toolbar。
- 搜尋無結果與 API 失敗狀態。

## 可重用的既有資產

- `web/mock/routes.json`：現有 mock 路徑契約。資料另行產生；不能把現有資料檔未經確認視作安全合成 fixture。

## 待補的頁面

無路由；以互動腳本補拍編輯器與選單狀態。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs products/goku/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/goku/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
