---
project: products/hai-taskboard
purpose: 以可追溯工作圖與證據關卡控制人機軟體交付
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# HAI Taskboard 成功契約

## 主線與範圍

[P0-A SDD](docs/SDD.md)要求單 operator 能由持久工作圖與 ContextPack 接續工作，經 subject-bound review/evidence 安全完成。
Fake executor 是第一版原定邊界；完整 P0-A 仍須滿足 UI、恢復與 Done gate，不以成功 Run 取代。

只允許 deterministic Fake，不執行真 agent、shell、provider credential 或聊天 channel integration。
Board/SSE 是 projection；WorkItem、Run、Candidate、Review、Evidence、Approval、CompletionRecord 不合併。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 有效 application command 與持久 SQLite，When response-loss/retry/restart，Then 同一命令結果可重放且不重複啟動 Fake | historical | [交接](docs/HANDOFF.md)、[traceability](docs/traceability.md)：有界 command/Fake/persistence 接受 |
| AC-02 | Given exact candidate 與政策／AC revision，When 嘗試完成工作，Then 缺失、過期或不獨立的證據不能產生 Done | pending | [traceability](docs/traceability.md)：完整 HAI-DONE-001..004 仍 NotRun，部分 kernel 通過不等於總 gate |
| AC-03 | Given operator 使用 board/detail/attention，When 遭遇斷線、拒絕與狀態變動，Then UI 可操作並從權威狀態恢復 | pending | [traceability](docs/traceability.md)：HAI-UX 全組及完整 UI acceptance 尚缺 |
| AC-04 | Given 備份、proposal import 與依賴圖變更，When 還原並接續，Then accepted binding、reconciliation 與 ContextPack 可完整恢復 | pending | [traceability](docs/traceability.md)：backup/restore、durable activation 與 full ops group 未完 |

## 現況與缺口

Domain kernel、SQLite、HTTP/SSE、Fake vertical 與 local bootstrap 有獨立接受切片。
[交接](docs/HANDOFF.md)保留 T-062、T-077/079、T-047/082 等歷史 FAIL 與後續修復，不能抹成首輪全過。
Runnable loopback runtime 不是完整圖形工作管理產品。
真 agent integration 是刻意不在 P0-A，不列作本輪產品缺陷或要求開啟。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[local development](docs/local-development.md)規定 Go、0700 私有資料根、loopback origin 與單次 session token。

已核對入口：[taskboard main](backend/cmd/taskboard/main.go)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
cd backend
go build -o /tmp/hai-taskboard-local ./cmd/taskboard
go test ./...
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須先完成 P0-A 自己的 Done、UI、持久 import/reconciliation 與備份還原驗收；維持 Fake-only 也能完成此主線，但目前證據尚不足。
