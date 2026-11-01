---
project: platform/agent-workforce
purpose: 持久協調不同代理產品的身份、授權、會話與工作交付
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Agent Workforce 成功契約

## 主線與範圍

完整主線是同一 owner 的多產品／帳號工作者，由可信 WorkCommand 准入、持久收件與資源控制走到可審查交付。
[SDD](SDD.md)與[驗收分層](docs/verification.md)區分 DOC、FAKE、NATIVE、API、LIVE、SOAK。

M1 是 Python 標準庫與 SQLite 離線核心，M2 只開放具名 native 切片。
Done 仍屬外部工作系統；不恢復 dormant gateway，也不採用 Yobiru 實作或擅自接通其他產品。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 合成 grant 與同一 command，When 重送或普通重啟，Then SQLite 維持一份邏輯工作且 fake dispatch 不重複 | historical | [M1 契約](docs/m1.md)、[M1 證據](docs/m1-evidence.json) |
| AC-02 | Given 有界 native route 與明確 opt-in subreaper，When 原生程序停止，Then 只對已量測的兩條呼叫記錄本機後代閉合 | historical | [M2 契約](docs/m2.md)、[M2 證據](docs/m2-evidence.json) |
| AC-03 | Given 原生 session 與未知操作結果，When 恢復或重試，Then exact route/auth/resume/tool coverage 與外部 effects 都能核對 | pending | [驗收](docs/verification.md)：完整 M2、opaque wrapper coverage 與 remote effects 未通過 |
| AC-04 | Given 真實跨產品工作，When writer 交付給 reviewer 再發布，Then candidate、review、ContextPack、備份還原與長時運作證據一致 | pending | [驗收](docs/verification.md)：FAKE-06/09/11/14/15、完整 FAKE-16 與 LIVE/SOAK 尚有 NotRun |

## 現況與缺口

M1 與部分 M2 已可執行，不代表 daemon、SaaS/API 或完整工作交付。
Polling port 無法證明 descendant stop；subreaper 的成功不能回填舊 polling operation。
Persisted-session evidence 只適用明確選用的新 Codex operation；未知成本及副作用維持 unknown。
[任務板](docs/tasks/BOARD.md)的 XN 第一片已採納設計，XS-2 起尚待實作，不能稱跨節點可用。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)要求 Python 3.11+ 與 Unix flock，demo 使用明確指定的 SQLite 路徑。

已核對入口：[CLI](src/agent_workforce/__main__.py)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -v
PYTHONPATH=src python3 -m agent_workforce demo --db var/demo.sqlite
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須先補完整 M2 與第一個真實交付流程的逐 route 證據，再核對備份／恢復及跨產品責任邊界；現階段只具離線與有界 native 切片。
