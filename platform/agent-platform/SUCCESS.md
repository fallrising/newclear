---
project: platform/agent-platform
purpose: 以網頁派送、監看與介入隔離的程式代理任務
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Agent Platform 成功契約

## 主線與範圍

主線是單一 operator 由 Web 建立固定 repository/base 的任務，在 Cocoon VM 執行 agent，處理審批與取消，並在重啟後取得可信成果。
[SDD](SDD.md) 的 M0–M4 與[最新交接](docs/HANDOFF.md)共同界定範圍；已完成的 mock 切片不取代整體 MVP。

多節點、ACP、排程及 webhook 屬後續。Agent Computer 桌面是獨立 Proposed 實驗。
單人版已延後真實計費與硬金額上限；費用維持 unknown，不能重新當成本片阻擋。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 固定來源與模擬模型，When 正常 worker 在真實 KVM 執行工具，Then 取得可核對 diff、驗證結果與完整停止證據 | historical | [正常 worker KVM](docs/WORKER-TOOLS-KVM.md) |
| AC-02 | Given 執行中的模型與工具，When 截止、取消或遭遇不明結果，Then 撤權、保留未知占用且不盲目重派 | historical | [M3 整合 mock 驗收](docs/M3-INTEGRATED-ACCEPTANCE.md) |
| AC-03 | Given 已封存成果與資料庫，When 隔離備份還原並重新登入，Then 成果 hash 保持一致且舊 session 失效 | historical | [單節點證據](docs/evidence/single-node.json) |
| AC-04 | Given 真實自然語言工作，When 由支援的模型完成任務並經正常操作收尾，Then 全部 M3/M4 與 MVP gate 有同版證據 | pending | [交接](docs/HANDOFF.md)：真實 coding、實際 runtime 部署、stale VM cleanup 與整體 gate 未完成 |

## 現況與缺口

M0–M2 已驗收，M3/M4 僅有多個已接受切片；不可把其合計稱作完整平台。
2026-10-06 單節點演練涵蓋真 TCP API、CLI worker、PostgreSQL 與 Web，模型仍是 local mock。
真 provider、live GitHub export、release 前長任務與主機 service-manager/TLS 尚缺對應證據。
歷史報告中較早失敗與停止指令有後續修正，應以交接頂端與逐切片結果判斷。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[快速開始](docs/quickstart.md)、[單節點手冊](docs/SINGLE-NODE.md)列出 PostgreSQL、operator bootstrap、API/worker 與私人設定。

已核對入口：[operator CLI](src/agent_platform/cli.py)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make platform-check
make web-check
make browser-test
make deployment-rehearsal
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須補齊完整 MVP 的真實工作與恢復證據，核對 KVM／成果／維護流程對應合併 commit；尚不能建立全項目可用標記。
