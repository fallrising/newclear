# FE Review Prompt — fleet

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 保留樣式／a11y 與契約限制；D2 採 (a) 模板修正 swap、Rollback JSON、錯誤提示，不改後端 API。 此為第1輪設計確認紀錄；第2輪實作證據見下方目前狀態，完整第3輪仍未通過。
你是負責 **fleet** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**已批准第2輪 M1–M9 實作與限定驗證通過**。12張選定PNG、12 loaded guards、真實互動與原生gate可核對；4 desktop axe保留3 serious header contrast與2 critical meta-refresh，incomplete0。完整第3輪未通過，Cloudflare OTP/mainline不在本次完成聲明。見 [本輪報告](tasks/round2/report.md)。

## 專案概況

- **元件路徑：** `specs/fleet/`
- **一句話：** Fleet Catalog 控制面：Go `html/template` + htmx 的伺服器渲染 UI，模板與靜態檔以 `embed.FS` 打包進 `fleetd`。
- **技術棧：** Go、`html/template`、htmx、`embed.FS`
- **UI 入口：** `fleetd`（預設 `FLEETD_LISTEN=127.0.0.1:18765`）：`/login`、`/`（catalog）、`/nodes/{id}`、`/services/{name}`

## 本輪隔離啟動

由 root 在 network-none、無 host port/socket、非 root、cap-drop ALL 容器執行 [README](README.md) 的 owned runner。其私有 state 使用新 SQLite；即時生成 operator/bootstrap token，既有 API 註冊節點、heartbeat、建立服務與兩個額外 releases，再以實際 generation 回報 actual。建立服務本身也產生 release，因此正常 seed 為三個 releases，不能把所有同名 Rollback 視為唯一按鈕。

runner 真正填入 `/login` 表單，觀測 303 與受保護 catalog 200，並用完整 cookie jar 驗 Secure／HttpOnly／SameSite=Lax；不注入或放寬 cookie。它每 10 秒更新 heartbeat 與 actual，無 CF token、fleet-agent 或 workload。原設計的 `seed.sh` 功能由此 runner 的 inline API seed 實現。

shared `capture.mjs` 不修改。runner 產生私有 targets，把 `/login` 放匿名 app、其餘三頁使用剛取得的 storageState；先 `--dry-run`，再 normal capture `--no-axe`。服務已由 supervisor 啟動，不傳沒有啟動效果的 `--start`。另外只做四頁 desktop scoped axe 與十二個 finalURL／loaded identity／overflow guards；不是十二次 axe，也不是完整 R3。

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
   # runner 生成 /state/<owned>/targets.json 後，在同一隔離容器執行：
   node /work/docs/fe-review/capture.mjs /state/<owned>/targets.json --dry-run --out /evidence/<run>/matrix
   node /work/docs/fe-review/capture.mjs /state/<owned>/targets.json --no-axe --out /evidence/<run>/matrix
   ```
   上述是本輪 runner 實際使用的共用擷取介面（私有路徑每次生成，不可直接執行含尖括號的示意命令）；完整第3輪仍未驗收。需要互動才能看到的狀態，以本目錄的 flow observer 取證；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
