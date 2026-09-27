# FE Review — agent-platform — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認假設）。每次修改都走 PR。

## 目標

第 2 輪結束時，`web/` 能在 PROTOCOL 第 0 節的隔離環境內，以「真實 FastAPI＋PostgreSQL＋fake backend」和即時產生的合成帳號單獨啟動（只綁 `127.0.0.1`）；登入頁以外的主要畫面，以及 fake backend 產生不了的執行狀態（暫停、審批、用量），都有可重跑的互動擷取腳本；已知的前端小缺陷（未翻譯的 `pausing` 狀態、審批面板的樣式與時間格式不一致）已修正；`targets.json` 改為 `verified: true`。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **A1（D1）第 3 輪的後端形態採 (a)**：容器內起 PostgreSQL＋真實 FastAPI＋fake backend，以既有的 `scripts/browser-fixture.py serve` 作為啟動與 seed 入口；fake backend 產生不了的狀態，以 Playwright `page.route` 在同一個真實伺服器上覆寫對應 API 回應補拍（M1）。
  - **A2** `pausing` 狀態的顯示文字用「正在暫停」（M2），與既有的「正在恢復」「正在取消」一致。
  - **A3** 審批面板的「有效至」時間改用與任務列表相同的 `zh-TW` 短格式（M3）。
- 相關規範：
  - `docs/quickstart.md`、`docs/M1.md`「本機執行」：HTTP 只允許 loopback＋`APP_INSECURE_LOCAL=1`（`src/agent_platform/config.py:28-31`）。
  - `scripts/browser-fixture.py:26-30`：只接受名為 `agent_platform_test` 的資料庫，啟動時 `TRUNCATE`；帳號密碼在執行時隨機產生，寫入 git-ignored 的 `.artifacts/browser-fixture.json`（0600）。
  - `src/agent_platform/domain.py:12-22`：fake backend 的 `CAPABILITIES` 中 pause／resume／cancel／approval 都是 `false`；只有 `openhands` backend 開啟（`domain.py:87-99`），而 OpenHands 需要 KVM 主機。
  - PROTOCOL 第 4 節：後端、fixture 腳本、API 都只提議不直接改。

## 不做的事

- 不改後端、API、資料庫 schema、`scripts/browser-fixture.py`、CI；不新增 URL 路由（專案／Agent 設定頁不可由 URL 直達，改用互動腳本點擊）。
- 不做 dark mode（C4）：`web/src/style.css` 沒有 `prefers-color-scheme`，所有顏色都是固定值；新增主題屬於視覺改版，不在本輪。
- 不預先做事件時間軸虛擬化：`App.tsx:672-712` 一次渲染全部事件。先由第 3 輪以 100 筆事件的 fixture 量測，若有問題再寫回 `REVIEW.md`。
- 不接真實 OpenHands／KVM、真實模型或金鑰；不涵蓋只在真實 VM 出現的畫面（終端輸出、真實 diff）。
- 不做 major 依賴升級，不改文案語意（A2、A3 以外）。

## 修改項目

### M1 隔離環境的互動擷取腳本
- 對應：C1、C2、C3、D1（假設 A1）
- 現況：
  - `targets.json` 只有 `/` 一頁；登入後的畫面全部依 React state 切換（`web/src/App.tsx:147-149` 的 `view`、`selected`），只有任務詳情可用 `#<task_id>` 直達（`App.tsx:149`）。
  - fake backend 的 run 只會出現 queued／running／finalizing／succeeded，看不到 `RunControls.tsx:71-90` 的 pausing／paused／resuming／cancelling 提示、`Approvals.tsx` 的審批面板，以及 `Usage.tsx:19-62` 的已啟用用量。
  - 既有 `web/e2e/reconnect.spec.ts` 只驗證重連與按鈕停用，不擷取截圖。
- 修改：在 `platform/agent-platform/fe-review/` 新增一支 Playwright 腳本（例如 `flows.spec.ts`，以 `web/` 已有的 `@playwright/test` 執行，不新增依賴），截圖輸出到 `runs/<ts>/screenshots/`：
  1. 從 `.artifacts/browser-fixture.json` 讀合成帳號登入，存 `runs/<ts>/auth.storage.json`（git-ignored）。
  2. 真實資料流程：任務列表 → `#<task_id>` 詳情 → 執行 `browser-fixture.py produce` 後的 100 筆事件與「執行結果」→ 離線／恢復時的「連線中斷，正在重新連線…」→ 專案、Agent 設定兩個 view → 建立任務表單（`base_sha` 不符 `App.tsx:386` 的 `pattern` 時，瀏覽器原生驗證會擋下送出，擷取該狀態）。
  3. 覆寫狀態流程：以 `page.route` 改寫 `/api/v1/tasks/<id>`、`/api/v1/runs/<id>/approvals`、`/api/v1/runs/<id>/usage` 的回應，擷取 pausing／paused／resuming／cancelling、審批 pending／逾期／已拒絕、用量已啟用這幾種狀態。回應內容依 `web/src/api.ts:1-79` 的型別，全部是合成值。
- 驗證：在第 0 節環境內跑兩次腳本結果一致；`npm --prefix web run check`（腳本放在 `web/` 之外，但要能被 `tsc`／prettier 接受或另行格式檢查）；確認 `git status` 沒有 PNG 或 storageState 進入暫存區。
- 風險與回滾：覆寫回應可能與真實後端漂移 → 型別直接引用 `web/src/api.ts`，並在腳本註明哪些畫面是覆寫的；回滾即刪除該腳本。

### M2 `pausing` 狀態缺少顯示文字
- 對應：C5（假設 A2）
- 現況：`web/src/App.tsx:24-37` 的 `stateNames` 沒有 `pausing`，但後端會進入這個狀態（`src/agent_platform/migrations/006_pause.sql:3`、`src/agent_platform/connector_control.py:35`），`RunControls.tsx:71` 也為它顯示提示。任務列表的狀態徽章（`App.tsx:38-40`）與「執行紀錄」下拉（`App.tsx:524`）因此會直接顯示英文 `pausing`。
- 修改：`stateNames` 加入 `pausing: '正在暫停'`。不新增配色：`style.css:378-391` 只為 running／provisioning／finalizing／succeeded／interrupted／failed 配色，`resuming`、`cancelling` 等過渡狀態同樣使用預設樣式。
- 驗證：`App.test.tsx` 新增一則 `pausing` 狀態顯示中文的測試；`npm --prefix web run check`。
- 風險與回滾：只影響顯示文字；回滾即還原該行。

### M3 審批面板與其他區塊的樣式、時間格式不一致
- 對應：C6（假設 A3）
- 現況：
  - `web/src/Approvals.tsx:20`、`:96` 的錯誤訊息是沒有 `className` 的 `<p role="alert">`，其他區塊一律用 `className="error"`（`App.tsx:43`、`RunControls.tsx:99`），因此審批錯誤沒有錯誤配色。
  - `Approvals.tsx:95` 的受理提示沒有 `notice` 樣式，和 `RunControls.tsx:94` 的同類提示不同。
  - `Approvals.tsx:73` 用未指定 locale 的 `toLocaleString()`，顯示格式隨瀏覽器語系變動；其他時間都用 `App.tsx:51-58` 的 `zh-TW` 短格式。
- 修改：錯誤訊息加 `className="error"`，受理提示加 `className="notice"`；「有效至」改用與 `App.tsx` 相同的格式（把 `timestamp` 移到共用位置，或在 `Approvals.tsx` 以相同參數格式化）。
- 驗證：`Approvals.test.tsx` 補上錯誤訊息帶 `error` class、時間以 `zh-TW` 格式顯示的斷言；`npm --prefix web run check`；M1 腳本的審批截圖。
- 風險與回滾：純前端顯示變更；回滾即還原 `Approvals.tsx`。

## 啟動方式（第 2 輪要驗證的版本）

在第 0 節的隔離容器內，從 `platform/agent-platform` 執行：

1. 依 `docs/quickstart.md` 建立 `.venv` 並安裝鎖定依賴；`npm --prefix web ci && npm --prefix web run build`。
2. 在容器內起 PostgreSQL，只綁 `127.0.0.1`，建立專用資料庫 `agent_platform_test`，密碼在執行時隨機產生；以環境變數 `TEST_DATABASE_URL` 傳入（不寫進任何提交的檔案）。
3. `.venv/bin/python scripts/browser-fixture.py serve`：套用 migration、建立合成 operator／專案／Agent 設定／一個 queued 任務，在 `http://127.0.0.1:18600` 同時提供 `web/dist` 與 `/api/v1`（`APP_INSECURE_LOCAL` 等同開啟，origin 為 `http://127.0.0.1:18600`）。
4. 需要完成的執行時，再跑 `.venv/bin/python scripts/browser-fixture.py produce`（fake backend 送出一則訊息、100 筆事件，最後 `succeeded`）。
5. ready 檢查：`GET /api/v1/session`。

改用 `npm run dev`（5173）時要另外起 API（8000）、worker 與 PostgreSQL，且 `APP_ORIGIN` 必須是 `http://127.0.0.1:5173`（`.env.example`）；第 2 輪以上面的單一 origin 版本為準。

## 第 3 輪驗收

- 頁面與流程：
  - `capture.mjs`：登入頁（`targets.json` 的 `login`）。
  - M1 腳本：任務列表（空／有資料）、任務詳情（queued、succeeded＋100 筆事件＋執行結果）、重連提示、專案、Agent 設定、建立任務表單與原生驗證提示；覆寫狀態：pausing／paused／resuming／cancelling、審批 pending／逾期／已拒絕、用量已啟用。
  - `PROMPT.md` 的主要流程。
- 通過條件：無 blocker／major；axe 無 critical／serious；三種 viewport 無水平溢出；console 無 error；沒有 4xx／5xx（未登入時 `GET /api/v1/session` 回 200，`src/agent_platform/auth.py:93-108`）。
- 已知不在驗收範圍：真實 OpenHands VM 的暫停／審批端到端流程、終端輸出、真實模型用量與金額、dark mode。

## 開放問題

- `browser-fixture.py` 是 AT-03 的測試 fixture，第 3 輪借用它當 seed。若擁有者希望 fe-review 有自己的 seed 入口（例如多幾筆不同狀態的任務），那是後端／腳本變更，需另開提議。
