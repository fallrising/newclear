# FE Review Prompt — fleet

你是負責 **fleet** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)，第 2 輪的範圍與對外契約見 [DESIGN.md](DESIGN.md)。

## 專案概況

- **元件路徑：** `specs/fleet/`
- **一句話：** Fleet Catalog 控制面：Go `html/template` + htmx 的伺服器渲染 UI，模板與靜態檔以 `embed.FS` 打包進 `fleetd`。
- **技術棧：** Go、`html/template`、htmx、`embed.FS`
- **UI 入口：** `fleetd`（預設 `FLEETD_LISTEN=127.0.0.1:18765`）：`/login`、`/`（catalog）、`/nodes/{id}`、`/services/{name}`

## 啟動線索（未驗證）

- 在 `specs/fleet` 執行 `mkdir -p fe-review/runs/.state && go run ./cmd/fleetd`，環境變數見 `targets.json`。`FLEET_UI_HOSTNAME`、`FLEET_API_HOSTNAME` 必填（缺少時直接結束，`internal/config/config.go:76-78`）；`FLEETD_DB` 指到 `fe-review/runs/.state/`。未設定 `CF_API_TOKEN` 時 ingress 是 `Noop`，不對外連線。
- 操作員登入：在環境內即時產生 `FLEETD_BOOTSTRAP_OPERATOR_TOKEN=flt_op_<隨機>`，以環境變數傳入（不寫進 `targets.json`），在 `/login` 貼上。以 `127.0.0.1` 連線時會提供 HTML（`Host` 不等於 API hostname）。
- 節點與服務：以 `FLEETD_BOOTSTRAP_NODE_TOKEN=flt_bs_<隨機>` 透過 API 註冊假節點 `vps-fe-1`、建立服務 `hello` 與兩個 release，不連真實主機、不跑 `fleet-agent`（第 2 輪寫成 `seed.sh`，見 DESIGN.md M9）。節點 60 秒沒有 heartbeat 會轉為 `offline`。
- 只有淺色主題（`app.css` 沒有深色模式），`colorSchemes` 只擷取 `light`；UI 文字是英文。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → catalog → 節點詳情 → 服務詳情
- catalog 按一次 Stop 再按 Start（htmx 換掉該列，焦點應留在按鈕上）
- 服務頁按一次 Redeploy 與 Rollback

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- htmx 局部更新後的 focus 與 loading 提示。
- 狀態徽章的色彩對比與非色彩提示。
- 無節點／無服務的空狀態。

## 可重用的既有資產

- `internal/ui/templates/`、`internal/ui/static/`。

## 狀態擷取

另外擷取：空資料庫的 catalog（只登入、不建立資料）、沒有服務的節點頁、沒有 release 的服務頁、節點 heartbeat 逾時後的 `offline-node`、動作失敗時的錯誤提示。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 只做 `DESIGN.md` 的修改項目，不改變其中列出的對外契約；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs specs/fleet/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs specs/fleet/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
