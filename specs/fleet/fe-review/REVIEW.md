# FE Review — fleet — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認其中的假設（D1、D2）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **B（maintain / public contract）**：第 2 輪修改不得改變對外契約；不新增 tutorial 系列。對外契約的具體範圍列在 `DESIGN.md`「依據 → 對外契約」。

## 矛盾點

### C1 啟動需要的設定與測試憑證

不構成耦合：所需設定都能以環境變數注入，且預設只綁 `127.0.0.1:18765`（`internal/config/config.go:11`）。`FLEET_UI_HOSTNAME`、`FLEET_API_HOSTNAME` 是必填，缺少時 `fleetd` 直接結束（`config.go:76-78`）；`FLEETD_DB` 預設 `/var/lib/fleetd/fleet.db`，要指到 `fe-review/runs/.state/`，且 `db.Open` 不建目錄。操作員登入是在 `/login` 貼上 `flt_op_` token；測試用 token 以 `FLEETD_BOOTSTRAP_OPERATOR_TOKEN` 在啟動時寫入（`cmd/fleetd/main.go:36`），節點以 `FLEETD_BOOTSTRAP_NODE_TOKEN`（`flt_bs_`）註冊。`targets.json` 已依此修正，種子腳本與實際驗證見 `DESIGN.md` M9。待驗證：`fleet_op` cookie 帶 `Secure`（`internal/api/login.go:60`），預期 Chromium 對 `http://127.0.0.1` 可以設定。

### C2 模板與 htmx 屬性屬於公開契約的一部分

`/static/htmx.min.js`（htmx 2.0.4）與模板一起以 `embed.FS` 打包（`internal/ui/embed.go`）。模板中的路由、表單欄位 `token`、`<tr id="row-<name>">` 片段與 `hx-post` 路徑都是 SDD「UI」一節與 `internal/ui/pages_test.go` 約束的契約，B 檔要求不改。

### C3 自動更新同時用兩種方式，htmx 更新後焦點丟失

`internal/ui/templates/layout.html:6` 對所有頁面加 15 秒 meta refresh，catalog 另有 15 秒的 htmx 輪詢（`catalog.html:4`），SDD 規定二擇一。整頁重載讓焦點與捲動位置每 15 秒重置；動作按鈕沒有 `id`，局部更新後焦點也無法還原；請求進行中沒有 loading 提示。

### C4 服務頁的動作按鈕與 Rollback 無法正常運作（由原始碼推斷，未執行）

- `service.html:8-12,28-31` 使用的 `hx-refresh="true"` 不是 htmx 屬性，按鈕也沒有 `hx-target`；後端對 htmx 請求回傳 catalog 的 `<tr>` 片段（`internal/api/services.go:246-248`），會被換進按鈕本身。
- Rollback 以 `hx-headers` 把 `Content-Type` 改成 JSON，但本體仍是 form 編碼；`handleServiceDeploy` 以 JSON 解析（`services.go:319-322`），推斷回 400。htmx 對錯誤回應不做任何呈現。

### C5 後端錯誤回應的呈現

`POST /login` 失敗時回 JSON（`internal/api/login.go:50-53`），瀏覽器表單看到原始 JSON；不存在的節點或服務回純文字 `not found`（`internal/ui/pages.go:72,87,107`）。屬後端回應，依 D1 不在第 2 輪範圍；只記錄，未提出為待決定事項。

### C6 窄螢幕版面

頁面沒有 `<meta name="viewport">`（`layout.html`、`login.html`）；catalog 8 欄的表格在 mobile 寬度必然水平溢出（`app.css:6`）。

### C7 狀態對比與表格語意

`health-healthy`（`#0a7`，白底 2.99:1）與 `health-progressing`（`#b80`，3.17:1）低於 WCAG AA 4.5:1（`app.css:9,11`）；狀態有文字，不只靠顏色。`<th>` 沒有 `scope`、表格沒有 `<caption>`，每列同名的 Stop／Redeploy／Rollback 按鈕沒有可分辨的名稱；沒有 `:focus-visible` 樣式。深色模式不支援（`app.css` 沒有 `prefers-color-scheme`），不列為缺陷。

### C8 空狀態

catalog 有空狀態（`catalog.html:12`）；節點頁 Services、服務頁 Releases 沒有；Facts、Instance 沒有資料時顯示空白或 `null`（`pages.go:97,111-112`）。

## 需要放開或決定的點

### D1 第 2 輪可修改的範圍

- 選項：(a) 只允許樣式與 a11y 修正；(b) 允許模板結構調整。
- 建議：(a)，符合 B 檔的契約限制。`DESIGN.md` 對 (a) 的解讀：可改 CSS、加不影響行為的屬性與標記（`aria-*`、`scope`、`id`、`<caption>`、viewport、呈現用外層 `div`）與空狀態列，可在 `pages.go` 傳入只影響呈現的資料；不改路由、表單欄位、cookie、`row` 片段與 `hx-post` 路徑。
- 狀態：**待擁有者決定**。`DESIGN.md` 以建議作為假設。

### D2 服務頁動作按鈕與 Rollback（C4）的修正方式

- 選項：(a) 只改模板：按鈕改 `hx-swap="none"` 並在成功後重載頁面；Rollback 用 `layout.html` 內嵌的小型 htmx 擴充送出 JSON 本體；加一個顯示錯誤回應的 `role="alert"` 區塊。(b) 改後端：`mutateDesired` 對服務頁回 `HX-Refresh` 標頭、`handleServiceDeploy` 另外接受 form 編碼。(c) 第 2 輪不修，只記錄。
- 建議：(a)，不動後端與 API 契約，也不新增 vendored 檔案；它超出 D1 (a)「只做樣式與 a11y」的字面範圍，所以單獨列出。
- 狀態：**待擁有者決定**。`DESIGN.md` M6、M7 以建議作為假設。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設（D1、D2）都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- 設計 PR（`fe-review/design-fleet`，Closes #152）：撰寫 `DESIGN.md`，修正 `targets.json`、`PROMPT.md`。
