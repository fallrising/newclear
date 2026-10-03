# mkfk

> **Portfolio doc tier: B (maintain / public contract)** — Keep the contract usable; do not expand into a second product line without an owner override. Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


Kafka-inspired distributed log，透過實作理解分區儲存、複製、冪等生產與消費群組。

**狀態：M0–M5 已驗證；M6–M7 尚未實作。** 現有程式提供 segmented durable WAL、sparse-index read、RF1/RF3 per-partition Raft、ISR/HW/captured-ack controller，以及 durable idempotent producer、HTTP adapter、Go client 與 ledger CLI；目前仍沒有可啟動的 broker server、consumer groups、production-ready 保證或 Kafka client 相容性。精確狀態見 [implementation status](docs/STATUS.md)。

## 從這裡開始

1. **[Enhanced CSR SDD](SDD-enhanced-csr.md)（實作權威）：** 給 LLM／agent 落地用的單檔契約（介面、schema、peer RPC、milestone 任務卡）。
2. [SDD 主文件](SDD.md)：目標、範圍、架構、不變量與文件優先級（設計基線）。
3. [教學對照、設計決策與來源](docs/sdd/06-decisions-sources.md)：六個教學任務的映射，以及 mkfk 與 Apache Kafka 的刻意差異。
4. [開發里程碑](docs/sdd/05-roadmap.md)：M0–M7，每個階段的輸入、產物、驗收與禁止越界事項。
5. [Agent 工作規則](AGENTS.md)：交接、改規格、測試證據與 monorepo 修改邊界。

## 規格章節

| 文件 | 開發時解決的問題 |
| --- | --- |
| [儲存](docs/sdd/01-storage.md) | append-only WAL、record offset、segment、sparse index、fsync、crash recovery |
| [複製](docs/sdd/02-replication.md) | 每分區 Raft、選主、衝突截斷、ISR、HW、ack 與分裂腦防護 |
| [協定與客戶端](docs/sdd/03-protocol-clients.md) | HTTP/JSON 契約、producer fencing/dedup、consumer group generation 與 offset commit |
| [驗證](docs/sdd/04-validation.md) | requirement → test 對照、故障注入、模型測試、安全界線與量測方法 |

實作語言為 Go；`go.mod` 固定 Go 1.27.1 toolchain。Linux 本機檔案系統為 durability 驗收平台，最低環境與限制記錄於 [ADR-007](docs/adr/007-m0-toolchain-platform.md)。這是設計選擇，不是宣稱教學強制使用 Go。

## M0 可執行內容

- `internal/storage`：WAL frame v1、sparse index v1 codec、CRC32C、長度與 overflow 邊界。
- `internal/config`：strict static topology、exact-byte SHA-256、storage identity 與資源 cap 驗證。
- `internal/protocol`：decimal-string、strict JSON/base64、produce/fetch/group request contracts、batch fingerprint 與 FNV-1a partitioning。
- `internal/adapters` / `internal/testkit`：clock、random、network、filesystem interface，以及 manual clock、scripted random/fault transport。
- `api/schemas` / `testdata/golden`：完整 public endpoint contract、config schema、正反例與固定 binary vectors。

執行 M0 gates：

```bash
make fmt-check
make vet
make test
make test-race
```

目前仍刻意沒有 `cmd/mkfk` 或長時間執行的 broker process。M5 已加入 producer HTTP handler；其他 transport wiring 必須依後續 milestone 驗收順序加入。

## M1 durable storage

`internal/storage` 現在提供：

- explicit empty-directory format、exact topology identity 與 Linux advisory data-dir lock；
- `O_NOFOLLOW` 的本機 filesystem adapter，避免 final path component symlink traversal；
- 單 partition append、partial-write write-all、成功前 `File.Sync` barrier；
- temp write → sync → rename → directory sync 的 atomic `hardstate.json`；
- restart scan、offset/record round-trip，以及只修復最後 active WAL 的 incomplete tail；
- 完整 frame CRC 錯誤、非法長度、log/offset gap、commit floor 缺損時 fail closed；
- I/O failure 後 quarantine，restart recovery 前拒絕繼續 append。

M1 只保證成功 local append 已通過本機 sync。它沒有 Raft quorum、ISR、HW、public Produce/Fetch handler 或 retry dedup；對外 replicated acknowledgement 必須等待 M3–M5。

## M2 segmented storage

- 預設 64 MiB segment；frame 不跨 segment，新 WAL 在對外可見前會 sync directory。
- `.idx` 以每 4 KiB WAL 距離建立 sparse DATA anchor；這是可丟棄 cache，不是 durability truth。
- offset read 先對 segment DATA range 與 anchor 做二分搜尋，再從 WAL 局部掃描；`ReadStats` 回報 comparisons、scan frames/bytes 與 index bytes。
- 缺失、CRC 錯誤或指向不合理的 index 由 WAL 重建，不改 WAL bytes。
- read lock 是 stable read-view lease；close/truncate 不會在 reader 使用 segment handle 時關閉或重用它。
- `TruncateSuffix` 只能移除 `commit_index` 之後的 suffix，並同步重算 LEO、segment catalog 與 anchors。

M2 仍沒有 retention/snapshot，也不會自行觸發 truncate；M3 Raft 只在驗證 prev index/term 後的 conflict reconciliation 呼叫它。

## M3 per-partition Raft

`internal/raft` 現在提供 deterministic `Step` / `Tick` / `Ready` 介面：

- 固定 RF1/RF3 voters，quorum 純由 voters 計算，不受 ISR 影響；
- RequestVote 以 `(last_term,last_index)` 比較 log freshness，vote/term 先 sync hardstate 才產生回覆；
- AppendEntries 驗證 identity、prev index/term、frame cap 與同 index/term 內容，只截斷 uncommitted conflict；
- follower commit 上限是該 RPC 證實的 matching prefix，不會用 local extra tail 推進；
- leader 只能以多數已持久化的 current-term entry 推進 commit，並必須先 commit/apply NOOP 才 ready；
- ReadIndex 需要 current-term majority heartbeat confirmation，被隔離的舊 leader 無法完成讀取。

M3 的 traffic proposal 僅是測試用 non-idempotent DATA 入口。M4 controller 會套用下列 ack gate，但目前仍不得將 local proposal 或 Raft append 直接當成 public producer 成功回覆。

## M4 ISR、HW 與 acknowledgement gate

`internal/replication` 現在提供：

- 每個 leader term 重建的 follower durable progress、catch-up target 與 2 秒 freshness/lag 驅逐；ISR 只是健康觀察，不改 Raft voter set 或 quorum。
- DATA admission 前檢查 `min_isr` 與 operation/byte cap，並捕捉不可變集合 `A=current ISR`；成功必須同時滿足 Raft commit/apply 及 A 全員在本 term 的 durable match。
- ISR shrink 不會放寬既有 A。append 後 timeout 是 `outcome_unknown`；internal operation identity 可建立新 gate 等候同一 log entry，而不再次 append。
- HW 由 applied DATA 的 exclusive end offset 計算，不把 NOOP/FENCE internal index 當 offset；Fetch 必須先完成 current-term ReadIndex，且只讀 `[offset, HW)`。
- pending operation、bytes、fetch barriers 與 operation/gate history 都有明確上限；真實 RF1 WAL 重啟會由 committed-prefix replay 恢復 HW。

M4 的 test-only operation identity 不負責 producer 去重；M5 透過下列 committed producer state 與 client ledger 補上跨 reply loss、leader failover 與 process restart 的 retry identity。長輪詢 broker event loop 仍未提供。

## M5 idempotent producer 與 retry client

- `internal/producer`：partition-scoped OpenProducer CAS/FENCE、epoch fencing、single in-flight sequence、pending waiter coalescing、最近 64 個 committed batch result，以及每 partition 1,024 producer ID 上限。
- producer ID、epoch、first sequence、SHA-256 batch digest 與 records 放在同一 DATA frame；FENCE/DATA 只由 committed applied prefix 更新正式 state，restart 與新 leader 可直接 replay。
- 相同 committed batch retry 會對原 internal entry 建立新的 M4 captured-ISR gate；100 次重送、RF3 reply loss/failover 及 RF1 filesystem restart 都不會追加第二份 records。
- `internal/transport`：`POST /v1/producers/open` 與 `POST /v1/produce` 的 6 MiB bounded strict JSON handler、typed HTTP/error outcome；malformed、duplicate-key、unknown-field、bad-base64 與 unsupported acks 都在 backend 前拒絕。
- `pkg/client`：總 deadline、attempt cap、50 ms–1 s jitter backoff、固定 partition/identity/sequence retry，以及只接受 static allowlist 內 leader hint 的 HTTP transport。
- `cmd/mkfkctl`：OpenProducer 與 produce 指令；outbound ledger 先以 temp write → file sync → rename → directory sync 保存 pending，成功後才持久更新 next sequence。新 invocation 會先恢復未解決 batch。

M5 的 HTTP handler 是可嵌入 partition actor 的 public boundary，但尚無 `cmd/mkfk` broker 把 client/peer listeners、所有 partitions 與 lifecycle 接成常駐服務；該整合與 consumer groups 分別屬於 M7 與 M6。這裡的冪等只涵蓋同 producer/partition/epoch/sequence 的 transport retry，不是跨 partition transaction 或外部 side-effect exactly-once。

## 範圍提示

- 第一版覆蓋教學的六個核心任務，外加可重現的三 broker 故障驗收。
- 自行實作 log、index、Raft core、producer 去重與 group assignment；不以現成 Kafka broker 或資料庫代理核心能力。
- 自訂 HTTP/JSON API；不使用 Kafka wire protocol。
- 完整 transactions、跨分區 exactly-once、retention/snapshot、動態擴縮及公開網路部署均不在核心版。
- 與同一 monorepo 的 `systems/ojbquay` 分開：本專案學習實作 broker 核心，不依賴該專案。

教學來源：[Build Mini-Kafka](https://builddistributedsystem.com/projects/mini-kafka)。讀取方式與來源限制見 [來源紀錄](docs/sdd/06-decisions-sources.md)。不複製教學全文或未提供的題目程式碼。
