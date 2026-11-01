---
project: platform/cloud-lab
purpose: 以共同契約與知識樹組合個人 Cloudflare 工具、遠端運維及代理能力
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-11-01
source_commit: 882ccb000fdae8654bec636b70816d12699fc49c
---

# Cloud Lab 成功契約

## 主線與範圍

單operator的CF工具整合與非同步運維入口，逐步連接既有應用、運維與agent平台；不是只建造一個健康檢查器。原設計見[SDD](SDD.md)，2026-11-01重排見[方向審查與近期計畫](docs/direction-review.md)。

M0知識樹與介面已完成；M1固定node-health profile已實作／部署並有多層驗證，長期整合目標仍未完成。`source_commit`是本次審查輸入基準，不代表這份文件的新commit或目前live版本。歷史逐輪紀錄移至[單一歷史頁](docs/milestone-history.md)。

## 驗收條件

| AC | 範圍 | 狀態 | 證據與剩餘範圍 |
| --- | --- | --- | --- |
| AC-01 | Given 現有能力與來源，When 沿知識樹閱讀，Then 每個能力有責任者、契約、來源／實作與證據或明示缺口 | passed | [M0證據](docs/evidence/m0-review.md)；本次修正入口的過時狀態 |
| AC-02 | Given UI／bot／schedule 與既有 executor，When 追蹤合成命令，Then 准入、去重、attempt、取消、未知及驗證由明確 owner 處理 | passed | M0設計及[M1實作](docs/evidence/m1-implementation.md)，限固定profile |
| AC-03 | Given CF 元件及既有平台，When 分配狀態與部署責任，Then 無雙重 run／host／workload／Done 權威 | passed | [架構](docs/architecture.md)；未接管host/workload/agent lifecycle |
| AC-04 | Given 每個候選來源，When 決定歸位／抽取／adapter／reference，Then 有目標與阻擋，封存必須通過接替及回退 gate | passed | [遷移表](docs/migration.md)；只代表設計，尚未完成實際整合或封存 |
| AC-05 | Given 完整文件候選，When 跑既有索引驗證與獨立審查，Then 導航一致、沒有 runtime 成功冒稱，所有未實作事項保留 | passed | M0證據；本次修正README／知識樹／狀態索引，不把歷史部署寫成當前可用 |
| AC-06 | Given 授權 caller 與一台真實 runner，When API／排程提交固定唯讀檢查，Then 同一 command 可追蹤、去重、驗證並在看板顯示 | historical | [首輪API](docs/evidence/m1-first-live.md)、[Cron](docs/evidence/m1-health-schedule-window-live.md)、[bot](docs/evidence/m1-bot-activation-live.md)、[Safari讀取](docs/evidence/m1-usage-live.md)、[看板更新](docs/evidence/m1-snapshot-rollout.md)。已有閉環證據；**Grok模型對話不是此AC的門檻**。日常授權可用性另見近期計畫，不把到期窗口當現行可用。 |
| AC-07 | Given 重複投遞、失聯、取消及恢復，When 執行與回報競爭，Then 不重做未知副作用且停止／未知／驗證狀態誠實可見 | pending | [十四列矩陣](docs/failure-matrix.md)逐列區分local／歷史remote。已有固定profile保障；新adapter的故障語義在接入時驗，不無限追加現有recipe的故障演練。 |
| AC-08 | Given 私人入口、受限預算與備份，When 撤權、超限或隔離還原，Then 存取被限制、成本／缺漏可見且未完成工作先對帳 | pending | Access／撤權、應用配額、[RX遠端資料還原](docs/evidence/m1-remote-restore.md)已驗；provider實際用量／帳單unknown、保留上限需營運處置。這些缺口不得再遮蔽既有工具整合。 |

`historical`表示具名實際證據存在，並非剛重跑、當前授權有效或owner整體產品驗收；未把完整mainline改為complete。

## 現況與缺口

- 已有一個Worker/D1控制面、一個non-root runner、一種固定健康recipe、15分鐘schedule、看板、獨立bot工具；沒有任意shell或通用recipe registry。
- human／bot短窗口已過期；最後保存的resident政策截止2026-11-05T07:24:25Z。本次方向審查未查live或續權。
- 既有CF專案仍在原路徑；沒有真正的工具目錄產品、來源搬遷、重複退役或agent平台adapter。
- 保留Access/HMAC/scoped grants、unknown不重播、單一writer、journal與既有測試。暫停新增授權層、provider API接線、Event/seq、active failover與模板平台。
- 先交付日常使用方案、CF來源處置目錄、第二種有用的唯讀能力；各自範圍與停止條件以[近期計畫](docs/direction-review.md)為準。

## 啟動與驗證

[本機啟動](docs/quickstart.md)、[操作紀錄](docs/live-operations.md)、[M1實作契約](docs/m1-implementation.md)。測試由既有launcher執行`python3 platform/cloud-lab/tools/check.py`；本次只改文件，不宣稱重跑463項測試或更新live。

## 可用版本

`mainline: incomplete`、`usable_tag: none`保持。技術閉環證據、目前授權可用、原始整合目標與owner整體驗收分開記錄；不因多次merge或更多測試自動升級為完整平台。
