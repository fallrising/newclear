# 知識樹與能力目錄

本樹是 Cloud Lab 的產品知識導航。它描述責任與關係，不保存私人知識庫或覆寫來源元件的主線狀態。M0 表保留來源映射；M1 局部能力已有 **locally_verified** 實作，見下方實作對照，沒有 live_verified 宣告。

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
| ID-02 | 私人入口與機器入口；部署政策擁有 | [架構](architecture.md) | [CF Access 來源](sources.md)；無本次帳號驗證 | M1 |
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

## M1 實作對照

| 能力 | 本次位置與範圍 | 狀態／證據 |
| --- | --- | --- |
| ID-01 | [Worker auth](../apps/control/worker/auth.mjs)：Access JWT、HMAC、D1 grant | locally_verified；真實 Access 未驗 |
| AU-01／AU-02 | [控制面](../apps/control/worker/index.mjs)、[D1 schema](../apps/control/migrations/0001.sql)：准入、outbox、具期限低頻schedule | locally_verified；沒有啟用排程 |
| EX-01 | [Python OS collector](../adapters/node-health/README.md)：單節點負載與根目錄空間、durable journal | locally_verified；未接指定遠端節點 |
| OB-01／OB-02 | [看板](../apps/control/public/index.html)、snapshot／有界 health artifact | locally_verified 的 UI 模型／HTTP；互動瀏覽器與 live gate 待驗 |

共同證據：[M1 evidence](evidence/m1-implementation.md)。其餘能力保持 proposed／後續計畫，不因本次實作自動升級。

BC補充：AU-01的[固定bot caller](../tools/bot_bridge.py)及[JSON契約](bot-bridge.md)已本機驗證durable提交／查詢；[證據](evidence/m1-bot-bridge.md)區分真正HTTP collector與尚未接線的Grok。它不接管Kith聊天室或agent原生run，亦不改HL部署pending。

MT補充：AU-01的[本機MCP接入](mcp-stdio.md)重用BC固定工具與durable ID，不建立第二份命令權威；[證據](evidence/m1-mcp-stdio.md)含實際stdio／HTTP／collector，Kith INV-09保持。

GC補充：AU-01的[獨立Grok工具端](grok-connection.md)已登記status-only MCP，原生client發現通過；bot grant過期與自然語言執行仍待後續，Kith權責保持。

BL補充：AU-01獨立MCP工具已完成[一筆真實原runner閉環](evidence/m1-bot-live.md)，bot僅短期窗口，Grok恢復status-only；沒有新增聊天權威、model或常態授權。

BP補充：AU-01的[持久bot政策](bot-policy.md)補上獨立工具host的本機租期與跨連線配額，維持原API／runner權威；常態live啟用另行驗收。

BR補充：AU-01以[顯式政策續租](bot-policy-renewal.md)連接原state的下一期，保持原API／runner權威；模型不具續租工具，live啟用另驗。

BA補充：AU-01的[首期有界啟用方案](bot-activation.md)固定獨立host候選與原state；bot-only期限提議受原runner／Access限制，準備與實際權限分開。

BT補充：AU-01首期政策與獨立host已[實際啟用](evidence/m1-bot-activation-live.md)，原bot-only截止與持久額度並行；工具驗證不等於模型對話驗收。
