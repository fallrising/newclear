# 02 — Backend SDD

狀態：proposed。Cloudflare 依據見 [S02–S07、S19](../SOURCES.md)，wire contract 以 [05](05-contracts-and-security.md) 為準。

## 1. Cloudflare 職責

| 服務 | 責任 | 不負責 |
| --- | --- | --- |
| Workers + Static Assets | UI、HTTP API、身分／授權、schema／配額、scheduled maintenance | 長時間 shell、OS image build、VM hosting |
| D1 | nodes、credentials、設定、有限 metrics、job state、audit、outbox、log manifests | 無界全文 log、每條高基數指標各一筆 |
| SQLite-backed DO | workspace 訂閱與 WebSocket hibernation、可丟棄 invalidation | 主機是否已完成副作用的權威、另一份 job queue |
| Private R2 | immutable scripts／manifest、壓縮 log chunks、有限 job outputs | 公開下載站、未授權任意物件讀取 |

先用單個 workspace DB，所有資料帶 workspace_id；禁止跨 workspace 查詢。未測得瓶頸前不分片。上報、node authentication、human authentication、artifact download 有獨立 route policy，machine route 不會被導向人類登入頁。

## 2. 資料模型

| Entity | 最小欄位與約束 |
| --- | --- |
| Node | id、workspace_id、enrollment_generation、display_name、tags、os/arch、agent_version、host_authority、mode、last_seen_received_at、init_state、revision |
| NodeCredential | id、node_id、generation、public_key、purpose、valid_from/to、revoked_at；collector/courier 不共用用途 |
| Enrollment | id、token_hash、workspace、expected_fingerprint／綁定資訊、expires_at、consumed_by_key、status |
| MetricSample | node_id、generation、boot_id、seq、observed_at、received_at、bounded metrics payload；唯一 `(node_id,generation,boot_id,seq)` |
| RecipeVersion | recipe_id、version、artifact_sha256、manifest_sha256、param_schema、platforms、run_as、capabilities、pre/postcheck、retry_policy |
| JobRun | id、workspace、manifest digest、approval reference、state、created_by、revision；初版單目標 |
| JobAttempt | job_id、node_id、generation、attempt_id、fence、lease_owner/until、deadline、result_digest、state；本地 journal 對應同一 attempt |
| AuditEvent / Outbox | actor、action、resource、transition_id、received_at、redacted detail；各有唯一 event ID |
| LogChunk | node/source、cursor range、time range、object_key、digest、bytes、record_count、dropped_count、state |
| AlertRule / Incident | scope、threshold/window、cooldown、maintenance、transition、notification status |

所有 query 使用 bound parameters。新建立 job、claim、取消與 revoke 讀取主庫並在寫入時重新驗證條件，不以過期 read replica／cache 授權。Read replication 留後續性能 gate。

## 3. 上報與一致性

metrics endpoint 驗證身分／body size／schema／timestamp envelope，再去重、落庫、回覆已 durable 接收的 seq。相同 identity+seq 且不同 body digest 回 409。補報樣本保留 observed_at，但不以旧样本更新 fresh health；`last_seen` 由當次有效 heartbeat 收到時間決定。

P0 允許 latest view 由按 node/time 索引的 sample 查詢得到，不強制每份上報再更新多張統計表。若保存 nodes.last_seen 或 latest projection，要把每次寫入放大算進容量測試。資料先持久化才給 durable ack；DO broadcast 失敗不撤銷已落庫資料，前端下次 snapshot 可收斂。

## 4. Job transaction 與投遞

D1 是唯一 job authority。使用有條件 UPDATE／INSERT 與 revision/fence；狀態變更、AuditEvent、Outbox 在一個 D1 batch transaction 中完成。[S19](../SOURCES.md#s19) **SQL statement 執行成功但更新 0 行不會自動代表 transaction 失敗**；後續 audit/outbox 必須以相同 transition_id 及條件選取變更結果，不能無條件插入假成功事件。M0 必須用競爭 claim、0-row CAS、rollback fixtures 驗證 SQL 實作。

Agent 用 outbound claim 取得一個綁定 node/generation 的 attempt。每台主機同時最多一個 host-mutation job；courier 只傳遞，本地 execd 驗簽並持有 durable journal／lock。

Outbox 只送通知提示、非權威 read-model invalidation；送出成功但確認丟失可重送。若未來採 Cloudflare Queues，按 at-least-once 假設，不能取消同樣的 dedupe 和對帳。[S06](../SOURCES.md#s06)

過期 lease 僅將 attempt 標為 reconciling／unknown，不自動把有副作用的操作交另一個 worker 重跑。Job runtime deadline 由本地執行器 enforce；Cloudflare HTTP request lifetime 不是 job runtime。

## 5. R2 物件生命週期

artifact 先上傳 quarantined object → 伺服器驗 size/digest/type → 完成不可變 metadata → 才能引用於待批准 recipe。下載只接受 authorized object ID，不接受任意 URL／bucket key。內容不得被重寫到同一 digest；執行前再次 hash 驗證。

log chunk 先寫 R2，D1 commit manifest 後才回覆 ACK；中斷可能留下未被引用的 object，由有寬限期的 GC 清除。metadata 失敗不得回 durable ACK。GC 只刪確定無引用且超過寬限期的物件，與活躍上傳隔離；D1/R2 沒有跨產品 transaction。

原始 logs 在上傳前按本地 allowlist 限定來源並 redact；雲端仍視為敏感資料。查詢限 node/time/source、cursor、回傳 bytes，不提供任意 SQL 或無界掃描 R2。notification webhook 同樣要防 SSRF，不讓使用者指定 metadata／內網管理端點。

## 6. 即時更新、告警與故障

DO 使用 server-side WebSocket Hibernation API；constructor 重建可丟棄訂閱狀態，connection attachment 保存必要受限身分資料。不能只在握手時驗權：session 有效期、撤銷事件與定期重新驗權必須能關閉既有連線；事件本身不夾帶不必要的 log／secret。[S05](../SOURCES.md#s05)

離線判定初始設計 `received_at > 3 * heartbeat_interval + 30s`，Cron 每分鐘評估；這是容忍抖動的目標，不是秒級 SLA。資源告警用 sustained window、hysteresis、cooldown；維護期 suppress 通知但保留 incident。告警通知與狀態改變分離，有 dedupe key 及重試上限。

Worker/D1 不可用或權限系統失效時：拒絕新 job／claim、禁止 fail-open；Agent 只在界限內 spool／重試。已開始的本地任務依已簽署 deadline 和本地政策完成或終止，控制面不能承諾即時撤回。DO 故障只影響即時性，不代表所有主機 offline。R2 失效不允許執行拿不到或驗不了內容的腳本。

## 7. 實作布局與驗證

規劃 `backend/src/{domain,application,adapters,http}`、`backend/migrations/`、`contracts/`。domain 不 import Cloudflare binding types；JobStore 是 transaction 邊界，不抽象成各自獨立且無法原子操作的 generic CRUD repository。

測試需包括 Workers 本地 runtime + D1 integration、schema migrations upgrade／restore、ACL/IDOR、重放與重試、R2 部分失敗、DO 重啟、quota rejection。只有 disposable Cloudflare resources 的後續已授權測試，才能支持真實 quota／hibernation／平台相容性結論。
