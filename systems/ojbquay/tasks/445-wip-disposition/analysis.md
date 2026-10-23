# Ojbquay #445：WIP479 與現行主線處置

## 固定對照

本次讀取 [issue445 的2026-10-23補充](https://github.com/fallrising/newclear/issues/445)，比較候選 `ae607399476891db86b3e365df4dfb822517576b` 與主線 `8d16672837ef7a8cdc70ed015d0ca605c138b624`。共同候選基底與全部 blob ID 見 [comparison.json](comparison.json)。52 個變更檔包含45個來源／測試／CI檔與7個協調／狀態／證據檔；只比較內容，不把相同 blob 當成新的執行證據。

[Draft479](https://github.com/fallrising/newclear/pull/479) 是失敗候選的保存點，仍不可整包合併。它所寫「477未批准」是當時快照，已被後續批准與交付取代；舊失敗紀錄不可刪掉或改成 PASS。

## 兩個具體歷史 failure

原 [job119829879016](https://github.com/fallrising/newclear/actions/runs/39780401145/job/119829879016) 日誌仍可取得。`gateway-consume` 當次44 tests、2 failed；完整日誌摘要雜湊留於 JSON。以下不是新的測試執行。

1. `PushRetryE2eTest.AC_05_schedulesThreeRetriesThenWritesFourthFailureToDlq`：202ms不小於180ms，原嚴格到達區間確實 FAIL。其後 [477](https://github.com/fallrising/newclear/pull/477) 已批准並合併；[bbf4b3b](https://github.com/fallrising/newclear/commit/bbf4b3bd31624fbbdcd80acb6861113297ce2920) 保留批准紀錄，[2dc9b8b](https://github.com/fallrising/newclear/commit/2dc9b8bee5e8f4185fc2a42c3d653cd919f5d656) 更新斷言。現行 [SDD](../../SDD.md) 保留完整 request body 到達為觀測點，要求 `[150,1150)`、`[300,1300)`、`[600,1600)`，並保留 durable/no-early。原202ms不能倒推為舊契約通過；也不能拿舊180ms門檻否定現行主線。早先「改成 response-completion 起點」提案不是目前測試的定義。
2. `PushWorkerOrchestratorTest.startsReplacesAndStopsWorkersFromSubscriptionRevisions`：預期版本4，實際0。候選 `onDeleted` 無條件移除 version；測試在 store 還有 subscription 時呼叫它，故 version歸零。已合併的 [68568f3c](https://github.com/fallrising/newclear/commit/68568f3cdaff805604ed4aae54bc47d3aac179e1) 只在 store 已有 tombstone 時忘記 revision；原 test 檔在候選與比較主線 blob相同，`isEqualTo(4)` 保留。[既有AC09報告](../../docs/test-reports/ac09-runtime-slice.md) 明列該回歸、65項focused及120項完整JUnit零失敗；這是該修復來源的歷史證據，不是藉其他分支綠燈猜修好了。後續 [850e0106](https://github.com/fallrising/newclear/commit/850e0106) 補 reconcile失敗持續性與bus loss後停止重試，沒有恢復錯誤移除行為。

原 issue 另外提到 `KafkaOrderedPushWorkerTest` 的 Testcontainers startup timeout。這個 job 的兩個實際失敗不是該 timeout，不能用它或後來主線成功宣稱已找出 startup 根因。候選的診斷容器與artifact保留仍未納入主線；若再出現同型失敗，應在固定新來源下保留容器狀態、啟動失敗與清理結果，再獨立驗證最小修復。

## 變更處置

- **已保留**：13個檔與主線逐blob相同，涵蓋runtime/common/Compose及部分AC09測試，不需再次搬運。
- **AC09後續取代**：console fence/restore/未知結果與push lifecycle差異由 [68568f3c](https://github.com/fallrising/newclear/commit/68568f3cdaff805604ed4aae54bc47d3aac179e1)、[850e0106](https://github.com/fallrising/newclear/commit/850e0106)、[2ccd5116](https://github.com/fallrising/newclear/commit/2ccd5116)、[876878fb](https://github.com/fallrising/newclear/commit/876878fb)、[ab014b72](https://github.com/fallrising/newclear/commit/ab014b72)、[7afb1556](https://github.com/fallrising/newclear/commit/7afb1556)、[0a0adf6d](https://github.com/fallrising/newclear/commit/0a0adf6d) 及相應報告串接。不要用舊WIP覆蓋後續閘門。
- **retry實驗未納入**：scheduler wakeup、連線、metadata預編譯及其測試仍是未接受候選。現行契約已變更；沒有目前失敗或獨立效益證據時，不抽取大幅scheduler改造。advancing-clock anchor回歸可單獨考慮，但也未在本次冒稱已納入或驗證。
- **Go產生碼已被取代**：六個檔的候選／主線差異只有 `protoc v7.35.1`／`v3.21.12` 產生器註記；目前 [7f3a56a5](https://github.com/fallrising/newclear/commit/7f3a56a5) 已完成SDK重新產生／可匯入修復。不為註記倒灌舊候選。
- **值得保留為後續候選**：診斷容器、測試、Gradle exception輸出與CI artifact/Go SDK lane。它們未在目前來源獨立驗證，不能整段直接複製；診斷中原始broker輸出須先審視payload/credential邊界。現行workflow沒有此WIP artifact保留步驟。
- **歷史紀錄**：7個協調／狀態／保存證據檔留在舊PR歷史；不要覆蓋現行SUCCESS或PLAN。

逐檔分類如下；`comparison.json`另保留52組固定blob證據。`candidate_not_in_main`只表示主線仍等於候選基底，不代表應該合併。

| 檔案 | 處置 |
| --- | --- |
| `.github/workflows/ojbquay-ci.yml` | diagnostic_or_ci_candidate_needs_separate_validation |
| `.team/PLAN.md` | historical_record_only |
| `docs/project-success/evidence/ojbquay-wip-checkpoint/last-reset-test-summary.json` | historical_record_only |
| `docs/project-success/evidence/ojbquay-wip-checkpoint/reset-source-manifest.json` | historical_record_only |
| `docs/project-success/evidence/ojbquay-wip-checkpoint/retry-source-manifest.json` | historical_record_only |
| `systems/ojbquay/SUCCESS.md` | historical_record_only |
| `systems/ojbquay/build.gradle.kts` | diagnostic_or_ci_candidate_needs_separate_validation |
| `systems/ojbquay/deploy/compose/docker-compose.yml` | already_retained_exact |
| `systems/ojbquay/docs/execution-plan.md` | historical_record_only |
| `systems/ojbquay/modules/common/src/main/java/dev/ojbk/config/KafkaConfigBusClient.java` | already_retained_exact |
| `systems/ojbquay/modules/common/src/main/java/dev/ojbk/config/RuntimePauseStatus.java` | already_retained_exact |
| `systems/ojbquay/modules/common/src/main/java/dev/ojbk/config/RuntimeRoster.java` | already_retained_exact |
| `systems/ojbquay/modules/common/src/main/java/dev/ojbk/observability/MetricsHttp.java` | already_retained_exact |
| `systems/ojbquay/modules/console-api/src/main/java/dev/ojbk/console/group/DefaultGroupOperations.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/console-api/src/main/java/dev/ojbk/console/group/GroupMaintenanceFence.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/console-api/src/main/java/dev/ojbk/console/group/GroupWorkflowService.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/console-api/src/main/java/dev/ojbk/console/group/RuntimePauseVerifier.java` | already_retained_exact |
| `systems/ojbquay/modules/console-api/src/main/java/dev/ojbk/console/subscription/SubscriptionService.java` | already_retained_exact |
| `systems/ojbquay/modules/console-api/src/test/java/dev/ojbk/console/group/DefaultGroupOperationsAc09Test.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/console-api/src/test/java/dev/ojbk/console/group/GroupMaintenanceFenceAc09Test.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/console-api/src/test/java/dev/ojbk/console/group/RuntimePauseVerifierAc09Test.java` | already_retained_exact |
| `systems/ojbquay/modules/console-api/src/test/java/dev/ojbk/console/topic/TopicApiIntegrationTest.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/BoundedStripedExecutor.java` | already_retained_exact |
| `systems/ojbquay/modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/GatewayConsumeRuntime.java` | already_retained_exact |
| `systems/ojbquay/modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/GatewayConsumeSettings.java` | already_retained_exact |
| `systems/ojbquay/modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorker.java` | already_retained_exact |
| `systems/ojbquay/modules/gateway-consume/src/main/java/dev/ojbk/gateway/consume/PushWorkerOrchestrator.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/DiagnosticKafkaContainer.java` | diagnostic_or_ci_candidate_needs_separate_validation |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/DiagnosticKafkaContainerTest.java` | diagnostic_or_ci_candidate_needs_separate_validation |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/KafkaOrderedPushWorkerTest.java` | diagnostic_or_ci_candidate_needs_separate_validation |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PauseLifecycleAc09Test.java` | replaced_by_reviewed_ac09_followups |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushRecordHandlerTest.java` | unintegrated_anchor_regression |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/PushRetryE2eTest.java` | superseded_by_approved_retry_contract |
| `systems/ojbquay/modules/gateway-consume/src/test/java/dev/ojbk/gateway/consume/RuntimeRecoveryAc09IntegrationTest.java` | already_retained_exact |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayDispatcher.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayMetadataCodec.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/DelayRepository.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/JdbcDelayRepository.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/KafkaDelaySender.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/SchedulerRuntime.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/main/java/dev/ojbk/scheduler/WorkerConnections.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/test/java/dev/ojbk/scheduler/DelayDispatcherTest.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/test/java/dev/ojbk/scheduler/JdbcDelayRepositoryTest.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/test/java/dev/ojbk/scheduler/SchedulerE2eTest.java` | unintegrated_retry_experiment |
| `systems/ojbquay/modules/scheduler/src/test/java/dev/ojbk/scheduler/WorkerConnectionsTest.java` | unintegrated_retry_experiment |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/common.pb.go` | superseded_generator_header |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/config.pb.go` | superseded_generator_header |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/consumer.pb.go` | superseded_generator_header |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/consumer_grpc.pb.go` | superseded_generator_header |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/producer.pb.go` | superseded_generator_header |
| `systems/ojbquay/sdk/go/gen/ojbk/v1/producer_grpc.pb.go` | superseded_generator_header |
| `systems/ojbquay/tasks/445-retry-timing/wip-checkpoint.md` | historical_record_only |

## 建議與界線

建議把479保留為歷史保存點，或由owner決定關閉為已被後續交付取代；本次不關閉、不合併、不重寫其來源。若需要診斷保留／anchor回歸，另從現行main抽最小候選，先RED再GREEN及獨立審查；不能拿舊WIP完整green作不存在的前提。

現行資格見 [qualification](../../../../docs/project-success/qualifications/ojbquay.md) 與 [主線證據](../../../../docs/project-success/evidence/ojbquay-mainline-20261022/README.md)。本次沒有重跑Java/Kafka/PG、Compose或browser，也沒有改規格／tag／部署。原兩項failure已有不同處置：一項由明確批准的契約取代，一項有保留原斷言的因果修復；原startup timeout仍未作根因定案。Owner驗收與WIP關閉另計。
