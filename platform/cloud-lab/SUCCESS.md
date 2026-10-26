---
project: platform/cloud-lab
purpose: 以共同契約與知識樹組合個人 Cloudflare 工具、遠端運維及代理能力
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-26
source_commit: 65bbadb7659437e8a14f029015313c6f5277ce35
---

# Cloud Lab 成功契約

## 主線與範圍

主線是 [SDD](SDD.md) 描述的單 operator 私人 Cloud Lab：共用准入、可觀察的非同步任務、具 scope 的執行 adapter、成果及看板。各應用可獨立部署，既有 host／workload／agent／工作驗收 authority 保留。

本次只授權 **M0 文件先行**：知識樹、責任與介面、來源映射、遷移／封存 gate 及驗收設計。AC-01～05 屬本次文件里程碑；AC-06～08 是未實作的產品主線，不能因文件完成改成 passed。沒有程式搬移、資料遷移、部署、封存或新增模型呼叫。

frontmatter source_commit 是文件盤點的 repository 基準，不是新文件已合併或產品已驗收的宣告。

## 驗收條件

| AC ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 現有能力與來源，When 沿知識樹閱讀，Then 每個能力有責任者、契約、來源／實作與證據或明示缺口 | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源／連結及獨立審查通過 |
| AC-02 | Given UI／bot／schedule 與既有 executor，When 追蹤合成命令，Then 准入、去重、attempt、取消、未知及驗證由明確 owner 處理 | passed | [M0 文件證據](docs/evidence/m0-review.md)：合成 walkthrough 與恢復語義複核通過 |
| AC-03 | Given CF 元件及既有平台，When 分配狀態與部署責任，Then 無雙重 run／host／workload／Done 權威 | passed | [M0 文件證據](docs/evidence/m0-review.md)：唯一權威與部署邊界審查通過 |
| AC-04 | Given 每個候選來源，When 決定歸位／抽取／adapter／reference，Then 有目標與阻擋，封存必須通過接替及回退 gate | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源處置、切換／回退與退役 gate 審查通過 |
| AC-05 | Given 完整文件候選，When 跑既有索引驗證與獨立審查，Then 導航一致、沒有 runtime 成功冒稱，所有未實作事項保留 | passed | [M0 文件證據](docs/evidence/m0-review.md)：本機 validators 及獨立 ACCEPT；Git 交付狀態見[任務板](docs/tasks/BOARD.md) |
| AC-06 | Given 授權 caller 與一台真實 runner，When API／排程提交固定唯讀檢查，Then 同一 command 可追蹤、去重、驗證並在看板顯示 | pending | M1 尚未實作，無 CF／runner／手機／bot 整合證據 |
| AC-07 | Given 重複投遞、失聯、取消及恢復，When 執行與回報競爭，Then 不重做未知副作用且停止／未知／驗證狀態誠實可見 | pending | 待 [M1 故障矩陣](docs/verification.md)的真實邊界驗收 |
| AC-08 | Given 私人入口、受限預算與備份，When 撤權、超限或隔離還原，Then 存取被限制、成本／缺漏可見且未完成工作先對帳 | pending | 尚無帳號、部署、配額或恢復驗收 |

## 現況與缺口

只有 M0 提案文件。沒有公開可呼叫 API、共用 D1／DO schema、runner、看板程式或可用版本。能力整合與遷移候選不代表既有產品已被接管或驗收。

機器可讀 schema、OpenAPI、跨實作向量、runtime、部署及操作演練留待各里程碑。未知費用／配額不填零；真實 model／CLI、Workflows、Queues、變更主機與模板生成均不是本次交付。

## 啟動與驗證

[啟動狀態](docs/quickstart.md)明示目前無 runtime；[驗收計畫](docs/verification.md)列出 repo 文件檢查與後續 gate；[文件證據](docs/evidence/m0-review.md)保存實際命令與審查結果。未來產品驗收必須保留失敗、未跑及限制，不能由本次文件檢查推導。

## 可用版本

`usable_tag: none`。M0 文件里程碑即使通過，產品仍是 `mainline: incomplete`；不建立 release／usable tag，也不將 merge 當成 owner acceptance 或部署。
