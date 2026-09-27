# FE Review Prompt — agent-platform

你是負責 **agent-platform** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `platform/agent-platform/`
- **一句話：** 自託管多 agent 工作平台：React 19 + Vite 8 + TanStack Query 的 SPA（`web/`），後端是 Python FastAPI + PostgreSQL。
- **技術棧：** React 19、Vite 8、TanStack Query；後端 FastAPI、uvicorn、PostgreSQL
- **UI 入口：** `platform/agent-platform/web/`（dev port 5173 strict，`/api` 代理到 `http://127.0.0.1:8000`；生產時由 FastAPI 以 StaticFiles 提供 `web_dist`）

## 啟動線索（未驗證）

- 依元件 `docs/quickstart.md` 起後端（FastAPI 8000）；優先使用 repo 內的 fake／mock model（`model_mock.py`、`fake_model.py`），不要接真實模型或金鑰。
- 在 `web/` 執行 `npm ci` 與 `npm run dev`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 建立或開啟一個 run → Run controls（開始／暫停／取消）→ Approvals 審核 → 事件串流斷線重連

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 事件串流的 loading、斷線、重連 UI（既有 `e2e/reconnect.spec.ts`）。
- Approvals 的危險操作確認、按鈕狀態與鍵盤可達性。
- 長 log／事件列表的效能與捲動。

## 可重用的既有資產

- `web/e2e/`、`web/src/*.test.tsx`。

## 待補的頁面

若 App 內有 run id 狀態，從 fake backend 取得後以互動腳本補拍。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs platform/agent-platform/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/agent-platform/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
