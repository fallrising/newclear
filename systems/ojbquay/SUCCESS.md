---
project: systems/ojbquay
purpose: 在 Kafka 與 PostgreSQL 上提供自助訊息發布、消費及故障處理
kind: service
mainline: incomplete
usable_tag: none
reviewed: 2026-10-22
source_commit: 2dc9b8bee5e8f4185fc2a42c3d653cd919f5d656
---

# ojbquay 成功契約

## 主線與範圍

[product spec](docs/product-spec.md) 的 Kafka-first v1：topic/group/subscription 自助管理、gRPC producer、HTTP push、Java／Go pull SDK、delay/retry/DLQ 與 console。
固定 AC 在 [SDD](SDD.md)，程式與測試對照在 [specification-map](docs/specification-map.md)。

不提供 end-to-end exactly-once、broker fork、可執行使用者 pipeline、跨區複製或 usage billing。
主線只認本機真基礎設施功能驗收；正式部署與容量認證不在主線內。

## 驗收條件

`passed` 指在 `source_commit` 實跑通過；`pending` 指該 commit 尚未實跑所需情境。
2026-10-22 於 `eclipse-temurin:25-jdk` 容器跑 `./gradlew build --no-daemon --no-parallel`：BUILD SUCCESSFUL，153 tests、0 failure、0 skip；`sdk/go` 的 `go test ./...`（Go 1.25）PASS。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given owner session/CSRF，When 建立 topic/group/PUSH subscription，Then PostgreSQL、Kafka、config bus 與 audit 收斂且 runtime 五秒內採用 | pending | integration tests 通過；同版本 `make e2e` 未跑 |
| AC-02 | Given gRPC producer 與 PUSH subscription，When 傳送已知 payload，Then ACK 含 partition/offset 且 HTTP sink 收到相同 hash | pending | `ProducerGatewayE2eTest` 通過；同版本 `make e2e` 未跑 |
| AC-03 | Given PULL 訂閱與 Java/Go SDK，When ACK/NACK 或 lease 過期，Then 逐筆確認與重送符合 at-least-once | pending | Java tests 與 `go test ./...` 通過；同版本 `e2e/pull_share.sh` 未跑 |
| AC-04 | Given delay 與失敗交付，When 延遲、取消、耗盡重試及 replay，Then 不提早、不遺失、可稽核 | passed | `SchedulerE2eTest`、`JdbcDelayRepositoryTest`、`KafkaRetryPublisherTest`、DLQ tests；`./gradlew build` 153/0 |
| AC-05 | Given `[150,300,600]` retry 與每次 503，When 四次交付，Then 每次間隔不小於 delay 且最多晚一秒，第四次寫 DLQ | passed | `PushRetryE2eTest.AC_05_…`（Testcontainers 真 Kafka/PG）；`./gradlew build` 153/0 |
| AC-06 | Given 非法 topic/token/大小/quota/partition，When 發送，Then 穩定錯誤碼且無 broker I/O | passed | `ProducerEngineTest`、`ProducerGrpcServiceTest`、`TokenAuthTest`、`ProducerGatewayE2eTest`；`./gradlew build` 153/0 |
| AC-07 | Given 有效 snapshot，When 舊／無效 revision 或控制面停止，Then LKG 保留且發送交付不中斷 | pending | unit/integration 通過；停 console 的同版本 stack 情境未跑 |
| AC-08 | Given pipeline fixtures 與同 key 訊息，When push 處理，Then 轉換、過濾、同 key 順序與資源上界成立 | passed | `PushPipelineTest`、`KafkaOrderedPushWorkerTest`、`PullShareWorkerTest`（含 ack 佇列上限）；`./gradlew build` 153/0 |
| AC-09 | Given classic ordered subscription，When reset，Then 全 runtime pause 確認、group empty、fence、alter、讀回、audit、restore；結果未知保持 paused | passed | `TopicApiIntegrationTest` reset cases、`*Ac09Test`；`./gradlew build` 153/0 |
| AC-10 | Given browser，When 登入、建立資源、預覽、test message、delay、DLQ、登出，Then 結果可見且權限正確 | pending | mock Chromium journey 既有；同版本真 stack 未跑 |
| AC-11 | Given JDK25、Node24、Docker Compose，When `make validate-deploy`、`make e2e`，Then 十一服務核心流程完成 | pending | 同版本未跑 |

## 現況與缺口

v1 功能全部實作；剩下的只是在同一 commit 跑真 stack（AC-01/02/03/07/10/11）。步驟見 [specification-map](docs/specification-map.md#到主線驗收的路徑)。
Kafka/PostgreSQL 間是 at-least-once；crash 後重送與 DLQ replay 可能重複。
Pull ACK token 必須回到發出 token 的 gateway，多實例需 connection affinity。
offset reset 結果未知時需人工處理，見 [operations](docs/operations.md#offset-reset-outcome-unknown)。

## 啟動與驗證

[README](README.md)、[demo guide](docs/demo.md)與[operations](docs/operations.md)：JDK 25、Docker Compose v2 及私人配置。

```sh
./gradlew build
(cd sdk/go && go test ./...)
make validate-deploy
make e2e
./e2e/pull_share.sh
```

保留來源 SHA、命令與結果，逐項對回 AC；health 或 exit 0 不等於 AC 通過。

## 可用版本

`usable_tag: none`。全部 AC 在同一 commit `passed`、CI 綠燈並合併後建立 `usable/ojbquay/v1.0.0`，標記說明保留 at-least-once 與 pull affinity 限制。
