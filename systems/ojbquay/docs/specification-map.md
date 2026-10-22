# Ojbquay 規格、程式與測試對照

本文件是既有規格的導航與差異盤點，不新增需求、不取代已批准規格，也不以現有程式反推「正確行為」。

盤點來源：`6c611778a83b8e2d7198edace1dfc6a04d517516`（2026-10-22）。相對連結方便閱讀；要重現這次判斷，請讀取該 commit 的同路徑。未合併工作樹不在這份現況內。
16:30Z回讀發現同期 PR491 已合併；D-02另列 `02f61e1b41d36d4289212de15941c5c340964a1e` 的安全修復差異，避免把起始快照的缺口誤報為最新主線。
需求／進度：T-0374；[任務板](tasks/BOARD.md)。[本輪證據](test-reports/specification-map-20261022.md)。

## 先讀哪份文件

| 想知道什麼 | 來源與定位 |
| --- | --- |
| 產品做什麼、做不到什麼 | [product-spec](product-spec.md)：既有產品基線、範圍、驗收與非目標。 |
| 選型與衝突怎麼決定 | [ADR-001](adr/001-source-of-truth-and-v1-baseline.md) 選 Kafka-first；[ADR-002](adr/002-java-25-lts-baseline.md) 只取代 Java 基線，現行編譯／執行為 Java 25。 |
| 各功能的設計與限制 | [M2 producer](specs/m2-producer-vertical-slice.md)、[M3 delay](specs/m3-delay-scheduling.md)、[M4 push](specs/m4-push-consumer.md)、[M5 pull](specs/m5-pull-consumer.md)、[M6 console/operations](specs/m6-console-operations.md)。 |
| 發送、重送、順序與 reset 的共同承諾 | [messaging-semantics](messaging-semantics.md)。 |
| 對外 wire 契約 | [producer](../proto/ojbk/v1/producer.proto)、[consumer](../proto/ojbk/v1/consumer.proto)、[config](../proto/ojbk/v1/config.proto)、[common](../proto/ojbk/v1/common.proto)；REST 入口及 OpenAPI 測試見 AC-01/10。 |
| 固定 AC 與後來批准的變更 | [現行 SDD](../SDD.md)：PR472 主線整理、PR477 AC-05 量測修訂；原設計仍可由以上來源閱讀。 |
| 哪些真的驗證過 | [SUCCESS](../SUCCESS.md)、[execution plan](execution-plan.md) 及個別 test report；必須核對來源版本與驗證範圍。 |

此表是閱讀索引，不創設新的規格優先序。既有 ADR 的明確 supersedes 與 owner 已批准的修訂按各自範圍適用；沒有被解決的矛盾仍是待處理差異。程式與測試提供對照證據，不自動覆寫需求。

舊 repo 2026-09-04 的 [product-spec](https://github.com/fallrising/ojbquay/blob/2fe3c9d6042027050a598353d2cac55866aaccde/docs/product-spec.md) 與 [ADR-001](https://github.com/fallrising/ojbquay/blob/2fe3c9d6042027050a598353d2cac55866aaccde/docs/adr/001-source-of-truth-and-v1-baseline.md) 已存在；ADR 日期為 2026-07-29，明載 provided PRD／normative SDD 並要求先更新文件再改碼。[原件搜尋報告](test-reports/mainline-sdd-20261022.md)只支持「在所列範圍未找到原始單一檔案」，不能推論沒有文檔先行。新 SDD 是後來的主線整理與明確修訂，不是這些舊設計的首次出現。

## 系統輪廓

應用透過 console 建立 topic/group/subscription；PostgreSQL 同步保存 metadata、audit 與 outbox，publisher 將 revision 發到 Kafka `__ojbk.config`。各 Java runtime 載入不可變配置並保留 LKG。gRPC producer 驗證後寫 Kafka；consumer 以 HTTP push 或 gRPC pull 交付。delay/retry 由 Kafka inbox 進 PostgreSQL，再由 scheduler 發往目標 topic；DLQ/replay 透過受權管理操作。控制面使用 Spring，資料面沒有 Spring；傳送與副作用為 at-least-once，客戶端需要冪等。

## 逐 AC 對照

以下「有程式／有測試」是靜態查核，不代表該 AC 已通過。測試欄是可追查入口；本輪實跑與快取結果另列於證據報告。

| AC／規格行為 | 既有設計來源 | 程式入口 | 測試入口 | 現況與未證實部分 |
| --- | --- | --- | --- | --- |
| AC-01：資源建立、權限、配置與 audit/outbox 收斂 | [product-spec](product-spec.md) | [TopicService](../modules/console-api/src/main/java/dev/ojbk/console/topic/TopicService.java)、[OutboxPublisher](../modules/console-api/src/main/java/dev/ojbk/console/configuration/OutboxPublisher.java)、[ConfigStore](../modules/common/src/main/java/dev/ojbk/config/ConfigStore.java) | [TopicApiIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java)、[TopicConfigPublicationIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/configuration/TopicConfigPublicationIntegrationTest.java)、[KafkaConfigBusIntegrationTest](../modules/common/src/test/java/dev/ojbk/config/KafkaConfigBusIntegrationTest.java) | 有交易與版本化配置路徑；五秒全程序收斂仍需同版本情境證據。 |
| AC-02：gRPC 發送與可觀察交付 | [M2](specs/m2-producer-vertical-slice.md) | [ProducerEngine](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/ProducerEngine.java)、[ProducerGrpcService](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/ProducerGrpcService.java)、[KafkaBrokerProducer](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/KafkaBrokerProducer.java) | [ProducerGatewayE2eTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerGatewayE2eTest.java) | ACK 回傳 partition/offset；producer integration 不等於完整 HTTP sink／Compose 驗收。 |
| AC-03：pull、ACK/NACK、lease、SDK | [M5](specs/m5-pull-consumer.md) | [PullGateway](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PullGateway.java)、[PullShareWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PullShareWorker.java)、[ConsumerGrpcService](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/ConsumerGrpcService.java) | [PullGrpcE2eTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PullGrpcE2eTest.java)、[PullShareWorkerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PullShareWorkerTest.java) | ACK token 綁定本 gateway；Java 測試不能代替 Go import 與跨語言互通。 |
| AC-04：delay、取消、重複排程、retry/DLQ | [M3](specs/m3-delay-scheduling.md)／[M4](specs/m4-push-consumer.md) | [DelayGateway](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/DelayGateway.java)、[KafkaDelayIngestor](../modules/scheduler/src/main/java/dev/ojbk/scheduler/KafkaDelayIngestor.java)、[DelayDispatcher](../modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayDispatcher.java)、[JdbcDelayRepository](../modules/scheduler/src/main/java/dev/ojbk/scheduler/JdbcDelayRepository.java)、[KafkaRetryPublisher](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/KafkaRetryPublisher.java) | [DelayGatewayTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/DelayGatewayTest.java)、[SchedulerE2eTest](../modules/scheduler/src/test/java/dev/ojbk/scheduler/SchedulerE2eTest.java)、[JdbcDelayRepositoryTest](../modules/scheduler/src/test/java/dev/ojbk/scheduler/JdbcDelayRepositoryTest.java)、[KafkaRetryPublisherTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/KafkaRetryPublisherTest.java) | PG/Kafka 交易分離，容許 crash 重送；delay 功能容差不可替代 strict retry。 |
| AC-05：首次及後續 retry 時序 | [M4](specs/m4-push-consumer.md)／[已批准量測修訂](../SDD.md) | [PushRecordHandler](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PushRecordHandler.java)、[DelayDispatcher](../modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayDispatcher.java) | [PushRetryE2eTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushRetryE2eTest.java) | 既有測試容差 140–1150／290–1300／590–1600 ms 與已批准門檻不等價，也未嚴格排除 10 ms 提早；保留原指標 FAIL，新指標未取得主線資格。 |
| AC-06：producer 拒絕邊界與穩定錯誤 | [M2](specs/m2-producer-vertical-slice.md) | [ProducerEngine](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/ProducerEngine.java)、[TokenAuth](../modules/common/src/main/java/dev/ojbk/security/TokenAuth.java)、[TopicQuota](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/TopicQuota.java) | [ProducerEngineTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerEngineTest.java)、[ProducerGrpcServiceTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerGrpcServiceTest.java)、[TokenAuthTest](../modules/common/src/test/java/dev/ojbk/security/TokenAuthTest.java) | 未知／停用 topic、token、quota、大小、partition 拒絕與 broker I/O 邊界有測試入口。 |
| AC-07：配置快照、刪除與 LKG | [product-spec](product-spec.md)／[ADR-001](adr/001-source-of-truth-and-v1-baseline.md) | [ConfigStore](../modules/common/src/main/java/dev/ojbk/config/ConfigStore.java)、[KafkaConfigBusClient](../modules/common/src/main/java/dev/ojbk/config/KafkaConfigBusClient.java)、[GatewayProduceRuntime](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/GatewayProduceRuntime.java) | [ConfigStoreTest](../modules/common/src/test/java/dev/ojbk/config/ConfigStoreTest.java)、[KafkaConfigBusIntegrationTest](../modules/common/src/test/java/dev/ojbk/config/KafkaConfigBusIntegrationTest.java) | 舊 revision／非法 schema 不覆蓋 LKG；真控制面中斷後 producer→sink 仍需故障驗證。 |
| AC-08：pipeline、同 key 順序、有界資源 | [M4](specs/m4-push-consumer.md) | [PushPipeline](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PushPipeline.java)、[OrderedPushRecordHandler](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/OrderedPushRecordHandler.java)、[KafkaOrderedPushWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorker.java)、[BoundedStripedExecutor](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/BoundedStripedExecutor.java) | [PushPipelineTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushPipelineTest.java)、[OrderedPushRecordHandlerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/OrderedPushRecordHandlerTest.java)、[KafkaOrderedPushWorkerTest](../modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorkerTest.java) | ordered path 用 poll-batch barrier；未完成 batch 可導致已成功呼叫重送，不宣稱 exactly-once。 |
| AC-09：classic offset reset 安全閘門 | [product-spec](product-spec.md)／[共同語義](messaging-semantics.md#offset-reset)／[M6](specs/m6-console-operations.md) | [GroupWorkflowService](../modules/console-api/src/main/java/dev/ojbk/console/group/GroupWorkflowService.java)、[RuntimePauseVerifier](../modules/console-api/src/main/java/dev/ojbk/console/group/RuntimePauseVerifier.java)、[GroupMaintenanceFence](../modules/console-api/src/main/java/dev/ojbk/console/group/GroupMaintenanceFence.java)、[DefaultGroupOperations](../modules/console-api/src/main/java/dev/ojbk/console/group/DefaultGroupOperations.java) | [TopicApiIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java)、[RuntimePauseVerifierAc09Test](../modules/console-api/src/test/java/dev/ojbk/console/group/RuntimePauseVerifierAc09Test.java)、[DefaultGroupOperationsAc09Test](../modules/console-api/src/test/java/dev/ojbk/console/group/DefaultGroupOperationsAc09Test.java)、[GroupMaintenanceFenceAc09Test](../modules/console-api/src/test/java/dev/ojbk/console/group/GroupMaintenanceFenceAc09Test.java) | 已有 pause／fence／broker 回讀；全 group、preview-confirm、真雙 runtime 仍有缺口；未知 outcome／過期 owner 的同期修復與復原限制見 D-02。 |
| AC-10：console、登入權限、preview／操作 | [M6](specs/m6-console-operations.md) | [AuthController](../modules/console-api/src/main/java/dev/ojbk/console/security/AuthController.java)、[SecurityConfiguration](../modules/console-api/src/main/java/dev/ojbk/console/security/SecurityConfiguration.java)、[SubscriptionPreviewService](../modules/console-api/src/main/java/dev/ojbk/console/subscription/SubscriptionPreviewService.java) | [SubscriptionPreviewServiceTest](../modules/console-api/src/test/java/dev/ojbk/console/subscription/SubscriptionPreviewServiceTest.java)、[TopicApiIntegrationTest](../modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java) | [前端測試](../console-web/src/test/)與 [mock browser journey](../console-web/e2e/golden-path.spec.ts) 不等於同版本真 stack／雙 viewport 全流程。 |
| AC-11：本機啟動與可重現整合流程 | [M6](specs/m6-console-operations.md)／[demo spec](specs/docker-functional-demo.md) | [GatewayProduceRuntime](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/GatewayProduceRuntime.java)、[GatewayConsumeRuntime](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/GatewayConsumeRuntime.java) | [ProducerGatewayE2eTest](../modules/gateway-produce/src/test/java/dev/ojbk/gateway/produce/ProducerGatewayE2eTest.java) | [Makefile](../Makefile)、[e2e](../e2e/)、[demo](../demo/) 是驗收入口；模型有效／build 綠燈不等於十一服務交付成功。 |

## 必須保留的差異

### D-01：retry 的批准門檻與測試 oracle

M4 原文為 150 ms retry 的端到端偏差 <20%；原到達間隔失敗保留。PR477 改成前次失敗結果完成至下一次完整 request body 到達，數值仍為 `[150,180)`、`[300,360)`、`[600,720)` ms；沒有暖機或排除首次 retry。這是有影響的批准修訂，不是原指標通過。

本來源 `PushRetryE2eTest` 仍以寬容差驗證 scheduled retry；完整 build 成功不能證明新版 strict AC-05。下一步是依已批准 fixture/量測建立對應 assertion 並保留兩套量測結果；本輪只記錄，不改 oracle 或 runtime。[修訂記錄](test-reports/retry-contract-decision-20261022.md)。

### D-02：reset 不能只看 broker empty，也不能沿用「沒有回讀」的舊描述

`GroupWorkflowService.resetGuarded` 已 capture runtime roster、發布 pause revision、兩次確認 pause、等待 broker empty，並驗證 maintenance ownership。`DefaultGroupOperations.reset` 已在 alter 後讀回 offsets，逐 partition 比對；回讀缺項或不一致會失敗。相應 `*Ac09Test` 與 API integration cases 已存在。

但仍只選 `subscriptions(...).findFirst()` 的 subscription；這不是全 group 所有 subscription 協調的證明。reset 內計算目標不等於獨立 preview/confirm 流程。`DefaultGroupOperations.await` 的 timeout/interrupt 只結束等待，未證明 broker alter 結束；`resetGuarded` 的 finally 仍嘗試 resume，`Gate.close` 刪除 lease，未知結果後的保護與 stale-owner 問題仍保留。也未取得同版本真雙 runtime 整體驗收。

以上缺口描述限定起始來源6c611778。同期 [PR491](https://github.com/fallrising/newclear/pull/491) 已合併為 `02f61e1b41d36d4289212de15941c5c340964a1e`：root回讀新 `GroupMaintenanceFence.beforeAlter` 以相同token且未過期條件將lease設為infinity；只有acknowledged alter加matching readback後才 `confirmedReset`，未知結果保留pause與lease並回覆 `GROUP_RESET_OUTCOME_UNKNOWN`，不再一律resume／刪除lease。這是後續有界修復，不把起始缺陷當成仍未修。

AC-09 仍 partial：未知結果的安全復原／對帳流程尚未提供，可能長期paused；不可僅憑等待、一次offset讀值或重啟清除保護。全group、preview/confirm及真雙runtime仍待驗。本文件不能以unit/mocked broker case取代跨程序證據。原[切片報告](test-reports/ac09-runtime-slice.md)與[獨立審查](../../../.team/reports/T-486.md)保留歷史範圍。

### D-03：功能測試與效能／部署承諾

[execution-plan 的 M2 紀錄](execution-plan.md#m2-producer-vertical-slice)列出 50k messages/s release load gate；M3 的 3,000 schedules/s 與 50 million pending rows、M4 吞吐目標也明載需要 load gate。單機 Compose、模型驗證或 Gradle build 不提供這些容量保證，也不構成 production deployment。沿用原非目標與 pending 狀態。

### D-04：介面存在與 SDK／UI 整合

Protobuf 契約、Java gateway tests、Go generated descriptor、Java↔Go interop、mock browser journey 是不同驗證層。舊來源 Go import panic 留在歷史報告；本輪未重跑 Go 或真 Compose，不把 Java build 寫成跨語言通過。UI mock 成功不代表 runtime 操作與雙 viewport 的同版本驗收。

### D-05：批准狀態與歷史證據

README、product-spec、SUCCESS 與任務板曾殘留「SDD 待 owner 同意」，但 PR472/477 已批准合併。本次只同步此事實與索引，不將舊 FAIL、PARTIAL 或 historical 改成 PASS，也不把尚未完成的產品列為可用。來源版本不同的報告需先比對 delta；本次盤點版本與歷史 reference `0aac1841` 不相同。

## 新發現的文件／實作差異

### D-06：4 MiB 是 value 上限，非完整編碼 request

M2 舊文寫「4 MiB request ceiling」，但 M3 明確保留 framing overhead。[MessageLimits](../modules/common/src/main/java/dev/ojbk/messaging/MessageLimits.java) 定義 value 4,194,304 bytes，Kafka request 另加 2,300,000 bytes 的有界 overhead。本次同步 M2 用詞以對齊這個既有設計；沒有調整數值或新增容量承諾。

### D-07：Java／Go SDK 能力描述過度一致

M5 同時承諾兩 SDK 的 immutable delivery、blocking run loop、cancellable background subscription。[Java OjbkConsumer](../sdk/java/src/main/java/dev/ojbk/sdk/OjbkConsumer.java) 公開 poll/acknowledge/subscribe，run 為 private；[Go Consumer](../sdk/go/consumer.go) 公開 Poll/Acknowledge/Run，沒有相同 subscription handle。[Go Delivery](../sdk/go/message.go) 的 fields/slices/maps 可變，即使接收路徑有複製資料也不等於 immutable API。這是待決的規格／API 差異；不在本輪刪除原承諾或補做 API。

### D-08：有界佇列與 deadline 尚非全路徑保證

[PullShareWorker](../modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PullShareWorker.java) 的 ack commands 是無界 `ConcurrentLinkedQueue`；每次 500 tokens 的限制不限制佇列總長，ack wait timeout 也不移除 command。這違背 product-spec 的 all queues bounded 要求，需要後續有界 admission／清理設計與回歸；目前只完成靜態定位，未實跑飽和情境。

[KafkaBrokerProducer.send](../modules/gateway-produce/src/main/java/dev/ojbk/gateway/produce/KafkaBrokerProducer.java) 等待 `send(...).get()` 並設定固定 120,000 ms delivery timeout；檢視的 producer path 未將 RPC remaining deadline 傳入 broker 等待。SDK deadline 存在，不足以證明共同語義文件所說的 gateway retries 受 client deadline 限制。需以 cancellation/deadline 情境驗證並修正契約或實作，不能只以目前單次 send 成功推定。

## 維護方式

改行為前先定位原要求與適用修訂，補測試或列出無法自動驗證的原因；完成後同步本對照、原規格適用狀態與有來源版本的證據。若需改需求或門檻，另提供具體差異與影響供 owner 審查，不用文件整理掩蓋規格變更。產品完成仍依全部已批准 AC，而不是本文件完成。
