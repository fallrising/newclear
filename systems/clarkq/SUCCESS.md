---
project: systems/clarkq
purpose: 以簡單 HTTP 介面提供可持久化的單機訊息佇列
kind: service
mainline: complete
usable_tag: usable/clarkq/v1.5.1
qualification: docs/project-success/qualifications/clarkq.md
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# ClarkQ 成功契約

## 主線與範圍

本契約的已完成核心是 [PROGRESS](PROGRESS.md)推薦的單機任務佇列：FIFO、WAL/snapshot、API key、長輪詢、metrics 與管理 UI。
[ROADMAP](ROADMAP.md)與現有 source 的 cluster/quorum/lease 是另有證據的實驗能力，不提升為 production 或跨機房保證。

保留 dormant 投入狀態；普通 v1.5.1 版本名不等於本規範的可用標記。
多 AZ 真拓撲與長時生產負載須另驗證；不以可選 cluster 能力擴張單機核心完成定義。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是原有逐項報告；2026-10-21 已補做 [可用版本資格驗證](../../docs/project-success/qualifications/clarkq.md)，區分本次重跑與可沿用的歷史結果。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 空單機 queue，When enqueue/list/peek/dequeue 到空，Then FIFO payload 正確且空佇列回 204 | historical | [PROGRESS](PROGRESS.md)：真 binary/Docker 單機 49 checks |
| AC-02 | Given 已寫入 WAL/snapshot 的訊息，When 重啟 server，Then 訊息恢復且可繼續讀寫 | historical | [PROGRESS](PROGRESS.md)、[demo](demo/README.md) |
| AC-03 | Given API key 與多租戶 quota，When 缺 key、跨 tenant 或超限，Then 401/403/容量限制與合法操作可區分 | historical | [PROGRESS](PROGRESS.md)：認證與 quota demo |
| AC-04 | Given 長輪詢 worker 與 UI，When 發送訊息並查看健康/metrics，Then worker 收到資料且 UI、JSON/Prometheus metrics 可見 | historical | [單機 demo](demo/README.md)、[PROGRESS](PROGRESS.md) |

## 現況與缺口

核心原有歷史 runtime 驗收；2026-10-21 另重跑推薦單機六情境 49 項實際 API／重啟 assertions。
2026-10-06 記錄另有三台 VM 驗證，但建議仍是單機；不以 cluster smoke 宣稱跨機房線性一致服務。
實驗能力的自壓與實際部署設定仍需操作者依使用範圍確認。
Dormant 不撤回已驗收核心，也不授權新功能、部署或服務升級。

本次新增驗收入口並補做可用資格；未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)與[使用說明](docs/USAGE.md)提供環境/YAML、WAL 路徑、auth 與限制；單機 demo 有自有隔離環境。

已核對入口：[main](cmd/clarkq/main.go)與 [Makefile](Makefile)。
下列提供既有啟動／驗證入口；本次實際執行範圍與結果以資格紀錄為準；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
go build -o bin/clarkq ./cmd/clarkq
./bin/clarkq
cd demo
./run-demo.sh
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

本次資格通過，預定標記 `usable/clarkq/v1.5.1`，範圍與逐命令證據見[資格紀錄](../../docs/project-success/qualifications/clarkq.md)。
必要 PR CI／獨立審查通過並合併後才發布；不外推 production 或原範圍以外能力。


## FE 第 2 輪（2026-10-24T11:45:41Z）

T-0380 / R2-AC-13，依已批准 DESIGN M1–M3 與 [T019](fe-review/tasks/round2/T019.md) 開始隔離 API/瀏覽器驗證、合成資料與必要的前端呈現修正。原生 go test/build、三 viewport、鍵盤與真實操作證據仍待執行；不修改既有主線、usable tag、後端或部署。
