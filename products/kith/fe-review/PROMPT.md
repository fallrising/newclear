# FE Review Prompt — kith

你是負責 **kith** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `products/kith/`
- **一句話：** 人機群聊產品：React 19 + Vite 6 + Tailwind 4 + Radix + TanStack Query/Virtual 的 SPA（`web/`），後端是 Cloudflare Workers + Hono + D1。
- **技術棧：** React 19、Vite 6、Tailwind 4、Radix、TanStack Query／Virtual、Zustand、React Router 7；後端 Hono on Cloudflare Workers（wrangler）、D1
- **UI 入口：** `products/kith/web/`（SPA，dev port 5174，`/api`、`/mcp` 代理到 `KITH_API_ORIGIN`，預設 `http://127.0.0.1:8787`）

## 啟動線索（未驗證）

- 在 `products/kith/` 執行 `npm ci`、`npm run db:bootstrap:local`，再 `npm run dev` 起本機 worker（wrangler，預設 8787）。
- 另一個 shell：`npm ci --prefix web`，然後 `npm run dev:web` 或在 `web/` 內 `npm run dev -- --host 127.0.0.1`。
- `npm run check:live` 會列出本機前置條件；需要 LLM provider 的功能改用 fixture／fake provider，不要填真實 API key。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → 進入房間（`/r/:slug`）→ 發送訊息 → 看到 agent 回覆與 thread（`/t/:threadId`）
- Console：rooms、agents、people、providers 的列表與新增／編輯表單

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 長訊息列表的虛擬捲動（TanStack Virtual）：捲動跳動、新訊息自動捲到底、載入更多。
- 人類與 agent 訊息的視覺區分、串流輸出中的狀態、WebSocket 斷線重連提示。
- 手機寬度下聊天輸入框、側欄與 thread 面板的佈局。
- Console 表單（agent／provider）的驗證、機密欄位遮罩（截圖中不得出現真實 key）。

## 可重用的既有資產

- `products/kith/e2e/`：既有 Playwright harness（`npm run e2e`），可重用其 fixtures 與 global-setup 取得登入狀態。
- `products/kith/DESIGN.md`、`SDD.md`：設計與行為依據。

## 待補的頁面

`/r/:slug`、`/t/:threadId`、`/console/agents/:id`、`/console/providers/:id`：從本機 seed 取得真實 id 後加入。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs products/kith/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/kith/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
