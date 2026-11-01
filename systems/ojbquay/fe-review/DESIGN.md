# FE Review — ojbquay console — DESIGN

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1/A1 保留真 Compose 整合來源；先交付有所有權與 loopback 證據的隔離方案，額外後端變更另定範圍。 第 2／3 輪仍未由本次文件回寫執行。
> 狀態：**設計方向已確認**。實作與 runtime／browser 驗證仍須按本檔範圍另行執行；文件確認不代表產品可用。

## 目標

第 2 輪結束時，console 在符合共用 loopback 隔離規範的環境以合成資料接受檢查，涵蓋所有頁面與主要 drawer／精靈步驟；驗證並修整平板 Drawer 與圖表縮放、鍵盤及 axe 缺口。現有 Compose 啟動程序尚不滿足此隔離條件，不能直接當作已就緒 harness。

## 依據

- REVIEW.md 已決定：休眠元件可在第 2 輪於本檔範圍內修改前端（PORTFOLIO「休眠」fe-review 例外）。
- 已確認的設計依據（2026-10-23）：
  - **A1（D1）**：保留真 JVM／Kafka stack 作整合來源的建議，但須先確認符合 PROTOCOL 的獨立隔離方案；不能直接採用預設 `KEEP_STACK=1 make e2e`。empty／error 狀態仍用測試瀏覽器 `page.route`，不冒充真整合。若隔離需要後端／Compose 變更，須另提範圍；本設計不授權該變更。
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
  - `e2e/compose_full.sh:6` 預設共用 Compose project；`deploy/compose/docker-compose.yml:18,52,74,159` 的 published ports 未限制 host loopback。加入預設網路並用 `console-web:8080` 不等於 PROTOCOL 要求的同環境 loopback；保留的 stack 也可能含既有工作。
- 修改（只在 `fe-review/` 內新增）：
  - 先記錄並審閱隔離契約：每次新的 task 目錄、獨立 network namespace、無既有 volumes／帳號、唯一 project ID，瀏覽器與被測入口同環境且只用 loopback。啟動前核對解析後的 network／ports／mounts 與所有權；遇既存 project 或非 loopback 綁定即拒絕。無可行的現有注入方式時，回報耦合、另提必要部署修正，不在本任務直接改 Compose 或繞過規範。
  - 隔離與 D1 確認後才實作 `fe-review/seed.sh`：對本次新建且已核對的 stack 用 REST 建立合成 topics、groups、PUSH／PULL subscription、delay；DLQ 使用本機受控失敗端點，不連外網。帳號、token 與 payload 當次產生，不沿用保留 stack。
  - `fe-review/login.mjs` 只接受本次 loopback origin，用新合成帳號登入，狀態寫在本次忽略的 task 證據區。targets 的起動及 storageState 由已驗證 harness 設定，不先改成容器 DNS origin 或 verified。
  - 擷取與互動腳本使用 repository 已鎖定的 Playwright；新建專用 `fe-review/playwright.config.ts` 指定此目錄的 states.spec.ts，不沿用只選 `console-web/e2e` 的設定。這些腳本和設定目前均不存在。
- 驗證：先做 ownership／非 loopback／既有 project 的拒絕測試；實際隔離整合通過後，從 repository root 跑 `node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json --dry-run` 與擷取；HTTP、page error、真實登入／seed／主要流程都通過才更新 verified，不能只看頁面 200。
- 風險與回滾：任何啟動失敗保留非秘密診斷。清理只處理本次記錄並重新核對 ID／label／volume 所有權的資源；禁止無條件對預設 project 執行 down／刪 volume。無法證明所有權就停止清理並記錄，不影響別人的保留 stack。文件／harness 可獨立回退，runtime 清理不能用刪檔冒充。

### M2 互動狀態擷取腳本
- 對應：PROMPT「主要流程」、PROTOCOL 第 3 節「狀態」
- 現況：Topics、Groups、Subscriptions 的詳情與建立流程都是 Drawer（例如 `pages/TopicsPage.tsx:76`、`pages/SubscriptionsPage.tsx:131`、`:245`），沒有獨立路由，`capture.mjs` 的頁面清單擷取不到。
- 修改：新增 `fe-review/states.spec.ts`（Playwright），沿用 `e2e-stack/golden-path.stack.spec.ts` 的選擇器，在三種 viewport 擷取：topic drawer 兩個 tab、subscription 精靈四步與 preview 結果、DLQ drawer、group drawer；以 `page.route` 覆寫取得 empty（列表回空陣列）與 error（500）狀態；登入錯誤密碼、delay 查無 ID 兩個錯誤狀態。截圖寫入 `runs/<ts>/screenshots/`（git-ignored）。
- 驗證：腳本在 M1 的環境內跑完，產生的截圖檔名列在 REPORT；`pnpm test`、`pnpm build` 不受影響（腳本不在 `src/`）。
- 風險與回滾：只新增檔案；刪除即回滾。

### M3 驗證並限制 Drawer 的窄螢幕寬度
- 對應：C2
- 現況：Drawer 設定寬度為 DLQ `pages/SubscriptionsPage.tsx:131`（900）、Group `pages/GroupsPage.tsx:61`（800）、Topic `pages/TopicsPage.tsx:77` 與精靈 `pages/SubscriptionsPage.tsx:248`（720）。`styles.css:443-445` 的專案 max-width 規則只在 576px 以下；834px 小於 DLQ 的 900、但大於 Group 的 800。這是窄螢幕風險，Ant Design 最終 computed style 與實際溢出尚未驗證，不宣稱所有 Drawer 在平板都破版。
- 修改：把 `.ant-drawer-content-wrapper { max-width: 100% !important; }` 移出 576 px media query，成為全域規則；Drawer 的 `width` 不變。
- 驗證：先記錄原版 computed width、client/scroll width；只修確實違反上限的情況。`pnpm test`、`pnpm build`、`pnpm e2e`；M2 在 834px 及低於 800px 的中間寬度擷取 DLQ 與 group drawer，證明無水平溢出。
- 風險與回滾：只放寬上限，桌面寬度行為不變；還原該段 CSS 即回滾。

### M4 Dashboard 圖表不跟隨內容寬度
- 對應：C3
- 現況：`pages/DashboardPage.tsx:47-50` 只在 `window` resize 時呼叫 `chart.resize()`；收合／展開側欄（`Layout.tsx:121-123`）改變內容寬度但視窗未變，圖表維持舊寬度。
- 修改：改用 `ResizeObserver` 觀察圖表容器，effect cleanup 時 `disconnect()`；移除 `window` listener。
- 驗證：新增 vitest：mock `ResizeObserver`，觸發 callback 後 `chart.resize` 被呼叫、unmount 後 `disconnect` 被呼叫；`pnpm test`、`pnpm build`；M2 擷取側欄收合前後的 Dashboard。
- 風險與回滾：jsdom 沒有 `ResizeObserver`，測試 setup 需提供 stub；還原該 effect 即回滾。

## 啟動方式（第 2 輪要驗證的版本）

**未執行、尚不具備一鍵啟動資格。** 先完成 M1 的隔離方案與 D1 確認；
既有 `make e2e` 成功紀錄不能證明新 FE harness 的隔離／資源所有權。
建置、快取與合成資料使用共用 launcher 的 task 目錄，不使用既有 stack 或資料庫。
不得直接執行原先的預設 KEEP_STACK 程序，也不提供對預設 project 的清理命令。

M1 完成後，在 repository root、同一受控瀏覽器環境中執行下列**後續候選**擷取程序：

```sh
node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json --dry-run
node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json
```

互動腳本則在 `systems/ojbquay/console-web` 使用已安裝且鎖定的依賴，
候選命令為 `pnpm exec playwright test --config ../fe-review/playwright.config.ts`；
專用 config／states.spec.ts 尚待實作，不可宣稱現有 e2e config 已包含它。
targets ready 不代表後端、登入或合成資料就緒，這些須逐一證明。
真 stack 旅程另記實際命令與同次來源；完成後的清理按 M1 的所有權收據執行。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的 `/login`、`/dashboard`、`/topics`、`/groups`、`/subscriptions`、`/delay`、`/admin/clusters`、`/admin/audit`、`/admin/users`；M2 的 drawer、精靈與狀態；主要流程以 `pnpm e2e:stack` 走一次。
- 通過條件：無 blocker／major；axe 無 critical／serious；desktop／tablet／mobile 無水平溢出；正常流程無非預期 console／request error。M2 注入的 401／500／查無 ID 必須逐項標示為負向測試，不能把正常流程的失敗列為例外。
- 已知不在驗收範圍：dark mode（不存在）、Grafana／Prometheus 畫面、原生 Kafka 工具。

## 開放問題

D1／A1 已由 owner 明確確認。真 stack 的 loopback 隔離方案是進入第 2 輪的必要前提；
若需部署注入，另外界定範圍，不把本次合併文件的授權當作後端修改或實機操作授權。

## 2026-10-24 owner 批准的第2輪執行補充

Owner 在具體隔離/gRPC提案後回覆「批准，代碼完成每個里程碑就提交，然後合併 PR」。上方原始M1部署注入待決條件由本次限定批准滿足，不回寫為歷史已測。允許僅在 fe-review 內提供 review-only Compose overlay：移除所有host published ports、當次新建PG/admin/Grafana憑證、唯一image tags及run/source ownership labels；保留現有11service/internalbridge拓撲及production Compose原檔。專用browser/Vite/transparentproxy namespace加入該次新bridge，前端/proxy僅loopback，backend既有bridge listener獲允許；無hostnetwork、Docker socket或API替身。

M1種子方法更正：現有REST建topics/groups/PUSH/PULL subscriptions；delay走現有 ojbk.v1.ProducerService/ProduceDelay gRPC，token/payload用memory或protectedstdin，再以現有REST delay inspector回讀。DLQ使用該次owned既有push-sink未監聽port9，無外網失敗端點。所有權/ports/mounts負向檢查先於啟動，精確ownedresource清理與私有證據保留均必要。

實作、驗收與邊界見 [本輪task](tasks/round2/task.md)。此補充不是實跑通過，不授權backend/API/auth/dependency/CI/productiontopology變更、release或deploy；原M2–M4與完整第3輪條件不改。
