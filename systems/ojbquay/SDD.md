# Ojbquay 主線 SDD

狀態：**提案，待 owner 同意；尚未鎖定或取得可用資格。**
需求：T-0368；修復入口 [#445](https://github.com/fallrising/newclear/issues/445)。
參考實作：`0aac18413a3b39043706f17b8e5f801f41573d70`。
本文件是依現存產品文件、程式與測試重新制定的主線契約，**不是找回的原始 SDD**。
搜尋範圍、來源、實跑結果與尚缺證據見 [SDD 報告](docs/test-reports/mainline-sdd-20261022.md)。

## 用途與目標

讓應用擁有者透過一個管理介面建立 topic、group、subscription，使用 Java／Go
gRPC SDK 發送消息，選擇 HTTP push 或高階 pull 接收，並能處理延遲、取消、重試、
死信與重播。使用者不必直接管理 Kafka；發送確認、處理確認與可能重送必須有明確語義。

本次目標是把已承諾的 Kafka-first v1 主線變成可逐項驗證的固定 AC，讓下一次修復有
明確成功條件。功能存在、測試通過、主線可用、owner 驗收及正式部署是分開的事實。

## 主線範圍與邊界

- 自助資源管理、權限與 audit、版本化配置發布、Last Known Good（LKG）。
- 同步 producer ACK 與拒絕語義；Java／Go SDK；HTTP push 與 Kafka Share pull。
- 已有 shadow/tag/CEL/transit 處理、同 key 有序 push、有限資源與 backpressure。
- durable delay、取消、有限 recurrence、retry、DLQ／replay；保留 AC-05 strict 時序。
- 已有 console 的登入、建立資源、預覽、消息／delay／DLQ 操作、classic offset reset，
  以及本機 Compose 的真實核心流程與最小觀測入口。

非目標：exactly-once side effects、broker fork、RocketMQ／Thrift adapter、可執行使用者
pipeline、Redis/HBase/HDFS sink、跨區／HA、usage billing、cron／無限 delay recurrence、
新 UI 設計、OIDC／secret-manager 選型、production deployment、容量或吞吐量認證。
舊文件提及的 production load gate 沒有在此被宣告通過；本文件只接受本機功能主線。
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

- REST `/api/v1`、`proto/ojbk/v1`、`dev.ojbk.*` 保持既有介面；本提案沒有 schema、
  runtime dependency 或 namespace 變更。
- 全路徑 at-least-once；客戶端以自然 key／inbox 處理重複。replay 是明確的再次發送。
- PULL ACK=ACCEPT、NACK=RELEASE；token 唯一、single-use，回到發出 token 的 gateway。
  v1 多實例需要 affinity。lease 到期／斷線可重送，delivery count 可見。
- schedule/cancel 成功只表示 Kafka 已接受命令；PG 套用是非同步。相同 delay ID
  first-write-wins。CANCEL 先取得 pending row 時不發送；dispatch 先鎖住時容許當次發送。
- 預設 direct threshold=0，不提早發送。positive threshold 是既有明確 opt-in，
  **不能用在本次驗收或 AC-05**。有限 recurrence 最多 10,000 次；首次／間隔最多 30 天。
- message value 上限 4 MiB；poll/claim/inflight 各自使用現有設定上界，單 worker 不超過
  500 records；DLQ browse 最多 500、sample 1..100。預設 logs 不含 payload 或 credentials。
- classic offset reset 要 pause、全部 runtime 確認停止 fetch、inflight drain 或明確 abandon、
  broker group quiet、preview、alter、verify、audit、restore；缺任一安全前提不改 offset。
  Share group reset/progress 回覆 UNSUPPORTED，不虛構 offset。

### Retry 計時：保留契約，不以實作反推驗收

AC-05 測量的是相鄰 HTTP endpoint 收到完整 request body 的時刻，包含首次交付 →
第一次 retry。沿用 #445 strict test 的四次 HTTP 503 fixture，不插入暖機交付，不減去
HTTP、Kafka、PG 或排程成本；不改平均值／百分位、不把第一段排除。

現有 `PushRecordHandler` 在 `http.deliver` 返回後才呼叫
`clock.instant().plusMillis(delay)`。這是**實作事實**，不代表已核准把 AC-05 起點改到
response 結束。驗收的到達間隔與 scheduler 的 durable `due_at` 是不同觀測點，兩者都要
記錄。仍須 no-early durable dispatch；不能把 due_at 往前移而不提交契約差異。

## 固定驗收條件

AC-01～AC-05 延用 [SUCCESS](SUCCESS.md) 的既有編號；AC-06～AC-11 只補既有
product-spec/M2～M6 已承諾、原五列未獨立列出的行為。編號不得重用或隨修復改名。
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
`DefaultKafkaDlqOperationsTest`、`DlqApiIntegrationTest`。一般 delay 一秒容差不能替代 AC-05。

### AC-05 — 原 strict retry timeline

**Given** 現有 unordered Share PUSH fixture、真 HTTP/Kafka/PG、`[150,300,600]`、HTTP endpoint 每次回 503，**When** 第一筆
消息產生四次請求，**Then** 相鄰到達間隔依序滿足 `150 ≤ Δ1 < 180 ms`、
`300 ≤ Δ2 < 360 ms`、`600 ≤ Δ3 < 720 ms`，同時 AC-04 durable/no-early 條件成立。

驗證：#445 候選 `PushRetryE2eTest.schedulesThreeRetriesThenWritesFourthFailureToDlq` 的
strict assertions。保留完整四次 timestamp、三段 interval、command due／ingest／dispatch
資料及來源 manifest。沿用現有毫秒量測定義，不新增暖機、扣除成本或統計平均。
main 舊測試的 `[140,1150] / [290,1300] / [590,1600]` 只能作功能參考，不能接受此 AC。

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
歷史 Kafka 啟動失敗未找到退出根因；一次 PASS 只證明該次未重現。

### AC-09 — Classic offset reset 的硬性閘門

**Given** owned classic ordered subscription，**When** preview/reset，**Then** pause 發布、
**所有 runtime 確認 fetch 已停止且 inflight 已 drain 或明確 abandon**，再確認 broker group quiet，
preview 目標後才 alter，讀回 broker offset 核對、audit 並恢復先前 state。任一 runtime 尚未確認
pause 或60 秒內未 quiet 都不能改 offset。PULL／unordered Share 回覆 UNSUPPORTED。未授權者不能執行。

驗證：`TopicApiIntegrationTest.resetsClassicOffsetsOnlyAfterTheGroupIsQuietAndRestoresState`
加真 broker group active/empty、runtime 未確認、inflight 未清空與 alter 後讀回 case。
現有 `DefaultGroupOperations.awaitEmpty` 只觀察 EMPTY/DEAD／不存在，不能自動推論所有 runtime
及 inflight 均確認；現有 reset 返回計算目標，未讀回 broker offsets。這些是實作／驗證缺口，
**不是把原硬性閘門改成 quiet-only 的批准**。mocked `GroupOperations` 不足以證明完整閘門。

### AC-10 — 自助 console 核心操作

**Given** 1280 px／390 px browser，**When** 登入、建立 topic/group/subscription、預覽
filter/transit、送 test message、查 delay、browse/replay DLQ、登出，**Then** 操作有可見
成功／失敗與 desired version；預覽不寫 broker；未登入導向 login、非 OPS/ADMIN 禁止管理頁。
消息內容只在明確使用者操作後顯示，payload/credential 不進預設 logs。

驗證：`pnpm test`、`pnpm build`、`pnpm e2e` 既有 MSW/Chromium journey 加真 stack 操作；
固定 AC 對應 runtime API 測試。mock golden path 不冒充真端到端操作。

### AC-11 — 可重現本機啟動與核心流程

**Given** README/runbook 所列 JDK25、Node24、Docker Compose、合成配置與獨立測試資源，
**When** `make validate-deploy`、`make e2e`／`make demo`，**Then** 十一服務核心流程完成：
readiness、session/CSRF、資源建立、真 gRPC ACK、exact HTTP payload、success metric、
Prometheus scrape；退出後只清除本次 fixture 資源。版本與設定摘要足以重跑。

驗證：native build、deploy model checks、真 Compose 與 Java↔Go interoperability。
對應來源 SHA 必須明確；較早來源證據要附 source delta，相關程式變更需補跑。

## 舊契約對照、明確差異與待確認事項

| 來源原文／既有行為 | 本提案如何處理 | 差異與影響 |
| --- | --- | --- |
| product-spec：「create a topic and subscription, send through a stable gRPC SDK, receive by HTTP push or high-level pull」 | AC-01/02/03/10/11 | 保留原用途，補可觀測輸出與固定 ID，沒有新增產品線 |
| SUCCESS AC-01～05 | 原 ID 與行為保留；增加 AC-06～11 對應其他既有承諾 | 不是縮小五列或宣布 historical=pass；新列揭露現有驗證缺口 |
| M4：「`<20%` end-to-end timeline target for a 150 ms retry」；「warm Testcontainers runs」 | AC-05 保留 #445 strict 到達間隔與首次交付 | warm 是歷史觀察，不是豁免。舊 main E2E 寬容差與嚴格目標的差異公開，不能互換 |
| handler：「`clock.instant().plusMillis(delay.getAsLong())`」（在 http.deliver 返回後） | 記為實作事實；不改為 attempt-start，也不把量測起點改成 response-end | 起算點修訂**未提出為本次變更、未獲批准**。需修訂時另列原文、原因、數值影響與 owner 決定 |
| M3：「fire it within ±1 second」；預設 threshold zero | AC-04 同時要求 no-early 與 due 後一秒 | 保留既有 no-early 預設；不能用一般 delay 容差放寬 strict retry |
| M6：「Production secret distribution, TLS certificate issuance, or a managed Kubernetes operator」為 non-goals | 保持本機功能範圍，保留既有模型驗證 | 沒有正式部署、HA 或容量承諾；舊 load-gate 沒有改成通過 |
| product-spec：「when any runtime has not confirmed pause, then no broker offset changes」；messaging-semantics 要全部 runtime 停 fetch、inflight drain/abandon、verify | AC-09 全部保留 | M6/current code 的 broker EMPTY/DEAD 觀測不能取代原條文；缺 runtime/inflight confirmation 與讀回證據，未批准 quiet-only 修訂 |
| 原始 normative SDD 僅有引用、未找回 | 此文件作新的可審查主線規範 | **須 owner 同意此具體 SDD 及固定 AC**，不是要求提供原件；批准文件也不代表產品或失敗 AC 已驗收 |

最新 desk operating-method §0 N3：「卡沒有 `spec` 就先開 SDD PR，等你合併」；§6：
「修改運作方法、`AGENTS.md` 或 SDD 的 PR 仍等你同意後才合併」。本次 owner 授權制定
文件與正常交付，沒有批准未見過的具體 AC 或 retry 語義變更；因此先交付具體 PR，
等同意後才鎖定、合併與進入依 AC 的修復。沒有要求 owner 找原始 SDD。

## 驗證、任務與完成規則

實跑 evidence 在 [報告](docs/test-reports/mainline-sdd-20261022.md)；每個 AC 分別標
PASS/FAIL/PARTIAL/NOT RUN，保留實際命令、來源、測試名稱與 CI URL。尚未執行的預期結果
不可寫成實測。桌面規則要求鎖定前實跑；本提案將缺少 case 明列為鎖定／完成缺口，
不因寫好文件自動滿足它。

批准後先建立 [任務板](docs/tasks/BOARD.md) 的 AC 對應可執行測試（名稱含 `AC_01` 等
固定 ID），再沿用現有 #445 修復候選，依 Red-Green-Refactor 補必要缺口。既有測試映射
是參考證據，尚未假稱已完成 AC 命名的 executable suite。昂貴真 stack/fault checks 手動跑、
保存指令與結果；不藉此刪除現有必要 CI 或搬走失敗檢查。

只有全部主線 AC 通過、必要 CI／獨立審查通過、版本有對應啟動與核心流程證據且完成
正常合併，才能按當次 owner 授權建立新 annotated usable tag。現在 `usable_tag: none`。
T-0368 維持 `in_progress`，owner 驗收另計；mkfk 等後續項目不因本 SDD 展開。
