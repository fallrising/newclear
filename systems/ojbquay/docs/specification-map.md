# Ojbquay 規格、程式與測試對照

本文件回答：每條主線 AC 在哪段程式實作、用哪個命令或測試驗證。
固定 AC 原文在 [SDD](../SDD.md)；驗收狀態在 [SUCCESS](../SUCCESS.md)。本文件不另立需求。

## 先讀哪份文件

| 想知道什麼 | 來源 |
| --- | --- |
| 產品範圍與非目標 | [product-spec](product-spec.md)、[ADR-001](adr/001-source-of-truth-and-v1-baseline.md)（Kafka-first）、[ADR-002](adr/002-java-25-lts-baseline.md)（Java 25） |
| 固定 AC | [SDD](../SDD.md) |
| 各功能設計 | [M2 producer](specs/m2-producer-vertical-slice.md)、[M3 delay](specs/m3-delay-scheduling.md)、[M4 push](specs/m4-push-consumer.md)、[M5 pull](specs/m5-pull-consumer.md)、[M6 console](specs/m6-console-operations.md) |
| 發送、重送、順序、reset 語義 | [messaging-semantics](messaging-semantics.md) |
| wire 契約 | [proto/ojbk/v1](../proto/ojbk/v1/) |
| 操作與故障處理 | [operations](operations.md) |

## 系統輪廓

console（唯一 Spring 元件）在 PostgreSQL 保存 topic/group/subscription、audit 與 outbox，publisher 把 revision 發到 Kafka `__ojbk.config`。
producer／consumer／scheduler 載入不可變配置並保留 LKG。gRPC producer 驗證後寫 Kafka；consumer 以 HTTP push 或 gRPC pull 交付。
delay/retry 經 Kafka inbox 進 PostgreSQL，由 scheduler 發往目標 topic。全路徑 at-least-once，客戶端需冪等。

## 逐 AC 對照

| AC | 程式入口 | 測試入口 | 跨程序驗證 |
| --- | --- | --- | --- |
| AC-01 資源建立與配置收斂 | [TopicService](../modules/console-api/src/main/java/dev/ojbk/console/topic/TopicService.java)、[OutboxPublisher](../modules/console-api/src/main/java/dev/ojbk/console/configuration/OutboxPublisher.java)、[ConfigStore](../modules/common/src/main/java/dev/ojbk/config/ConfigStore.java) | [TopicApiIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java)、[TopicConfigPublicationIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/configuration/TopicConfigPublicationIntegrationTest.java)、[KafkaConfigBusIntegrationTest](../modules/common/src/test/java/dev/ojbk/config/KafkaConfigBusIntegrationTest.java) | `make e2e`；`extra.sh` 量 loaded version |
| AC-02 發送與交付 | [ProducerEngine](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/ProducerEngine.java)、[KafkaBrokerProducer](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/KafkaBrokerProducer.java) | [ProducerGatewayE2eTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerGatewayE2eTest.java)、`make e2e` payload hash | `make e2e` payload hash |
| AC-03 Java／Go pull | [PullShareWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PullShareWorker.java)、[ConsumerGrpcService](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/ConsumerGrpcService.java)、[Java SDK](../sdk/java/src/main/java/dev/ojbk/sdk/OjbkConsumer.java)、[Go SDK](../sdk/go/consumer.go) | [PullGrpcE2eTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PullGrpcE2eTest.java)、[PullShareWorkerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PullShareWorkerTest.java)、`sdk/go` 的 `go test ./...` | [pull_share.sh](../e2e/pull_share.sh)（Java↔Go） |
| AC-04 delay、retry、DLQ | [DelayGateway](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/DelayGateway.java)、[KafkaDelayIngestor](../modules/scheduler/src/main/java/dev/ojbk/scheduler/KafkaDelayIngestor.java)、[DelayDispatcher](../modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayDispatcher.java)、[KafkaRetryPublisher](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/KafkaRetryPublisher.java) | [SchedulerE2eTest](../modules/scheduler/src/test/java/dev/ojbk/scheduler/SchedulerE2eTest.java)、[JdbcDelayRepositoryTest](../modules/scheduler/src/test/java/dev/ojbk/scheduler/JdbcDelayRepositoryTest.java)、[KafkaRetryPublisherTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/KafkaRetryPublisherTest.java) | Testcontainers（`./gradlew build`） |
| AC-05 retry 時序 | [PushRecordHandler](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PushRecordHandler.java)、[DelayDispatcher](../modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayDispatcher.java) | [PushRetryE2eTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushRetryE2eTest.java) `AC_05_…` | Testcontainers（`./gradlew build`） |
| AC-06 producer 拒絕 | [ProducerEngine](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/ProducerEngine.java)、[TokenAuth](../modules/common/src/main/java/dev/ojbk/security/TokenAuth.java)、[TopicQuota](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/TopicQuota.java) | [ProducerEngineTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerEngineTest.java)、[ProducerGrpcServiceTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerGrpcServiceTest.java)、[TokenAuthTest](../modules/common/src/test/java/dev/ojbk/security/TokenAuthTest.java) | Testcontainers（`./gradlew build`） |
| AC-07 LKG 與控制面中斷 | [ConfigStore](../modules/common/src/main/java/dev/ojbk/config/ConfigStore.java)、[KafkaConfigBusClient](../modules/common/src/main/java/dev/ojbk/config/KafkaConfigBusClient.java) | [ConfigStoreTest](../modules/common/src/test/java/dev/ojbk/config/ConfigStoreTest.java)、[KafkaConfigBusIntegrationTest](../modules/common/src/test/java/dev/ojbk/config/KafkaConfigBusIntegrationTest.java) | `extra.sh` 停 console-api 後發送與交付 |
| AC-08 pipeline、順序、有界資源 | [PushPipeline](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PushPipeline.java)、[KafkaOrderedPushWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorker.java)、[BoundedStripedExecutor](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/BoundedStripedExecutor.java)、[PullShareWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PullShareWorker.java) | [PushPipelineTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushPipelineTest.java)、[KafkaOrderedPushWorkerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorkerTest.java)、[PullShareWorkerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PullShareWorkerTest.java) | Testcontainers（`./gradlew build`） |
| AC-09 classic offset reset | [GroupWorkflowService](../modules/console-api/src/main/java/dev/ojbk/console/group/GroupWorkflowService.java)、[RuntimePauseVerifier](../modules/console-api/src/main/java/dev/ojbk/console/group/RuntimePauseVerifier.java)、[GroupMaintenanceFence](../modules/console-api/src/main/java/dev/ojbk/console/group/GroupMaintenanceFence.java)、[DefaultGroupOperations](../modules/console-api/src/main/java/dev/ojbk/console/group/DefaultGroupOperations.java) | [TopicApiIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java)、`*Ac09Test` | Testcontainers（`./gradlew build`）；結果未知時按 [operations](operations.md#offset-reset-outcome-unknown) 人工處理 |
| AC-10 console | [AuthController](../modules/console-api/src/main/java/dev/ojbk/console/security/AuthController.java)、[SubscriptionPreviewService](../modules/console-api/src/main/java/dev/ojbk/console/subscription/SubscriptionPreviewService.java)、[console-web](../console-web/src/) | [前端測試](../console-web/src/test/)、[golden path](../console-web/e2e/golden-path.spec.ts) | `pnpm e2e:stack`（[真 stack 旅程](../console-web/e2e-stack/golden-path.stack.spec.ts)） |
| AC-11 本機啟動與核心流程 | [Makefile](../Makefile)、[deploy](../deploy/)、[demo](../demo/) | `make validate-deploy`、`make e2e` | 同左 |

## 為完成主線所做的取捨

以下決定已同步到 SDD、SUCCESS 與各 spec。

- **AC-05 改為「不提早、最多晚一秒」。** 原「150 ms retry 偏差 <20%」與 Kafka→PostgreSQL→scheduler 路徑及 100 ms dispatcher tick 衝突（M4 設計已記錄），要達成得另造 scheduler。生產需要的是不提早、晚到有上限，與 AC-04 delay 的一秒容差一致。
- **AC-09 不另做 preview／confirm 步驟、自動復原端點或真雙 runtime e2e。** 現有閘門已涵蓋 pause、全部 runtime 確認、broker group empty、PG fence、alter、逐 partition 讀回、audit、restore；回覆就是讀回核對一致的 offsets。`ResetOffsetRequest.topicId` 必填且 `(group_id, topic_id)` 唯一，一次 reset 只動一個 subscription；同 group 其他 subscription 仍在消費時 broker group 不會 empty，以 `GROUP_NOT_QUIET` 安全失敗。結果未知時保持 paused，由 operator 按 runbook 處理。
- **AC-10 真 stack 只走一個 viewport。** 390 px 版面由既有 mock Chromium journey 覆蓋。
- **SDK 不要求 Java／Go 同形。** Java 用 `subscribe()` 回傳可取消的 handle；Go 用 `Run(ctx)`，以 context 取消，背景執行即 `go c.Run(ctx, h)`。
- **producer 不把 RPC deadline 傳進 broker 等待。** client 逾時只代表結果未知；gateway 按 Kafka delivery timeout（120 s）完成或失敗，client 重試可能重複，屬 at-least-once。gRPC 呼叫跑在 virtual thread，等待不佔平台執行緒。
- **容量與正式部署不在主線。** [execution plan](execution-plan.md) M2–M4 的 load gate（50k msg/s、3,000 schedules/s、5,000 萬 pending rows）是後續容量工作，不阻擋主線。

## 已修正的程式缺陷

- Go SDK import 即 panic：monorepo 改路徑時直接替換了生成檔 raw descriptor 內的字串，長度欄位失配。已用 `make generate-proto` 重新生成，`go test ./...` 通過。
- pull ACK command queue 無界，ack 逾時後 command 仍留在佇列：改為上限 500，滿了回 `BROKER_UNAVAILABLE`，逾時或中斷時移除自己的 command（`PullShareWorkerTest.rejectsAcknowledgementsBeyondTheCommandQueueBound`）。
- subscription 精靈的 topic／group 下拉選單不能搜尋，項目超過一頁時新建的 group 選不到：改為可搜尋。

## 驗收

2026-10-22 在 `71ac5f77` 全部 AC 通過，見 [SUCCESS](../SUCCESS.md) 與[證據](../../../docs/project-success/evidence/ojbquay-mainline-20261022/README.md)。重跑順序：`./gradlew build`、`sdk/go` 的 `go test ./...`、`make validate-deploy`、`KEEP_STACK=1 make e2e`、[extra.sh](../../../docs/project-success/evidence/ojbquay-mainline-20261022/extra.sh)、`pnpm e2e:stack`、`e2e/pull_share.sh`。

改行為時先改 SDD 與本表，再補測試與程式。
