# 知識樹與能力目錄

本樹是 Cloud Lab 的產品知識導航。它描述責任與關係，不保存私人知識庫或覆寫來源元件的主線狀態。M0表保留來源映射；下方M1對照已按具名live證據更新。live_verified只表示曾完成該子集驗證，不保證當前授權仍有效；近期方向見[重排計畫](direction-review.md)。

[CF工具目錄](tool-catalog.md)補上2026-11-01來源盤點與Edge Ops比較；這是導航文件，未新增執行介面。RS-01的下一個有界工作為沿用既有inventory的唯讀報告；EX-01維持Cloud Lab日常健康入口，Edge Ops只作參考。

## 知識樹

```text
CL Cloud Lab
├── ID 身分與入口：operator、bot、runner、grant、Access、路由
├── RS 資源與服務：inventory、resource reference、desired/observed、capability
├── AU 任務與自動化：API、UTC schedule、event、command、run、approval
├── EX 執行能力：唯讀檢查、受控運維、agent adapter、CF executor
├── OB 觀測與成果：freshness、event、artifact、verification、notification、dashboard
├── AP 使用者應用：控制台、聊天、筆記／提問工作台
└── OP 營運與恢復：budget、retention、backup、restore、migration、retirement
```

## 節點記錄格式

每個葉節點有 `capability_id`、用途、唯一責任者、依賴、介面版本、實作位置、階段及證據引用。階段使用 `proposed / implemented / locally_verified / live_verified / retired`；實作完成、部署與可用驗收分開。只有新的驗收證據能升級狀態；不能由目錄存在或 health response 推導。

資源目錄的 `resource_ref` 是穩定 opaque ID，顯示名可改，hostname／provider account ID 不作授權主鍵。`observed_at`、`received_at`、來源、完整性及 freshness 必須保留；未知值不填零。實際私有 inventory 存放在部署環境，不提交此樹。

## 能力對照

| ID | 用途與唯一責任 | 提案契約／設計 | 現行來源與證據入口 | Cloud Lab 目標 |
| --- | --- | --- | --- | --- |
| ID-01 | 認證與 scoped caller；准入層決定 | [identity](../contracts/identity.md) | [Kith auth 邊界](../../../products/kith/SDD.md)僅供對照，不共用 session | M1 |
| ID-02 | 私人入口與機器入口；部署政策擁有 | [架構](architecture.md) | [CF Access 來源](sources.md)；後續Access實證見下方M1對照 | M1 |
| RS-01 | 雲資源盤點；inventory adapter 提供 observed | [架構](architecture.md) | 外部私人盤點器，公開僅保留介面需求 | M2 候選 |
| RS-02 | 服務與能力目錄；原服務 owner 保留 lifecycle | [遷移表](migration.md) | [Fleet SUCCESS](../../../specs/fleet/SUCCESS.md)；非 Cloud Lab catalog 實作 | M1 最小 reference |
| AU-01 | 命令准入／去重；Cloud Lab command store | [commands/runs](../contracts/commands-runs.md) | [Edge Ops SDD](../../edge-ops/SDD.md)；跨產品契約尚未接線 | M1 |
| AU-02 | 排程與事件觸發；trigger adapter 提交命令 | [recipes](../contracts/recipes.md) | [Kith Cron 設定](../../../products/kith/wrangler.toml)是產品內排程，非共用 scheduler | M1 固定 UTC schedule |
| EX-01 | 唯讀主機檢查；限定 runner 執行 | [recipes](../contracts/recipes.md) | [Edge Ops SUCCESS](../../edge-ops/SUCCESS.md)：契約與 mock，真 collector pending | M1 |
| EX-02 | workload／host 變更；各自原 authority 執行 | [架構](architecture.md) | [Edge Ops 責任表](../../edge-ops/SDD.md)／[Fleet](../../../specs/fleet/README.md) | M2 後獨立批准 |
| EX-03 | agent 原生 run；外部 agent 平台執行 | [commands/runs](../contracts/commands-runs.md) | [Agent Platform](../../agent-platform/SUCCESS.md)／[Workforce](../../agent-workforce/SUCCESS.md) | M2 後 adapter |
| OB-01 | 事件／成果證據；producer 與 artifact owner | [events/artifacts](../contracts/events-artifacts.md) | [Signal Hub SUCCESS](../../signal-hub/SUCCESS.md) | M1 最小事件及成果引用 |
| OB-02 | 看板與通知；可重建投影 | [架構](architecture.md) | [Signal Hub](../../signal-hub/README.md)／[Edge Ops](../../edge-ops/README.md) | M1 單頁狀態 |
| AP-01 | 人機聊天；Kith 保留房間／訊息權威 | [遷移表](migration.md) | [Kith SUCCESS](../../../products/kith/SUCCESS.md) | M2 後評估 apps 歸位 |
| AP-02 | 私人筆記與提問；應用 owner 保留資料權威 | [遷移表](migration.md) | 非公開來源，未納入公開程式 | M2 後公開適用性審閱 |
| OP-01 | 配額、備份與恢復；各 store owner 執行 | [架構](architecture.md)／[驗收](verification.md) | [Open Compute lab](../../../labs/open-compute/SUCCESS.md)僅參考實驗方法 | 每次部署的必要 gate |
| OP-02 | 遷移與封存；元件 owner 決定切換 | [migration](migration.md) | [來源清單](sources.md) | M0 計畫，M2/M3 執行 |

## 導航更新規則

新增能力先指定唯一責任及既有來源；沒有實作就填 proposed 和缺口。抽取／遷移後更新實作 link，舊路徑保留 successor 指向，歷史來源及證據保留固定版本。一次部署的狀態不寫成整個元件已驗收。

未來機器可讀 catalog 可由這個欄位集合設計 schema；M0 不提供可自動派工的 registry，文件中的 capability ID 也不授權任何操作。

## M1 實作與實際證據

| 能力 | 現行實作 | 驗證層次／限制 |
| --- | --- | --- |
| ID-01／ID-02 | [Worker auth](../apps/control/worker/auth.mjs)、Access／HMAC／scoped grant | live_verified子集：[首輪接入](evidence/m1-first-live.md)、[撤權](evidence/m1-remote-recovery.md)、[Safari登入](evidence/m1-usage-live.md)。human／bot窗口已到期，不代表目前可登入使用。 |
| AU-01／AU-02 | [控制面](../apps/control/worker/index.mjs)、D1 outbox、15分鐘schedule | live_verified子集：[Cron閉環](evidence/m1-health-schedule-window-live.md)、[unknown處置後新Cron](evidence/m1-unknown-resolution-live.md)；限一種recipe／單節點，原授權期限保持。 |
| EX-01 | [Python collector](../adapters/node-health/README.md)、journal／resident | live_verified子集：[服務接入](evidence/m1-service-live.md)；最後保存政策截止2026-11-05T07:24:25Z，非本次程序存活證明。 |
| OB-01／OB-02 | [看板](../apps/control/public/index.html)、snapshot／artifact／應用用量 | live_verified子集：Safari手動用量與[新版看板](evidence/m1-snapshot-rollout.md)。完整Event/seq未實作，provider用量／帳單unknown。 |
| AU-01 bot | [bot bridge](../tools/bot_bridge.py)、[MCP](mcp-stdio.md)、[獨立Grok工具接線](grok-connection.md) | [真實工具閉環](evidence/m1-bot-activation-live.md)已驗；沒有模型對話驗收，過期bot不會自動續權。 |
| OP-01 | 配額／稽核／[隔離還原](evidence/m1-remote-restore.md) | 5應用表／42列與3journal恢復已驗；沒有活躍程序failover，Pages全域盤點缺讀取權限。 |
| RS-01／RS-02、EX-02／EX-03、AP、OP-02 | 來源／adapter／遷移設計 | runtime仍proposed；已有[文件目錄與處置建議](tool-catalog.md)，沒有既有應用搬遷／封存或agent平台接入。下一項為inventory報告adapter。 |

歷史細項見[里程碑紀錄](milestone-history.md)及[任務板](tasks/BOARD.md)。本樹只投影證據，不產生新的執行或授權權威。
