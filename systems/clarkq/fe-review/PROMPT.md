# FE Review Prompt — clarkq

你是負責 **clarkq** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `systems/clarkq/`
- **一句話：** HTTP FIFO queue：Go 服務以 `embed` 內嵌單檔 HTML 管理介面（`/ui/`）。
- **技術棧：** Go、`embed`、單檔 HTML
- **UI 入口：** `/ui/`（`internal/ui/index.html`，預設 http://localhost:8080/ui/）

## 啟動線索（未驗證）

- `go build -o bin/clarkq ./cmd/clarkq` 後以本機設定啟動；或 `./run-demo.sh --keep`（Docker，會跑六個情境並保留 UI）。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 開啟 Admin UI → 查看 queue 列表 → 查看訊息／統計

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 單檔 HTML 的 RWD 與 a11y 基礎（語意標籤、label）。
- 大量 queue 或訊息時的表格與自動刷新。

## 可重用的既有資產

- `run-demo.sh`：可產生有資料的畫面。

## 待補的頁面

無。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs systems/clarkq/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs systems/clarkq/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
