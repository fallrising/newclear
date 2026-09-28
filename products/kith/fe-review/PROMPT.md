# FE Review Prompt — kith

你是負責 **kith** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)，第 2 輪的範圍見 [DESIGN.md](DESIGN.md)（草稿）。

## 專案概況

- **元件路徑：** `products/kith/`
- **一句話：** 人機群聊產品：React 19 + Vite 6 + Tailwind 4 + Radix + TanStack Query/Virtual 的 SPA（`web/`），後端是 Cloudflare Workers + Hono + D1。
- **技術棧：** React 19、Vite 6、Tailwind 4、Radix、TanStack Query／Virtual、Zustand、React Router 7；後端 Hono on Cloudflare Workers（wrangler）、D1
- **UI 入口：** `products/kith/web/`（SPA，dev port 5174，`/api`、`/mcp` 代理到 `KITH_API_ORIGIN`，預設 `http://127.0.0.1:8787`）

## 啟動線索（未驗證）

- **不要**用根目錄的 `npm run dev`／`npm run dev:web`：它們經 `scripts/dev-bind.mjs` 綁 `0.0.0.0` 與 Tailscale 位址、需要 `tailscale`，並載入開發者的 `.dev.vars`（見 [REVIEW.md](REVIEW.md) C3）。
- 符合 PROTOCOL 第 0 節的路徑是 `e2e/` harness：`e2e/harness/server.ts` 以 `127.0.0.1`、隨機 port、隔離狀態目錄啟動 `wrangler dev --local` 與 fake LLM provider；`e2e/global-setup.ts` 套用 migrations 與固定 seed `base-v1`（`e2e/fixtures/seed.ts`）。第 2 輪會把它包成本目錄的 `launch.mjs`（[DESIGN.md](DESIGN.md) M1）；在那之前沒有已驗證的單獨啟動指令。
- web 的 Vite 預設就綁 `127.0.0.1:5174`（`web/vite.config.ts`），以 `KITH_API_ORIGIN` 指向上述 worker。
- 需要 LLM 的畫面使用 harness 的 fake provider（canary key），不要填真實 API key。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → 進入房間（`/r/:slug`）→ 發送訊息 → 看到 agent 回覆與 thread（`/r/:slug/t/:threadId`）
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

seed `base-v1` 的固定路由已加入 [`targets.json`](targets.json)：`/r/lobby`、`/r/long-history`、`/r/quiet`、`/r/ada-private`、`/console/agents/m-grok`，以及 `/console/agents/new`、`/console/providers/new`。seed 沒有 thread 與 provider，`/r/:slug/t/:threadId`、`/console/providers/:id` 的 id 在執行時產生，由第 2 輪的 `flows.mjs`（[DESIGN.md](DESIGN.md) M2）建立後擷取。除 `/login` 外所有頁面都需要登入（`storageState`，第 2 輪由啟動器產生）。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 只實作 [DESIGN.md](DESIGN.md) 範圍內的修改；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs products/kith/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs products/kith/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
