# mkfk

Kafka-inspired distributed log，透過實作理解分區儲存、複製、冪等生產與消費群組。

**狀態：M0–M3 已驗證；M4–M7 尚未實作。** 現有程式提供 segmented durable WAL、sparse-index read，以及 RF1/RF3 per-partition Raft 的選舉、複製、衝突修復、NOOP leader barrier 與 ReadIndex；目前仍沒有可啟動的 broker/API server，也不宣稱 M4 `acks=all` 語意、production-ready 或 Kafka client 相容。精確狀態見 [implementation status](docs/STATUS.md)。

## 從這裡開始

1. [SDD 主文件](SDD.md)：目標、範圍、架構、不變量與文件優先級。
2. [教學對照、設計決策與來源](docs/sdd/06-decisions-sources.md)：六個教學任務的映射，以及 mkfk 與 Apache Kafka 的刻意差異。
3. [開發里程碑](docs/sdd/05-roadmap.md)：M0–M7，每個階段的輸入、產物、驗收與禁止越界事項。
4. [Agent 工作規則](AGENTS.md)：交接、改規格、測試證據與 monorepo 修改邊界。

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

目前刻意沒有 `cmd/mkfk`、HTTP handler、長時間執行的 broker process 或固定成功 stub；這些必須依 milestone 驗收順序加入。

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

M3 的 traffic proposal 僅是測試用 non-idempotent DATA 入口。ISR/HW、`acks=all` captured set、public producer success 與 follower lag 屬於 M4；目前不得將 local proposal 或 Raft append 直接當成對外成功回覆。

## 範圍提示

- 第一版覆蓋教學的六個核心任務，外加可重現的三 broker 故障驗收。
- 自行實作 log、index、Raft core、producer 去重與 group assignment；不以現成 Kafka broker 或資料庫代理核心能力。
- 自訂 HTTP/JSON API；不使用 Kafka wire protocol。
- 完整 transactions、跨分區 exactly-once、retention/snapshot、動態擴縮及公開網路部署均不在核心版。
- 與同一 monorepo 的 `systems/ojbquay` 分開：本專案學習實作 broker 核心，不依賴該專案。

教學來源：[Build Mini-Kafka](https://builddistributedsystem.com/projects/mini-kafka)。讀取方式與來源限制見 [來源紀錄](docs/sdd/06-decisions-sources.md)。不複製教學全文或未提供的題目程式碼。
