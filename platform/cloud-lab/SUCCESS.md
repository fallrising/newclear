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

先前授權 **M0 文件先行**：知識樹、責任與介面、來源映射、遷移／封存 gate 及驗收設計。AC-01～05 屬本次文件里程碑；AC-06～08 是未實作的產品主線，不能因文件完成改成 passed。Owner 後續指示「好，繼續開發。」授權 M1 實作；範圍與獨立 AC 見 [M1 實作契約](docs/m1-implementation.md)。沒有程式搬移、資料遷移、部署、封存或新增模型呼叫。

frontmatter source_commit 是文件盤點的 repository 基準，不是新文件已合併或產品已驗收的宣告。

## 驗收條件

| AC ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 現有能力與來源，When 沿知識樹閱讀，Then 每個能力有責任者、契約、來源／實作與證據或明示缺口 | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源／連結及獨立審查通過 |
| AC-02 | Given UI／bot／schedule 與既有 executor，When 追蹤合成命令，Then 准入、去重、attempt、取消、未知及驗證由明確 owner 處理 | passed | [M0 文件證據](docs/evidence/m0-review.md)：合成 walkthrough 與恢復語義複核通過 |
| AC-03 | Given CF 元件及既有平台，When 分配狀態與部署責任，Then 無雙重 run／host／workload／Done 權威 | passed | [M0 文件證據](docs/evidence/m0-review.md)：唯一權威與部署邊界審查通過 |
| AC-04 | Given 每個候選來源，When 決定歸位／抽取／adapter／reference，Then 有目標與阻擋，封存必須通過接替及回退 gate | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源處置、切換／回退與退役 gate 審查通過 |
| AC-05 | Given 完整文件候選，When 跑既有索引驗證與獨立審查，Then 導航一致、沒有 runtime 成功冒稱，所有未實作事項保留 | passed | [M0 文件證據](docs/evidence/m0-review.md)：本機 validators 及獨立 ACCEPT；Git 交付狀態見[任務板](docs/tasks/BOARD.md) |
| AC-06 | Given 授權 caller 與一台真實 runner，When API／排程提交固定唯讀檢查，Then 同一 command 可追蹤、去重、驗證並在看板顯示 | pending | 本機 API／runner／OS collector／UI 協定已實作；尚無真實 CF、手機或 Grok bot 整合證據 |
| AC-07 | Given 重複投遞、失聯、取消及恢復，When 執行與回報競爭，Then 不重做未知副作用且停止／未知／驗證狀態誠實可見 | pending | 待 [M1 故障矩陣](docs/verification.md)的真實邊界驗收 |
| AC-08 | Given 私人入口、受限預算與備份，When 撤權、超限或隔離還原，Then 存取被限制、成本／缺漏可見且未完成工作先對帳 | pending | 尚無帳號、部署、配額或恢復驗收 |

## 現況與缺口

有 M1 本機實作候選、D1 migration、Python runner 與看板程式。沒有已部署 API、可用版本或 live 驗收。能力整合與遷移候選不代表既有產品已被接管或驗收。

[M1 OpenAPI](contracts/m1.openapi.json)、HMAC 跨語言 loopback 測試與本機 runtime 已加入；部署及操作演練仍待 live gate。未知費用／配額不填零；真實 model／CLI、Workflows、Queues、變更主機與模板生成均不是本次交付。

## 啟動與驗證

[本機啟動](docs/quickstart.md)區分測試 harness 與 CF runtime；[驗收計畫](docs/verification.md)列出 repo 文件檢查與後續 gate；[文件證據](docs/evidence/m0-review.md)保存實際命令與審查結果。未來產品驗收必須保留失敗、未跑及限制，不能由本次文件檢查推導。

## 可用版本

`usable_tag: none`。M0 文件里程碑即使通過，產品仍是 `mainline: incomplete`；不建立 release／usable tag，也不將 merge 當成 owner acceptance 或部署。

## M1 本次開發驗收

| AC | 範圍 | 狀態 | 證據 |
| --- | --- | --- | --- |
| M1-I1 | 有界准入、SQL outbox、scope、CAS、對帳與結果 | passed | [M1 evidence](docs/evidence/m1-implementation.md)：控制面測試、獨立 ACCEPT |
| M1-I2 | 真實 OS 唯讀 collector、journal、HMAC、重送 | passed | [M1 evidence](docs/evidence/m1-implementation.md)：31 Python 測試及 HTTP 整合、獨立 ACCEPT |
| M1-I3 | 看板、freshness、取消意圖與權限 | passed | UI 模型及 HTTP 資產驗證通過；本地 AC 不含瀏覽器互動／mobile live 驗收 |
| M1-I4 | 整合、負向案例、索引、獨立 review | passed | [M1 evidence](docs/evidence/m1-implementation.md)：62 tests、validators、獨立 ACCEPT |
