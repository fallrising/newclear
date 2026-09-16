# mkfk — Enhanced SDD (CSR: Code / Cursor Spec Ready)

- Version: 0.2.0-csr
- Date: 2026-09-15
- Status: **implementation-ready contract for LLM / agent coding**
- Parent baseline: [`SDD.md`](SDD.md) v0.1.0 + [`docs/sdd/`](docs/sdd/)
- Component: `systems/mkfk`
- Language: 繁體中文 + 必要英文術語；契約欄位與識別符一律英文

> **權威規則**
>
> 1. 本文件是給實作者（含 LLM）的**單一落地規格**。
> 2. 安全語意以本文件 §4 不變量為準；若與基線章節衝突，以**更嚴格者**為準，並開 ADR。
> 3. 基線 [`SDD.md`](SDD.md) 與 [`docs/sdd/*`](docs/sdd/) 仍是設計論證與來源；實作時優先讀本 CSR。
> 4. 一次只做一個 milestone；未 `VERIFIED` 不得宣稱完成或跳過依賴。

---

## 0. 架構師點評（對基線 SDD v0.1）

### 0.1 總評

基線 SDD 在教學型 distributed log 規格裡屬於**上乘**：不變量清楚、故障邊界誠實、Raft/ISR 分工刻意且可驗證、milestone 與 acceptance ID 可追蹤。多數「Kafka 教學規格」會在選主、HW、冪等、timeout 語意上含糊；本案沒有。

### 0.2 優點（應保留）

| 面向 | 評價 |
| --- | --- |
| 語意詞典 | offset / Raft index / LEO / HW / ISR / timeout=unknown 邊界清楚 |
| ADR-002 | 固定 Raft voters + 額外 ISR ack gate，避免「假 consensus」 |
| INV 集合 | 可直接映射到測試 oracle；適合 deterministic model testing |
| 里程碑閘門 | M0→M7 依賴正確；禁止 election-only 冒充 replicated log |
| 誠實範圍 | 明確非目標、非 production SLA、非 Kafka wire 相容 |
| Agent 契約 | `AGENTS.md` 的改動邊界與證據要求適合 monorepo 多 agent |

### 0.3 缺口（本 CSR 補齊）

| 缺口 | 風險 | CSR 對策 |
| --- | --- | --- |
| 規格分散 7 檔 | LLM 漏讀導致錯誤實作 | 單檔自洽 + 明確「讀什麼／寫什麼」 |
| JSON Schema / golden 延後到 M0 | 實作時發明不相容格式 | §8–§11 給出可編碼契約與固定 vectors |
| Peer RPC 傳輸層未定 | transport 各自發明 | §9 固定 peer 為 HTTP/JSON on peer listener |
| Go 介面簽名不足 | 模組邊界漂移 | §7 給出 package 樹與 interface 契約 |
| `cluster.json` 缺完整 schema | 拓撲不一致 | §6 完整 schema + digest 規則 |
| Composition / boot 順序缺失 | 啟動 race、lock 誤用 | §12 boot sequence |
| ISR window vs election timer 交互僅口頭 | flaky liveness tests | §10.4 固定參數與測試約束 |
| LLM prompt 不足 | agent 一次做太多 | §15 每 milestone 可複製任務卡 |

### 0.4 刻意不改的設計決策

- 不改成 Kafka-compatible protocol
- 不引入第三方 Raft library / 外部 DB 作為 truth
- 不把 ISR 變成 voter set
- 不提供 `acks=0/1`、transactions、retention
- 不放寬 timeout=unknown

---

## 1. 產品定義與成功標準

### 1.1 一句話

mkfk 是可觀察、可測試、可故障重播的 **Kafka-inspired partitioned distributed log**（Go），核心保證是：成功確認的資料在 quorum 存活下可恢復；consumer 只見 committed prefix；重試與 rebalance 不會破壞協議狀態。

### 1.2 使用者故事（可驗證）

| ID | 故事 | 成功條件 |
| --- | --- | --- |
| US-01 | Produce batch 到 topic partition | 成功回覆含穩定 offset 區間；重啟後可讀 |
| US-02 | 從任意保留 offset replay | 不改其他 group；不刪已讀 records |
| US-03 | Kill 當前 leader | 多數可用時恢復；已成功確認 records 保留 |
| US-04 | Produce 回覆遺失 | 同 identity/epoch/sequence 重試不新增 record |
| US-05 | Member join/leave/fail | 同 generation assignment 完整不重疊；舊 generation 不可 commit |
| US-06 | Reviewer 查正確性 | 固定 seed 重播故障，對應到測試 ID 與 evidence |

**核心完成定義：** M0–M7 全部 `VERIFIED`（見 §14–§15）。文件本身不是功能完成證明。

### 1.3 範圍

**做：** Linux + POSIX FS；Go module；RF=1 或 RF=3 靜態拓撲；segmented WAL；sparse index；每 partition 完整 Raft；ISR 觀察 + `acks=all` gate；冪等 producer；round-robin consumer groups；HTTP/JSON API；CLI；metrics；fault tests。

**不做：** Kafka binary protocol / SDK 相容、ZK/KRaft、跨分区 transaction、動態 membership、retention/compaction/snapshot、compression、ACL/SASL、公網安全部署、Web UI。

**預設：** 單機 `min_isr=1`；三副本 `min_isr=2`。topic/partition/replica set **不可線上變更**；無 auto-create。

---

## 2. 文件優先級與變更規則

```text
INV / 本 CSR 安全語意
  > 本 CSR 的格式與 API 契約
  > 基線 docs/sdd 章節細節
  > roadmap 示例命令 / README 文案
```

- 改 persisted format、ack/HW/ISR、epoch、membership、API → 先 ADR + 升版 + golden vectors。
- 預設只改 `systems/mkfk/**`；根 CI / 根 README 索引為明確例外並在 PR 說明。
- 禁止用現成 Kafka/etcd/Raft library/SQL/Redis 替代教學核心。

---

## 3. 語意詞典（不可混淆）

| 名詞 | 定義 |
| --- | --- |
| record offset | partition 內從 0；已提交後永久不變 |
| Raft log index | 從 1；含 DATA/FENCE/NOOP/GROUP；≠ record offset |
| LEO | 下一個 data record offset（含未提交尾） |
| HW | 已 apply 的 committed DATA prefix 的下一個 offset（exclusive） |
| commit_index | Raft 已提交 internal index（inclusive） |
| group committed offset | **下一個**應處理的 record offset |
| ISR | 本 leader term 追上指定 tail target 的健康集合；**不是** voter set |
| 成功 produce | durable + Raft commit/apply + 捕捉的 ISR set A 全部 durable ACK |
| timeout | **結果未知**（可能已提交）；不是 rollback |
| 冪等 | 同 producer/partition/epoch/sequence 的 transport retry 不新增 records |
| at-least-once | process 後再 commit offset；crash 可能重處理 |

約束：`0 <= HW <= LEO`。v0.1 log start = 0。Fetch 只能回 `offset < HW`。未提交尾可在 leader 切換後消失並重用 provisional offsets，**不得**先對 consumer/producer 成功暴露。

---

## 4. 功能要求與安全不變量

### 4.1 Functional requirements

| ID | MUST | Milestone |
| --- | --- | --- |
| FR-01 | append batch、嚴格 offset、checksum、restart recovery | M1 |
| FR-02 | segmented log、sparse seek、index rebuild（正常 seek 不全掃） | M2 |
| FR-03 | durable term/vote、log matching、majority commit、fencing | M3 |
| FR-04 | ISR join/evict、HW、ack gate、quorum-loss 拒絕成功回覆 | M4 |
| FR-05 | partition-scoped epoch、sequence、durable dedup | M5 |
| FR-06 | membership、round-robin、generation fence、durable offsets | M6 |
| FR-07 | bounded HTTP API、CLI、metadata refresh、typed errors | M0–M7 |
| FR-08 | metrics、可重播 fault tests、三 broker e2e evidence | M7 |

### 4.2 Invariants

| ID | 不變量 |
| --- | --- |
| INV-01 | 成功回覆的 DATA 必須存在於未來成功 leader 的 committed prefix（在配置的多數穩定儲存未永久丟失前提下） |
| INV-02 | 單 partition committed DATA offsets 連續、有序、不可被 truncate 改寫 |
| INV-03 | consumer 不見未提交 record；NOOP/FENCE 不佔 data offset |
| INV-04 | 同 term 最多一個合法 majority leader；舊 leader 不得取得新寫入成功所需 quorum |
| INV-05 | durable vote 在回覆前落盤；同 term 不投兩人 |
| INV-06 | ISR 變小不改 Raft majority；ISR ≠ voters |
| INV-07 | batch 資料與 producer epoch/sequence 狀態可由同一 committed log 重建 |
| INV-08 | 當前 stable generation 中每訂閱 partition 恰一 assigned member；groups 互獨立 |
| INV-09 | stale generation / non-owner commit 必須拒絕；成功 offset 在 coordinator failover 後保留 |
| INV-10 | 尾端修復不越過 durable commit boundary；完整 checksum 錯誤 fail-closed |
| INV-11 | 任一 queue/frame/batch/long-poll/session 有上限；超限錯誤或 backpressure |
| INV-12 | 同一 data dir 僅一 process；cluster/node/config 不匹配拒絕啟動 |

---

## 5. 故障模型

**包含：** crash/restart、SIGKILL、RPC 延遲/丟失/重複/亂序、非對稱分割、pause、partial write、disk-full、fsync fail、損壞檔、reply loss。

**假設：** 非 Byzantine；成功 `fsync` 遵守平台合約；損壞偵測後停該 replica，不猜內容。

**保證內：** 單副本失效且剩餘多數最終可通訊 → 可恢復。兩副本不可用 → 停止需 quorum 的服務。

**保證外：** 多數磁碟永久丟失、惡意 peer、FS 虛報 durability、共同硬體損壞、真實拔電（`kill -9` ≠ power-loss）。

---

## 6. 靜態拓撲契約（`cluster.json`）

### 6.1 Schema（必須精確 UTF-8 bytes 一致）

所有節點分發**同一份檔案 bytes**。`config_hash = SHA-256(exact file bytes)`，hex lowercase。禁止各節點重新 marshal JSON 再算 hash。

```json
{
  "schema_version": 1,
  "cluster_id": "mkfk-dev-001",
  "storage_format_version": 1,
  "min_isr_default": 2,
  "brokers": [
    {
      "id": 1,
      "client_addr": "127.0.0.1:19091",
      "peer_addr": "127.0.0.1:19191",
      "admin_addr": "127.0.0.1:19291"
    },
    {
      "id": 2,
      "client_addr": "127.0.0.1:19092",
      "peer_addr": "127.0.0.1:19192",
      "admin_addr": "127.0.0.1:19292"
    },
    {
      "id": 3,
      "client_addr": "127.0.0.1:19093",
      "peer_addr": "127.0.0.1:19193",
      "admin_addr": "127.0.0.1:19293"
    }
  ],
  "topics": [
    {
      "name": "events",
      "partitions": 3,
      "replica_set": [1, 2, 3],
      "min_isr": 2
    }
  ],
  "internal": {
    "groups_topic": "__mkfk_groups",
    "groups_partition": 0,
    "replica_set": [1, 2, 3],
    "min_isr": 2
  }
}
```

**Standalone RF=1 profile：** 單一 broker；所有 `replica_set=[1]`；`min_isr=1`。

### 6.2 驗證規則

- `broker.id` 唯一、≥1；addresses 不重疊。
- topic name：`^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$`；不得以 `__mkfk_` 開頭（internal 除外）。
- `replica_set` 長度 = RF；元素皆為已知 broker id；排序不要求，但比較時正規化。
- `partitions` ∈ [1, 32]（每 broker user partitions 總數 ≤32，另加 1 internal）。
- 啟動時 manifest 內 `cluster_id` / `config_hash` / `node_id` / `storage_format_version` 必須匹配。

### 6.3 On-disk layout

```text
data/<node-id>/
  node.lock                 # OS advisory exclusive lock
  manifest.json             # storage_format_version, cluster_id, node_id, config_hash
  partitions/<topic>/<partition>/
    hardstate.json
    00000000000000000001.wal
    00000000000000000001.idx
    ...
```

Segment 檔名數字 = 該 segment **第一個 internal log index**（不是 record offset）。

`manifest.json` 例：

```json
{
  "storage_format_version": 1,
  "cluster_id": "mkfk-dev-001",
  "node_id": 1,
  "config_hash": "0123...abcd"
}
```

格式化：目錄必須為空、顯式 `mkfk format`；已有 manifest 只驗證不覆寫。

---

## 7. 程式架構（LLM 必須遵守的目錄契約）

### 7.1 Module

```text
module: github.com/fallrising/newclear/systems/mkfk
go: 由 M0 查核後固定支援中的 patch（寫入 go.mod + ADR-007）
```

### 7.2 目標目錄樹（實作時逐步建立，勿一次空殼灌滿）

```text
systems/mkfk/
  go.mod
  go.sum
  Makefile
  README.md
  AGENTS.md
  SDD.md
  SDD-enhanced-csr.md          # 本文件
  docs/sdd/…
  configs/
    cluster.rf1.json
    cluster.rf3.json
  schemas/
    http/                      # JSON Schema drafts
    wal/
  testdata/golden/
    wal/
    fingerprint/
    partition_hash/
  cmd/
    mkfk/main.go               # broker
    mkfkctl/main.go            # CLI
  internal/
    config/
    storage/                   # frame, segment, index, recovery, hardstate
    raft/                      # pure Step/Tick core
    partition/                 # actor, apply, ISR gate, pending writes
    producer/                  # epoch/sequence/dedup
    group/                     # coordinator state machine
    transport/
      clienthttp/              # public /v1
      peerhttp/                # peer RPC
      adminhttp/               # healthz/readyz/metrics
    observability/
    testkit/                   # fake clock, fault disk/net, seed runner
  pkg/
    client/                    # Go SDK
    api/                       # shared DTO + error codes
```

### 7.3 禁止耦合

| Package | 可做 | 禁止 |
| --- | --- | --- |
| `storage` | codec、append/sync、read、truncate、recovery | RPC、election、HTTP |
| `raft` | deterministic Step/Tick | 讀真實時鐘/socket/FS |
| `partition` | 單一 owner 事件迴圈、offset 分配、ISR gate | 管理其他 partition 排序 |
| `producer` | fencing/sequence/cache | 以記憶體成功代替持久結果 |
| `group` | membership/assignment/offsets | 宣稱外部 side-effect exactly-once |
| `transport` | bounded HTTP、錯誤映射 | 繞過 actor 改 state |
| `pkg/client` | retry、metadata refresh | unknown 後改 sequence |

### 7.4 核心介面（語意固定；方法名 M0 可微調但不可改語意）

```go
// internal/storage
type PartitionLog interface {
    Open(cfg OpenConfig) (RecoveredState, error) // 不自動 format
    AppendEntries(entries []LogEntry) (PersistToken, error)
    WaitPersisted(token PersistToken) error
    ReadEntries(fromIndex uint64, budget ByteBudget) ([]LogEntry, error)
    ReadRecords(offset uint64, hw uint64, budget ByteBudget) (FetchBatch, error)
    Term(index uint64) (term uint64, ok bool, err error)
    PersistHardState(hs HardState) error
    TruncateSuffix(fromIndex uint64) error // fromIndex <= commit_index => fatal
    Close() error
}

// internal/raft — pure
type Core interface {
    Step(ev Event) (Ready, error)
    Tick() Ready
}

// adapters inject: Clock, Rand, Disk, Transport
// Ready may contain: Messages, EntriesToPersist, HardState, CommittedEntries, RoleChange

// internal/partition
type Actor interface {
    Submit(cmd Command) (Future, error) // produce/fetch/admin; bounded queue
    ApplyCommitted(entries []LogEntry) error
    OnPersistComplete(token PersistToken, err error)
    SnapshotMetrics() PartitionMetrics
}
```

**硬性：** 不可用全域 mutex 包住網路等待或 fsync。每 partition 單一邏輯 owner；persistence completion 以 token/term 配回。送依賴持久性的 RPC 前必須先過 durability barrier。

---

## 8. Storage 契約（M1–M2）

### 8.1 WAL frame v1（big-endian）

| Order | Field | Bytes | Rule |
| --- | --- | --- | --- |
| 1 | frame_length | 4 | = `28 + payload_length` |
| 2 | crc32c | 4 | Castagnoli；涵蓋 version→payload 末；不含 length/CRC |
| 3 | format_version | 2 | =1 |
| 4 | kind | 1 | 1=DATA 2=NOOP 3=FENCE 4=GROUP |
| 5 | flags | 1 | v1=0；未知拒絕 |
| 6 | log_index | 8 | 1..MaxInt64 連續 |
| 7 | term | 8 | 1..MaxInt64 |
| 8 | payload_length | 4 | UTF-8 JSON bytes |
| 9 | payload | var | 嚴格 schema |

整 frame = `32 + payload_length`，上限 **4 MiB**。長度先驗證再 allocate；溢位檢查用寬整數。

### 8.2 DATA payload（JSON；64-bit 用 decimal string）

```json
{
  "base_offset": "0",
  "record_count": 2,
  "append_timestamp_ms": "1730000000000",
  "producer_id": "90f67d4e-13c5-4a3c-8d62-443f1bbb1af4",
  "producer_epoch": "0",
  "first_sequence": "0",
  "batch_digest": "<hex sha256>",
  "records": [
    {"key_base64": null, "value_base64": ""},
    {"key_base64": "", "value_base64": "aGVsbG8="}
  ]
}
```

- M1–M4 fixture 可 `producer_id=null`；**M5 後對外 produce 禁止 null**。
- null key ≠ empty key；empty value 合法（非 tombstone）。
- Leader 分配 `base_offset=LEO`；count=k → offsets `[base, base+k)`。
- Followers **原樣**存 leader frame bytes；同 index/term 不同內容 = corruption。

NOOP payload：`{}`。FENCE / GROUP payload schema 見 §11。

### 8.3 Append / durability 順序

```text
validate → serialize + allocate offset → write-all → File.Sync
  → notify persistence completion
  → ONLY THEN count as self durable / reply follower success
```

- partial write：繼續寫剩餘；任何失敗 → partition `recovery-required`，不可在不明尾後 append。
- M1 storage success = **本機** durability；M3+ 對外 produce success 還需 replication/apply/ISR gate。
- `hardstate.json`：temp → sync temp → atomic rename → sync dir。先 sync WAL，再提升 commit_index。
- HardState 欄位：`version, current_term, voted_for|null, commit_index`。

### 8.4 Segments

- 預設 64 MiB；下一個完整 frame 放不下 → sync/seal → 以 next log_index 建新檔 → sync directory。
- Frame **永不**跨 segment。
- 啟動依檔名 + 連續 frame index；不依賴半更新 segment manifest。
- v0.1 **不刪**歷史；容量 soft limit 只拒絕新 user DATA。

### 8.5 Sparse index

- Anchor：每含 DATA 的 segment 至少記第一 DATA frame；之後距上一 anchor ≥ 4 KiB WAL bytes 再建。
- Entry：`base_offset:u64, file_position:u64, log_index:u64`（24B）。
- 檔案：`MKIX` + ver=1 + reserved=0 + entry_count + entries + crc32c。
- Seek：segment binary search → max `base_offset<=o` → 掃描 frames → 受 HW/budget 截止。
- Index 可丟棄；損壞則從 WAL 重建，**不得改 WAL**。

### 8.6 Recovery

可自動修：**僅** active segment 不完整尾 frame（長度不足或 EOF 落在 frame 中途），且最後完整 index ≥ durable commit_index。

Fail-closed：完整 frame CRC 錯、非法 version、sealed 損壞、中間缺口、commit floor > 有效 prefix。

### 8.7 TruncateSuffix

僅 Raft conflict 後呼叫。`from_index <= commit_index` → **fatal**。同步更新 LEO/anchors/pending。Reader 需 refcount / stable view。

### 8.8 Capacity

- User soft budget / partition：1 GiB；另留 64 MiB in-flight/control。
- Soft limit → `RESOURCE_EXHAUSTED`；磁碟不足 → 降 readiness，不刪 committed WAL。

### 8.9 M0 必備 golden vectors（固定 hex）

至少覆蓋：空 value、null vs empty key、多 record、NOOP、FENCE、GROUP、CRC 錯、length overflow。路徑：`testdata/golden/wal/`。

---

## 9. Protocol：Client / Peer / Admin HTTP

### 9.1 Listeners

| Listener | 用途 | 預設 |
| --- | --- | --- |
| client | `/v1/*` public API | loopback |
| peer | Raft RPC | loopback；不暴露公網 |
| admin | `/healthz` `/readyz` `/metrics` | loopback |

Body 上限 6 MiB；`Content-Type: application/json`（mutating）。未知欄位、重複 JSON key、壞 base64、非整數 → append 前拒絕。

64-bit（offset/index/term/epoch/sequence/generation）= **decimal string**。

### 9.2 Envelope

成功：`{"request_id":"...","data":{...}}`

錯誤：

```json
{
  "request_id": "…",
  "error": {
    "code": "REQUEST_TIMEOUT",
    "message": "The append outcome is unknown; retry the identical batch.",
    "retryable": true,
    "outcome": "unknown",
    "details": {"leader_id": 2, "leader_term": "8"}
  }
}
```

`outcome ∈ {not_applied, unknown, applied, not_applicable}`。

### 9.3 Error code → HTTP（完整表）

| HTTP | code | Client MUST |
| --- | --- | --- |
| 400 | INVALID_REQUEST / UNSUPPORTED_ACKS | 修正，不盲重試 |
| 400 | FETCH_BUDGET_TOO_SMALL | 提高 budget（仍 ≤ server cap） |
| 404 | UNKNOWN_TOPIC_OR_PARTITION | 不 auto-create |
| 409 | NOT_LEADER / NOT_COORDINATOR | refresh metadata；保留 identity/sequence |
| 409 | FENCED_PRODUCER / ILLEGAL_GENERATION / NOT_OWNER | 停舊 session |
| 409 | SEQUENCE_CONFLICT / OUT_OF_ORDER_SEQUENCE | 報程式錯；不換 sequence |
| 409 | DUPLICATE_WINDOW_EXPIRED | 不可當新 batch append |
| 409 | PRODUCER_BUSY / REBALANCE_IN_PROGRESS | bounded backoff / re-sync |
| 409 | OFFSET_OUT_OF_RANGE / OFFSET_REGRESSION | 明確處理 |
| 413 | REQUEST_TOO_LARGE / RECORD_TOO_LARGE | 縮小 |
| 429 | RESOURCE_EXHAUSTED | jitter backoff；保留 identity |
| 503 | NOT_READY / NOT_ENOUGH_REPLICAS / DEPENDENCY_UNAVAILABLE | deadline 內重試 |
| 503 | STORAGE_ERROR / CORRUPT_LOG | 退出可服務；不降 durability |
| 504 | REQUEST_TIMEOUT | unknown → **只重試原 batch** |

SDK backoff：50ms 起、上限 1s、jitter、受總 deadline 約束。

### 9.4 Public endpoints

| Method | Path | 結果重點 |
| --- | --- | --- |
| GET | `/v1/metadata` | cluster/config、brokers、topics、observed leaders/terms、coordinator hint |
| POST | `/v1/producers/open` | partition-scoped epoch（CAS） |
| POST | `/v1/produce` | base/last offset、next_sequence、duplicate、leader_term |
| GET | `/v1/fetch` | records、next_offset、HW、LEO、leader_term |
| POST | `/v1/groups/{g}/join` | generation、state |
| POST | `/v1/groups/{g}/sync` | assignment 或 waiting |
| POST | `/v1/groups/{g}/heartbeat` | state / rebalance hint |
| POST | `/v1/groups/{g}/leave` | membership 結果 |
| POST | `/v1/groups/{g}/offsets/commit` | 原子 commit |
| GET | `/v1/groups/{g}/offsets` | committed next-offset 或 null |

`acks` **只接受** `"all"`。

### 9.5 Peer RPC（本 CSR 定案：HTTP/JSON on peer listener）

路徑前綴 `/peer/v1/`：

| Method | Path | 對應 |
| --- | --- | --- |
| POST | `/peer/v1/request-vote` | RequestVote |
| POST | `/peer/v1/append-entries` | AppendEntries |
| POST | `/peer/v1/read-barrier` | ReadIndex / majority heartbeat confirm |

共用欄位：`cluster_id, config_hash, partition`（`{topic,id}`）, `term`, `rpc_id`, bounded payload。

**不得**只回 HTTP 200；body 必須含 algorithm-level `vote_granted` / `success` / `conflict_*` / `term`。允許重送、延遲、亂序；去重屬協議本身。

RequestVote  freshness：`(last_log_term, last_log_index)` lexicographic —— **禁止**用 LEO 或 ISR。

AppendEntries follower 順序（必須照做）：

1. 拒舊 term／錯 cluster/config；高 term → 持久化並退位
2. 驗證 prev index/term；衝突回 hint，不改 committed
3. 同 index/term 當重送；內容不一致 = corruption；衝突處截未提交 suffix 再 append
4. sync WAL/hardstate 後才 `success=true, matched_index`
5. follower commit ≤ `min(leader_commit, verified_match_index)`（verified = prev+本 RPC entries）

Heartbeat（無新 entry）也要驗證 prev。

---

## 10. Replication / ISR / HW（M3–M4）

### 10.1 Raft 規則（摘要）

- 每 user partition = 獨立固定 voter Raft group；`__mkfk_groups` 同機制、不對 user produce 開放。
- Core：`Step` / `Tick` 純函式；clock/rand/disk/net 全注入。
- Election timeout：600–1200 ms（測試用 fake clock + 固定 seed）；heartbeat 100 ms。
- 成 leader 後 append **本 term NOOP**；NOOP durable quorum commit + apply 前 = **未 ready**（拒 produce / open-producer / leader reads）。
- Commit：僅當 N 的 durable match 達固定 voters quorum **且** `term(N)==currentTerm`。舊 term 條目不直接推進。
- Persist vote/term **先於**送出依賴該狀態的 RPC。

### 10.2 LEO / HW 映射

```text
data_end(c) = last DATA in prefix index<=c 的 (base_offset + record_count)；無 DATA → 0
HW  = data_end(lastApplied)
LEO = data_end(local lastLogIndex)
lastApplied <= commit_index
consumer 可見 [0, HW)
```

**必備 fixture：** index1=NOOP, 2=DATA(0,1), 3=FENCE, 4=DATA(2)。commit/apply 到 3 時 HW=2（不是 3/4）。

### 10.3 ISR observation

- ISR = 本 term 健康追趕集合；leader 自身（healthy storage）∈ ISR。
- Peer 追蹤：`last_success_at, catchup_target_index, last_caught_up_at, durable_match_index`。
- 追上 **捕捉的** target 才更新 caught-up；不可每有一點進度就重設 lag timer。
- Freshness/lag window 預設 **2s**：超時無成功聯繫，或超時未追上 target → 移出 ISR。
- 新 term 清空 observations，重建 ISR。
- **ISR 不是 consensus membership。** RF=3 時即使 ISR={leader}，quorum 仍=2。

### 10.4 `acks=all`（mkfk 精確定義）

Admission 時要求 `|ISR| >= min_isr`，捕捉不可變集合 `A = current ISR`（含 leader）。

成功回覆 **同時**滿足：

1. entry 在固定 voters 上滿足 Raft commit 且已 apply
2. A 中每個 replica 本 term 確認 `durable matchIndex >= entry index`
3. handler 仍屬有效 leader operation（已知更高 term → 不可 success）

後來 ISR 縮小 **不**免除 A；新成員 **不**擴大已捕捉 A。A 中節點失效 → 可 `REQUEST_TIMEOUT`；retry 重新捕捉符合 min_isr 的 gate，等待**同一 entry** durability，**不再 append**。

- 尚未 append 且 ISR 不足 → `NOT_ENOUGH_REPLICAS`（確定未寫）
- append 後 timeout → `REQUEST_TIMEOUT` + `outcome=unknown`
- HW 由 Raft applied prefix 定義，**不由 A 定義** → timeout 資料仍可能可讀
- FENCE/GROUP/NOOP 只走 Raft majority，不受 user DATA 的額外 A gate 阻塞

### 10.5 Linearizable read barrier（Fetch）

v0.1 無 follower reads、無 clock lease。每次 Fetch：

1. 已有 current-term committed entry
2. 以唯一 read context 取得本 term majority heartbeat confirmation
3. 記 readIndex；等 `lastApplied >= readIndex`
4. 長輪詢醒來後，回覆前**重新**確認 barrier/role

隔離舊 leader 無法取得新 quorum confirm → 錯誤/timeout，不回「看似最新」資料。

### 10.6 典型故障期望（實作 oracle）

| 故障 | MUST |
| --- | --- |
| append 後、quorum 前 crash | 不宣稱成功；尾可能提交或被截 |
| quorum 後 reply 遺失 | consumer 可能已見；retry 同 offsets |
| leader 隔離，另兩台新 leader | 舊 leader 新寫入不可成功；已提交保留 |
| follower 長期落後 | ISR 驅逐；voter 不變；既有 A waiter 不自動放行 |
| 失去兩台 | 不降 RF 成功 |
| 全重啟磁碟保留 | 恢復；NOOP barrier 後服務；不 re-format |
| sync failure | 不 ACK durable；不計 match；隔離 replica |

---

## 11. Producer / Consumer（M5–M6）

### 11.1 Produce 請求例

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

限制：1–1000 records/batch；raw key+value ≤1 MiB/record；encoded frame ≤4 MiB；跨 partition 由 client 拆分。

### 11.2 OpenProducer / epoch

- Scope：`(cluster, topic, partition, producer_id)`
- `expected_epoch="-1"` → 建立 epoch 0；之後 CAS 當前 epoch → +1
- FENCE 與 DATA 同 WAL；durable quorum apply 後才回新 epoch
- 同 `request_id`+同參數 → 原結果；同 id 不同參數 → conflict
- 與同 producer pending DATA/FENCE **序列化**；busy → `PRODUCER_BUSY`

### 11.3 Sequence rules

| 收到 | MUST |
| --- | --- |
| epoch < current | FENCED_PRODUCER |
| epoch > current / 未 open | 拒絕（不自動接受） |
| seq == expected，無 pending | validate → append 一 DATA |
| 與 pending 完全相同 | coalesce waiter；不 append |
| 與 cache 同 seq/count/digest | 回同 offsets；重新滿足 ack gate |
| 同 seq/range 不同 count/digest | SEQUENCE_CONFLICT |
| seq > expected | OUT_OF_ORDER_SEQUENCE |
| 舊 seq 不在 cache / 不完整重疊 | DUPLICATE_WINDOW_EXPIRED / CONFLICT；禁止 append |

Cache：每 producer/partition 最近 **64** committed batch 結果。Producer IDs / partition ≤ **1024**；滿則拒新 ID；**禁止 silent eviction**。

### 11.4 Batch fingerprint（M0 vectors）

```text
ASCII "mkfk-batch-v1" || NUL
|| record_count: u32 BE
|| for each record:
     key_len: i32 BE  (null=-1, empty=0) || key bytes
     value_len: u32 BE || value bytes
→ SHA-256 hex
```

**不**含 append timestamp / offsets。

### 11.5 Client ledger（CLI MUST；SDK via hook）

跨 process retry 需持久：`cluster_id, producer_id, partition, epoch, next_sequence, pending_batch`。

順序：durable save pending → send → success 後 durable 更新 sequence 並清 pending。任一 crash 只能重送相同 batch。**禁止** timeout 後換 identity/sequence。

### 11.6 Partitioning（client）

- 指定 partition 優先
- 有 key：`FNV-1a-64(key) % partition_count`
- 無 key：client-local round-robin
- Retry **必須**保留首次選定 partition
- M0：固定 key→partition vectors

### 11.7 Fetch

- `offset` = 下一個要讀位置
- `offset < 0` 或 `offset > HW` → OFFSET_OUT_OF_RANGE
- `offset == HW` → 可 long poll 後空 records，`next_offset` 不變
- 首筆已超 budget → `FETCH_BUDGET_TOO_SMALL`（含 required_bytes），禁止空轉迴圈
- 有資料：`next_offset = last+1`

### 11.8 Consumer group

**Truth：** internal `__mkfk_groups` Raft log。不可只靠 consumer 本機 offset。

State machine：

```text
EMPTY → PREPARING(g+1) → ASSIGNING(g+1) → STABLE(g+1)
      → PREPARING(g+2) on join/leave/timeout/coordinator change
```

- BEGIN_REBALANCE commit 後，舊 generation offset commits **立即失效**
- Members SyncGroup(`revoked=true`) 後才算停止舊 assignment
- Assignment：排序 `(topic,partition)` 與 `member_id`；`members[i % n]`；確定性；全覆蓋不重疊；member>partition 允許空 assignment
- Heartbeat 1s / session 5s / rebalance 10s；timer 帶 term/generation token
- 新 coordinator term：Raft barrier 後要求重新加入；**offsets 保留**；舊 sessions 不沿用
- CommitOffsets：STABLE + owner；`existing <= new <= HW`；同 command 全成或全敗；提案前向 data leader 取 quorum-confirmed HW 證據

**明確：** assignment exclusivity ≠ 外部副作用 exactly-once。Stale worker 可能仍在跑；generation 只擋 stale commit。

FENCE payload 例：

```json
{"type":"FENCE","producer_id":"…","new_epoch":"1","request_id":"…","expected_epoch":"0"}
```

GROUP payload 例：

```json
{
  "type":"COMMIT_OFFSETS",
  "group_id":"g1",
  "member_id":"m1",
  "generation":"3",
  "request_id":"…",
  "offsets":[{"topic":"events","partition":0,"offset":"10"}]
}
```

---

## 12. Boot、資源預算、部署

### 12.1 Broker boot sequence

```text
1. Parse flags: --data-dir --node-id --cluster-json [--allow-insecure-bind]
2. Load cluster.json bytes → compute config_hash → validate schema
3. Acquire node.lock (exclusive); fail if held
4. If empty dir: require explicit format subcommand (do not auto-format on start)
5. Read/validate manifest vs node-id/cluster_id/config_hash/format
6. Open each partition log → recover WAL/hardstate/index (not ready yet)
7. Start raft cores + partition actors with injected adapters
8. Start peer listener → allow Raft traffic
9. Wait recovery; per-partition leader-ready is independent
10. Start client + admin listeners
11. readyz=true only if recovery OK and no fatal storage/config
    (readyz ≠ "I am leader of all partitions")
```

Shutdown：停止 admission → 排空有界 → sync → 釋放 lock；有界時間。

### 12.2 Resource caps（設計上限，非量測成果）

| Item | Default |
| --- | --- |
| raw key+value / record | 1 MiB |
| encoded WAL frame | 4 MiB |
| HTTP body | 6 MiB |
| records / batch | 1–1000 |
| encoded fetch response | 6 MiB |
| decoded fetch budget | 1 MiB default，cap 4 MiB |
| segment | 64 MiB |
| sparse index stride | 4 KiB WAL bytes |
| user partitions / broker | 32 + 1 internal |
| producer IDs / partition | 1024 |
| dedup cache | 64 batches / producer / partition |
| groups / cluster | 128；members / group 64 |
| pending req / partition | 256；decoded bytes ≤ 16 MiB |
| broker pending decoded | 64 MiB |
| long polls / broker | 256；max 5s |
| election / heartbeat | 600–1200 ms / 100 ms |
| producer timeout | 5s default，30s max |
| group heartbeat / session | 1s / 5s |
| partition disk soft | 1 GiB |

所有 bytes 用 binary units。複製、base64 decode、queue、response buffer 都算進 accounting。

### 12.3 Security posture（v0.1）

- 預設 loopback；client/peer/admin 分離
- 無 TLS/auth → **僅**受信任隔離教學環境
- 非 loopback insecure 需顯式 flag + 啟動警告
- 測試/container：non-root；named volumes；禁止對未知 host path 遞迴 chown
- Log **不**記 payload / credentials / 私有路徑

---

## 13. Observability（最低集合）

Metrics / events 至少含：

`role, term, leader_changes, durable_log_index, commit_index, last_applied, LEO, HW, isr_size, per_peer_lag, pending_ack_waiters, quorum_failures`

事件欄位：`cluster, node, topic, partition, term, request_id` —— **無** record payload。

ISR 轉換必須能對照 captured A、Raft commit、HTTP timeout，解釋「timeout 但仍可讀」。

---

## 14. 驗證契約（acceptance IDs）

完整 Given/When/Then 見基線 [`docs/sdd/04-validation.md`](docs/sdd/04-validation.md)。CSR 要求：**測試名稱必須含下列 ID**。

| Area | IDs |
| --- | --- |
| Storage | ST-01 … ST-09 |
| Replication | RP-01 … RP-11 |
| Producer | PR-01 … PR-07 |
| Groups | CG-01 … CG-07 |
| Ops/API | OP-01 … OP-06 |

Model testing 最低：M3/M4 每次 PR **100 seeds × 1000 events**；M7 可選 1000×10000。失敗保存 seed + event history。Safety 不以 wall-clock 推斷。

Evidence manifest 欄位：`milestone, commit, toolchain, commands, exit_codes, seeds, fault_schedule, assertion_ids, metrics_summary, limitations`。

---

## 15. Milestone 任務卡（給 LLM 直接執行）

狀態機：`NOT_STARTED → IN_PROGRESS → VERIFIED`。不可跳級。

### 全域約束（每張卡都適用）

```text
讀：AGENTS.md、本 CSR、對應基線章節
只改 systems/mkfk/**（必要時根 workflow，需 PR 說明）
不做：Kafka wire、transaction、UI、VPS 部署、force-push、合併他人 PR
證據：命令、exit code、seed、未做事項、下一任務
```

### M0 — Contracts & testkit

**目標：** 可依賴的格式／介面／測試骨架，不是 broker。

**建立檔案（最小集）：**

- `go.mod`（固定 Go patch + ADR-007）
- `Makefile`：`fmt-check` `vet` `test`（非空）
- `schemas/http/*.json`、`testdata/golden/**`
- `internal/api` 錯誤碼與 DTO
- `internal/testkit`：Clock、Rand、FaultDisk、FaultTransport、SeedRunner
- `configs/cluster.rf1.json` `configs/cluster.rf3.json`
- README 真實可跑命令

**驗收：** schema 正反例；frame `28+payload` / `32+payload`；fingerprint null/empty；path 邊界；若加 CI 符合 `docs/specs/monorepo-ci.md`。

**禁止：** 實作 Raft/broker 主路徑 stub 成假成功。

**可複製 prompt：**

> 實作 mkfk M0。讀 `systems/mkfk/AGENTS.md` 與 `SDD-enhanced-csr.md`。只建立 Go module、schemas、golden vectors、testkit adapters、非空 make gates。不要實作 broker/Raft/transactions。PR 列出命令與 exit codes。

### M1 — Durable partition log

**產物：** frame codec、write-all/sync、offset 分配、local read、hardstate、lock、torn-tail recovery。

**驗收：** ST-01–ST-05、OP-02。Demo：寫三 batch → kill → 讀回（只宣本機 durability）。

### M2 — Segments & sparse index

**產物：** rotation、index codec、bounded scan、rebuild、truncate 後修復。

**驗收：** ST-06–ST-09 + M1 regression。報告 comparisons / scan bytes / index size。

### M3 — Per-partition Raft

**產物：** RequestVote/AppendEntries、durable vote、conflict truncate、current-term majority commit、NOOP ready、ReadIndex、RF1/RF3、三 process driver。

**驗收：** RP-01–RP-07；100×1000 model seeds。Demo：三 data dir 複製 → kill leader → 兩台恢復已確認資料。

**禁止：** election-only 標完成；ISR 算 quorum；引入 Raft library。

### M4 — ISR / HW / ack gate

**產物：** catch-up tracking、ISR、min_isr admission、captured-A waiters、HW/LEO、unknown errors、committed-prefix fetch。

**驗收：** RP-08–RP-11；展示「A=3 掉一台 → quorum 已提交但原 req timeout → retry 新 gate 不重寫」。

### M5 — Idempotent producer

**產物：** OpenProducer/FENCE、epoch/sequence、64-batch cache、coalesce、public Produce、SDK retry、CLI ledger。

**驗收：** PR-01–PR-07。Demo：丟 reply → 重送 → consumer 只見一次。

**禁止：** timeout 後遞增 sequence / 換 producer ID；RAM-only dedup。

### M6 — Consumer groups

**產物：** durable join/sync/heartbeat/leave、round-robin、generation fence、CommitOffsets、failover、consumer SDK loop。

**驗收：** CG-01–CG-07。Demo：rebalance + kill coordinator；展示 process-before-commit 的 at-least-once。

### M7 — Integration & evidence

**產物：** 三 broker Compose（non-root、named volumes、loopback）、fault harness、OP-01–OP-06、benchmark baseline、架構短文。

**驗收：** 所有 FR/INV 至少一已執行測試 + evidence manifest。

### 命令契約（未來必須存在；缺失要失敗，不准假綠）

| From | Command |
| --- | --- |
| M0 | `make fmt-check` `make vet` `make test` |
| M1 | `make test-race` |
| M3 | `make test-model` `make test-integration` |
| M7 | `make test-chaos` `make bench` `make demo` `make demo-down` |

---

## 16. ADRs（繼承 + CSR 增補）

繼承基線 ADR-001…006（Go/HTTP、Raft+ISR、acks=all、單 WAL、單 coordinator、冪等≠交易）。詳見 [`docs/sdd/06-decisions-sources.md`](docs/sdd/06-decisions-sources.md)。

### ADR-007 — Toolchain pin at M0

Status: required at M0。固定受支援 Go patch、最小 Linux/kernel/FS 驗收環境；寫入 `go.mod` 與本 ADR。

### ADR-008 — Peer transport = HTTP/JSON v1

Status: accepted in CSR。Peer 與 client 同用 HTTP/JSON，降低實作面；未來 binary transport 屬 X3，另立 ADR。不宣稱與 Kafka protocol 相近。

### ADR-009 — Conservative captured-ISR ack set A

Status: accepted（重申）。可用性換可推理性；timeout≠未寫入。

---

## 17. Future tracks（非核心完成條件）

| ID | 內容 | 完成前不可宣稱 |
| --- | --- | --- |
| X1 | Transactions / LSO / isolation | transactional / E2E exactly-once |
| X2 | Retention / snapshots | 無界刪段安全 |
| X3 | Binary / Kafka subset / perf | Kafka client 相容或更快 |
| X4 | AuthN/Z、動態 membership、多機故障域 | 公網 production |

---

## 18. LLM 實作檢查清單（每次 PR）

- [ ] 對應 milestone 與 acceptance IDs 已列出
- [ ] 未改 INV / timeout=unknown / ISR≠voters
- [ ] 無全域鎖包 fsync/網路；有 fake clock
- [ ] 未知結果路徑有測試（reply loss）
- [ ] 舊 leader 隔離路徑有測試
- [ ] 無 payload 進 log；無真實 secrets 進 fixture
- [ ] 命令、exit code、seed、限制已寫在 PR
- [ ] 下一 milestone 交接明確

---

## 19. 與基線文件的關係

| 檔案 | 角色 |
| --- | --- |
| [`SDD.md`](SDD.md) | 原始設計基線 |
| [`SDD-enhanced-csr.md`](SDD-enhanced-csr.md) | **實作權威（本文件）** |
| [`docs/sdd/01-storage.md`](docs/sdd/01-storage.md) | Storage 細節論證 |
| [`docs/sdd/02-replication.md`](docs/sdd/02-replication.md) | Raft/ISR 細節論證 |
| [`docs/sdd/03-protocol-clients.md`](docs/sdd/03-protocol-clients.md) | API/producer/group 細節 |
| [`docs/sdd/04-validation.md`](docs/sdd/04-validation.md) | 完整 acceptance 表 |
| [`docs/sdd/05-roadmap.md`](docs/sdd/05-roadmap.md) | 里程碑敘事 |
| [`docs/sdd/06-decisions-sources.md`](docs/sdd/06-decisions-sources.md) | ADR 與來源 |
| [`AGENTS.md`](AGENTS.md) | Agent 改動與交接規則 |

---

## 20. 一句話交接

> 從 M0 開始：先鎖契約與 golden vectors，再依 ST→RP→PR→CG→OP 把不變量變成可重播測試；任何時候都寧可 `REQUEST_TIMEOUT`，也不要發明「大概沒寫進去」的成功路徑。
