# FE Review Prompt — fleet

你是負責 **fleet** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `specs/fleet/`
- **一句話：** Fleet Catalog 控制面：Go `html/template` + htmx 的伺服器渲染 UI，模板與靜態檔以 `embed.FS` 打包進 `fleetd`。
- **技術棧：** Go、`html/template`、htmx、`embed.FS`
- **UI 入口：** `fleetd`（預設 `FLEETD_LISTEN=127.0.0.1:18765`）：`/login`、`/`（catalog）、`/nodes/{id}`、`/services/{name}`

## 啟動線索（未驗證）

- `go run ./cmd/fleetd`，以 `internal/config/config.go` 的環境變數指定暫存資料目錄；操作員登入用本機產生的測試憑證。
- 需要節點資料時以 `fleet-agent` 或 API 註冊假節點，不連真實主機。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → catalog → 節點詳情 → 服務詳情

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- htmx 局部更新後的 focus 與 loading 提示。
- 狀態徽章的色彩對比與非色彩提示。
- 無節點／無服務的空狀態。

## 可重用的既有資產

- `internal/ui/templates/`、`internal/ui/static/`。

## 待補的頁面

`/nodes/{id}`、`/services/{name}`：註冊假資料後補齊。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs specs/fleet/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs specs/fleet/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
