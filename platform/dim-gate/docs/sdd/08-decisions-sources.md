# 08 — 決策、來源與待驗證事項

## 1. Architecture decisions

| ID | 決策 | 理由／代價／重開條件 |
| --- | --- | --- |
| ADR-001 | 獨立 `platform/dim-gate` component | 以企業運維體驗為目的，與coding-agent平台／基建執行器分工。未有明確API契約前不綁定sibling實作。 |
| ADR-002 | 同一 SPA 的三中心，共用domain與API | 角色差異在視圖、action與scope，資料保持同一真相。若未來各中心獨立團隊／發布節奏才重新評估microfrontend。 |
| ADR-003 | CMDB統一身分＋provider attributes | 統一檢索／關係又保留AWS、Aliyun、IDC特有語義；需要mapping與validation，不能把所有雲資源當同一VM。 |
| ADR-004 | Mock-first、session-local、有狀態 | 不需雲成本與後端即可展示完整業務；代價是無真正協同與安全邊界，故DemoBanner與future integration gate必需。 |
| ADR-005 | MSW攔截typed HTTP，共用純domain engine | 元件不耦合fixture，契約可轉到真實backend；增加少量mock engine設計，但能驗證跨模組因果。 |
| ADR-006 | React/TS/Vite + shadcn/ui/Tailwind | 符合使用者指定React及shadcn方向；client-only控制台不需SSR。版本與base primitives須M0驗證。 |
| ADR-007 | 固定角色＋明確scope；不做任意policy語言 | 展示RD/Ops/Admin及職責分離已足夠；任意ABAC editor增加範圍。若真實組織規則不足再另立ADR。 |
| ADR-008 | sessionStorage原子snapshot、單一command queue | 基線資料小、可刷新、易reset；不支援跨分頁協同。超出容量拒絕寫入；需要多人／大量資料時改backend，不自行膨脹成local DB平台。 |
| ADR-009 | release／pipeline／incident分開建模 | 成功build不等於上線、回滾不等於告警立即消失；可展示真實業務差異，需保留references和多段狀態機。 |
| ADR-010 | 瀏覽器 history routing與base-path支援 | deep link易讀且可分享視圖；host需SPA fallback、MSW scope正確。完全無rewrite host可另評估hash router。 |
| ADR-011 | component-local依賴，root CI path-scoped | 遵循現有monorepo CI，不觸發其他產品構建；docs基線不添加無code可測的假workflow。 |
| ADR-012 | M0 固定 Node24.18.0／pnpm11.18.0，TS5.9.3 | 沿用 repository runtime 基線；實測最新 TS7 不符合目前 typescript-eslint 的 peer 範圍，因此鎖定受支援的5.9.3。React19.3／Vite8.3／Tailwind4.3／Zod4／MSW2 的精確 patch 與傳遞依賴保存於 lockfile；pnpm 嚴格 peer check，不允許可選 MSW postinstall，worker 由明示 init 產生。 |
| ADR-013 | API／demo prefix 相對 application base；Zod 產生 OpenAPI3.1 | `/dim-gate/api/v1` 防止根 `/api/` 與其他 app 衝突。共用 runtime DTO 與生成檢查避免 drift，planned endpoints 明示後續里程碑；domain refinements 以行為測試補足 JSON Schema 表達限制。 |
| ADR-014 | versioned saved envelope＋Web Locks tab ownership | sessionStorage 會被 opener 複製；每 document 持有 stable ownership lock，reset 更換 API session但保留 ownership，copy 則 fork 兩者。Web Locks 不支援時明示錯誤。saved envelope 全部計入3MiB，不丟棄 audit/replay；persona+domain commands 共用1000上限；corrupt/version mismatch 需明示 recovery。 |

## 2. 已核對的 repository context

2026-09-20 讀取 `fallrising/newclear` main commit `36928bb1887bf8c4e886eeadab22b18f93330966`：

- [根 README](../../../../README.md)：公開作品集、平台／應用分類、root workflows為canonical。
- [Monorepo CI specification](../../../../docs/specs/monorepo-ci.md)：path filters、read-only permissions、固定 action SHA、timeout與concurrency。
- [Prism README](../../../prism/README.md)：可觀測性相容層，當時仍為Phase0，不能預設已有可用APM backend。
- `systems/mkfk/SDD.md` 的總綱＋專題文件模式作閱讀結構參考，不繼承其Raft／Go等領域要求。

在該base的完整tree中，root與`platform/`沒有AGENTS.md／CONTRIBUTING；其他component的AGENTS只作用其自身，不適用dim-gate。本項目新增局部開發約定。既有PORTFOLIO為歷史盤點，不在本次追改；使用者本輪已明確授權新增本項目。

## 3. 官方技術來源

查閱日期：2026-09-20。以下為所選實作方式的參考，不代表版本已完成安裝驗證；不要把動態 `latest` 文件地址當成可重現的dependency pin。

| 來源 | 本設計使用的資訊 |
| --- | --- |
| [shadcn/ui — Vite](https://ui.shadcn.com/docs/installation/vite) | 提供Vite整合與Tailwind設定方式；M0按實際相容版本建立可維護元件與theme。 |
| [MSW — Browser integration](https://mswjs.io/docs/integrations/browser/) | Browser service worker的初始化與攔截方式；dim-gate另定義domain state、persistence、授權與scenario，這些不是MSW自動提供。 |
| [TanStack Query — React overview](https://tanstack.com/query/latest/docs/framework/react/overview) | Query/mutation cache與資料生命週期；本項目另設identity/scope keys與invalidation規則。 |
| [React Flow — Quick start](https://reactflow.dev/learn) | 互動nodes/edges呈現；CMDB的kind、relation semantics、impact BFS与權限截斷由本項目定義。 |
| [Vite — Getting started](https://vite.dev/guide/) | React SPA開發／構建工具與環境要求；確切Node/Vite組合在M0鎖定。 |

本SDD沒有宣稱vendor同步API、雲價、production SLA或特定監控後端相容程度。所有provider fixture與APM值都是合成示例；來源選型與產品行為分開管理。

## 4. M0需要實測但不阻塞文檔的事項

- Node／pnpm與React/Vite/Tailwind/shadcn primitives的相容組合、license與exact lockfile；若偏離repo既有CI基線，記明理由。
- MSW在production demo build、HTTPS subpath及browser-history刷新時的worker URL/scope；不能只測dev server。
- sessionStorage在目標瀏覽器的可用空間、disabled storage行為；3MiB是設計上限，仍需捕捉更早發生的QuotaExceededError。
- chart與graph的初始bundle分割、繁體中文排版及鍵盤替代視圖。

這些是implementation evidence tasks，不需要重新詢問已確認的產品名稱、範圍或Mock-first方向。

### M4 implementation clarification

ADR-020: Observation charts use bounded native SVG and CSS time bars with an equivalent numeric table, retaining semantic tokens, unit/window/source labels and keyboard-readable links. No new chart runtime is required for the three fixed demo metrics. This refines the initial Recharts choice in 05 without reducing APM behavior or M5 measurement gates.

ADR-021: One logical tick remains one second. Recovery observations use three consecutive one-minute windows, scheduled every60 ticks after successful rollback. Explicit latency/recovery scenarios advance180 ticks through the central scheduler and label the synthetic sample windows; this corrects the earlier ambiguous “one recovery sample per tick” wording in03.
