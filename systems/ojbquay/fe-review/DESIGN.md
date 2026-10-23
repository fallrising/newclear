# FE Review — ojbquay console — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**。每次修改都走 PR。

## 目標

第 2 輪結束時，console 能在隔離的 Compose 網路內以合成資料啟動，`capture.mjs` 與互動腳本能擷取所有頁面與主要 drawer／精靈步驟；平板寬度不再水平溢出，Dashboard 圖表跟隨內容寬度縮放；axe 無 critical／serious。

## 依據

- REVIEW.md 已決定：休眠元件可在第 2 輪於本檔範圍內修改前端（PORTFOLIO「休眠」fe-review 例外）。
- 假設（待擁有者在本 PR 確認）：
  - **A1（D1）**：第 3 輪後端用既有 Compose stack（`KEEP_STACK=1 make e2e`），不另寫 mock 伺服器；empty／error 狀態用互動腳本內的 Playwright `page.route` 覆寫個別 API 回應。
- 相關規範：
  - [AGENTS.md](../AGENTS.md)：不記錄 payload、credential；不改對外 API。
  - [SDD](../SDD.md) AC-10：console 核心操作；真 stack 旅程 `console-web/e2e-stack/golden-path.stack.spec.ts`，mock journey 不冒充真端到端。
  - [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md) 第 0 節：獨立 network namespace、合成資料、不用 `--network host`。

## 不做的事

- 不新增 dark mode、不改文案語言（UI 目前只有 light 主題與英文文案）。
- 不改後端 API、Compose 拓撲或 CI；不升級 React／Vite／Ant Design／ECharts 的 major 版本。
- 不重新設計視覺（色彩、字級、版面結構），不調整圖表配色。
- 不另寫 mock API 伺服器（見 A1）。

## 修改項目

### M1 第 3 輪的隔離 stack、合成資料與登入狀態
- 對應：C1、D1（A1）
- 現況：
  - `targets.json` 指向 `pnpm dev`（5173）；`console-web/vite.config.ts:6-11` 把 `/api` proxy 到 `localhost:8080`，沒有後端時所有頁面只剩錯誤狀態。
  - `console-web/e2e/serve.mjs` 只是 `dist/` 靜態伺服器；假資料寫在 `console-web/e2e/golden-path.spec.ts` 的 `page.route` 內，`capture.mjs` 不能使用。
- 修改（只在 `fe-review/` 內新增）：
  - `fe-review/seed.sh`：對 `KEEP_STACK=1 make e2e` 留下的 stack 以 REST 建立合成資料：2 個 topic（含一個長名稱）、2 個 group、PUSH／PULL subscription、一筆指向不可達端點的 subscription 以產生 DLQ、一筆 delay。帳密只用 e2e 腳本的本機合成值。
  - `fe-review/login.mjs`：以 admin 合成帳號登入，寫 `runs/<ts>/auth.storage.json`（git-ignored）。
  - `targets.json`：`baseUrl` 改為 `http://console-web:8080`，`start` 移除（stack 由 `make e2e` 啟動），`storageState` 指向上述檔案。
  - `capture.mjs` 在 `mcr.microsoft.com/playwright:v1.62.0-noble` 容器內執行，加入 Compose 網路 `ojbquay-e2e_default`；`npm i --no-save @axe-core/playwright` 於暫存目錄。
- 驗證：`node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json --dry-run`；實跑一次，`capture.json` 每頁 HTTP 200、無 page error；完成後 `targets.json` 改 `verified: true`。
- 風險與回滾：只新增 `fe-review/` 檔案與修改 `targets.json`，刪除即可回滾；stack 用完 `make e2e` 預設清理 volume。

### M2 互動狀態擷取腳本
- 對應：PROMPT「主要流程」、PROTOCOL 第 3 節「狀態」
- 現況：Topics、Groups、Subscriptions 的詳情與建立流程都是 Drawer（例如 `pages/TopicsPage.tsx:76`、`pages/SubscriptionsPage.tsx:131`、`:245`），沒有獨立路由，`capture.mjs` 的頁面清單擷取不到。
- 修改：新增 `fe-review/states.spec.ts`（Playwright），沿用 `e2e-stack/golden-path.stack.spec.ts` 的選擇器，在三種 viewport 擷取：topic drawer 兩個 tab、subscription 精靈四步與 preview 結果、DLQ drawer、group drawer；以 `page.route` 覆寫取得 empty（列表回空陣列）與 error（500）狀態；登入錯誤密碼、delay 查無 ID 兩個錯誤狀態。截圖寫入 `runs/<ts>/screenshots/`（git-ignored）。
- 驗證：腳本在 M1 的環境內跑完，產生的截圖檔名列在 REPORT；`pnpm test`、`pnpm build` 不受影響（腳本不在 `src/`）。
- 風險與回滾：只新增檔案；刪除即回滾。

### M3 Drawer 在平板寬度溢出
- 對應：C2
- 現況：Drawer 寬度固定：DLQ `pages/SubscriptionsPage.tsx:131`（900）、Group `pages/GroupsPage.tsx:61`（800）、Topic `pages/TopicsPage.tsx:77` 與精靈 `pages/SubscriptionsPage.tsx:248`（720）。`styles.css:443-445` 的 `max-width: 100%` 只在 `max-width: 576px` 內，577–900 px（含 834 px 平板）時 900／800 寬的 Drawer 超出視窗。
- 修改：把 `.ant-drawer-content-wrapper { max-width: 100% !important; }` 移出 576 px media query，成為全域規則；Drawer 的 `width` 不變。
- 驗證：`pnpm test`、`pnpm build`、`pnpm e2e`；M2 在 834 px 擷取 DLQ 與 group drawer 無水平溢出。
- 風險與回滾：只放寬上限，桌面寬度行為不變；還原該段 CSS 即回滾。

### M4 Dashboard 圖表不跟隨內容寬度
- 對應：C3
- 現況：`pages/DashboardPage.tsx:47-50` 只在 `window` resize 時呼叫 `chart.resize()`；收合／展開側欄（`Layout.tsx:121-123`）改變內容寬度但視窗未變，圖表維持舊寬度。
- 修改：改用 `ResizeObserver` 觀察圖表容器，effect cleanup 時 `disconnect()`；移除 `window` listener。
- 驗證：新增 vitest：mock `ResizeObserver`，觸發 callback 後 `chart.resize` 被呼叫、unmount 後 `disconnect` 被呼叫；`pnpm test`、`pnpm build`；M2 擷取側欄收合前後的 Dashboard。
- 風險與回滾：jsdom 沒有 `ResizeObserver`，測試 setup 需提供 stub；還原該 effect 即回滾。

## 啟動方式（第 2 輪要驗證的版本）

```sh
# systems/ojbquay（stack 在 Compose 自己的網路內）
KEEP_STACK=1 make e2e
fe-review/seed.sh
# 在 playwright 容器內，加入 ojbquay-e2e_default 網路
node fe-review/login.mjs
node ../../docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json
npx playwright test fe-review/states.spec.ts
# 結束
docker compose -p ojbquay-e2e -f deploy/compose/docker-compose.yml --profile e2e down --volumes
```

帳號、topic token、payload 都是本次 stack 產生的合成資料；console-web 在網路內是 `console-web:8080`。第 2 輪驗證後同步到 `targets.json`。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的 `/login`、`/dashboard`、`/topics`、`/groups`、`/subscriptions`、`/delay`、`/admin/clusters`、`/admin/audit`、`/admin/users`；M2 的 drawer、精靈與狀態；主要流程以 `pnpm e2e:stack` 走一次。
- 通過條件：無 blocker／major；axe 無 critical／serious；desktop／tablet／mobile 無水平溢出；console 無 error；除登入錯誤密碼的預期 401 外無 4xx／5xx。
- 已知不在驗收範圍：dark mode（不存在）、Grafana／Prometheus 畫面、原生 Kafka 工具。

## 開放問題

無。
