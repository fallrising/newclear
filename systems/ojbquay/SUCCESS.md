---
project: systems/ojbquay
purpose: 在 Kafka 與 PostgreSQL 上提供自助訊息發布、消費及故障處理
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# ojbquay 成功契約

## 主線與範圍

[product spec](docs/product-spec.md)的 Kafka-first v1 提供 topic/group/subscription 自助管理、gRPC producer、HTTP push、pull SDK、delay/retry/DLQ 與 console。
[execution plan](docs/execution-plan.md)保留各 milestone 接受與整合結果；以真基礎設施功能驗收作完成依據。

不提供 end-to-end exactly-once、broker fork、任意 executable pipeline、跨區複製或 usage billing。
維持 dormant；本機十一服務 demo 不是 production certification 或 capacity benchmark。

本契約核對的是上述來源版本中的文件與程式。
功能完成、原定主線驗收與部署保證分開記錄；本案仍有明列未通過條件。

## 驗收條件

下表 `historical` 是既有報告的結果，沒有在 2026-10-21 重跑。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 有效 owner session/CSRF，When 建立 topic/group/PUSH subscription，Then PostgreSQL、Kafka、config bus 與 audit 收斂 | historical | [執行計畫](docs/execution-plan.md)、[Docker demo 報告](docs/test-reports/docker-functional-demo.md) |
| AC-02 | Given authenticated gRPC producer，When 傳送已知 payload，Then ACK 含 partition/offset 且 HTTP sink 收到相同 hash | historical | [2026-07-30 demo 報告](docs/test-reports/docker-functional-demo.md)：cd80c5c8，11 services |
| AC-03 | Given PULL 訂閱與 Java/Go SDK，When ACK/NACK 或 lease 過期，Then 明確逐筆 acknowledgement 與重送符合 at-least-once | historical | [執行計畫 M5](docs/execution-plan.md)：pull_share.sh 真 Kafka 跨語言驗收 |
| AC-04 | Given 失敗交付與 retry/DLQ，When 延遲、耗盡重試及授權 replay，Then 資料不因本機失敗被提早確認且操作可稽核 | historical | [執行計畫 M3/M4/M6](docs/execution-plan.md)、[messaging semantics](docs/messaging-semantics.md) |
| AC-05 | Given 原定 150 ms retry；When 量測實際端到端間隔；Then 偏差小於 20% | failed | [M4 原始驗收](docs/specs/m4-push-consumer.md)、[實測 206–253 ms](docs/execution-plan.md)；目前未達標 |

## 現況與缺口

M4 的原定 150 ms retry 端到端偏差 <20% 仍未達標，實測約 206–253 ms。
[execution plan](docs/execution-plan.md) 雖保留功能完成，不能代替原 SDD 時序條件；因此整體主線尚未驗收、不建立 usable tag。
這不是本次新加的效能要求，也不能藉縮小主線刪去；需修正實作／驗證或由 owner 明確修訂規格。

完成的是 v1 功能主線與本機整合，不代表任何現存部署健康或容量承諾。
Demo 記錄 7/7 readiness、真 gRPC ACK、sink payload hash、console 與監測。
Kafka/PostgreSQL 間仍是 at-least-once；crash 後重送與 DLQ replay 可能產生重複。
Pull acknowledgement token 在 v1 必須回到發出 token 的 gateway，跨實例需 connection affinity。

這次僅新增驗收入口，未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[README](README.md)、[demo guide](docs/demo.md)與[operations](docs/operations.md)要求 JDK 25、Docker Compose v2 及私人配置。

已核對入口：[Makefile](Makefile)與 [demo runner](demo/run.sh)。
下列是該入口既有的啟動或驗證命令，並非本次執行紀錄；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
./gradlew build
make validate-deploy
make demo
make e2e
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

目前 `usable_tag: none`；本次沒有建立或發布任何 tag。
既有版本號、合併紀錄與歷史驗收不自動轉換為可用版本標記。

須核對歷史測試 tree 與目前目標 commit 差異，重跑必要 build/真 Compose 主線；標記必須保留 at-least-once、連線 affinity 與本機功能資格限制。

## 2026-10-22 SDD 提案與現況補記

[主線 SDD](SDD.md) 原版 PR472 及 AC-05 量測修訂 PR477 已批准合併。以下保留提案時的參考執行證據；搜尋未找到被引用的原始 normative SDD 檔案，不代表既有產品規格與分階段設計不存在。
AC-01～05 延用原 ID；新列 AC-06 producer 拒絕、AC-07 LKG、AC-08 pipeline/ordering、AC-09 offset reset、
AC-10 console、AC-11 同版本啟動，均整理既有 product-spec/M2～M6 行為，詳見 SDD 的 Given/When/Then。
[逐 AC 實際結果與缺口](docs/test-reports/mainline-sdd-20261022.md#ac-證據矩陣) 與 [任務草案](docs/tasks/BOARD.md)。

main `0aac18413a3b39043706f17b8e5f801f41573d70` 的119-test build PASS 是參考實作結果，其 retry oracle
仍寬於 AC-05；Go SDK import panic FAIL。另一工作樹未提交候選的132-test 快照仍是131 PASS/1 strict FAIL，
intervals [703,350,639]ms；後續兩行 fired_at scope correction 只有20 focused PASS，沒有最終完整驗收。
原始失敗、第一次交付與到達間隔計時都保留，未增加暖機或放寬門檻。
本頁原五列 historical 不改成新 PASS；SDD 批准也不構成產品 owner 驗收。usable_tag:none。

AC-09 runtime lifecycle／啟動切片（T461 R1/R2）見 [ac09-runtime-slice](docs/test-reports/ac09-runtime-slice.md)：
failed-stop 不終止 config bus、有界 reconcile 收斂、fatal config 失敗降 readiness、未配置 roster 正常啟動但不能確認 reset。
這只是切片；AC-09 整體仍 partial（缺 preview、整 group 協調、PG fence 交錯安全、真雙 runtime 證據），AC-05 仍 FAIL，owner 驗收待定。


## 2026-10-22 C1b 接手審查（T-0374，原 T-0368）

本輪只審查並修復 PR485 的持久 lease 交付阻擋；AC09 整體仍 partial。
新增驗收：lease INSERT 在 advisory lock 取得後失敗，API 拒絕操作且連線池不得殘留該 group 的 advisory lock。
先用真 PG constraint failure 重現，再跑相關 console 測試、Gradle build、部署模型與 CI／獨立審查。
已批准 SDD 是 #477/adca0174；歷史失敗保留，AC05 未通過，不發 tag。


## 2026-10-22 規格與程式對照整理（T-0374）

本次目標是將既有 product-spec、ADR、M2–M6、messaging-semantics 與目前程式／測試建立可追溯對照，修正文檔入口的過時批准狀態。
範圍只有文件；保留所有原產品 AC、歷史 FAIL 與未驗證項，不將現有實作提升為規格。
文件驗收：來源版本固定、AC01–11 有來源／程式／測試／缺口、連結有效、獨立審查及必要檢查；不代表產品主線完成。

閱讀入口：[規格、程式與測試對照](docs/specification-map.md)。盤點固定來源6c611778；包含 SDK parity、ack command queue 與 deadline 的靜態差異，不將新發現偽裝成已修復。
