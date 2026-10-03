# FE Review — agent-platform — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認其中的假設（A1～A3）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件文件與 PROTOCOL 第 4 節修改前端。元件目錄沒有自己的 `AGENTS.md`，以 `README.md`、`docs/quickstart.md`、`docs/M1.md` 為準。

## 矛盾點

### C1 UI 需要 FastAPI＋PostgreSQL

`web/` 沒有前端 mock；dev server 把 `/api` 代理到 `127.0.0.1:8000`（`web/vite.config.ts:6`），後端需要 PostgreSQL。可拆開的現成入口：`scripts/browser-fixture.py serve` 在 `127.0.0.1:18600` 以真實 API＋專用測試資料庫（`agent_platform_test`）提供 `web/dist`，合成帳號在執行時隨機產生（`scripts/browser-fixture.py:26-90`）。不是耦合問題：綁定只接受 loopback，HTTP 需要 `APP_INSECURE_LOCAL=1`（`src/agent_platform/config.py:28-31`）。

### C2 fake backend 產生不了暫停、審批與用量狀態

沒有 `CONNECTOR_ORIGIN` 時，worker 使用 `FakeAgentBackend`／`FakeSandboxProvider`（`src/agent_platform/worker.py:32-33`），不呼叫模型；`model_mock.py` 只用於 OpenHands／KVM 路徑。fake backend 的 pause／resume／cancel／approval 能力都是 `false`（`src/agent_platform/domain.py:12-22`），Agent 設定也只有 `openhands` 能開啟審批（`src/agent_platform/store.py:113`）。因此在隔離環境內，`RunControls` 的暫停類提示、`Approvals` 面板與已啟用的用量面板都不會出現。

### C3 登入後的畫面無法由 URL 直達

任務／專案／Agent 設定三個 view 由 React state 切換（`web/src/App.tsx:147`），只有任務詳情可用 `#<task_id>` 直達（`App.tsx:149`）。`capture.mjs` 只能擷取登入頁，其餘需要互動腳本。

### C4 targets.json 宣告了不存在的 dark mode

`web/src/style.css` 沒有 `prefers-color-scheme`，顏色都是固定值（例如 `style.css:1-14`）；`targets.json` 已改為只擷取 `light`。

### C5 `pausing` 狀態沒有顯示文字

`web/src/App.tsx:24-37` 的 `stateNames` 缺 `pausing`，狀態徽章與執行紀錄下拉會顯示英文原值；後端會進入此狀態（`src/agent_platform/migrations/006_pause.sql:3`）。

### C6 審批面板的樣式與時間格式和其他區塊不一致

`web/src/Approvals.tsx:20`、`:96` 的錯誤訊息沒有 `error` class，`:95` 的受理提示沒有 `notice` class，`:73` 的時間用瀏覽器預設 locale；其他區塊用 `className="error"`（`App.tsx:43`）與 `zh-TW` 短格式（`App.tsx:51-58`）。

## 已決定

- 無

## 需要放開或決定的點

### D1 第 3 輪的後端形態

- 選項：(a) 容器內起 PostgreSQL＋真實 FastAPI＋fake backend；(b) 前端 contract mock。
- 建議：(a)，以 `scripts/browser-fixture.py` 啟動與 seed；fake backend 產生不了的狀態（C2）在同一個真實伺服器上以 Playwright `page.route` 覆寫回應補拍。整合覆蓋較完整，PostgreSQL 在隔離容器內沒有暴露問題。
- 狀態：**待擁有者決定**。`DESIGN.md` 以此建議作為假設 A1，由擁有者在設計 PR 確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- fallrising/newclear#178：第 1 輪 `DESIGN.md` 草稿與 REVIEW／PROMPT／targets 修正（待確認）。
