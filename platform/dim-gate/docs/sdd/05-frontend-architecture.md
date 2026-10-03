# 05 — 前端架構與工程設計

## 1. 技術決策

以下是選定的組合，確切版本於 M0 以相容性驗證與 lockfile 固定，不在文件階段宣稱套件已安裝或可 build。

| 技術 | 用途與邊界 |
| --- | --- |
| React + TypeScript strict + Vite | Client-only SPA；無 SSR 需求，按中心及重型頁面 lazy loading |
| shadcn/ui + Tailwind CSS | 受專案管理的 UI 元件、semantic tokens、明暗主題；不是另外一套後端框架 |
| React Router | Route registry、layout、deep links、URL search params；採 browser history |
| TanStack Query | API data cache、invalidation、loading/error；不作 authoritative domain store |
| TanStack Table | 欄位、sorting/filtering/pagination 的表格行為；由共用 DataTable 封裝 |
| React Hook Form + Zod | Typed forms、輸入／API payload validation；domain rule 仍由 handler 檢查 |
| React Flow | CMDB dependency topology；只畫授權且有界的子圖 |
| Recharts | 時間序列／容量圖；必須有單位與表格替代 |
| MSW | Browser 與測試共享 HTTP handlers，不讓 page components import fixture |
| Vitest + Testing Library + Playwright | Domain 單元、元件互動及跨中心 E2E；axe 做可存取性檢查 |
| pnpm | component-local manifest／lockfile；不為本項目改整個 repo 的 workspace 結構 |

選型參考與版本確認責任見 [08](08-decisions-sources.md)。M0 同時檢查 React、shadcn base primitives、Tailwind、Vite、Node 的相容性；有差異以 ADR 記錄實際選擇，不默默退回 JavaScript 或改 UI 系統。

## 2. 規劃中的模組

本節為未來 layout，文件階段不建立空 source folders。

| 目錄 | 責任 | 不允許依賴 |
| --- | --- | --- |
| `src/app/` | bootstrap、providers、router、route registry、shell | 不直接更新 CMDB／workflow snapshot |
| `src/components/ui/` | 生成／維護 shadcn primitives | 不知道 role、provider 或 API |
| `src/components/shared/` | DataTable、StatusBadge、ScopeBar、EntityLink、Timeline、EmptyState | 不寫 domain transitions |
| `src/features/{cmdb,catalog,requests,delivery,observability,admin}/` | 頁面、forms、queries、feature components | 不跨 feature import 私有 state |
| `src/domain/` | Entity schemas、commands、policy evaluator、state machines、selectors | 不依賴 React、MSW、DOM、真實時間 |
| `src/api/` | Typed fetch client、endpoint DTO、error mapping、query keys | 不讀 fixture、不能儲存雲端 credential |
| `src/demo/` | Seed builder、snapshot repository、scheduler、scenario controller、MSW handlers | 不被 future live bundle 依賴 |
| `src/test/`、`e2e/` | Fixtures helpers、domain properties、browser journeys | 不透過直接改 store 偽造 E2E 成功 |

中心只是路由 layout；同一 `ApplicationDetail`／`ResourceDetail` projection 可在 drawer 或中心內頁重用。不為 RD、Ops 建兩套互不相容的 release types。

## 3. 資料與權限流程

頁面 → feature query/mutation → typed API client → `/api/v1/...` → MSW handler → domain engine。engine 讀 context、policy、snapshot；返回 envelope。UI 不靠 local component state 來充當請求／發布的唯一存檔。

Query key 統一包括 `sessionId, identityEpoch, policyVersion, resourceFamily, scope, filters`。頁面切換共用 cache，但角色或 policy 變更時清除，避免殘留資料。可見頁面的查詢收到 store revision 變更後 invalidation；不必全頁 reload。

- query 預設 staleTime=5s；demo 顯式 domain commit 會失效相關 key。錯誤 retry：讀取最多 1 次，401/403/404 不重試。
- mutations 不做一般性 optimistic domain updates；表單提交中保留草稿，等 command receipt 確認後刷新。安全的 UI 偏好可即時更新。
- long job 由 jobId 輪詢 1s；terminal 停止、hidden tab 暫停；刷新由 snapshot 恢復。示範 engine 本身不因 query polling 次數推進。
- cross-feature invalidation families 由 command 定義：provision success 影響 requests/jobs/environments/cis/placements/capacity/audit；release success 影響 pipeline/releases/environments/audit；observation 影響 metrics/traces/logs/incidents/dashboard。

## 4. Demo persistence 與交易

Domain engine 在頁面主執行緒持有 snapshot，MSW handlers 對同一 engine 發 command；service worker 只攔截／轉送 HTTP，不另建第二份 state。

1. 每分頁一個 sessionStorage key `dim-gate.demo.v1`；snapshot 含 schemaVersion、seedVersion、sessionId、logicalClock、sequence counters、storeRevision、policyVersion、entities、jobs、events、audit、idempotency records、scenario flags。
2. 所有 mutation 進單一序列 queue，純函式計算下一 snapshot，驗 invariant 後一次 JSON serialize + sessionStorage.setItem；成功才交換記憶體 state 並通知 UI。
3. storage quota／serialize 失敗返回 507 `DEMO_STORAGE_FULL`，舊 state 保留，UI 提供匯出安全摘要或 reset；不顯示假保存成功。v0.1 不實作 snapshot import，也不匯出憑證／真實資料。
4. 預設 snapshot serialized 上限 3 MiB、成功 command 上限 1,000；到達上限拒絕新 mutation 並提示 reset，不靜默丟棄稽核或冪等記錄。
5. 首次開啟載入 seed；刷新沿用同分頁 session；新分頁明示獨立 session。sessionStorage 偶爾複製既有分頁時重新配 session identity，不承諾完全空白基線；提供 reset。
6. schema/seed version 不相容或 JSON 損壞時，顯示「示範資料需重置」，不 crash 或部分 migrate。沒有寫入儲存空間時，可選擇明示的暫存記憶體模式，刷新即遺失；同樣走 engine invariant。
7. reset 需 dialog 確認，終止所有 scheduler tasks、增加 session generation、清 API cache、恢復 seed，舊 epoch 的 handler response／timer 必須忽略。重置本身記錄在新 session 的 demo metadata，不把上次 audit 混入。

UI preferences（主題、密度、側欄）可用獨立 localStorage key；permission、credential、domain entity 不放這裡。5,000 CI benchmark profile 為唯讀 memory mode，不需塞進 3 MiB persistence budget。

## 5. UI 系統

Semantic tokens：background、foreground、card、muted、border、primary、destructive 及 status healthy/warning/critical/unknown；Tailwind classes 只引用 token，避免每 feature 自訂一套色碼。元件 API 接收 enum，不接收任意 HTML。

共用元件最少包括：AppShell、CenterSwitcher、PersonaSwitcher、ScopeSelector、DataTable、EntityDrawer、StatusBadge、ConfirmActionDialog、PermissionGate、DiffSummary、EventTimeline、MetricPanel、TraceWaterfall、DemoBanner、GuidePanel。

Forms 必須有 schema error 與 server/domain error 的不同區塊；422 按 field 映射，409 保留輸入但要求重新讀取版本，403 不重試。無操作權限與因 state 暫不能操作分開解釋。

## 6. 效能與可存取性

以下是 M5 的驗收預算，不是承諾所有使用者環境相同：

| 項目 | 預算與測量條件 |
| --- | --- |
| Production build 首頁 | Chromium desktop、1440×900、4× CPU throttle、localhost serving、無網路節流、baseline seed；cold navigation 5 次中位 LCP ≤ 2.5s |
| App shell JS | 初始路由必要 JS gzip 合計 ≤ 300 KiB；拓撲、APM、guide 之外的重型模組按需載入 |
| Filter／sort | 5,000 CI 唯讀 profile，排除固定 mock latency，100 次操作 p95 engine query ≤ 150ms；記錄 CPU/OS/browser |
| Mutation response | baseline seed、排除刻意錯誤情境，100 次安全 command 的 p95 ≤ 500ms；包含 150ms mock latency |
| Topology | 每次至多 100 nodes／200 edges；含截斷標記與 expand，不一次渲染 5,000 nodes |
| Accessibility | 主要頁面 axe 無 serious/critical；完整主線可鍵盤操作，dialog focus 與錯誤提示人工驗證 |

UI 操作若超過 300ms 有 pending feedback。baseline graph 不開持續粒子動畫；尊重 prefers-reduced-motion。表格分頁避免把整個 inventory 掛到 DOM；log viewer 最多 500 lines／頁。

## 7. 構建與將來部署

M0 建立 `package.json`、`pnpm-lock.yaml`、Node 版本檔、`components.json`、TypeScript/Vite config。只在 component 安裝依賴。規劃 scripts：`dev`、`build`、`preview`、`lint`、`typecheck`、`test`、`test:e2e`、`check:docs`；目前尚不存在。

Demo build 明確設定 `VITE_DATA_MODE=demo`，即使是 production build 也載入 MSW；未設定模式則 startup error，避免上線後悄悄變成錯誤的 live 請求。future live mode 必須提供 API adapter 與 backend session；v0.1 選 live 應顯示「尚未提供」，不 fallback 到 demo。

MSW worker URL 依 Vite BASE_URL 配置，service-worker scope 僅限部署 app base，避免攔截同 origin 其他產品。靜態 host 需 HTTPS 或 localhost，設定 browser-history fallback 到 index.html、正確資產 MIME；base-path 深連結與刷新列入 E2E。第一版只定義部署需求，不在文件 PR 發布網站。

依 repo CI 慣例，後續 workflow 放 `.github/workflows/dim-gate-ci.yml`，path filter 包含本 component 與自身；read-only contents、immutable action SHAs、timeout、concurrency、disable persisted credentials。不納入其他 component 的 build 或 release。


## W1 相容與視圖狀態

W1 dashboard query key 加入全部 scope filters，identity/policy/epoch 防護沿用。activeWorkspace 為可重新驗證的 UI preference，按 session/user 分隔，URL 中合法工作區優先；不作授權來源。首頁 URL 保存 scope；scope 切换讀新 query，不沿用前範圍資料。`dim-gate.demo.v1`、schemaVersion1、seedVersion `dim-gate-m4-v1` 均保持不變，現有存檔不遷移、不重設。所有 AC-27 效能預算與可用性 gates 保留。

W1 revision3：RD `workOwner=all|mine` 納入 URL、完整 query key 和 strict dashboard DTO；mine 只篩工作／交付的實際 requester/creator，不改服務範圍與持久化。切到 Ops/Admin 清除此不適用條件並說明，合法 project/environment 在三工作區均保留。


## W2 integration delta

W2 snapshot version2 uses the existing shared controller, queue, idempotency and sessionStorage key. Strict version1 reader validates genuine W1 active operations before atomic conversion; failed conversion preserves original bytes. Resource UI uses typed clients, identity/policy-keyed queries and lazy public feature exports. Lightweight runtime operation descriptors are generated and checked from canonical OpenAPI contracts. Initial required JS retains the existing 300KiB budget; no measurement exclusions. See [W2 integration contract](../W2-INTEGRATION-CONTRACT.md) for exact types, operations, policy, support matrix and owners. Current validation/acceptance is recorded separately in [STATUS](../STATUS.md).


## W3 實作前契約

W3 沿用 initial JS307200bytes、冷啟動LCP、5,000CI query 與 persisted HTTP command 基準，不提高預算。新的 command/scheduler 可分離至既有 lazy queue，但必要 startup schema/relationship/scheduler validation 保持執行。全主題、三viewport、keyboard、Firefox/WebKit、sibling/live isolation 和 no stale persona cache 均為 exit gates。 行為細節與 owner 以 [W3 contract revision3](../W3-INTEGRATION-CONTRACT.md) 為準；這是實作前規格，尚不是通過驗收的宣稱。

W3 首次啟動量測超標後，可將非 Shell 所需的 feature API client 延至首次操作載入；型別與回應驗證保持相同。每次呼叫在等待模組前保存輸入和 actor/session/generation/policy/epoch，等待後有任一變更則拒絕，不能以新身分送出舊命令。seed、遷移、snapshot／關係／排程驗證仍在啟動完成前同步執行。

## W4 實作前契約

W4 三個新路由延後載入，typed client 的 deferred boundary 保留呼叫前 identity/input snapshot 與回應前 epoch 防護。startup 必須完成 v1–v4 遷移與 snapshot/integrity 驗證後才渲染；不能靠 lazy import 跳過檢查。原 initial JS 307200 gzip bytes、LCP、5,000 CI query 與 persisted HTTP command 上限不變；W3 產品只餘753 bytes headroom，須在固定 W4 build 量測。鍵盤、明暗三 viewport、深連結、Firefox/WebKit 與 scope race 均為 gate。詳見 [W4 contract revision1](../W4-INTEGRATION-CONTRACT.md)。

React Query 的 queryFn／mutationFn 以明確 callback 呼叫 typed API，只傳入 API 定義的參數；零參數讀取不轉傳 QueryFunctionContext，mutation 不轉傳框架 context。AbortSignal、QueryClient 等框架物件不屬於可持久化的 API 輸入快照。Admin 整合 metadata 的初次讀取與重新整理必須能通過此邊界，原有模擬測試及身分隔離流程保留。


## W5 platform governance delta (2026-09-23)

[W5 integration contract](../W5-INTEGRATION-CONTRACT.md) revision 1 fixes the implementation boundary for this section. Register Admin /users, /features, /routes and /notifications pages and extend RD alerts/Ops alerting through typed clients; load new pages on demand to protect the unchanged 307200-byte initial JS budget. Identity/policyVersion and full scope key queries; stale old-persona/old-grant responses cannot render after switch. Preserve safe drafts and readback/history on command failure. Keep eager snapshot validation despite route/module splitting.
