# FE Review — fleet — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認）。每次修改都走 PR。

## 目標

fleet 的 UI 是 `fleetd` 內建的 Go `html/template` + htmx 伺服器渲染頁面（登入、catalog、節點、服務）。第 2 輪結束時：`fleetd` 能在 PROTOCOL 第 0 節的隔離環境內以合成資料單獨啟動、只綁 `127.0.0.1`；四個頁面在三種 viewport 下沒有水平溢出；狀態文字對比符合 WCAG 2.2 AA；htmx 局部更新與自動更新不會把鍵盤焦點丟回頁首；節點與服務頁的空狀態有明確呈現；服務頁的 Start／Stop／Redeploy／Rollback 按鈕實際可用。所有修改都不改變下方「對外契約」。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **D1 採 (a)**：第 2 輪只做樣式與 a11y 修正。本設計對 (a) 的解讀是：可以改 `internal/ui/static/app.css`；可以在模板加上不影響行為的屬性與標記（`aria-*`、`scope`、`id`、`<caption>`、`<meta name="viewport">`、純呈現用的外層 `<div>`）與空狀態列；可以在 `internal/ui/pages.go` 傳入只影響呈現的模板資料。不改路由、表單欄位名、cookie、`id="row-<name>"` 片段、`hx-post` 的目標路徑、API 回應格式。
  - **D2 採 (a)**：服務頁動作按鈕與 Rollback 的修正只在模板內完成（見 M6、M7），不改後端 handler。
- 相關規範：
  - 元件 `README.md`：文檔檔位 **B（maintain / public contract）**，不擴成第二條產品線。元件沒有自己的 `AGENTS.md`。
  - `docs/SDD.md`「UI」一節：只用 Go `html/template` + HTMX，htmx 以單一 vendored `internal/ui/static/htmx.min.js` 提供、不用 npm、不用 React/Vue/Svelte；catalog 欄位固定為 Service／URL／Node／Version／Health／Expose／Desired／Actions；Health 值為 `healthy`／`unhealthy`／`unknown`／`offline-node`／`progressing`，顏色由 CSS class 表現；按鈕 `hx-post` 到 `/api/v1/services/{name}/{start,stop,redeploy}`，`hx-target` 為該列；自動更新用 `<meta http-equiv="refresh" content="15">` **或** htmx `hx-trigger="every 15s"`，二擇一。
  - `docs/SDD.md` Decision 24：HTML 只在帶 `fleet_op` cookie 時提供；`/healthz`、`/version`、`GET/POST /login` 是僅有的免認證端點。

### 對外契約（第 2 輪不得改變）

- 路由與方法：`internal/api/server.go:72-113`。
- 登入：`POST /login` 表單欄位 `token`（`internal/ui/templates/login.html:14`），cookie `fleet_op` 的名稱與屬性（`internal/api/login.go:55-62`、`internal/config/config.go:24`）。
- htmx 片段：`mutateDesired` 在 `Accept: text/html` 或 `HX-Request: true` 時回傳 `row` 片段（`internal/api/services.go:246-248`），片段根元素是 `<tr id="row-<name>">`（`internal/ui/templates/catalog.html:20`，`internal/ui/pages_test.go:51` 檢查）。
- catalog 的欄位順序、Health 值與對應 class `health-<value>`（`internal/ui/templates/catalog.html:7,25`）。
- 靜態檔路徑 `/static/app.css`、`/static/htmx.min.js`（`internal/ui/pages_test.go:43,102`）。

## 不做的事

- 不改後端 handler、store、API 回應格式與錯誤格式（包括 REVIEW.md C5 的登入失敗回 JSON、`pages.go:72,87,107` 的純文字 404；這些只記錄在 REVIEW.md）。
- 不改 `internal/ui/static/htmx.min.js` 的版本，不引入 npm、打包工具或前端框架。
- 不加深色模式（新功能）；`targets.json` 只擷取 `light`。
- 不做 SDD 提到但尚未實作的畫面，例如節點列的 `mem_used_pct`／`disk_root_used_pct`／`load1`（`docs/SDD.md` 的 node facts 一節）、節點總覽頁、token 管理頁。
- 不改模板結構到會影響 `hx-select="table"` 的程度：catalog 頁的第一個 `<table>` 必須仍是 `#catalog`。
- 不改 UI 文案語意與語言（維持英文，`lang="en"`）。
- 不改 `Dockerfile.*`、`Makefile`、CI、`go.mod`。

## 修改項目

### M1 viewport 與窄螢幕表格

- 對應：REVIEW.md C6；PROTOCOL 第 3 節「版面與視覺」。
- 現況：`internal/ui/templates/layout.html:3-9` 與 `login.html:3-7` 沒有 `<meta name="viewport">`，行動裝置以桌面寬度縮放顯示；catalog 有 8 欄（`catalog.html:7`），`app.css:6` 的 `table { width: 100% }` 在 390px 寬度下只能撐出水平溢出；`<pre>` 已有 `overflow: auto`（`app.css:18`），長 URL 與 git SHA 沒有換行規則。
- 修改：
  1. `layout.html`、`login.html` 的 `<head>` 加 `<meta name="viewport" content="width=device-width, initial-scale=1">`。
  2. `catalog.html`、`node.html`、`service.html` 的每個 `<table>` 外包一層 `<div class="table-scroll">`；`app.css` 加 `.table-scroll { overflow-x: auto; }`，讓溢出只發生在表格容器內。catalog 的 `<table id="catalog">` 本身與其 `hx-*` 屬性不動（`hx-select="table"` 選到的仍是它，`outerHTML` 只換掉表格，外層 `div` 保留）。
  3. `app.css` 對 URL 欄位與 `<code>` 加 `overflow-wrap: anywhere`；`form.login` 在窄螢幕加 `box-sizing: border-box` 避免 `padding` 撐出寬度。
- 驗證：`make test`（`go test ./...`）；`internal/ui/pages_test.go` 新增斷言：三個頁面輸出含 `name="viewport"` 與 `class="table-scroll"`，catalog 仍含 `id="catalog"` 與 `hx-select="table"`。第 3 輪 `capture.json` 的水平溢出欄位在 mobile 為否（表格容器內捲動不計入頁面溢出）。
- 風險與回滾：純呈現；revert 該 commit 即可。

### M2 Health 狀態的對比與非色彩提示

- 對應：REVIEW.md C7；PROMPT.md「狀態徽章的色彩對比與非色彩提示」。
- 現況：`app.css:9-12`。在白底 `#fff` 上，`health-healthy` `#0a7` 對比 2.99:1、`health-progressing` `#b80` 3.17:1，低於 WCAG 2.2 AA 一般文字的 4.5:1（0.95rem 粗體不算大字）；`#c22` 5.5:1、`#666` 5.74:1 合格。狀態本身以文字呈現（`catalog.html:25`、`service.html:5`），不是只靠顏色；但節點頁的 Health 欄（`node.html:13`）沒有套 `health-*` class，與 catalog 不一致。
- 修改：
  1. `app.css`：`health-healthy` 改 `#067a55`（白底 5.35:1）、`health-progressing` 改 `#8a5a00`（5.93:1）；`health-unhealthy`、`health-unknown`／`health-offline-node` 維持。
  2. `app.css` 以 `::before` 為每個狀態加一個不依賴顏色的符號（例如 `healthy` ●、`unhealthy` ✕、`progressing` ◐、`unknown`／`offline-node` ○），`content` 使用 CSS 的替代文字語法 `content: "●" / ""`，讓螢幕閱讀器不唸符號。狀態文字本身不變。
  3. `node.html:13` 的 Health `<td>` 加上 `class="health-{{.Health}}"`，與 catalog 一致。
- 驗證：`make test`；新增斷言：節點頁輸出含 `class="health-`。對比值用上面的比例驗算（WCAG 相對亮度公式），第 3 輪 axe 無 `color-contrast` violation。
- 風險與回滾：只改顏色值與 class；revert 即可。舊版瀏覽器不支援 `content` 替代文字時會唸出符號，影響僅限 a11y 細節。

### M3 表格語意與按鈕的可讀名稱

- 對應：REVIEW.md C7；PROTOCOL 第 3 節「無障礙」。
- 現況：所有 `<th>` 沒有 `scope`（`catalog.html:7`、`node.html:10`、`service.html:18`）；表格沒有 `<caption>`；catalog 每列都有同名的 Start／Stop／Redeploy 按鈕（`catalog.html:30-34`），服務頁 Releases 每列都是同名的 Rollback（`service.html:31`），螢幕閱讀器無法分辨對象；服務頁 Releases 最後一欄的 `<th>` 是空的（`service.html:18`）。
- 修改：
  1. 所有 `<th>` 加 `scope="col"`；catalog、節點頁 Services、服務頁 Releases 各加一個 `<caption>`（視覺隱藏，用 `app.css` 的 `.visually-hidden`）。
  2. 按鈕加 `aria-label`，包含動作與對象：`Stop hello`、`Rollback hello to rel_…`。按鈕可見文字不變。
  3. 服務頁 Releases 最後一欄的 `<th>` 改為視覺隱藏的 `Actions`。
  4. `app.css` 加 `:focus-visible` 的外框樣式（`outline: 2px solid` 深色、`outline-offset: 2px`），`header a` 在深色頁首上用白色外框。
- 驗證：`make test`；新增斷言：catalog 輸出含 `scope="col"` 與 `aria-label="Stop hello"`，服務頁含 `aria-label="Rollback hello to rel_old"`。第 3 輪 axe 無 critical／serious。
- 風險與回滾：只加屬性與樣式；revert 即可。

### M4 自動更新不重載整頁

- 對應：REVIEW.md C3；PROMPT.md「htmx 局部更新後的 focus 與 loading 提示」；WCAG 2.2.1。
- 現況：`layout.html:6` 對所有已登入頁面都加 `<meta http-equiv="refresh" content="15">`；catalog 另外有 `hx-get="/" hx-trigger="every 15s" hx-select="table"`（`catalog.html:4`），兩者同時作用。整頁重載每 15 秒把焦點、捲動位置與正在進行的 htmx 請求清掉，局部更新形同無效。SDD 規定兩種方式二擇一。
- 修改：`layout.html` 的 meta refresh 改為 `{{if not .LivePoll}}…{{end}}`；`internal/ui/pages.go:66` 的 catalog 資料加 `"LivePoll": true`。catalog 只保留 htmx 局部更新；節點頁與服務頁沒有局部更新，保留 meta refresh。
- 驗證：`make test`；新增斷言：catalog 輸出不含 `http-equiv="refresh"`，節點頁與服務頁仍含。第 3 輪在 catalog 以鍵盤把焦點放在某一列的按鈕上，等待 20 秒後焦點仍在（依 M5 的 `id`）。
- 風險與回滾：catalog 若 htmx 載入失敗就不再自動更新（使用者手動重新整理即可）。revert 即回到雙重更新。

### M5 htmx 局部更新的焦點與 loading 狀態

- 對應：REVIEW.md C3；PROMPT.md「htmx 局部更新後的 focus 與 loading 提示」。
- 現況：catalog 的動作按鈕沒有 `id`（`catalog.html:30-34`）；`hx-swap="outerHTML"` 換掉整列、每 15 秒的輪詢換掉整個表格後，原本有焦點的按鈕不存在，焦點掉回 `<body>`。htmx 在換入的內容中找到與原焦點元素相同 `id` 的元素時會還原焦點，所以缺的只是穩定的 `id`。請求進行中沒有任何提示（`app.css` 沒有 `.htmx-request` 樣式），可以連點。
- 修改：
  1. `catalog.html` 的 `row` 模板中，Start／Stop 按鈕加 `id="act-{{.Name}}-toggle"`（兩者互斥，共用一個 `id`），Redeploy 加 `id="act-{{.Name}}-redeploy"`。
  2. 動作按鈕加 `hx-disabled-elt="this"`（htmx 2 內建屬性，請求期間加上 `disabled`），避免連點；`app.css` 加 `.htmx-request` 與 `button[disabled]` 的樣式（游標與透明度）。
  3. 整個 catalog 表格加 `aria-busy` 不在本項範圍（輪詢每 15 秒觸發一次，會造成螢幕閱讀器噪音）。
- 驗證：`make test`；新增斷言：`ServiceRow` 片段含 `id="act-hello-toggle"` 與 `hx-disabled-elt="this"`。第 3 輪以 Playwright 按 Stop 後檢查 `document.activeElement.id` 為 `act-hello-toggle`。
- 風險與回滾：服務名稱限定為 `^[a-z][a-z0-9-]{0,46}[a-z0-9]$`（`internal/fleetfile/validate.go:32`），組出的 `id` 一定合法且不需跳脫；revert 即可。

### M6 服務頁動作按鈕的 swap 目標

- 對應：REVIEW.md C4、D2。
- 現況：服務頁的 Start／Stop／Redeploy 與 Rollback（`service.html:8-12,28-31`）沒有 `hx-target`，而 `hx-refresh="true"` 不是 htmx 屬性（`HX-Refresh` 只有回應標頭，vendored 的 htmx 2.0.4 裡沒有 `hx-refresh` 這個屬性）。後端對 `HX-Request: true` 回傳 catalog 的 `<tr>` 片段（`services.go:246-248`），htmx 預設以 `innerHTML` 換進按鈕本身，按鈕變成一段破損的表格列，要等 15 秒的 meta refresh 才恢復。
- 修改：移除這四處的 `hx-refresh="true"`，改為 `hx-swap="none"` 加 `hx-on::after-request="if(event.detail.successful) location.reload()"`；失敗時不重載，交給 M7 的錯誤提示。按鈕的 `hx-post` 路徑不變。
- 驗證：`make test`；新增斷言：服務頁輸出不含 `hx-refresh`，含 `hx-swap="none"`。第 3 輪在服務頁按 Stop 後頁面重載，Desired 顯示 `stopped`。
- 風險與回滾：依賴 htmx 2 的 `hx-on::` 語法（2.0.4 已支援）；revert 即回到目前行為。

### M7 Rollback 送出 JSON 與失敗提示

- 對應：REVIEW.md C4、D2。
- 現況：Rollback 按鈕以 `hx-headers='{"Content-Type": "application/json"}'` 加 `hx-vals='{"release_id": …}'` 送出（`service.html:28-31`），但 htmx 沒有 json-enc 擴充時請求本體仍是 `release_id=…` 的 form 編碼，只有標頭被改成 JSON；`handleServiceDeploy` 以 `json.NewDecoder` 解析（`services.go:319-322`），推斷會回 400 `invalid_json`，Rollback 無法使用（第 2 輪先重現再修）。htmx 對 4xx／5xx 預設不做任何 swap，使用者看不到失敗。
- 修改：
  1. 在 `layout.html` 加一段不到 20 行的內嵌腳本，以 `htmx.defineExtension("json-body", …)` 定義一個只實作 `encodeParameters`（htmx 2.0.4 的擴充介面，vendored 檔案內可見）的擴充：設定 `Content-Type: application/json`，回傳參數的 `JSON.stringify`。Rollback 按鈕改用 `hx-ext="json-body"`，移除 `hx-headers`。不新增 vendored 檔案，不改 `htmx.min.js`。
  2. `layout.html` 加一個 `<p id="flash" role="alert" hidden>`，以 `htmx:responseError` 事件把狀態碼與回應的 `error.message` 顯示在其中（只顯示伺服器回傳的訊息，不顯示請求內容）。catalog 與服務頁的所有動作按鈕都受益。
- 驗證：`make test`；新增 `internal/api` 層級的測試（`server_test.go`）以 JSON 本體與 cookie 呼叫 `POST /api/v1/services/hello/deploy` 驗證 202，確認後端契約；前端送出格式在第 3 輪以 Playwright 按 Rollback 驗證回 202、頁面重載後 Releases 的目前版本改變。
- 風險與回滾：內嵌腳本屬於前端程式碼，若 htmx 版本日後升級，需重新確認事件介面；revert 即回到目前（不可用的）行為。

### M8 空狀態

- 對應：REVIEW.md C8；PROMPT.md「無節點／無服務的空狀態」。
- 現況：catalog 已有 `No services yet.`（`catalog.html:12`）。節點頁的 Services 表格（`node.html:12-14`）與服務頁的 Releases 表格（`service.html:20-35`）沒有 `{{else}}`，沒有資料時只剩表頭；節點沒有 facts 時 `FactsPretty` 可能是空字串或 `null`（`pages.go:97`），`<pre>` 是空的；服務沒有 instance 時 Instance 區塊輸出 `null`（`pages.go:111-112`）。
- 修改：
  1. `node.html`、`service.html` 的表格加 `{{else}}` 列：`No services on this node.`、`No releases yet.`，樣式沿用 `.muted`。
  2. Facts、Instance、Audit 三個 `<pre>` 在內容為空或 `null` 時改顯示 `.muted` 的 `No facts reported yet.`／`No instance reported yet.`／`No audit entries.`。判斷在模板中完成（`{{if and .FactsPretty (ne .FactsPretty "null")}}`）；若需要在 `pages.go` 預先正規化，只傳入空字串，不改資料來源。
- 驗證：`make test`；新增測試：未註冊服務的節點頁含 `No services on this node.`；沒有 release 的服務頁含 `No releases yet.` 與 `No instance reported yet.`。
- 風險與回滾：只加呈現分支；revert 即可。

### M9 驗證 `targets.json` 與種子資料

- 對應：REVIEW.md C1；PROTOCOL 第 1 節第 2 輪完成條件。
- 現況：本 PR 已依原始碼修正 `targets.json`：加上必填的 `FLEET_UI_HOSTNAME`／`FLEET_API_HOSTNAME`（缺少時 `fleetd` 直接結束，`internal/config/config.go:76-78`）、把 `FLEETD_DB` 指到 `fe-review/runs/.state/`（預設 `/var/lib/fleetd/fleet.db`，`config.go:12`；`db.Open` 不建目錄，所以 `start` 先 `mkdir -p`）、補上節點與服務頁、`colorSchemes` 只留 `light`、`locale` 改 `en-US`、加上 `storageState`。仍未實際執行。
- 修改：只改 `specs/fleet/fe-review/`。
  1. 新增 `seed.sh`：以環境中即時產生的 `FLEETD_BOOTSTRAP_OPERATOR_TOKEN`（`flt_op_` 前綴）與 `FLEETD_BOOTSTRAP_NODE_TOKEN`（`flt_bs_` 前綴）啟動後，依序 `POST /api/v1/nodes/register`（節點 `vps-fe-1`，取得 agent token）→ `POST /api/v1/nodes/vps-fe-1/heartbeat` → `POST /api/v1/services`（服務 `hello`，`fleet.yaml` 以 `testdata/fleetfile/valid-public.yaml` 為本，節點改 `vps-fe-1`、hostname 改 `hello.fleet.invalid`）→ 兩次 `POST /api/v1/releases` 與一次 `POST /api/v1/services/hello/deploy`（產生目前版本與可 rollback 的舊版本）→ `POST /api/v1/agent/actual` 回報一次 `healthy`。再以 `POST /login` 取得 cookie，存成 `runs/.state/auth.storage.json`。token 只存在環境變數與 `runs/.state/`，不寫進任何提交的檔案。節點在 60 秒沒有 heartbeat 會轉為 `offline`（`config.go:22`），擷取期間以背景迴圈維持 heartbeat，或刻意擷取一次 `offline-node` 狀態。
  2. 依擷取結果修正 `targets.json`、`PROMPT.md`；全部頁面 200、沒有 page error 後把 `verified` 改為 `true`，`verifiedNote` 寫上日期與 commit。
- 驗證：`node docs/fe-review/capture.mjs specs/fleet/fe-review/targets.json --dry-run` 列出 4 頁 × 3 viewport；`--start` 擷取後 `capture.json` 每筆 `status` 為 200。
- 風險與回滾：只動文件與測試腳本。`fleet_op` cookie 帶 `Secure`（`login.go:60`），Chromium 對 `http://127.0.0.1` 視為安全來源，預期可以設定；若不行，屬 REVIEW.md 需要擁有者決定的後端變更，記錄後停下，不放寬 cookie 屬性。

## 啟動方式（第 2 輪要驗證的版本）

- 環境：PROTOCOL 第 0 節的容器（獨立 network namespace，不用 `--network host`）。需要 Go（版本依 `go.mod`）；不需要 Docker、Cloudflare 或真實 VPS。未設定 `CF_API_TOKEN` 時 ingress 是 `Noop`（`cmd/fleetd/main.go:46-51`），不會對外連線。
- 憑證：在環境內即時產生 `FLEETD_BOOTSTRAP_OPERATOR_TOKEN=flt_op_<隨機>`、`FLEETD_BOOTSTRAP_NODE_TOKEN=flt_bs_<隨機>`，以環境變數傳入（`capture.mjs` 會把 `process.env` 併入 `targets.json` 的 `env`），不寫進 `targets.json`。
- 啟動：在 `specs/fleet` 執行 `mkdir -p fe-review/runs/.state && go run ./cmd/fleetd`，環境變數見 `targets.json`：`FLEETD_LISTEN=127.0.0.1:18765`、`FLEETD_DB=fe-review/runs/.state/fleet.db`、`FLEET_UI_HOSTNAME=fleet.invalid`、`FLEET_API_HOSTNAME=fleet-api.invalid`、`FLEET_BASE_DOMAIN=fleet.invalid`。以 `127.0.0.1` 連線時 `Host` 不是 API hostname，HTML 會提供（`internal/api/auth.go:141-146`）。
- 合成資料：`fe-review/seed.sh`（M9）；節點 `vps-fe-1`、服務 `hello`、兩個 release。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的 `login`、`catalog`、`node`（`/nodes/vps-fe-1`）、`service`（`/services/hello`）；PROMPT.md 的主要流程「登入 → catalog → 節點詳情 → 服務詳情」，加上 catalog 的 Stop／Start、服務頁的 Redeploy 與 Rollback 各一次。
- 狀態：空資料庫（只登入、不跑 `seed.sh`）的 catalog；沒有服務的節點頁；沒有 release 的服務頁；節點 heartbeat 逾時後的 `offline-node`；動作失敗（例如對已刪除的服務按 Stop）時的 `#flash` 訊息。
- 通過條件：無 blocker／major；axe 無 critical／serious；三種 viewport 頁面層級無水平溢出；鍵盤可走完主要流程，htmx 更新後焦點不丟失；上方「對外契約」的測試（`internal/ui/pages_test.go`、`internal/api/server_test.go`）全部通過。
- 已知不在驗收範圍：Cloudflare Access 在 UI 前的登入畫面（屬邊緣設定）、深色模式、真實節點與容器的健康狀態。

## 開放問題

- `POST /login` 失敗時回傳 JSON（`internal/api/login.go:50-53`），瀏覽器表單送出後看到的是原始 JSON；以及 `pages.go:72,87,107` 對不存在的節點或服務回純文字 `not found`。兩者都是後端回應的呈現，依 D1 的假設不在第 2 輪範圍，已記入 REVIEW.md C5，是否另開修正由擁有者決定。
