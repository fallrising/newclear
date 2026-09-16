# 02 — Replication, ISR and commit boundaries

[回主 SDD](../../SDD.md) · Requirements: FR-03, FR-04 · Milestones: M3, M4

這是 mkfk 自訂的教學型 Raft broker，不是 Apache Kafka partition replication 的相容重製。比較依據見 [ADR-002 / S2 / S3 / S5](06-decisions-sources.md)。

## 1. 拓撲與 fault assumptions

每個 user partition 使用獨立固定 Raft group。cluster profile 固定 voters `{1,2,3}`，quorum=2；standalone profile 固定一 voter，quorum=1。所有 partitions 暫使用全部 brokers，不做動態 membership 或 leader placement balancing。

internal `__mkfk_groups` 使用相同 Raft 機制，但不是 user DATA stream。靜態 cluster manifest 描述 cluster_id、broker IDs、peer/client addresses、topics、partition IDs、replica sets 和 min_isr。所有 RPC 驗證 cluster/config/group identity；這是誤配置保護，不是 authentication。

Safety 不依賴 timeout 的準確性。Liveness 需要多數節點最終可通訊、磁碟可用且 scheduler 最終推進；測試需把網路穩定的起始時間標出，不能要求任意永久分割都能完成 election。

## 2. Raft core 與 adapter 邊界

Core 提供 deterministic `Step(event)`、`Tick()`，輸入包括 received RPC、timeout、persistence completion。輸出是待持久狀態、待傳 RPC、待 apply entries 和 role events。clock、random source、disk、network 由 adapters 提供。

Partition event loop 是 state 唯一 writer；adapter 可以平行 I/O，但必須使用 operation/term token 把 completion 配回正確狀態。取消 context 不等於取消已寫入的 entry。

Persistent state：currentTerm、votedFor、WAL；mkfk 另持久化 commit_index 作為恢復與腐敗檢查的 conservative floor。Volatile state：role、leaderId、election timer、nextIndex、matchIndex、read requests、pending produces、ISR observations。lastApplied 由 committed-prefix replay 重建。

## 3. Election

Follower timeout 後進入 candidate：currentTerm+1、votedFor=self，先持久化再送 RequestVote。election timeout 預設在 600–1,200 ms 之間選取，heartbeat 100 ms；測試由固定 seed/fake clock 控制。

RequestVote 欄位：cluster_id、config_hash、partition_id、candidate_id、term、last_log_index、last_log_term。比對 log freshness 使用 `(last_log_term, last_log_index)` lexicographic ordering，不能改成 LEO 大小或 ISR membership。

Receiver 僅在 request term 不舊、該 term 尚未投他人、candidate log 足夠新時投票。較高 term 必須更新 persistent term 並退為 follower；投票成功回覆前 sync。相同 term 重送同一 candidate 的投票可重複回覆相同結果。

取得固定 voters 的 majority 才可成 leader。leader 初始化本 term replication tracking，追加本 term NOOP，等 NOOP durable quorum committed 並 apply 完成之前，不接受新的外部 produce/open-producer，也不提供 leader reads。這是 leader-ready barrier。

Pause 後甦醒的旧 leader 可能尚不知道新 term；它不能因自認 leader 而跳過 quorum。收到較高 term 立即退位並取消未完成回覆等待；資料是否提交仍可能未知。

## 4. AppendEntries 與 follower durability

RPC 欄位：cluster/config/group identity、leader_id、term、prev_log_index、prev_log_term、entries、leader_commit、rpc_id。payload 有 frame/count/byte cap，不能一次傳完整無界 log。

Follower 處理順序：

1. 拒絕舊 term／錯 cluster/config；較高 term 先持久化並退位。
2. 驗證 prev entry 存在且 term 相同；不相同回 conflict hint，不改 committed prefix。
3. 相同 index/term 的 entries 視為重送；內容不一致為 corruption。第一個 term 衝突處截斷未提交 suffix，再追加新 entries。
4. sync WAL／hardstate 後才回 `success=true, matched_index`。
5. follower commit 最多推到 `min(leader_commit, verified_match_index)`；verified_match_index 是本 RPC 證實與 leader 一致的 prefix 末端（prev + 本次 entries），不能拿未知一致性的 local extra tail 當作證據。

Heartbeat 無新 entry 時也要驗證 prev；不能只靠較大 leader_commit 就提交可能衝突的 local 尾端。重複／亂序 replies 只能更新相同 term、正確 peer 的有效 progress，不能使 nextIndex/matchIndex 無根據前進。

## 5. Commit 與 apply

Leader 的 self matchIndex 僅計入已 sync entries。選最大的 N，使固定 voters 中至少 quorum 個 durable matchIndex >= N，且 `term(N) == currentTerm`，才能依此推進 Raft commit_index。不要用多數已複製的舊 term entry 直接推進；由本 term entry 提交帶動之前 prefix。

Persist commit floor 後，依 index 順序 apply；每個 DATA frame 的 producer metadata 与 record bytes 是同一個 entry。NOOP 只推進 internal index；FENCE 更新 producer epoch；GROUP 更新 coordinator state，不消耗 user offsets。

Leader-ready NOOP 也會令繼承的合法舊 term tail 在 quorum 上確定，接著完成 producer state 重建；不得在此之前接收重試並誤判為全新 batch。

## 6. LEO、HW 與空間映射

定義 `data_end(c)` 為 internal prefix `index <= c` 中最後一個 DATA entry 的 `base_offset + record_count`；沒有 DATA 時為 0。

```text
HW  = data_end(lastApplied)
LEO = data_end(local lastLogIndex)
0 <= HW <= LEO
```

lastApplied 永遠 <= commit_index。消費者只看 `[0, HW)`。leader 切換後，必須先完成新 term barrier 與 state replay，再公開此 term 的 HW；任何曾公開的 committed prefix 都不可丟失。

例如：index 1=NOOP，index 2=DATA(offsets 0,1)，index 3=FENCE，index 4=DATA(offset 2)。當 commit/apply 到 index 3 時，HW=2，不是 3 或 4；offset 2 尚不可讀。這個 fixture 必須存在。

## 7. ISR observation algorithm

ISR 為本 term 的追趕／健康集合，leader 自身在 healthy storage 時屬於 ISR。Follower 僅在本 term 的成功 durable AppendEntries reply 證明它追上捕捉的 leader tail target 後加入。

每 peer 追蹤 `last_success_at`、`catchup_target_index`、`last_caught_up_at`、`durable_match_index`。target 在成功追上後更新到當時 leader lastLogIndex；到達 target 才更新 caught-up 時刻。不能每收到一點進度就重設所有 lag timeout，否則永久落後的 follower 可能永遠留在 ISR。

預設 freshness/lag window 2 秒：超過 2 秒沒有成功聯繫，或超過 2 秒沒完成追上 target，便移出 ISR。idle leader 下成功 heartbeat 可證明 current tail 已匹配並維持資格。

新 leader term 將 peer observations 清空，重新以本 term ACK 建立 ISR。這可能暫停 user admission，但不妨礙 Raft NOOP、replication 或 internal metadata 恢復。

ISR metrics 必須回報 term；舊 term 的慢回覆不能將 peer 加回。健康恢復且真正追上後才可重新加入。

**ISR 不是 consensus membership。** 即使 ISR 只剩 leader，固定 RF=3 的 quorum 仍是 2。Raft RequestVote 以 log freshness 決定資格，不以某個舊 leader 的本機 ISR 判斷投票。

## 8. `acks=all` 的本案精確定義

核心版只接受 `acks="all"`。這個名稱便於學習，但語意採下面的保守 mkfk profile，而不是聲稱 Kafka-compatible。

新 DATA admission 時，要求當前 ISR 數量 >= min_isr，並捕捉不可變集合 `A = current ISR`。把 A 及 entry index 與 pending operation 綁定。A 包括 leader。

成功回覆必须同時滿足：

- 該 entry 在固定 voters 的 durable majority 上滿足完整 Raft commit 規則，且已 apply。
- A 中每個 replica 都曾在本 term 確認 durable matchIndex >= 該 entry index。
- handler 仍属于有效的 leader operation；已得知更高 term 時不再回覆舊 leader success。

後來 ISR 變小不能免除 A 的等待；加入新 ISR 成員也不擴大已捕捉的 A。若 A 的某個節點失效，該次 request 可 timeout；相同 batch retry 在目前 leader 重新捕捉一個符合 min_isr 的 gate，等待現有 entry 的 durability，不再 append。

HW 由 Raft committed/applied prefix 定義，不由 A 決定，因此 **request timeout 的資料仍可能已可讀**。API 必須將該 timeout 標為 outcome unknown。

admission 時 ISR 不足且尚未 append，可確定回 `NOT_ENOUGH_REPLICAS`。append 後 quorum/ISR wait timeout 回 `REQUEST_TIMEOUT`，不能回「沒有寫入」。metadata/FENCE/GROUP internal commands 使用 durable Raft majority，不受 user DATA 的額外 ISR gate 阻塞。

## 9. Linearizable read barrier

v0.1 不提供 follower reads，也不做 clock-based leader lease。每次 Fetch 的 read barrier 需：已提交 current-term entry、以唯一 read context 取得本 term majority heartbeat confirmation、記錄 readIndex，等待 lastApplied >= readIndex。

不能只檢查記憶體的 leader flag。隔離舊 leader 無法取得新的 quorum read confirmation，故回錯誤／timeout，而不是繼續回覆貌似最新的資料。

長輪詢被 data commit 喚醒後，在實際回覆前重新確認可用的 read barrier/role；不能沿用數秒前已失效的 leader 認知。ReadIndex 可以在同一輪合併多個 waiter，但要證明每個 waiter 的線性化時間位於其 request/response 區間。

## 10. 典型故障的期望

| 故障 | MUST 行為 |
| --- | --- |
| leader local append 後、未到 quorum 即 crash | 不宣稱成功；tail 可能保留後提交，也可能被截斷 |
| quorum commit 後 reply 遺失 | consumer 可能已看見；同 batch retry 回同 offsets |
| leader 被隔離，另兩台選出 leader | 舊 leader 新寫入不可成功；新 leader 保留已提交 prefix |
| 單 follower 長期落後 | ISR 驅逐，但 voter set 不變；現有 A waiter 不自動放行 |
| follower 恢復 | 先 log reconcile，再 catch up，再重新進 ISR |
| 同時失去兩台 | 無 quorum 的 writes/read barriers timeout 或 fail，不能降 RF |
| 全部 process 重啟但磁碟保留 | term/vote/log 恢復，NOOP barrier 後服務，不重新 format |
| disk sync failure | 不回 durable ACK，不計入 match progress，隔離 replica |

## 11. 必備可觀察性

至少具備 role/term、leader changes、durable log index、commit index、lastApplied、LEO、HW、ISR size、per-peer lag、pending ack waiters、quorum failures。事件包含 cluster/node/topic/partition/term/request_id，但不包含 record payload。

ISR transitions 必須能與 captured A、Raft commit 及 HTTP timeout 對照，讓 reviewer 解釋「為什麼 timeout 但仍讀得到」而不是把它誤當資料重複 bug。

驗收與反例清單見 [04](04-validation.md)。
