# 05 — Milestones and implementation handoff

[回主 SDD](../../SDD.md)

所有 milestone 目前均為 **NOT_STARTED**。本次只建立 SDD baseline。M0–M7 是有 dependency 的交付順序，不是時間估算；教學頁的預估時數不作為本工程的交付承諾。

## 1. Dependency map

```text
M0 contracts / testkit
 -> M1 durable partition log
 -> M2 segments / sparse index
 -> M3 full Raft replication
 -> M4 ISR / visibility / ack gate
 -> M5 idempotent producer
 -> M6 consumer groups
 -> M7 failure-driven integration and portfolio evidence

After M7 only: X1 transactions, X2 retention/snapshots,
               X3 protocol/performance, X4 dynamic membership/security
```

M0 可平行準備測試與 schema；其他模組實作需先固定介面。不得因另一個 agent 提前完成某個函式，就跳過其依賴的驗收。

## 2. M0 — Contract and engineering foundation

**目標：** 把本 SDD 轉成開發可依賴的格式／介面／測試骨架，而不是一次寫完 broker。

讀取：全部 `SDD.md`、[01](01-storage.md) 的 frame/manifest、[03](03-protocol-clients.md) 的 schemas、[04](04-validation.md) 與 [06](06-decisions-sources.md)。

產物：獨立 Go module `github.com/fallrising/newclear/systems/mkfk`；固定且經官方查核仍受支援的 Go patch；config schema、HTTP JSON schemas、WAL/index/fingerprint golden vectors；clock/random/transport/disk adapter 介面；最小 deterministic testkit；非空的 format/vet/unit gates；README 中的實際執行命令。

M0 需決定並在 ADR 紀錄最小 Linux/kernel/filesystem 驗收環境，固定 node/client/peer/admin address 的 dev manifest。標準庫優先；新增 dependency 說明用途並固定版本。

验收：範例與反例通過 schema validation；frame header length=28+payload、whole frame=32+payload、int64 JSON string、null/empty key fingerprints 均有固定 vectors；monorepo 路徑邊界通過檢查；root workflow 靜態 policy 合格（若此階段加入）。

禁止：實作 Kafka wire protocol、transaction、GUI、部署到現有 VPS；把尚未提供的功能接成固定成功 stub。

## 3. M1 — Durable append-only partition log

**對應教學：** 分區日誌。

輸入：M0 的 frame/adapter 契約。產物：frame codec、write-all/sync、data offset allocation、local read、hardstate atomic write、data-dir lock、restart scan 及 torn-tail recovery。先用單 partition／standalone storage driver，不要求網路 cluster。

驗收：ST-01–ST-05、OP-02；特別展示 sync 前後 crash 的差異、完整 CRC 壞掉與不完整尾端的不同處理。evidence 列出每個 cutpoint。

最小 demo：寫入三個 batch，記錄 offset，停止 process，再啟動讀回。只宣稱本機 durability，不宣稱 replicated acknowledgement 或 retry 去重。

禁止：用 SQL/Redis/現成 log library 代替 WAL；在錯誤尾端後繼續 append；擅自刪除 committed frame。

## 4. M2 — Segmentation and sparse index

**對應教學：** 稀疏 offset 索引。

輸入：M1 VERIFIED。產物：segment rotation、index codec、segment DATA 範圍目錄、bounded local scan、index rebuild、read view/handle lifecycle、truncate 後索引修復。

驗收：ST-06–ST-09，加上 M1 regression；以小 segment fixtures 產生至少 3 段，隨機 seek 對 reference log，展示 index missing/corrupt 不改 WAL。

最小 demo：從非零 offset 讀取、跨 segment 讀取、移除 index 後恢復；報告搜尋 comparisons、實際 scan bytes 與 index size，不只秀一個延遲數字。

禁止：retention/snapshot、只做 `map[offset]record` 全量載入而稱 sparse index、用全檔掃描冒充正常 seek。

## 5. M3 — Per-partition full Raft

**對應教學：** partition leader election；本案補全安全複製。

輸入：M2 VERIFIED，固定 Raft event/Ready adapter 介面。產物：RequestVote、AppendEntries、durable term/vote、conflict reconciliation、current-term majority commit、NOOP ready barrier、ReadIndex、RF1/RF3 static manifests、三 process driver。

驗收：RP-01–RP-07、storage regression；100 deterministic seeds × 1,000 events。必須含 vote crash、older-term commit 反例、isolated old leader、全部 processes restart 和 quorum loss。

最小 demo：同一資料 partition 複製至三個 data dirs，停止 leader，由剩餘兩台恢復，已確認資料保留。M3 的 traffic driver 可使用 test-only non-idempotent DATA command，不能把它當成最終公開 producer API。

禁止：只有 election 完成就標示 distributed log 已完成；從 ISR 計算 quorum；以 Raft library/service 偷換學習核心；跨 branch 改其他 monorepo component。

## 6. M4 — ISR, HW and acknowledgement profile

**對應教學：** ISR 與高水位。

輸入：M3 VERIFIED。產物：per-term follower catch-up tracking、ISR join/eviction、min_isr admission、captured-A ack waiters、HW/LEO mapping、unknown-outcome errors、bounded committed-prefix fetch。

驗收：RP-08–RP-11、RP-06、OP-03/04 的相關部分；完整展示「A=3 時掉一台，quorum 已提交但原 request timeout」及 retry 新 gate 不重寫原 entry 的 waiter/lookup 接口。M5 尚未交付前，重試去重只用 internal test operation identity 驗證 ack waiter，不宣稱公開 producer idempotence。

最小 demo：暫停 follower，觀察 ISR shrink、quorum 不變、HW 推進與 waiters；恢復後確認真正 catch-up 才重入。

禁止：縮小 ISR 就改 voter set，或 waive 既有 A 等待；把 NOOP index 當成 data offset；向 consumer 曝光 LEO 尾端。

## 7. M5 — Idempotent producer and SDK retry

**對應教學：** sequence-based 去重。

輸入：M4 VERIFIED。產物：OpenProducer CAS/FENCE、partition-scoped epoch、sequence validation、64-batch result cache、pending request coalescing、committed replay、public Produce API、Go client retry 與 CLI outbound ledger。

驗收：PR-01–PR-07、OP-01/04；特別驗證 reply-loss、leader-switch、client ledger crash 和 dedup-window-expired。啟用最終 public API 後，不提供自動跳過 identity 的 fallback。

最小 demo：故意遺失第一個成功 reply，重送相同 request，consumer 只讀到一次，兩次確認得到同 offsets。再重啟 leader 與 client 重做。

禁止：只在 RAM map 去重；timeout 後遞增 sequence／更換 producer ID；以冪等宣稱完整 transaction 或外部 exactly-once。

## 8. M6 — Consumer groups and durable offsets

**對應教學：** group assignment。

輸入：M5 VERIFIED；internal `__mkfk_groups` Raft partition 可使用與 DATA partitions 相同 core。產物：durable membership/generation/assignment commands、eager revoke/sync、deterministic round-robin、heartbeats、session timeouts、owner/generation-checked offset commits、coordinator failover recovery、consumer SDK loop。

驗收：CG-01–CG-07；正常與 coordinator failover 兩種路徑都要驗證 stale generation。CommitOffsets 的多項 metadata 更新須 all-or-nothing，且成功值在 restart 後保留。

最小 demo：3 partitions、2 members，再加入第3位；接著 kill 一個 member 和 coordinator，觀察 generation/assignment、從 committed next offset 重播。展示 process-before-commit crash 可能重新處理，不隱藏 at-least-once 行為。

禁止：只實作 round-robin 函式就說完成 group coordinator；只在 consumer 本機存 offsets；把 stale worker 的外部副作用說成可被 broker 撤回。

## 9. M7 — Integrated failure verification and portfolio delivery

輸入：M0–M6 VERIFIED。產物：三 broker isolated Compose profile（non-root、named volumes、host loopback ports）、CLI demo、fault harness、完整 OP-01–OP-06、全部 regression、可選 extended seeds、benchmark baseline、短篇架構／故障結果說明。

驗收：所有 FR/INV 對照具有至少一個已執行 test；evidence 包含 command、commit、seed、config、exit code 和 limitation。reviewer 可在乾淨的支援 Linux 環境重現，不必取得 production credential。

最小 demo 順序：bootstrap 新空目錄 → 啟動3 brokers → open producer → produce/consume → 丟 reply 重試 → kill leader → follower catch-up → rebalance → coordinator restart → 從 offsets 恢復 → 只清理本次實驗資源。

不先寫吞吐承諾；報告實際 p50/p95/p99、records/s、CPU/RSS、fsync/index/recovery 指標。更新 README 狀態必須精確，例如「核心功能已驗收；未 production-hardened」，而不是刪掉所有限制。

## 10. Future tracks，不屬核心完成條件

| Track | 要另外設計的內容 | 在此之前不可宣稱 |
| --- | --- | --- |
| X1 Transactions | transaction coordinator、跨 partition markers、commit/abort recovery、last stable offset、read isolation、offset/output atomicity、fencing | transactional producer／端到端 exactly-once |
| X2 Retention and snapshots | safe deletion point、producer/group state snapshot、lagging follower snapshot install、checkpoint atomicity、restore/versioning | 無界運行、可任意刪 segment |
| X3 Compatibility and performance | binary transport 或 Kafka protocol subset、compatibility matrix、batch/compression/zero-copy benchmark | 現有 Kafka client 相容或性能優於 Kafka |
| X4 Operations and security | authenticated/encrypted peers、ACL、動態 membership 的安全變更、node replacement、backup/restore、multi-host failure domains | 公網 production deployment |

X1 的 prerequisite 還包含新的 transaction SDD 和驗收；不能只補三個 transaction endpoint 就宣告完成。X2/X4 的設計可能互相依賴，需要各自 ADR。

## 11. Planned command contract

下列命令是未來應建立的介面，**目前檔案／targets 尚不存在**：

| Milestone 起 | Component working directory command | 必須執行的工作 |
| --- | --- | --- |
| M0 | `make fmt-check` | non-mutating Go formatting check |
| M0 | `make vet` | `go vet ./...` |
| M0 | `make test` | 本階段實際存在的非空 unit/schema tests |
| M1 | `make test-race` | `go test -race ./...` |
| M3 | `make test-model` | deterministic seed suite，失敗保存 history |
| M3 | `make test-integration` | 三 child processes／獨立 temp data dirs |
| M7 | `make test-chaos` | 完整 fault schedule profile |
| M7 | `make bench` | 明確設定的 workload，輸出原始結果 |
| M7 | `make demo` | 建立隔離實驗，不使用既有 volumes |
| M7 | `make demo-down` | 僅停止該次實驗；刪資料須額外顯式 flag |

CI 使用 root workflow，不在 component 內建立以為會自動執行的 nested workflow。任何 target 的 missing dependency 要報錯，不准回固定 success。

## 12. Copyable first implementation task

> 在 `fallrising/newclear` 的 `systems/mkfk` 實作 M0。先讀 `AGENTS.md`、`SDD.md` 及 `docs/sdd/` 的全部章節，檢查當前 branch/ancestor 規則。只固定 Go module/toolchain、格式與 API schemas、golden vectors、test adapters 與非空的基本 gates；不要提前實作 broker、Raft、transactions 或 UI。維持本文所有不變量，新增需要的 ADR。PR 說明列出執行命令、exit codes、實際驗證項目、未做事項，以及 M1 的明確交接；不修改其他 components，不部署、不合併其他 PR。
