# FE Review Prompt — agent-platform

你是負責 **agent-platform** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)，第 2 輪的修改範圍與驗收見 [DESIGN.md](DESIGN.md)。

## 專案概況

- **元件路徑：** `platform/agent-platform/`
- **一句話：** 自託管多 agent 工作平台：React 19 + Vite 8 + TanStack Query 的 SPA（`web/`），後端是 Python FastAPI + PostgreSQL。
- **技術棧：** React 19、Vite 8、TanStack Query；後端 FastAPI、uvicorn、PostgreSQL
- **UI 入口：** `platform/agent-platform/web/`（dev port 5173 strict，`/api` 代理到 `http://127.0.0.1:8000`；build 後由 FastAPI 以 StaticFiles 提供 `web/dist`，fe-review 使用這個單一 origin 版本）

## 啟動線索（未驗證）

- 詳細步驟見 [DESIGN.md](DESIGN.md)「啟動方式」。摘要：依 `docs/quickstart.md` 建立 `.venv`；`npm --prefix web ci && npm --prefix web run build`；容器內起 PostgreSQL（只綁 `127.0.0.1`、專用資料庫 `agent_platform_test`、密碼即時產生），以 `TEST_DATABASE_URL` 執行 `scripts/browser-fixture.py serve`，在 `http://127.0.0.1:18600` 同時提供 UI 與 API。
- 合成帳號由 fixture 即時產生，寫在 git-ignored 的 `.artifacts/browser-fixture.json`；`scripts/browser-fixture.py produce` 讓預建任務跑完（100 筆事件後 `succeeded`）。
- 沒有 `CONNECTOR_ORIGIN` 時一律使用 fake backend，不呼叫模型、不需要金鑰；不要接真實 OpenHands／KVM 或模型。
- `npm run dev`（5173）需要另外起 API（8000）、worker 與 PostgreSQL，且 `APP_ORIGIN` 必須是 `http://127.0.0.1:5173`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → 開啟任務詳情 → 事件串流載入、斷線、重連（既有 `web/e2e/reconnect.spec.ts` 的做法）→ 查看執行結果 → 以相同設定重新執行。
- 專案、Agent 設定兩個 view → 建立任務表單（含原生驗證提示）。
- fake backend 不支援暫停、繼續、取消與審批（按鈕停用）。這些狀態依 [DESIGN.md](DESIGN.md) M1 以覆寫 API 回應的方式補拍，並在報告中註明是覆寫畫面。

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 事件串流的 loading、斷線、重連 UI（既有 `e2e/reconnect.spec.ts`）。
- Approvals 的危險操作確認、按鈕狀態與鍵盤可達性。
- 長 log／事件列表的效能與捲動（fixture 產生 100 筆事件，時間軸沒有虛擬化）。
- 狀態文字都已中文化（`App.tsx` 的 `stateNames`）。
- 沒有 dark mode，只擷取 light。

## 可重用的既有資產

- `web/e2e/reconnect.spec.ts`、`web/src/*.test.tsx`、`scripts/browser-fixture.py`。

## 待補的頁面

專案、Agent 設定 view 沒有 URL，任務詳情用 `#<task_id>`（id 從 `.artifacts/browser-fixture.json` 讀取）；這些以互動腳本擷取，見 [DESIGN.md](DESIGN.md) M1。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs platform/agent-platform/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/agent-platform/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
