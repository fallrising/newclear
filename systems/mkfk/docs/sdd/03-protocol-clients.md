# 03 — Protocol, producers and consumer groups

[回主 SDD](../../SDD.md) · Requirements: FR-05, FR-06, FR-07 · Milestones: M0, M5, M6

這是 mkfk HTTP/JSON v1，自訂 API 並不接受現有 Kafka SDK。完整 JSON schemas 及 golden request/response fixtures 由 M0 建立，本章規定其語意。

## 1. 通用 HTTP 契約

Client、peer、admin listener 分開。修改操作只接受 `application/json`，body 上限 6 MiB；未知欄位、重複 JSON keys、無效 base64、非整數數字、超界長度都在 append 前拒絕。offset、index、term、epoch、sequence、generation 這些 64-bit 值用 decimal string 傳輸；partition、bytes budget、timeout 等有小範圍限制的整數可使用 JSON number。

Client `X-Request-ID` 作 tracing；它本身不是 produce 去重鍵。需要 durable 操作冪等的 OpenProducer／group command 另外帶 body `request_id`。錯誤訊息不包含原始 payload 或 filesystem private path。

成功 envelope：`{"request_id":"...","data":{...}}`。錯誤 envelope：

```json
{
  "request_id": "example-request",
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "The append outcome is unknown; retry the identical batch.",
    "retryable": true,
    "outcome": "unknown",
    "details": {"leader_id": 2, "leader_term": "8"}
  }
}
```

`outcome` 為 `not_applied`、`unknown`、`applied` 或 `not_applicable`。寫入已 append 但尚無確定結果時只能標 unknown；read-only failure 為 not_applicable。相同 code 在不同執行階段的 outcome 必須正確，不可只依 HTTP status 推斷。

| HTTP | code | client 行為 |
| --- | --- | --- |
| 400 | INVALID_REQUEST / UNSUPPORTED_ACKS | 修正請求，不重送相同錯誤 |
| 400 | FETCH_BUDGET_TOO_SMALL | 增加 budget，仍不得突破 server cap |
| 404 | UNKNOWN_TOPIC_OR_PARTITION | 不 auto-create，檢查 manifest |
| 409 | NOT_LEADER / NOT_COORDINATOR | 更新 metadata，沿用原 identity/sequence 重試 |
| 409 | FENCED_PRODUCER / ILLEGAL_GENERATION / NOT_OWNER | 停止舊 session，重新取得有效身分／assignment |
| 409 | SEQUENCE_CONFLICT / OUT_OF_ORDER_SEQUENCE | 不自動更換 sequence 規避，回報程式錯誤 |
| 409 | DUPLICATE_WINDOW_EXPIRED | 無法再回復原結果；不得把舊 batch 當新 batch append |
| 409 | PRODUCER_BUSY / REBALANCE_IN_PROGRESS | 有上限的 backoff／重新 sync |
| 409 | OFFSET_OUT_OF_RANGE / OFFSET_REGRESSION | 明確處理，不默默跳到 latest |
| 413 | REQUEST_TOO_LARGE / RECORD_TOO_LARGE | 分批或減少資料 |
| 429 | RESOURCE_EXHAUSTED | bounded jitter backoff；保留 request identity |
| 503 | NOT_READY / NOT_ENOUGH_REPLICAS / DEPENDENCY_UNAVAILABLE | 在總 deadline 內重試，檢查 outcome |
| 503 | STORAGE_ERROR / CORRUPT_LOG | node/partition 退出可服務狀態；不得降 durability |
| 504 | REQUEST_TIMEOUT | outcome unknown 時只能重試原 batch，不能宣稱未寫入 |

`retryable=true` 不代表立即無限重試。SDK 預設 exponential backoff 50 ms 起、上限 1 秒、帶 jitter，並受總 delivery deadline 約束。NOT_LEADER 只是 hint，不以 HTTP redirect 自動重送到任意 URL；server 回傳的 broker ID/address 必須屬於已知靜態 topology。

## 2. Public endpoints

| Method / path | 主要欄位或查詢 | 結果 |
| --- | --- | --- |
| GET `/v1/metadata` | 無 | cluster/config identity、brokers、topics/partitions、observed leaders/terms、coordinator hint |
| POST `/v1/producers/open` | topic、partition、producer_id、expected_epoch、request_id | partition-scoped epoch |
| POST `/v1/produce` | topic、partition、producer_id、epoch、first_sequence、acks、records | base_offset、last_offset、next_sequence、duplicate、leader_term |
| GET `/v1/fetch` | topic、partition、offset、max_bytes、max_wait_ms | records、next_offset、high_watermark、log_end_offset、leader_term |
| POST `/v1/groups/{group}/join` | member_id、subscription、request_id | generation、state、coordinator_term |
| POST `/v1/groups/{group}/sync` | member_id、generation、revoked | assignment 或等待狀態 |
| POST `/v1/groups/{group}/heartbeat` | member_id、generation | 當前狀態／rebalance indication |
| POST `/v1/groups/{group}/leave` | member_id、generation、request_id | membership 移除結果 |
| POST `/v1/groups/{group}/offsets/commit` | member_id、generation、offsets、request_id | 同一次 command 的原子 metadata commit 結果 |
| GET `/v1/groups/{group}/offsets` | topic、partition，可批次 schema 化 | committed next-offset 或 null |

M0 固定 endpoint 的完整 request/response schema，不能新增未定義交易 API。metadata 中 leader 資料可過期；所有 authoritative request 仍由 leader/coordinator 自行驗證。user 不可用一般 endpoint 寫 internal topics。

只在 admin listener 提供 `/healthz`、`/readyz`、`/metrics`。healthz 表示 process event loop 活著；readyz 表示 recovery 完成且沒有 fatal storage/config 狀態，不代表這台 broker 是所有 partitions 的 leader。quorum / per-partition serviceability 另在 metadata/metrics 表示；每個 request 仍檢查自己的 ready barrier。

## 3. Produce 契約

以下是 M5 完成後的 schema 範例，現在尚無 executable endpoint：

```json
{
  "topic": "events",
  "partition": 0,
  "producer_id": "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
  "epoch": "0",
  "first_sequence": "0",
  "acks": "all",
  "records": [
    {"key_base64": "dXNlcjox", "value_base64": "aGVsbG8="}
  ]
}
```

成功 data 包含 `base_offset="0"`、`last_offset="0"`、`next_sequence="1"`、`duplicate=false`。batch 至少一筆，最多 1,000 筆；整批落在一個 DATA frame 中。請求跨多 partition 時由 client 拆分，沒有跨 partition 原子性。

nullable key 以 null 表示；空 key 以空字串表示；value 必填但可為空。raw key+value 每 record <=1 MiB，整個 encoded WAL frame <=4 MiB。record_count 由解析的 records 得到，不能信任 caller 自報數字。

## 4. Producer identity、epoch 與去重

### 4.1 身分作用域

`producer_id` 是 client 產生並保存的 UUID；epoch 與 sequence 的作用域是 `(cluster, topic, partition, producer_id)`。不同 producer IDs 發送相同 event 不會被當成重複；這不是業務 event_id 去重服務。

OpenProducer 使用 `expected_epoch` compare-and-set：第一次傳 `"-1"`，成功建立 epoch 0；後續明確 reopen 需提供目前 epoch，成功後 +1。FENCE command 與 DATA 使用同一 partition WAL，durable quorum commit/apply 後才回新 epoch。

相同 request_id、相同參數重送 OpenProducer 回原結果，不再加 epoch；同 request_id 不同參數回 conflict。保留該 producer 最近一次 FENCE request/result；若較新的 FENCE 已生效，舊 CAS 不得重演。超過 int64 上限拒絕，不能 wrap。

OpenProducer 與同 producer 的 pending DATA/FENCE 序列化；尚有未解決 operation 時回 PRODUCER_BUSY，而不是讓兩個 epoch 交錯。已在新 epoch FENCE 之前提交的舊 records 保留；FENCE 不刪資料。新 epoch 生效後的新請求必須 reject 舊 epoch。

### 4.2 Sequence rules

每 epoch 的第一筆 sequence=0。record count=k 的 batch 覆蓋 `[first_sequence, first_sequence+k)`。SDK 同 producer/partition 限制一個 in-flight batch；server 同樣防止 pipelined sequence 越過 unresolved batch。

對每個 producer/partition 保存 current epoch、next expected sequence、最近 64 個 committed batch 的 first_sequence/count/digest/offset range/internal index。狀態由 committed FENCE/DATA 重播；不做沒有持久證據的 silent eviction。每 partition producer IDs 上限 1,024，滿時拒絕新 ID。

| 收到請求 | server MUST 行為 |
| --- | --- |
| epoch < current | FENCED_PRODUCER |
| epoch > current 或從未 open | 拒絕未建立的 epoch，不自動接受 |
| sequence == expected，沒有 pending batch | validate 後 append 一個 DATA entry |
| 與 pending batch 完全相同 | 合併 waiter／重用 operation，不再 append |
| 與 cache batch 的 sequence/count/digest 相同 | 回相同 offsets；重新滿足此 retry 的 ack gate |
| 同 sequence/range 但不同 count 或 digest | SEQUENCE_CONFLICT |
| sequence > expected | OUT_OF_ORDER_SEQUENCE |
| 舊 sequence 不在 cache 中，或不完整重疊 | DUPLICATE_WINDOW_EXPIRED / SEQUENCE_CONFLICT，禁止再次 append |

batch fingerprint 不直接 hash JSON 字串。格式：ASCII `mkfk-batch-v1` 加一個 NUL byte、record_count big-endian uint32；依序加入每筆 key length int32（null=-1，empty=0）及 key bytes、value length uint32 及 value bytes，再 SHA-256。leader 分配的 append timestamp／offset 不參與 fingerprint。M0 建立固定 vectors。

### 4.3 Durable state 與 unknown outcome

Leader 提案時可保留 speculative producer reservation，但只有 committed apply 才更新正式 state。截斷未提交 tail 時清除 reservation；新 leader 在 current-term barrier 後重建正式 state，再處理 retry。

SDK 成功後才增加 sequence；timeout、connection loss、leader change 後保留原 ID/epoch/sequence/records，不能用新 identity 把未知結果變成另一筆請求。

若需跨 client process restart 重試，應保存 outbound ledger：cluster ID、producer ID、partition、epoch、next sequence、pending 原始 batch。CLI 必須提供此持久模式；Go SDK 透過 persistence hook 由呼叫者提供。沒有保留 ledger 的 caller 不可宣稱跨 session retry exactly-once。

CLI 在發送前 durable 保存 pending batch，成功後再 durable 更新 sequence 並清除 pending；client crash 任一切點都只能重送相同 batch。明確重新 open epoch 是管理動作，不是自動 timeout recovery。

## 5. Fetch 與 partitioning

Client 可明確指定 partition；未指定時，有 key 使用 FNV-1a 64-bit unsigned hash 對固定 partition_count 取餘數，無 key 以 client-local round-robin。M0 建立 key → partition vectors。這不是 consistent hashing，也不承諾日後改 partition_count 還維持原 mapping。

Retry 必須保留第一次選定的 partition；不能每次重試重新 round-robin。只保證 partition 內排序，不保證跨 partition 或不同 producer 的業務時間順序。

Fetch offset 是下一個要讀的位置。`offset < 0`、`offset > HW` 回 OFFSET_OUT_OF_RANGE；`offset == HW` 可 bounded long poll 後回空 records，next_offset 仍等於原 offset。v0.1 start offset=0，沒有 silent earliest/latest reset。

budget 以 raw record key+value bytes 計，另設 encoded response cap 和 records count cap 1,000。第一筆 record 就超過要求 budget 時回 FETCH_BUDGET_TOO_SMALL（包含 required_bytes），而不是回空且不前進的無限迴圈。server 不為單一大 record 悄悄突破 cap。

有 records 時 next_offset 為最後一筆 offset+1；空回覆維持請求 offset。回覆 HW/LEO 不授權 consumer 讀 HW 以後。實際線性化／長輪詢條件見 [02](02-replication.md)。

## 6. Consumer group coordinator

### 6.1 Durable state

一個 internal `__mkfk_groups` Raft partition 管理所有 groups。每 group 保存 subscription、generation、members、assignment、committed next-offset map；GROUP entry 包含 command type、request_id、expected generation 和必要參數。

核心版不刪 group、不改既有 group 的 subscription；新需求使用新 group_id。group/member IDs 長度 1–64 bytes，僅允許安全 ASCII token；最多 128 groups、每 group 64 members。第一位 member 確立 subscription，後續成員必須完全相同。

membership 變更、generation、assignment 及 offset commit 都經 replicated command。每個 member 保留最近一次各類 mutating request/result 用於 retry；舊 request 不得绕過 current generation check。

heartbeat 的 monotonic last_seen 可為本 leader term 的 volatile 狀態；新 coordinator leader 先完成 Raft barrier，再為既有 active groups 持久化新 generation／重新加入要求，完成前不提供一般 group service。舊 sessions 不跨 coordinator failover 沿用，committed offsets 則保留。

### 6.2 Rebalance state machine

```text
EMPTY
  -> PREPARING(g+1)
  -> ASSIGNING(g+1)
  -> STABLE(g+1)
  -> PREPARING(g+2) on join/leave/timeout/coordinator change
```

BEGIN_REBALANCE commit 後，舊 generation 的 offset commits 立即失效。coordinator 通知成員停止取得新工作並 revoke 全部舊 assignment；members 用 SyncGroup(revoked=true, current generation) 表示已停止使用舊 assignment。

當前候選 members 都 sync-ready，或 rebalance deadline 過後已將不回應者以新的 durable membership/generation 變更移除，才可計算 assignment。SET_ASSIGNMENT committed/apply 後才回 STABLE；舊 generation 的遲來 sync 不改狀態。

排序所有 `(topic, partition)` 與 member_id，對第 i 個 partition 分配 `members[i % member_count]`。因所有成員 subscription 相同，驗證 mapping 全覆蓋、不重複，member 數大於 partition 數時允許空 assignment。每次分配是確定性的。

session timeout 預設 5 秒、heartbeat 1 秒；rebalance timeout 預設 10 秒。timers 只在 coordinator active term 運作，舊 timer callback 帶 term/generation token，失效後不能移除新 session。

### 6.3 Offset commit 與處理語意

Consumer 正常循環是 fetch → process → commit next offset。CommitOffsets 必須在目前 STABLE generation 且 caller 擁有所有指定 partitions。對每個 offset 要求 `existing_commit <= new_commit <= partition committed HW`；無既有值視為 0。相同值為 idempotent。

Coordinator 在提案前向 data leader 取得 quorum-confirmed HW 證據；若該 partition 不可讀且無足夠的既有安全證據，回 DEPENDENCY_UNAVAILABLE。因本版不刪 committed prefix，已知可信 HW 可當 lower-bound proof，不可用 local LEO 取代。GROUP command apply 時再次驗證 generation/ownership，處理提案與 apply 之間的 rebalance race。

同一個 CommitOffsets command 中的 offsets 要全成功或全失敗，經 durable group quorum apply 後才回 success。這只是 metadata 的原子更新，不是資料輸出與 offsets 的跨分區 transaction。

GROUP state 是 truth；不能只在 consumer 本機保存 offset 就宣稱 coordinator failover 可恢復。

### 6.4 Assignment 不等於外部執行鎖

普通 Fetch 是 offset-based read，不是 ACL。group SDK 遵守 assignment，但舊 process 可能仍在處理已取得的資料；網路分割也無法撤回已發出的 response。generation fencing 防止 stale offset commit，不能保證外部資料庫、HTTP call 等副作用只執行一次。

SDK 必須停止 stale generation 的新工作，拒絕提交其結果。需要端到端 exactly-once 的業務必須另建下游 idempotency/transaction 設計；本案不把一次 assignment 當成一次副作用的保證。

## 7. Peer RPC contract

peer listener 至少支援 versioned RequestVote、AppendEntries、ReadBarrier/heartbeat context；共用 identity、term、rpc_id、bounded envelope。peer responses 不能只回 HTTP 200，必須保留 algorithm-level success/conflict/term。細節由 [02](02-replication.md) 決定。

core 不得直接依赖 HTTP connection lifetime 保證恰好一次傳送。所有 RPC 允許重送、延遲與重排，duplicate handling 必須是 protocol 自身的一部分。

## 8. 明確尚未提供

沒有 BeginTransaction、CommitTransaction、AbortTransaction、read_committed transaction isolation 或 last stable offset API。此處的 HW 是 replicated-data visibility boundary，不是 transaction LSO。擴充方向見 [05](05-roadmap.md) 的 X1。
