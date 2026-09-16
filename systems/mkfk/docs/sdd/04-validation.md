# 04 — Verification and evidence plan

[回主 SDD](../../SDD.md)

**執行狀態以 [implementation status](../STATUS.md) 與對應 evidence manifest 為準。** 本文件是 acceptance contract，不是測試報告。測試名稱／ID 必須出現在測試程式或 evidence mapping，不能只存在文案中。

## 1. 測試層級

Pure unit tests 驗證 codec、offset mapping、assignment、sequence、Raft transition。Model tests 以固定 seed 的事件排程模擬 loss、delay、duplication、partition、crash。Storage integration 使用真實暫存目錄與 child process，逐 durability cutpoint 重啟。Cluster tests 使用三個獨立 process／data dir；Compose 是額外包裝，不是單機 unit tests 的必要依賴。

所有時鐘和亂數可注入。Safety assertions 不以 elapsed time 推斷；liveness 測試明確給定網路最終穩定和 I/O 上界，才設定 deadline。失敗必須保存 seed 與 event history。

## 2. Requirement → acceptance mapping

### Storage: FR-01 / FR-02，INV-02 / 03 / 10 / 12

| ID | Given / When | Then |
| --- | --- | --- |
| ST-01 | 空 partition append 3 個 multi-record batches | DATA offsets 由 0 連續；讀取 bytes 與輸入一致 |
| ST-02 | null key、empty key、empty value、binary bytes 與邊界長度 | 可正確 round-trip；非法／超長輸入在 write 前拒絕 |
| ST-03 | sync 成功後回覆本機 append，再 SIGKILL/restart | 所有已確認本機 records 保留，offset 不重設 |
| ST-04 | 在 frame header/body 各切點注入 partial write | 只修復未提交 active tail；不虛報已 durable |
| ST-05 | 完整 frame CRC 錯誤或 committed prefix 缺損 | 受影響 partition fail closed，不能略過壞資料繼續服務 |
| ST-06 | 寫入至少 3 segments，跨邊界讀取 | 無 record 遺失／重複；frame 不跨 segment |
| ST-07 | 隨機 offset seek，有大 batch 與 control-only 區段 | 結果對應 reference log；記錄 index comparisons 和掃描 bytes，證明不是每次全 log scan |
| ST-08 | 刪除／損壞 `.idx`，保留正常 WAL | 重建得到同樣讀取結果；WAL bytes 不變 |
| ST-09 | truncate 未提交 suffix 與嘗試 truncate committed prefix | 前者重新計算 LEO/index；後者 fatal reject，committed bytes 不變 |

ST-03 的成功 sync 假設由平台提供；SIGKILL 不是突然斷電驗證。需要另列 platform power-loss test 才能聲稱驗證該硬體保證。

### Replication: FR-03 / FR-04，INV-01 / 03 / 04 / 05 / 06

| ID | Given / When | Then |
| --- | --- | --- |
| RP-01 | 同 term 重複、亂序及競爭 RequestVote | durable vote 不重投其他 candidate；最多一個合法 majority leader |
| RP-02 | vote persist 前／後 crash/restart | 未 sync 不送成功票；已 sync 後重啟仍保留 vote |
| RP-03 | candidate LEO 較大但最後 term 較舊 | 依 lastTerm/lastIndex freshness 拒絕，不能以 data offset 選主 |
| RP-04 | log suffix 不同，AppendEntries 重送／亂序 | 只截斷未提交 conflict；matching prefix 與 committed data 不變 |
| RP-05 | 多數已有舊 term entry，但沒有 current-term commit 證據 | 不以錯誤規則直接推進 commit；NOOP barrier 後才服務 |
| RP-06 | 一台 leader 隔離，另外兩台成新 leader | 舊 leader 的新 write/read barrier 無成功結果；已成功記錄由新 leader 保留 |
| RP-07 | 所有 processes 重啟、磁碟保留；另測兩台不可用 | 前者恢復已提交 prefix；後者不以單節點自動降級成功 |
| RP-08 | follower 持續有少量進度但超過 lag window 未追上 target | 被移出 ISR；heartbeat 不能永久掩蓋 lag |
| RP-09 | ISR 從 3 降到 2，某 pending operation 的 A 原為 3 | 該 operation 不因縮 ISR 被放行；重試可以新 gate 等同一 entry |
| RP-10 | NOOP/DATA/FENCE/DATA 混合，commit 到第三個 internal entry | HW 按 DATA offsets 映射，未提交下一筆不可讀 |
| RP-11 | follower 恢復但 log 未追上，舊 term ACK 延遲到达 | 未達標不得重入 ISR；舊 ACK 不改本 term progress |

另需明確測試 follower `leader_commit` 的上限來自本 RPC 證實一致的 prefix，而不是它可能分歧的 local extra tail。

### Producer: FR-05，INV-01 / 07

| ID | Given / When | Then |
| --- | --- | --- |
| PR-01 | 同 identity/epoch/sequence/digest 重送 100 次 | 只有一個 DATA batch，全部成功結果 offsets 相同 |
| PR-02 | quorum commit 後故意丟失 reply，再 retry | 回既有結果，不新增 records；client sequence 不提前增加 |
| PR-03 | commit 後 leader crash，新 leader 收到 retry | barrier/replay 後仍去重；不能只依賴舊 leader RAM cache |
| PR-04 | 相同 sequence 不同 bytes、缺序、重疊、超出 dedup window | 對應 typed error；log 不新增錯誤重試 |
| PR-05 | OpenProducer reply 丟失、同 request_id 重送，再增加 epoch | 第一次重送不重增 epoch；舊 epoch producer 被 fence |
| PR-06 | WAL 中未提交 DATA/FENCE 被截斷，節點重啟 | 未 apply 狀態不污染正式去重／epoch；既有 committed 狀態不回退 |
| PR-07 | CLI 在 pending ledger write/send/ack/update 各切點 crash | 恢復後重送相同 batch，不能用新 sequence 規避 unknown outcome |

相同業務 event 由不同 producer IDs 發送可出現兩次，這不違反本案 transport-idempotence；測試 oracle 必須區分 business identity 與 protocol identity。

### Consumer groups: FR-06，INV-08 / 09

| ID | Given / When | Then |
| --- | --- | --- |
| CG-01 | 3 partitions，1/2/3/5 members 與亂序 join | deterministic round-robin，覆蓋全部 partitions，不重複；多餘 member 可空 assignment |
| CG-02 | 同 topic 的兩個不同 group | assignment 與 committed offset 完全獨立 |
| CG-03 | member join/leave/timeout，含不回 revoke 的 member | generation 增加；SET_ASSIGNMENT commit 後才發新 assignment |
| CG-04 | 舊 generation、非 owner、apply 前剛好 rebalance 的 commit | 全部拒絕，不能更新 offset |
| CG-05 | process 後 commit 前 crash；另測成功 commit 後 crash | 前者允許重處理；後者從 durable next offset 恢復 |
| CG-06 | coordinator failover/restart | committed offsets 保留；舊 sessions 重新加入，generation 不重用 |
| CG-07 | offset > HW、回退 offset、多 partition 部分非法 | 拒絕；單次 command 不出現部分 offset 已提交 |

不得用「只有一份 assignment」推導 external side effect exactly-once。測試需展示 stale worker 可能仍在運作，但其 commit 已被 generation fence 拒絕。

### API / resource / integration: FR-07 / FR-08，INV-11 / 12

| ID | Given / When | Then |
| --- | --- | --- |
| OP-01 | malformed/duplicate-key JSON、巨大 length、bad base64、path traversal、未知 ack | bounded parse、typed rejection，不 panic、不在 filesystem 越界 |
| OP-02 | 同 data dir 雙 process、錯 cluster/node/config | 第二個或錯誤 process 啟動失敗，不覆寫資料 |
| OP-03 | request flood、slow clients、long-poll storm、disk-full/sync-fail | queue 和 byte reservations 不超 cap；backpressure；無 false durable ACK |
| OP-04 | metadata 指向舊 leader、RPC 延遲／回覆遺失 | bounded retry 且保留 partition/identity；沒有無限 goroutine 或自動 ack downgrade |
| OP-05 | 三 broker、producer、兩個 group，輪流 crash leader/follower/coordinator | acknowledged batches 不遺失、不因 retry 重複；offset/assignment invariant 成立 |
| OP-06 | shutdown/restart、metrics endpoint 與 event history | pending 結果清楚、退出有界、資料保留；觀察資料不洩露 payload／credentials |

## 3. Deterministic model testing

使用獨立簡化 reference model，而不是以同一套實作當 oracle。記錄事件：client operation start/result、node role/term、AppendEntries、durability completion、commit/apply、ISR transition、group generation、fault actions。

Safety oracle 至少逐步檢查：成功結果屬於所有未來已確認 leader 的 committed prefix、committed offsets/bytes 不被修改、consumer history 不包含 uncommitted offsets、同 producer batch 不被重複 append、generation 內 assignment 不重疊、stale commit 無效果。

模型中的磁碟區分「write 已到 volatile buffer」與「sync 已完成」；crash 時可丟失前者。不能讓 in-memory transport fake 自動帶出 fsync durability 而漏掉 persistence ordering bug。

最低 gate：M3/M4 每次 PR 100 seeds × 1,000 events；M7 提供可選 extended profile 1,000 seeds × 10,000 events。這是測試預算，不是證明已涵蓋所有 execution。CI 資源不足時必須公開調整 profile，不默默把 safety test 關掉。

## 4. 真實 process 故障矩陣

至少在 local WAL sync 前、sync 後未發 follower ACK、leader quorum commit 後未回 client、group offset commit 後未回 client 四個切點中斷 process。用測試專用 hooks 與 child PID，不依賴碰巧的 sleep。

網路故障用 test transport 或受控 local proxy，包含單向和雙向 partition。不得修改 host-wide firewall、使用任意 `pkill` 或對既有 volume 執行清理。

每次 fault 應產生可讀的時間線：哪個 request 已被承諾、哪些結果 unknown、哪些 replica durable、哪個 term 成功服務。未知結果可以稍後出現在 log，不計為 false positive。

## 5. Performance measurement，不先承諾數字

先跑 correctness，再做 profile。基準 workload 至少包含：RF=1 / RF=3，min_isr=1 / 2，1 KiB records，batch size 1 / 100，單 partition / 3 partitions，warm cache / cold restart。每個 run 預熱 10 秒、量測 60 秒，重複 3 次；不得使用非預設 ack 或關閉 sync 而不註明。

報告吞吐 records/s、bytes/s、produce/fetch p50/p95/p99、CPU、RSS、WAL/index bytes、fsync latency、index seek 掃描量及 recovery duration。列出機器 CPU/RAM、filesystem、磁碟類型、OS/kernel、Go patch、commit SHA、seed 和完整 config。

正確性要求是硬 gate；性能最初只建立可重現 baseline。沒有 benchmark evidence 前，不在 README 填入目標吞吐或與 Kafka 比較勝負。後續性能 gate 可採相同機器/config 的回歸比例，但需另附量測噪音分析。

## 6. Evidence 與交付

每次驗收保存一個 manifest，至少包含：milestone、commit、toolchain、commands/exit codes、seeds、fault schedule、assertion IDs、metrics summary、限制。small scrubbed summaries 可放 `docs/evidence/`；大 logs/history 作为 CI artifacts，預設不提交進 monorepo。

建議 evidence 檔名為 `<milestone>-<commit-short>-<seed>.json`，fixture 和示範資料不得含真實使用者資料。不能只上傳截圖代替機器可驗證結果。

## 7. CI 邊界

未来 workflow 位於根 `.github/workflows/mkfk-ci.yml`，只對 `systems/mkfk/**` 和 workflow 自身變更觸發，working directory 為 component。必須遵守 repository 現有 [Monorepo CI 規範](../../../../docs/specs/monorepo-ci.md)：read-only token、SHA-pinned actions、timeout、cancellation、no persisted checkout credentials，無 release/deploy/publish。

M0 建立格式、schema、unit gate；M3 再接 process integration/model tests，M7 加 end-to-end profile。未建立的 gate 不准以空 target／固定 exit 0 冒充通過。這次純文件 baseline 不新增 workflow，也沒有執行上述 runtime tests。
