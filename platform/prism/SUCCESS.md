---
project: platform/prism
purpose: 以可插拔儲存提供標準遙測接收、查詢與告警相容層
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# Prism 成功契約

## 主線與範圍

[SDD](docs/sdd/00-SDD-OVERVIEW.md)主線涵蓋 metrics/logs/traces、標準相容 API、可插拔 driver 與告警。
[任務板](docs/tasks/BOARD.md)已到 P2-07；P2-08 起是 backlog，完整 P2–P5 尚未結束。

LogQL 為 clean-room 實作；不引入 AGPL Loki/Tempo/Grafana 程式碼。
單 configured tenant、記憶體 backend、局部 driver 或 API 可用不能稱完整 APM；不恢復原生 dashboard 願望。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 合法 tenant 與標準 client，When OTLP/remote_write/Loki push 入庫再查 Prometheus，Then 資料可由 SPI 與真 Grafana 查核 | historical | [inventory](docs/inventory.md)、[Phase 1 deployment](deploy/README.md) |
| AC-02 | Given LogQL 與合法 bearer，When 呼叫 Loki query/query_range/labels/series，Then bounded 查詢、tenant 隔離與錯誤信封符合 AC-29–42 | historical | [任務板 P2-04](docs/tasks/BOARD.md)、[daemon](cmd/prismd/main.go) |
| AC-03 | Given ClickHouse native log 與規則/評估輸入，When 執行 P2-05–07 的獨立契約，Then 下推、規則解析及 alert state 測試符合對應 AC | historical | [任務板](docs/tasks/BOARD.md)：P2-05 dc09beab、P2-06 475c36ab、P2-07 6cdfa421 |
| AC-04 | Given 持續運作的 daemon，When native-log 查詢及規則週期評估，Then 實際接線、持久 flush 與 Postgres 整合皆可觀測 | pending | [任務板](docs/tasks/BOARD.md)：eval 尚未接 cmd/prismd；[daemon](cmd/prismd/main.go)仍建一般 Loki handler |
| AC-05 | Given 完整標準 observability 使用流程，When 查 traces 並觸發通知/靜默/抑制，Then 剩餘相容 API、driver 與運作 gate 全部滿足 | pending | [實作階段](docs/sdd/12-IMPLEMENTATION-PHASES.md)：P2-08 後與 P3–P5 尚未完整交付 |

## 現況與缺口

README 停留 P2-01，不能據此說 Loki HTTP 查詢未實作；目前 daemon 已掛 /loki/api/v1/。
NativeLogQuerier 函式庫與告警 eval/state 接受，不等於 daemon 已呼叫它們。
週期 flush、Postgres integration 與 AC-87 promtool gate 不在預設 CI，仍須個別證據。
Memory retention 無界、logical budget 非 RSS hard limit；不能套用為持久 production 保證。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)提供本機 bearer file、設定與 ingestion/query；[deploy](deploy/README.md)提供 pinned Compose。

已核對入口：[prismd](cmd/prismd/main.go)與 [Makefile](Makefile)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
make lint test
scripts/check-dependencies.sh
scripts/test-dependency-guard.sh
go build ./...
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須完成 daemon 接線與剩餘主線 gate，補跑所需外部 client、storage、告警整合；P2-07 完成不能轉為全 Prism usable tag。
