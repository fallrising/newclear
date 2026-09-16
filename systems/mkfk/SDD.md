# mkfk — Software Design Document

- Version: 0.1.0
- Date: 2026-09-15
- Status: proposed implementation baseline; documentation only
- Repository: `fallrising/newclear`
- Component: `systems/mkfk`
- Language: 繁體中文，保留必要英文術語

## 1. 目的與設計立場

從零建立一個可觀察、可測試、可故障重播的 Kafka-inspired distributed log。成果不只是能 produce/consume，而是能回答：資料何時算持久、哪些 offset 可以被讀、leader 故障後哪些承諾仍成立、重送與 rebalance 如何避免破壞狀態。

本規格參照 [Mini-Kafka 教學](https://builddistributedsystem.com/projects/mini-kafka) 的三條 track／六個任務。原頁直接讀取回傳 403；本次透過公開搜尋索引取得專案概述與六項任務清單，未取得各任務的獨立詳細頁、隱藏測試或解答。以下不是教學逐字重製；可實作的格式、協定、故障模型與里程碑是 mkfk 的補充設計。來源與差异完整列於 [06](docs/sdd/06-decisions-sources.md)。

教學頁的每分區 Raft 選主敘述不能直接等同 Apache Kafka 的實作。本案選擇 **每分區完整 Raft 複製 + 明確額外 ISR ack gate**：Raft 保證安全，ISR 用於觀察副本追趕及限制 acknowledgement。不得將「只寫 election」加上不明確的 ISR 多數決當成 consensus。[ADR-002](docs/sdd/06-decisions-sources.md) 說明與 Kafka 的差異。

## 2. 使用者故事與成功標準

| ID | 使用者故事 | 可驗證成功條件 |
| --- | --- | --- |
| US-01 | 生產者批次寫入一個 topic partition | 成功回覆包含穩定 offset 區間；重啟後仍可讀 |
| US-02 | 消費者從任意保留 offset 重播 | 不修改其他 group 進度；不刪除已讀 records |
| US-03 | 開發者停止目前 leader | 多數副本可用時恢復服務，所有成功確認 records 保留 |
| US-04 | 網路遺失 produce 回覆 | 同 identity/epoch/sequence 重試不新增一份 record |
| US-05 | consumer 加入、離開或故障 | current generation 的 assignment 完整且不重疊；舊 generation 不能 commit |
| US-06 | reviewer 檢查正確性 | 固定 seed 重播故障，能將要求追到測試及證據 |

核心版完成定義為 M0–M7 全部 `VERIFIED`。本次文件提交不是任何功能 milestone 的完成證明。

## 3. 範圍與非目標

### 核心版 v0.1

Go、Linux、本機 POSIX filesystem；單 process 儲存測試到三 broker cluster。支援 static topics/partitions、RF=1 的單機 profile 或 RF=3 的 cluster profile、append-only segmented WAL、sparse index、每 partition Raft、ISR 觀察與 ack gate、committed-prefix fetch、冪等 producer、round-robin consumer groups、durable group offsets、CLI、測試與基本 metrics。

單機預設 `min_isr=1`，三副本預設 `min_isr=2`。每個 cluster 必須使用同一 immutable topology manifest。topic／partition／replica set 不在執行中變更。新增 topic 需離線建立新的實驗 cluster；核心版沒有偷偷 auto-create topic 的路徑。

### 刻意不做

Kafka binary wire protocol／現有 Kafka SDK 相容、ZooKeeper/KRaft 相容實作、跨分區 transaction、external sink exactly-once、動態 membership、partition reassignment、retention 刪檔、snapshot/compaction、compression、zero-copy、tiered storage、ACL/SASL、多租戶、跨區域部署、Web UI。

不將吞吐量或教學頁的 production-grade 形容詞當成已取得的保證。核心版是學習與作品集工程，不提供 production SLA。

## 4. 不可混淆的語意

| 名詞 | mkfk v0.1 定義 |
| --- | --- |
| record offset | partition 內由 0 開始；已提交 record 的 offset 永久不變 |
| Raft log index | 由 1 開始；包括 DATA、FENCE、NOOP、GROUP 等 internal entries，不等於 record offset |
| LEO | local log 中下一個 data record offset，包含尚未 commit 的尾端 |
| HW | 已 apply 的 committed DATA prefix 的下一個 offset；exclusive upper bound |
| commit_index | Raft 已提交的 internal entry index，inclusive |
| group committed offset | 下一個應處理的 record offset，不是最後處理的 offset |
| ISR | 本 leader term 中近期成功追上指定 log-end target 的副本集合；不是 voter set |
| 成功 produce | 完整 batch 已 durable、Raft committed/applied，且满足本次捕捉的 ISR acknowledgement gate |
| timeout | 結果未知，可能已提交；不是 rollback |
| 冪等 | 同 producer/partition/epoch/sequence 的 transport retry 不新增 records |
| at-least-once | 先處理後提交 offset；crash 可能造成重新處理 |

`0 <= HW <= LEO`。v0.1 不刪除歷史資料，因此 log start offset 為 0。Fetch 只能回傳 `offset < HW`。未提交尾端可能在 leader 切換後消失，其 provisional offsets 可重用；它們不得先暴露給 consumer 或成功確認給 producer。

## 5. 功能要求

| ID | MUST requirement | 主要里程碑 |
| --- | --- | --- |
| FR-01 | append batch、嚴格 offset 順序、checksum、restart recovery | M1 |
| FR-02 | segmented log、sparse seek、index rebuild，不掃描全 log 才能完成正常 seek | M2 |
| FR-03 | durable term/vote、log matching、majority commit、leader fencing | M3 |
| FR-04 | ISR join/eviction、HW 推進、ack gate、quorum-loss 拒絕成功回覆 | M4 |
| FR-05 | partition-scoped producer epoch、sequence validation、durable dedup | M5 |
| FR-06 | membership、round-robin assignment、generation fence、durable offsets | M6 |
| FR-07 | bounded HTTP API、CLI、metadata refresh、typed errors、backpressure | M0–M7 |
| FR-08 | metrics、可重播 fault tests、三 broker end-to-end evidence | M7 |

## 6. 安全不變量

| ID | 不變量 |
| --- | --- |
| INV-01 | 已回覆成功的 DATA batch 必須存在於所有未來成功選出 leader 的 committed prefix；前提是配置的 Raft 多數穩定儲存未永久丟失 |
| INV-02 | 單 partition 的 committed DATA offsets 連續、排序且內容不可被後續 truncate 改寫 |
| INV-03 | consumer 看不到未提交 record；NOOP/FENCE 不佔用 data offset |
| INV-04 | 同 term 最多一個獲得合法 majority 的 leader；舊 leader 不得取得新寫入成功所需的 quorum |
| INV-05 | durable vote 在回覆前落盤；同 term 不投給兩個候選人 |
| INV-06 | ISR 變小不改變 Raft majority；不得用 ISR 取代固定 voters |
| INV-07 | batch 的資料與 producer epoch/sequence 去重狀態可由同一 committed log 重建 |
| INV-08 | group 當前 stable generation 中，每個訂閱 partition 正好有一個 assigned member；不同 group 互相獨立 |
| INV-09 | stale generation / non-owner 的 offset commit 必須被拒絕；成功提交的 offset 在 coordinator failover 後保留 |
| INV-10 | 尾端修復不會越過 durable commit boundary；完整 checksum 錯誤不被當成可忽略的尾端 |
| INV-11 | 任一 queue、frame、batch、long poll、session 數量有上限；超限用錯誤或 backpressure，不能無界累積 |
| INV-12 | 同一資料目錄只能由一個 node process 持有，cluster/node/config 不匹配時拒絕啟動 |

不同 term 的 processes 可以暫時都自認 leader；INV-04 不宣稱非同步網路能瞬間消除這種認知，而是限制誰能安全提交及回覆。

## 7. 故障模型與保證邊界

包含 crash/restart、SIGKILL、RPC 延遲／丟失／重複／亂序、非對稱網路分割、pause、partial write、disk-full、fsync failure、損壞檔案與 reply loss。演算法假設非 Byzantine peers、持久儲存遵守成功 fsync 的合約；資料損壞要偵測並停止受影響 replica，而不是任意猜測正確內容。

三副本配置在單一副本失效、剩餘 peers 最終能通訊且有足夠容量時應可恢復。兩個副本不可用時停止提供需要 quorum 的服務。多數磁碟永久丟失、惡意 peers、filesystem 虛報 durability、所有副本共同硬體損壞不在保證內。

`kill -9` 測試不是實際拔電測試；power-loss durability 需額外平台驗證。單機三 process／三 container 的展示不代表三個獨立硬體故障域。

## 8. 架構與資料責任

```text
CLI / Go SDK
  | HTTP/JSON v1: metadata, produce, fetch, groups
  v
Broker transport + validation + bounded request queues
  |                         |
  v                         v
Partition actor(s)          Group coordinator
  |                         | one internal __mkfk_groups partition
  v                         v
Raft core ---- persistence / transport adapters ---- peers
  |
  v
Segmented WAL -> committed-state apply -> sparse offset index
                                      -> producer state / group state
```

每一個 user partition 是獨立固定 voter set 的 Raft group；`__mkfk_groups` 是同樣複製機制的一個獨立 internal group，不對一般 producer 開放。拓撲由靜態 manifest 提供，故核心版不需要另外實作動態 metadata controller。

WAL 是資料與狀態機 commands 的唯一持久 truth。index、producer map、group map 是可由 committed prefix 重建的衍生物；不能加一個與 WAL 分開提交的資料庫作為第二真相。

| 預計模組 | 責任 | 禁止耦合 |
| --- | --- | --- |
| `internal/storage` | frame codec、segment、recovery、offset index | 不發 RPC、不做 leader election |
| `internal/raft` | deterministic Step/Tick、term/vote、replication、commit | 不直接讀時鐘／socket／filesystem |
| `internal/partition` | actor、offset allocation、apply、pending writes、ISR gate | 不管理其他 partition 的排序 |
| `internal/producer` | fencing、sequence、batch result cache | 不以記憶體成功代替持久結果 |
| `internal/group` | membership、assignment、generation、offset commands | 不宣稱外部 side effects exactly-once |
| `internal/transport` | bounded HTTP、peer RPC、error mapping | 不繞過 actor 改 state |
| `internal/observability` | metrics、structured event logs | 不記錄 payload / credentials |
| `internal/testkit` | fake clock、fault transport、fault disk、seed replay | 不依賴機器時間判斷 safety |
| `pkg/client` | producer retry、metadata refresh、group client | 不在 unknown result 後更換 sequence |
| `cmd/mkfk`, `cmd/mkfkctl` | broker 與 CLI | 不埋核心 business logic |

這些是未來目錄契約，本次沒有建立空程式模組或假 API。

## 9. 主要資料流程

Produce：檢查範圍／容量／leader ready → producer identity 與 sequence → 捕捉 ISR gate → 分配 provisional offsets → append + sync → Raft 複製 → commit + apply → ISR gate 完成 → 回覆穩定 offsets。M5 前 identity 去重尚未提供，階段 demo 必須標明重試可能重複。

Fetch：解析 offset 與 bytes 上限 → leader 完成 quorum-confirmed read barrier → index seek → 僅讀 HW 之前的 data → 回覆 records 與 next_offset。沒有資料時 bounded long poll；role change 或 deadline 會喚醒，不持鎖等待。

Consumer：join → sync 得到 generation/assignment → fetch → 處理 → commit 下一個 offset → heartbeat。rebalance 時停止新 fetch、結束或放棄本地 in-flight 工作，再以新 generation 重新同步。

## 10. 非功能與資源預算

以下是預設設計上限，不是量測成果；M0 需寫成一致的 config 與 boundary tests。

| 項目 | v0.1 預設 |
| --- | --- |
| raw 單 record key+value | 1 MiB |
| encoded WAL frame | 4 MiB，含全部 header |
| HTTP body | 6 MiB，另驗證 decoded batch 可放入 4 MiB frame |
| records / batch | 1–1,000 |
| encoded fetch response | 6 MiB；decoded fetch budget 預設 1 MiB、上限 4 MiB |
| segment | 64 MiB；frame 不跨 segment |
| sparse index stride | 4 KiB WAL bytes，容許一個最大 frame 的 overshoot |
| user partitions / broker | 32；另加 1 internal group partition |
| producer IDs / partition | 1,024；不 silent eviction |
| dedup cache | 每 producer/partition 保留最近 64 個 committed batch 結果 |
| groups / cluster | 128；members / group 64 |
| pending requests / partition | 256 且 cumulative decoded bytes <= 16 MiB |
| broker pending decoded bytes | 64 MiB，包含等待寫入、RPC 與 long-poll 回覆 buffer |
| long polls / broker | 256；最長 5 秒 |
| election / heartbeat | randomized 600–1,200 ms / 100 ms |
| producer request timeout | 預設 5 秒，上限 30 秒 |
| group heartbeat / session | 1 秒 / 5 秒 |
| partition disk budget | 1 GiB；user writes 在 soft limit 拒絕，另保留 control/replication 空間 |

所有 bytes 使用 binary units。任何單一 cap 不能代替整體 byte accounting；複製、base64 decode、queue 與 response buffer 都算資源。磁碟不足不得刪 committed WAL，詳見 [01](docs/sdd/01-storage.md)。

## 11. 部署與安全

預設 loopback 監聽，client、peer、admin listener 分開。Compose 可使用隔離 private network 並只將 client port 綁 host loopback；不暴露 peer/admin ports 到公網。不把 home VPS 上的既有 Tailscale/Cloudflare 設定當成此專案已配置完成。

無 TLS/auth 的 v0.1 只能是受信任的隔離教學環境；cluster_id 檢查不是 authentication。非 loopback 的 insecure 模式需顯式 flag、啟動警告及文件提示。正式外部部署必須另立 security milestone；不能靠本 SDD 宣稱安全可上線。

測試及之後的 container 必須以 non-root 執行，資料目錄權限由明確初始化或 named volume 管理，不自動遞迴 chown 未知 host path。

## 12. 開發流程與變更規則

詳細實作順序見 [05](docs/sdd/05-roadmap.md)，驗收見 [04](docs/sdd/04-validation.md)。先做 M0 固定契約與測試框架，再依教學完成 M1–M6，最後 M7 做跨模組故障證據。

修改 persisted format、ack 語意、HW 定義、membership、epoch 或 API 時，先更新 ADR、版本及 golden vectors；不能只改程式。若未來換語言，核心語意與 acceptance IDs 保留，但 M0 要重新驗證。

文件優先級：本文件的不變量 > 專題章節 > roadmap 的示例命令。來源文件用於理解及比較，不自動凌駕 mkfk 已明確選定的協定。

## 13. 章節索引

- [01 — Storage](docs/sdd/01-storage.md)
- [02 — Replication](docs/sdd/02-replication.md)
- [03 — Protocol and clients](docs/sdd/03-protocol-clients.md)
- [04 — Verification](docs/sdd/04-validation.md)
- [05 — Delivery plan](docs/sdd/05-roadmap.md)
- [06 — Decisions and sources](docs/sdd/06-decisions-sources.md)
