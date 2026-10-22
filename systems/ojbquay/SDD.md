# Ojbquay 主線 SDD

狀態：主線契約；修訂經 owner 合併 PR 生效。與舊設計的差異見文末。
需求：T-0368；修復入口 [#445](https://github.com/fallrising/newclear/issues/445)。
本文件依現存產品文件、程式與測試制定，不是找回的原始 SDD。

## 用途與目標

讓應用擁有者透過一個管理介面建立 topic、group、subscription，使用 Java／Go
gRPC SDK 發送消息，選擇 HTTP push 或高階 pull 接收，並能處理延遲、取消、重試、
死信與重播。使用者不必直接管理 Kafka；發送確認、處理確認與可能重送必須有明確語義。

本文件把 Kafka-first v1 主線定成可逐項驗證的固定 AC。全部 AC 在同一 commit 通過即主線完成；
正式部署與容量認證不在主線內。

## 主線範圍與邊界

- 自助資源管理、權限與 audit、版本化配置發布、Last Known Good（LKG）。
- 同步 producer ACK 與拒絕語義；Java／Go SDK；HTTP push 與 Kafka Share pull。
- 已有 shadow/tag/CEL/transit 處理、同 key 有序 push、有限資源與 backpressure。
- durable delay、取消、有限 recurrence、retry、DLQ／replay；retry 不提早、最多晚一秒。
- 已有 console 的登入、建立資源、預覽、消息／delay／DLQ 操作、classic offset reset，
  以及本機 Compose 的真實核心流程與最小觀測入口。

非目標：exactly-once side effects、broker fork、RocketMQ／Thrift adapter、可執行使用者
pipeline、Redis/HBase/HDFS sink、跨區／HA、usage billing、cron／無限 delay recurrence、
新 UI 設計、OIDC／secret-manager 選型、production deployment、容量或吞吐量認證。
execution plan 的 load gate 是後續容量工作，不阻擋主線。
既有 trailing `-1` retry policy 的相容性保留，但不是新增無限重試使用情境。

## 設計

### 元件與資料流

1. `console-api`（唯一使用 Spring Boot 的元件）在 PostgreSQL 17 保存 topic/group/
   subscription、audit、outbox。publisher 將單調遞增的資源 revision 寫至 compacted
   `__ojbk.config`；操作 UI 顯示 desired version，runtime metric 顯示 loaded version。
2. Java 25 framework-free producer／consumer／scheduler 載入不可變 snapshot，原子替換
   合法較新 revision；無效或舊配置不破壞現有 LKG。控制面故障不等同資料面資料消失。
3. producer 先驗證 token、topic、大小、quota、partition，再送 Kafka 4.2。
   同步成功返回 broker partition/offset；這只證明 Kafka 接受，不代表下游已處理。
4. unordered push 與 pull 使用 Share Group 明確 ACK。ordered push 使用 classic group、
   bounded key stripes 與保守 poll-batch barrier；ordered retry 在 key stripe 內 inline 執行，
   不寫 scheduled retry command；未終結 record 使 batch 重取，容許重複。
5. unordered push business failure 將原消息、identity、retry count 寫入 `DelayCommand ADD`，
   目的為 `{topic}.{group}.retry`，經 `__ojbk.delay.inbox` → PostgreSQL → scheduler。
   只有下一步 durable handoff 成功才 ACCEPT；耗盡後先寫 `{topic}.{group}.dlq`。
6. scheduler 在 transaction 內用 `FOR UPDATE SKIP LOCKED` 取得到期 row，Kafka ACK
   後標記 DONE 或推進同一 row 的下一次 recurrence。失敗 rollback；Kafka／PG 不是
   同一 transaction，crash 可重送。notification／deadline hint 只能喚醒，不得繞過 due gate。

### 對外行為與不變條件

- REST `/api/v1`、`proto/ojbk/v1`、`dev.ojbk.*` 保持既有介面；本修訂沒有 schema、
  runtime dependency 或 namespace 變更。
- 全路徑 at-least-once；客戶端以自然 key／inbox 處理重複。replay 是明確的再次發送。
- PULL ACK=ACCEPT、NACK=RELEASE；token 唯一、single-use，回到發出 token 的 gateway。
  v1 多實例需要 affinity。lease 到期／斷線可重送，delivery count 可見。
- schedule/cancel 成功只表示 Kafka 已接受命令；PG 套用是非同步。相同 delay ID
  first-write-wins。CANCEL 先取得 pending row 時不發送；dispatch 先鎖住時容許當次發送。
- 預設 direct threshold=0，不提早發送。positive threshold 是既有明確 opt-in，
  不能用在 AC-04／AC-05 驗收。有限 recurrence 最多 10,000 次；首次／間隔最多 30 天。
- message value 上限 4 MiB；poll/claim/inflight 各自使用現有設定上界，單 worker 不超過
  500 records；DLQ browse 最多 500、sample 1..100。預設 logs 不含 payload 或 credentials。
- classic offset reset 要 pause、全部 runtime 確認停止 fetch 且 inflight 已結算、broker group
  empty、PG maintenance fence、alter、逐 partition 讀回、audit、restore；缺任一安全前提不改 offset。
  alter 結果未知時保持 paused 與 fence，回 `GROUP_RESET_OUTCOME_UNKNOWN`，由 operator 按 runbook 處理。
  Share group reset/progress 回覆 UNSUPPORTED，不虛構 offset。

### Retry 計時

handler 在 `http.deliver` 返回後以 `clock.instant().plusMillis(delay)` 設定 durable due；
scheduler 以 100 ms tick 經 Kafka／PostgreSQL 發送。驗收以相鄰兩次完整 request body 到達
`A_i` 的間隔量測：不得小於設定的 delay，且比 delay 晚不超過一秒，與 AC-04 delay 容差相同。

## 固定驗收條件

AC 編號固定，不得重用或隨修復改名。
每列下的全部案例都必須成立；部分通過不等於該 AC 通過。

### AC-01 — 建立資源與配置收斂

**Given** 有效 owner session、CSRF 與真 Kafka/PG，**When** 建立 topic、group、PUSH
subscription，再更新及暫停，**Then** metadata、Kafka 所需 topic、audit/outbox 與
`__ojbk.config` 最終 revision 一致，runtime 在 M4 原有五秒條件內採用新 subscription；
非 owner mutation 被拒絕，無效訂閱不能留下部分 metadata。

驗證：`TopicApiIntegrationTest`、`TopicConfigPublicationIntegrationTest`、
`KafkaConfigBusIntegrationTest`、`PushWorkerOrchestratorTest`；真 Compose provisioning
與 loaded-version 觀測補跨程序證據。只檢查 REST 200 不夠。

### AC-02 — 發送與可觀察交付

**Given** 有效 topic token、enabled PUSH subscription 與已知 bytes，**When** 用 gRPC
producer 同步發送，**Then** 回覆含 Kafka partition/offset，HTTP sink 收到預期 body hash、
key/source identity 與 trace context；沒有 broker ACK 時不能回成功。

驗證：`ProducerGatewayE2eTest`、`PushPipelineTest` 與 `make e2e` 的 exact-payload hash。
transform fixture 的預期 bytes 明列，不能以健康探針代替消息到達。

### AC-03 — Java／Go pull 與重送

**Given** PULL subscription、真 Kafka/gRPC 及 Java／Go SDK，**When** 雙向發送接收、ACK、
NACK、重複 token ACK、斷線／lease 到期，**Then** ACK 的消息不再取得，NACK／未確認消息
能重送，delivery count 增加、重送 token 不同，舊 token 不得確認新的 delivery。

驗證：`PullGrpcE2eTest`、`PullShareWorkerTest`、兩 SDK tests，及 `e2e/pull_share.sh`
跨語言真 broker 情境。單元替身不能代替 SDK import、wire compatibility 或重送。

### AC-04 — Delay、durable retry 與死信復原

- **Given** 未來 due、預設 threshold=0 與重複 ADD，**When** inbox 套用且 dispatcher 執行，
  **Then** 一個 pending series、不早於 due、在 due 後一秒內完成既有 delay fixture 的 send，
  消息帶穩定 delay ID；三次有限 recurrence 恰好推進三次後 DONE。
- **Given** pending row，**When** CANCEL 先鎖定，**Then** 無 target record；dispatch 先鎖定
  時當次可發送，後續可取消。兩 worker 不能在同一 transaction 同時 claim 同 row。
- **Given** inbox PG batch 或 target send 失敗，**When** 重試，**Then** rollback／rewind
  保留待處理資料，不跳過失敗命令；Kafka ACK 後 PG crash 的重複仍屬 at-least-once。
- **Given** unordered Share PUSH、HTTP 503 與 `[150,300,600]`，**When** 四次交付均失敗，**Then** 前三次僅在
  下一筆 retry 命令 durable 後 ACCEPT，第四次先寫 DLQ 再 ACCEPT；handoff 失敗 RELEASE。
- **Given** owner 指定 DLQ partition/offset，**When** browse/replay，**Then** bounded
  response、原 key/value/partition 重發、retry/DLQ/delay-id header 清理且 audit；非 owner 拒絕。

驗證：`JdbcDelayRepositoryTest`、`SchedulerE2eTest`、`DelayGatewayTest`、
`PushRecordHandlerTest`、`KafkaRetryPublisherTest`、`PushRetryE2eTest`、
`DefaultKafkaDlqOperationsTest`、`DlqApiIntegrationTest`。

### AC-05 — Retry 等待與交付時序

**Given** unordered Share PUSH、真 HTTP/Kafka/PG、`[150,300,600]`、HTTP endpoint 每次回 503，
**When** 首次交付與三次 retry 產生四次請求，記每次完整 request body 到達 `A_i`，**Then**
`150 ≤ A_1-A_0 < 1150`、`300 ≤ A_2-A_1 < 1300`、`600 ≤ A_3-A_2 < 1600` ms，第四次失敗寫 DLQ，
且 AC-04 durable 條件全部成立。

驗證：`PushRetryE2eTest.AC_05_schedulesThreeRetriesThenWritesFourthFailureToDlq`；差值用
`Duration.toMillis()`，不加暖機、不排除第一次 retry。

### AC-06 — Producer 拒絕邊界

**Given** unknown/disabled topic、bad token、超過 4 MiB、quota exhausted 或非法 partition，
**When** producer 發送，**Then** 得到既有穩定 application code 且無 broker I/O；有效
message 才返回 broker ACK，broker error 不洩露內部 exception。

驗證：`ProducerEngineTest`、`ProducerGrpcServiceTest`、`TokenAuthTest`；測試同時斷言錯誤碼與
broker adapter 呼叫次數，並以 `ProducerGatewayE2eTest` 驗證真 wire path。

### AC-07 — 配置與控制面中斷

**Given** runtime 已有有效 snapshot，**When** 舊 revision、unsupported schema、刪除事件
或控制面不可用，**Then** 舊／無效配置不覆蓋 LKG，合法刪除原子移除資源；既有合法 topic
仍可發送與交付。恢復後只套用較新 revision，不將未知配置當空配置成功啟動。

驗證：`ConfigStoreTest`、`KafkaConfigBusIntegrationTest`；另需停止**測試 stack**控制面後
的真 producer→sink 證據。已有 unit pass 不等於此 fault 情境已驗證。

### AC-08 — Push pipeline、順序與有限重試

**Given** shadow/tag/CEL/transit fixtures，**When** 處理 matching/nonmatching/invalid input，
**Then** matching payload 正確轉換；filter 直接 ACCEPT 且無 HTTP/retry/DLQ；pipeline error
遵守既有 DLQ/REJECT。transport failure 最多兩次 200/400 ms fast retry，HTTP 2xx 才成功。
**Given** 相同 key 與另一 stripe，**When** ordered push 處理，**Then** 同 key 串行、另一
stripe 可前進，未完成 batch 不先 commit；資源維持既有上界。

驗證：`PushPipelineTest`、`JdkPushHttpClientTest`、`OrderedPushRecordHandlerTest`、
`BoundedStripedExecutorTest`、`KafkaOrderedPushWorkerTest.preservesSameKeyOrderWhileAnotherKeyProgresses`。

### AC-09 — Classic offset reset 的硬性閘門

**Given** owned classic ordered subscription，**When** 對指定 topic reset，**Then** pause 發布、
**所有 runtime 確認 fetch 已停止且 inflight 已結算**，broker group empty，取得 PG maintenance fence，
計算目標並在範圍內才 alter，逐 partition 讀回核對、audit 並恢復先前 state，回覆核對後的 offsets。
任一 runtime 未確認 pause 或 60 秒內未 empty 都不改 offset。alter 逾時或讀回不符時保持 paused 與
fence 並回 `GROUP_RESET_OUTCOME_UNKNOWN`。PULL／unordered Share 回覆 UNSUPPORTED。未授權者不能執行。

驗證：`TopicApiIntegrationTest` reset cases（真 PG/Kafka）、`RuntimePauseVerifierAc09Test`
（多 runtime roster）、`DefaultGroupOperationsAc09Test`、`GroupMaintenanceFenceAc09Test`。
未知結果的人工處理見 [operations](docs/operations.md#offset-reset-outcome-unknown)。

### AC-10 — 自助 console 核心操作

**Given** browser，**When** 登入、建立 topic/group/subscription、預覽
filter/transit、送 test message、查 delay、browse/replay DLQ、登出，**Then** 操作有可見
成功／失敗與 desired version；預覽不寫 broker；未登入導向 login、非 OPS/ADMIN 禁止管理頁。
消息內容只在明確使用者操作後顯示，payload/credential 不進預設 logs。

驗證：`pnpm test`、`pnpm build`、`pnpm e2e`（MSW/Chromium，1280 px 與 390 px），加同版本真 stack
走一次 golden path（單一 viewport）。mock journey 不冒充真端到端操作。

### AC-11 — 可重現本機啟動與核心流程

**Given** README/runbook 所列 JDK25、Node24、Docker Compose、合成配置與獨立測試資源，
**When** `make validate-deploy`、`make e2e`／`make demo`，**Then** 十一服務核心流程完成：
readiness、session/CSRF、資源建立、真 gRPC ACK、exact HTTP payload、success metric、
Prometheus scrape；退出後只清除本次 fixture 資源。版本與設定摘要足以重跑。

驗證：native build、deploy model checks、真 Compose 與 Java↔Go interoperability。
對應來源 SHA 必須明確；較早來源證據要附 source delta，相關程式變更需補跑。

## 與舊設計的差異

| 舊設計 | 本契約 | 理由 |
| --- | --- | --- |
| M4：150 ms retry 端到端偏差 `<20%` | AC-05：不提早、最多晚一秒 | Kafka→PG→scheduler 路徑與 100 ms tick 無法達到，需另造 scheduler；生產只需不提早且晚到有上限 |
| messaging-semantics：reset 前另做 preview | AC-09：計算目標、讀回核對後回覆 | 分開 preview 與 alter 之間 offsets 會變，preview 無法保證；讀回核對才是真正的保證 |
| 結果未知需自動復原流程 | 保持 paused，operator 按 runbook 處理 | 罕見故障，人工處理比自動對帳安全且簡單 |
| M5：Java／Go SDK 同形 API | 各自 idiomatic | Java `subscribe()` handle、Go `Run(ctx)` 皆可取消 |
| M2：gateway retry 受 client deadline 限制 | 依 Kafka delivery timeout | client 逾時即結果未知，at-least-once 已涵蓋 |

## 驗證與完成規則

每個 AC 標 PASS/FAIL/NOT RUN，保留實際命令、來源 commit、測試名稱與 CI URL；未跑不可寫通過。
全部 AC 在同一 commit 通過、必要 CI 綠燈並正常合併後，建立 annotated `usable/ojbquay/vX.Y.Z`。
步驟見 [specification-map](docs/specification-map.md#到主線驗收的路徑)。
