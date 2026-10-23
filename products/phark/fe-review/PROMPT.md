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

- 依 [DESIGN.md](DESIGN.md) 的未執行提案，在獨立 network namespace 內以全新 SQLite／media 目錄起 Spring，明確綁 `127.0.0.1:8080`；使用即時產生的測試 secret 與合成帳號，不沿用現有資料。API seed harness 尚待 D1 確認及第 2 輪實作。
- 在 `frontend/` 執行 `npm ci` 與 `npm run dev -- --host 127.0.0.1 --port 5173`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → 多欄 deck → 發文（Composer）→ 回覆串 → 通知 → 個人頁 → 搜尋 → 檢舉

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 多欄 deck 在 mobile 的呈現（水平捲動 vs 單欄切換）。
- PostCard 的長文、media、回覆串縮排。
- 檢舉的固定 reason、pending／成功／失敗，以及帳號登入登出狀態；不增加原本沒有的確認流程或改變產品語意。

## 可重用的既有資產

- `frontend/src/api/`、`frontend/src/types/` 與 `docs/specs/` 的現有契約可供合成 fixture 對齊；尚無可直接使用的 FE review seed／互動 harness。規劃見 [DESIGN.md](DESIGN.md)，D1 仍待確認。

## 待補的頁面

`frontend/src/App.tsx:129` 已解析 `/`、`/notifications`、`/search?q=...` 與 `/profiles/:handle`。targets 保留無需動態 ID 的路由；profile handle 須在第 2 輪由合成 fixture 回應取得後加入，不假設已存在帳號。另走 direct load、back／forward 與互動狀態。

目前只驗收現有 light 色票；`index.css` 的 dark variant 宣告沒有對應深色 palette，不新增主題功能。手機 deck 的刻意內部橫向捲動與頁面非預期水平溢出要分別記錄。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 只實作已確認 `DESIGN.md` 的範圍；在隔離環境確認 UI 與真實 API／fixture 接線跑通，才修正 `targets.json` 並改為 `verified: true`；跑現有 `npm run lint`、`npm run build`（含 TypeScript），目前沒有 frontend test script，不虛構檢查結果。
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
