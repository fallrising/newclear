# 01 — Storage specification

[回主 SDD](../../SDD.md) · Requirements: FR-01, FR-02 · Milestones: M1, M2

本章所有格式都是 mkfk v1 自訂，並非 Kafka message format。外部概念參考見 [來源 S2](06-decisions-sources.md)。

## 1. 資料模型與 offset

一個 partition 對應一條有序 WAL。WAL entry 有 `log_index`、`term`、`kind`、`payload`；DATA entry 包含一個完整 batch，每個 record 是 nullable key bytes + required value bytes。空 value 合法，不代表刪除。v0.1 不做 tombstone/compaction，也不支援 record headers。

DATA payload 至少包含：`base_offset`、`record_count`、`append_timestamp_ms`、records；M5 加上 `producer_id`、`producer_epoch`、`first_sequence`、`batch_digest`。所有 64-bit 整數在 JSON payload 中用 decimal string。非冪等的 M1–M4 fixture 以 `producer_id=null` 表示；M5 完成後對外 produce 不接受此模式。

Leader 在 partition actor 中串行分配 `base_offset=LEO`，batch count 為 k 時 offsets 為 `[base_offset, base_offset+k)`，local LEO 增加 k。不得跨 batch 跳號；未 commit 的分配只存在 local log，不能先當作 producer 成功結果。control entry 不增加 record offset。

已 commit 的 DATA entries 保持 offset 連續；衝突截斷後 LEO 由剩餘有效 entries 重算，允許尚未提交的 offsets 重用。`append_timestamp_ms` 由 leader 提案時指定並複製相同值，不用於排序、選主或 timeout。

## 2. Disk layout

```text
data/<node-id>/
  node.lock
  manifest.json
  partitions/<topic>/<partition>/
    hardstate.json
    00000000000000000001.wal
    00000000000000000001.idx
    00000000000000000217.wal
    00000000000000000217.idx
```

檔名數字是 segment 第一個 internal log index，不是 record offset。每 partition 只有最後一個 segment 可以 append；sealed segments 不再修改，除了 Raft 合法衝突修復可能移除整個未提交 suffix。

manifest 包含 storage_format_version、cluster_id、node_id、固定 topology manifest 的 SHA-256。實際拓撲檔案是 `cluster.json` 的精確 UTF-8 bytes，所有節點分發同一份；不依賴各節點重新序列化 JSON 得到相同 digest。

格式化必須顯式執行、目錄必須為空；已有 manifest 时只驗證不覆寫。cluster、node、format 或 config digest 不匹配即拒絕啟動。使用 OS advisory lock 限制同 data dir 只有一個 process；不能只看 PID file 是否存在。

Topic 限制為 ASCII `[A-Za-z0-9][A-Za-z0-9_-]{0,63}`；名稱以 `__mkfk_` 開始者只允許 internal bootstrap。不得把未檢查字串直接拼接為 filesystem path，也不得跟隨資料目錄內指向外部的 symlink。

## 3. WAL frame v1

所有 header 整數使用 big-endian；長度先驗證再 allocate。WAL 沒有額外 file header，每個 frame 自帶 version，整體版本由 manifest 驗證。

| 順序 | 欄位 | bytes | 規則 |
| --- | --- | --- | --- |
| 1 | frame_length | 4 | 後續 bytes 數，必須等於 `28 + payload_length` |
| 2 | crc32c | 4 | Castagnoli CRC，涵蓋 version 到 payload 結尾，不含 length 和 CRC 自身 |
| 3 | format_version | 2 | 固定 1 |
| 4 | kind | 1 | 1=DATA、2=NOOP、3=FENCE、4=GROUP |
| 5 | flags | 1 | v1 固定 0，未知 flags 拒絕 |
| 6 | log_index | 8 | 1..MaxInt64，連續 internal index |
| 7 | term | 8 | 1..MaxInt64；standalone storage fixtures 使用 term=1 |
| 8 | payload_length | 4 | UTF-8 JSON payload 的 bytes 數 |
| 9 | payload | variable | 嚴格 schema；NOOP 為空 JSON object |

完整 frame 大小為 `32 + payload_length`，上限 4 MiB。算術先轉安全的寬整數並檢查 overflow。frame checksum 正確後仍需驗證 JSON schema、record_count、base64、record bytes 上限、offset/sequence overflow、保留欄位與 kind 對應。

DATA followers 原樣儲存 leader 的 frame/payload bytes，不自行改 timestamp、digest 或重新分配 offset。收到相同 index/term 但不同內容視為協定／資料損壞，不默默接受。

M0 必須加入固定 hex golden vectors：空 value、null/empty key 差異、多 record、NOOP、FENCE、GROUP、CRC 錯誤、length overflow。既有 format 修改須升版並提供 migration 或明確拒絕舊格式。

## 4. Append 與 durability

Partition owner 將整個 batch 編成單一 frame。可在一次系統呼叫／sync 前串接多個完整 frame，但各 caller 只能在自己的 durability barrier 完成後被視為已持久。

順序：validate → serialize/allocate offset → write-all → `File.Sync` → 通知 persistence completion → 才可計入 self durable match 或回覆 follower append 成功。partial writes 必須繼續寫剩餘 bytes；任何失敗停止該 partition 新寫入並進入 recovery-required 狀態，不能在不明確尾端後繼續 append。

M1 的 storage append success 只保證本機 durability。M3 起對外 produce success 必須再通過 replication/apply gate；不能將 storage callback 直接連到 HTTP success。

term、vote、commit floor 使用 `hardstate.json`：version、current_term、voted_for（可為 null）、commit_index。寫 temp → sync temp → atomic rename → sync containing directory。先 sync WAL，再提升 commit_index；不得讓 hardstate 引用尚未持久的 entry。vote 或 term 變更也要先持久，再發送依賴該狀態的 RPC。

index 寫入失敗不回滾已提交 WAL；標記 index invalid 並重建，必要時暫停 reads。避免以獨立 index 寫入作為資料 commit 的第二條路。

## 5. Segment rotation

預設 segment 64 MiB；下一個完整 frame 放不下時先 sync/seal 現有 segment，使用下一個 log_index 建立新檔。建立檔案後 sync directory，再將它對外視為存在。frame 永不跨 segment。

啟動時從 `.wal` 檔名與連續 frame index 找出有效順序；不依賴可能半更新的 segment manifest。空的最後一個 segment 可重用；中間空檔、重複 index、檔名與首 index 不符、segment 缺口一律報錯。

v0.1 不執行時間或容量 retention。容量上限不是刪除舊 records 的授權。

## 6. Sparse offset index

每個含 DATA 的 segment 至少記錄第一個 DATA frame，之後當距離上一 anchor 已跨越 4 KiB WAL bytes 時，為下一個 DATA frame 建立 anchor。大量 control entries 沒有可讀 record，不為它們建立 data offset anchor。

Index entry：`base_offset:uint64, file_position:uint64, log_index:uint64`，共 24 bytes；base_offset 與 file_position 嚴格增加。`.idx` 檔為：`MKIX` magic 4 bytes、version uint16=1、reserved uint16=0、entry_count uint64、entries、最後 crc32c uint32（涵蓋前面所有 bytes）。它是可丟棄的 cache，不是 truth。

讀取 offset o：

1. 以各 segment 的第一／最後 DATA offset 範圍 binary search 選 segment。
2. 在該 segment 的 anchor 中找最大 `base_offset <= o`。
3. 從 anchor 掃描完整 frames，跳過 control entries，在含 o 的 batch 找到 record。
4. 按 byte/record budget 讀取，遇到 HW 截止；不能回傳半個 record。

複雜度為 `O(log S + log I + K)`：S 為 segment 數、I 為該段 anchor 數、K 為局部掃描工作量。含 control-only 區段時必須利用 segment 的 DATA 範圍資訊跳過無關 segment；不能宣稱所有情況都只需一次 disk seek。M2 要量測掃描 bytes/frames，不只量 wall-clock。

Index 不存在、CRC/version 不符、offset 不合理或指向錯誤 frame 時，從 WAL 重建。不得為滿足 index 損壞而修改資料。normal reads 不在每次請求重建 index。

Index 可以涵蓋尚未提交尾端，但 Fetch 必須以 HW 限制可見性；發生合法 truncate 後重建受影響 anchors。

## 7. Restart recovery

啟動尚未 ready 時取得 lock、驗證 manifest/hardstate，再逐 segment 讀取合法 frame。檢查 length、CRC、version、kind、log_index/offset 連續性；建立 sparse index 及 log-index → DATA offset 的必要 metadata。

只有最後 active segment 的**不完整尾 frame**可自動截短：不足 4-byte length，或已取得合法 length 但 EOF 落在 frame 中途。還必須證明最後完整 index 不小於 durable commit_index。truncate 後 sync 檔案與必要的 directory metadata，留下 recovery event。

以下 fail closed：完整 frame CRC 錯誤、非法長度／version、sealed segment 損壞、中間 index 缺口、commit floor 超過有效 prefix。不可把任意尾部垃圾都當成 benign torn write。

掃描完整 WAL 可以恢復 local LEO；只有 `index <= durable commit_index` 的 commands 能初始 apply 為 committed state。尚未 commit 的完整尾端保留給 Raft reconcile，不自行刪除，也不提供 consumer。

Raft 啟動後透過 leader term barrier 重新確認 commit，再按順序 apply。producer epoch/sequence cache、group generation/offsets 必須由相同 prefix 重建，index cache 不能代替 state-machine replay。

## 8. 合法 suffix truncation

只有 Raft 驗證 prev index/term 後發現衝突，才可呼叫 `TruncateSuffix(from_index)`。`from_index <= commit_index` 是 fatal invariant violation，不可修復成「接受 leader 的版本」。

截斷第一個衝突 frame 及後續 segment，sync 受影響檔案與 directory；更新 LEO、anchors、pending writes 與 speculative producer reservations。已 apply 狀態不應需要 rollback，因為 committed prefix 不可被截斷。

Reader 持有 segment handle/refcount 或 actor-issued stable read view；不能在它讀取時關閉／重用 file descriptor。已提交 DATA reads 不應落入被截斷區域，但 metadata cache 仍須失效。

## 9. 容量與資源失敗

每 partition user soft budget 1 GiB，另預留 64 MiB 給已接受的 in-flight writes、replication reconcile 與 control entries。容量判斷包含 active/sealed WAL 和衍生 index，不只 payload。

到 soft limit 回 `RESOURCE_EXHAUSTED`，不新接受 user DATA。實際磁碟不足或 reserve 耗盡則停止需要 durability 的操作並降低 readiness；保留資料、告警，不以刪舊 WAL 或清空去重狀態換取成功。

reserve 不是無限可用性的保證。node 可因容量不足落後，peer 需移除其 ISR 資格，但仍保留固定 voter 身分；沒有足夠健康 quorum 時 cluster 不可寫。

## 10. 模組介面契約

M0 可以調整 Go 方法拼字，但必須保留語意：

| 操作 | 結果與必要約束 |
| --- | --- |
| `OpenPartition(config)` | recovered log + durable hardstate；未 ready，不自動格式化 |
| `AppendEntries(entries)` | persistence completion；只有 sync 成功才標示 durable |
| `ReadEntries(fromIndex, budget)` | replication 讀取，與 user offset Fetch 分開 |
| `ReadRecords(offset, hw, budget)` | 不越過呼叫者的 committed visibility boundary |
| `Term(index)` | election/log matching 使用，不能用 record offset 代替 |
| `PersistHardState(state)` | durable term/vote/commit floor，monotonic validation |
| `TruncateSuffix(index)` | 嚴禁進入 committed prefix，同步更新衍生索引 |
| `Close()` | bounded shutdown，傳播 sync failure，釋放 lock |

測試與驗收 IDs 見 [04](04-validation.md)。
