# FE Review Prompt — fanzloud

你是負責 **fanzloud** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/fanzloud/`
- **一句話：** Cloud coding-agent 平台的 control plane：「Codebox operator」頁面是不用框架的純 JS + CSS，由 Rust axum 伺服器以 `include_bytes!` 提供，含 WebSocket。
- **技術棧：** Rust axum；前端為原生 JS（`p0-app.js`、`p0-client.js`）與 CSS
- **UI 入口：** `apps/control-plane/web/`，由 control-plane 在 `/`、`/assets/*` 提供

## 啟動線索（未驗證）

- control-plane 需要 `CODEBOX_LISTEN_ADDRESS` 等環境變數（見 `apps/control-plane/src/main.rs`）；設為 `127.0.0.1:<port>`，雲端 runner 相關設定一律指向假實作或留空，不連真實雲端。
- 若無法完整啟動，可用 `web/` 的靜態檔加上最小假 API 做版面擷取，並在報告註明。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 開啟 operator 頁 → 建立或檢視 session → WebSocket 事件更新

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 原生 JS 狀態更新時的 DOM 閃爍與 aria-live。
- WebSocket 斷線提示。
- 無框架樣式的一致性與 RWD。

## 可重用的既有資產

- `apps/control-plane/web/p0-client.test.mjs`、`tests/p0_subscription_e2e.rs`。

## 待補的頁面

無。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs platform/fanzloud/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/fanzloud/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
