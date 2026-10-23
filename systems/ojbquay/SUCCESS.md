---
project: systems/ojbquay
purpose: 在 Kafka 與 PostgreSQL 上提供自助訊息發布、消費及故障處理
kind: service
mainline: complete
usable_tag: usable/ojbquay/v1.0.0
reviewed: 2026-10-22
source_commit: 71ac5f775f9c93d679a2b0b3896ddce0d713594a
qualification: docs/project-success/qualifications/ojbquay.md
---

# ojbquay 成功契約

## 主線與範圍

[product spec](docs/product-spec.md) 的 Kafka-first v1：topic/group/subscription 自助管理、gRPC producer、HTTP push、Java／Go pull SDK、delay/retry/DLQ 與 console。
固定 AC 在 [SDD](SDD.md)，程式與測試對照在 [specification-map](docs/specification-map.md)。

不提供 end-to-end exactly-once、broker fork、可執行使用者 pipeline、跨區複製或 usage billing。
主線只認本機真基礎設施功能驗收；正式部署與容量認證不在主線內。

## 驗收條件

全部 AC 於 2026-10-22 在 `source_commit` 實跑通過；命令、環境與結果見 [證據](../../docs/project-success/evidence/ojbquay-mainline-20261022/README.md)。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given owner session/CSRF，When 建立 topic/group/PUSH subscription，Then PostgreSQL、Kafka、config bus 與 audit 收斂且 runtime 五秒內採用 | passed | `make e2e` 資源建立；`extra.sh` loaded version 561 ms；integration tests |
| AC-02 | Given gRPC producer 與 PUSH subscription，When 傳送已知 payload，Then ACK 含 partition/offset 且 HTTP sink 收到相同 hash | passed | `make e2e`：gRPC ACK partition/offset 與 sink 精確 payload；`ProducerGatewayE2eTest` |
| AC-03 | Given PULL 訂閱與 Java/Go SDK，When ACK/NACK 或 lease 過期，Then 逐筆確認與重送符合 at-least-once | passed | `e2e/pull_share.sh` `GO_INTEROP_OK`／`INTEROP_OK`；`go test`；`PullGrpcE2eTest` |
| AC-04 | Given delay 與失敗交付，When 延遲、取消、耗盡重試及 replay，Then 不提早、不遺失、可稽核 | passed | `SchedulerE2eTest`、`JdbcDelayRepositoryTest`、`KafkaRetryPublisherTest`、DLQ tests |
| AC-05 | Given `[150,300,600]` retry 與每次 503，When 四次交付，Then 每次間隔不小於 delay 且最多晚一秒，第四次寫 DLQ | passed | `PushRetryE2eTest.AC_05_…`（Testcontainers 真 Kafka/PG） |
| AC-06 | Given 非法 topic/token/大小/quota/partition，When 發送，Then 穩定錯誤碼且無 broker I/O | passed | `ProducerEngineTest`、`ProducerGrpcServiceTest`、`TokenAuthTest`、`ProducerGatewayE2eTest` |
| AC-07 | Given 有效 snapshot，When 舊／無效 revision 或控制面停止，Then LKG 保留且發送交付不中斷 | passed | `extra.sh`：停 console-api 後 gRPC ACK 與精確交付；`ConfigStoreTest` |
| AC-08 | Given pipeline fixtures 與同 key 訊息，When push 處理，Then 轉換、過濾、同 key 順序與資源上界成立 | passed | `PushPipelineTest`、`KafkaOrderedPushWorkerTest`、`PullShareWorkerTest`（含 ack 佇列上限） |
| AC-09 | Given classic ordered subscription，When reset，Then 全 runtime pause 確認、group empty、fence、alter、讀回、audit、restore；結果未知保持 paused | passed | `TopicApiIntegrationTest` reset cases、`*Ac09Test` |
| AC-10 | Given browser，When 登入、建立資源、預覽、test message、delay、DLQ、登出，Then 結果可見且權限正確 | passed | `pnpm e2e:stack` 真 stack 旅程（含 DLQ replay、登出）；`pnpm test`、mock Playwright |
| AC-11 | Given JDK25、Node24、Docker Compose，When `make validate-deploy`、`make e2e`，Then 十一服務核心流程完成 | passed | `make validate-deploy`；`make e2e` 11 services 8/8 |

## 現況與缺口

v1 功能主線完成，本機真基礎設施驗收通過。限制：
Kafka/PostgreSQL 間是 at-least-once；crash 後重送與 DLQ replay 可能重複。
Pull ACK token 必須回到發出 token 的 gateway，多實例需 connection affinity。
offset reset 結果未知時需人工處理，見 [operations](docs/operations.md#offset-reset-outcome-unknown)。

## 啟動與驗證

[README](README.md)、[demo guide](docs/demo.md)與[operations](docs/operations.md)：JDK 25、Docker Compose v2 及私人配置。

```sh
./gradlew build
(cd sdk/go && go test ./...)
make validate-deploy
KEEP_STACK=1 make e2e
(cd console-web && pnpm e2e:stack)
./e2e/pull_share.sh
```

AC-01 收斂時間與 AC-07 控制面中斷用 [extra.sh](../../docs/project-success/evidence/ojbquay-mainline-20261022/extra.sh) 對保留的 stack 執行。

保留來源 SHA、命令與結果，逐項對回 AC；health 或 exit 0 不等於 AC 通過。

## 可用版本

預定 `usable/ojbquay/v1.0.0`，資格見 [qualification](../../docs/project-success/qualifications/ojbquay.md)。此 PR 合併、CI 綠燈且 owner 同意後建立 annotated tag；範圍是本機功能主線，不是正式部署或容量認證。

## #445 歷史 WIP 處置（文件範圍）

本次驗收是[固定 SHA 對照與失敗處置](tasks/445-wip-disposition/analysis.md)：逐項區分已納入、被現行規格取代及尚未驗證的候選；保留原始失敗，不把其他來源綠燈倒推為 WIP 通過。只補來源與處置紀錄；本頁既有資格、SDD、runtime 與 tag 不變。文件／來源對照、42 項目契約、獨立審查與 PR CI 是本次 gates，不重跑產品以製造新資格。
