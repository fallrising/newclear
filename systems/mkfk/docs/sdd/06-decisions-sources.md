# 06 — 教學對照、ADR 與來源

[回主 SDD](../../SDD.md)

## 1. 來源取得與可確認範圍

來源頁：[Build Mini-Kafka](https://builddistributedsystem.com/projects/mini-kafka)，2026-09-15 查閱。直接 HTTP 瀏覽回傳 403；公開搜尋索引隨後提供該 URL 的專案概述、三條 track 與六個任務的內容。索引顯示約兩個月前抓取，故不宣稱已驗證 origin 當日版本。

已讀範圍：公開 project overview、prerequisites、track/task 清單。未讀範圍：個別 exercise 的獨立正文、starter code、評分器、登入內容或解答。下面的規格沒有假稱通過原網站測試，也不將自訂 API/格式歸因於網站。

原頁概述提及 transactional producers，但六項公開核心任務没有獨立完整交易任務。因此 mkfk 將完整交易列為後續 X1，而非把 sequence 去重當成 transaction 已完成。稀疏索引的工程複雜度也在本案中細化為 binary search 加 bounded local scan，而不是保證任意 I/O seek 都是純 O(log n)。

不保存來源全文；以下為任務概念的轉述和新設計。外部教學內容不因本 monorepo 的 MIT license 而成為本專案可再授權的全文。

## 2. 六個任務的可追蹤映射

| 教學 track | 教學任務概念（轉述） | 本案要求 | milestone | 驗收 |
| --- | --- | --- | --- | --- |
| Partition Log | 追加式分區日誌與 offset 讀寫 | FR-01 | M1 | ST-01–ST-05 |
| Partition Log | 稀疏 offset 索引 | FR-02 | M2 | ST-06–ST-09 |
| Replication | partition leadership 的 Raft 選主 | FR-03，補上完整 log replication 安全規則 | M3 | RP-01–RP-07 |
| Replication | ISR 追蹤及安全讀取邊界 | FR-04，採明確的 Raft/HW/ISR 分工 | M4 | RP-08–RP-11 |
| Producers and Consumers | sequence-based 冪等生產者 | FR-05 | M5 | PR-01–PR-07 |
| Producers and Consumers | consumer group partition assignment | FR-06 | M6 | CG-01–CG-07 |

M0 的契約／工具鏈與 M7 的整合故障驗證是本案新增，沒有冒稱教學的第七或第八個任務。

## 3. Architecture decision records

### ADR-001 — Go，HTTP/JSON，先 correctness 後 throughput

Status: accepted for baseline。

教學 prerequisites 容許 Python 或 Go；本案預設 Go，便於單 binary、多 process 實驗及標準庫 I/O。這不是使用者已指定的語言，也不以語言效能作無證據比較。M0 固定當時受支援的 patch，建立獨立 module，不建立 monorepo-wide workspace。

API 採自訂 HTTP/JSON v1，持久層採 length-framed WAL；二者不必同格式。可先看清狀態轉移，日後以量測決定 binary transport；v0.1 不宣稱 Kafka protocol 相容。[S4]

### ADR-002 — 每 partition 完整 Raft；ISR 不改 voter set

Status: accepted for baseline; deliberate teaching adaptation。

教學採每分區 Raft 選主作為學習路線。本案補全 election、log matching、stable storage、current-term majority commit、read barrier 及 fencing；只做 leader election 不足以建立可恢复的 replicated log。[S5]

Apache Kafka 的 controller metadata quorum 與 partition data replication 不應混為一談；Kafka 官方設計也分別討論 majority quorum 與 ISR 路線。[S2][S3]

mkfk 採固定 Raft majority 決定 commit；HW 是已 apply committed DATA prefix 的 exclusive offset。ISR 決定追加的 `acks=all` durability gate，會影響 admission/response latency，但不覆寫 commit_index、不限制 Raft 投票資格。故它不是 Kafka ISR algorithm 的一比一複製。

以 admission 當下的 ISR snapshot 等待全部副本 durability，故比可動態縮小等待集合的策略更保守；故障時可能 timeout，即使資料其實已 quorum committed。這個可用性代價是明示選擇。未來若改為 Kafka-style controller + ISR data plane，須另立 ADR 和新 safety tests，不能局部替換公式。

### ADR-003 — 只提供最強 ack profile，不偷偷降級

Status: accepted for baseline。

v0.1 只有 `acks=all`，且其精確定義以本案 [02](02-replication.md) 為準。保留讀者熟悉的名稱，但不聲稱與 Kafka 完全相同。未支援的 `acks=0/1` 回錯誤。先建立可推理的 durability，再考慮較弱模式。

每個被計入 durable quorum 的 WAL entry 都先 sync；這比依賴 page cache 的路徑保守、成本更高。本案沒有使用 Kafka 吞吐數字作 benchmark 目標。[S2][S6]

### ADR-004 — 一份 WAL，衍生索引；核心版不刪資料

Status: accepted for baseline。

DATA、FENCE 和 GROUP commands 使用同一分區 WAL／同一提交秩序；producer state 和 group state 由 committed entries 重播。拒絕資料 append 與去重 map 独立 commit 的雙寫設計。

不做 retention/snapshot，避免過早處理去重狀態保留、落後副本 resync 及 internal state checkpoint 的交互作用。代價是磁碟及 restart 時間隨 log 增長；用容量上限、拒絕寫入與明確實驗清理程序控制，不默默刪檔。

### ADR-005 — 一個 replicated group coordinator，eager rebalance

Status: accepted for baseline。

所有 group 的 durable commands 暫放一個 internal Raft group，避免第一版引入 coordinator sharding。members 必須具有相同訂閱集合，使用排序後 round-robin。新 coordinator term 使 sessions 重新加入並增加 generation；offsets 保留。這是可用性較保守但易驗證的方案，不實作 Kafka 完整 consumer group protocol。[S2]

assignment exclusivity 不代表能停止失聯 process 已開始的外部工作。下游 side effects 仍需 idempotency／transaction/outbox 等獨立設計。

### ADR-006 — 冪等與交易分開

Status: accepted for baseline。

核心版只保證 bounded retry window 中同 identity/epoch/sequence 的資料寫入去重，epoch fence 作用域是 producer + partition。不是 application-event 全域去重，也不是跨分區 transaction。

完整交易須另行處理 transaction coordinator、prepare/commit/abort markers、last stable offset、read isolation、offsets 與 outputs 的原子提交、timeout recovery 與 fencing。本案不提供虛假的 `begin_transaction` API。[S6]

### ADR-007 — M0 工具鏈與 durability 驗收平台

Status: accepted；完整決策見 [ADR-007](../adr/007-m0-toolchain-platform.md)。

M0 固定 Go 1.27.1；durability 的最低驗收環境為 Linux 5.10+ 與本機 ext4/XFS，且必須提供 file/directory fsync、同 filesystem atomic rename 與 advisory lock。tmpfs 可跑非 durability unit tests，但不能作持久性證據；其他 filesystem 需另附平台驗證。JSON Schema validator 僅作 test dependency，production contract 維持標準庫實作。

## 4. 來源目錄

來源主要用來校驗概念；本案具體數字、格式、HTTP endpoints、milestones、測試 IDs 都是原創設計，不是來源的既成實作。

| ID | 原始來源 | 用途 |
| --- | --- | --- |
| S1 | [Mini-Kafka project overview](https://builddistributedsystem.com/projects/mini-kafka) | 三 tracks、六 tasks、教學目標；取自公開索引，非逐 exercise 驗證 |
| S2 | [Apache Kafka 4.3 — Design](https://kafka.apache.org/43/design/design/) | log/replay、consumer position、replication 與交付語意比較 |
| S3 | [Apache Kafka 4.3 — KRaft](https://kafka.apache.org/43/operations/kraft/) | metadata quorum 與 controller 的責任邊界 |
| S4 | [Apache Kafka 4.3 — Protocol](https://kafka.apache.org/43/design/protocol/) | 提醒 Kafka wire protocol 有獨立、版本化契約；mkfk 不相容 |
| S5 | [Raft authors' project site](https://raft.github.io/) | consensus 原理、原始論文與 visualization 的閱讀入口 |
| S6 | [Apache Kafka 4.3 — Producer configurations](https://kafka.apache.org/43/configuration/producer-configs/) | ack、sequence retry、idempotence 與 transaction 的區分 |
| S7 | [Go release history](https://go.dev/doc/devel/release) | M0 決定受支援工具鏈 patch；本文件不宣稱某個未查核版本已安装 |

來源查閱日期均為 2026-09-15。固定 Kafka 4.3 文件為概念參考，不表示 mkfk 對該版本通過相容測試。

## 5. 開始實作前的決策 gate

M0 必須固定：Go patch／最小支援 OS、WAL golden vectors、HTTP schema、fake clock/fault adapter 介面及 manifest 樣例。以上屬落地 gate，不改動已選定的 safety semantics。

未來來源頁恢復可讀時，可增補 exercise 級對照，但不得在沒有取得內容的情況下杜撰題目細節、方法簽名或隱藏評分標準。若原題與本案契約不同，記錄差異，不靜默改變已實作的持久格式。
