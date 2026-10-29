# M1 實作契約（實作候選）

M1 使用 Workers Web APIs JavaScript、D1 SQL、Python 3.11+ 標準庫 runner、原生 HTML/CSS/JS；無套件管理器或第三方 runtime 依賴。Node 24 只作本機 Web API／SQLite 相容測試工具，不能代替 workerd／D1 live 驗收。

## 本輪與設計差異（ADR-08）

M0 是提案。M1 首個實作採 `cloudlab.m1` 有界 snapshot 協定，暫不實作通用事件、artifacts 上傳、Ed25519 callbacks 或 schema v1 的全部 operations。機器請求用 Python stdlib／Web Crypto HMAC-SHA256；每個 principal 獨立 ≥32 bytes secret，綁定 audience／credential generation，重放 nonce 持久去重。不能把這個 profile 當成 M0 Ed25519 的相容實作。後續非對稱協定須新 profile 和 vectors。

控制面只有一種 `node-health@1.0.0` Recipe。runner 自身是具名 `python-node-health` executor，以固定 stdlib 呼叫取得 `os.getloadavg()[0]`、`os.cpu_count()` 與 `os.statvfs("/")`。輸出整數 load_1m_milli、cpu_count、disk_free_percent；healthy 條件為一分鐘負載 ≤ CPU 數 ×2 且根目錄可用空間 ≥10%。unsupported／錯誤回 unknown，不以零代替。這是有限 OS 健康觀測，不代表所有服務健康；沒有任意檔案讀取、網路探測、shell 或服務管理。同 command 的 journal 記錄若是 started／missing，reconcile_only 只能回 unknown；不可重新執行。artifact 只含固定 collector JSON。

## HTTP

所有 request JSON ≤32768 UTF-8 bytes，拒絕重複 key、未知欄位、非有限數、浮點和無效 UTF-8。回應均有 request_id，錯誤 `{code,message,retryable,request_id}`。時間 UTC `YYYY-MM-DDTHH:mm:ssZ`。

Human：經驗簽 Access JWT 的 subject 對應 server-side grant；POST 要求同源 Origin 及 `X-Cloud-Lab: 1`。不在 UI 保存 token。Bot／runner：以下 header 簽章，禁止 browser Origin；可額外附 Cloudflare Access service headers，由外層驗證。

- `X-Lab-Key-Id`: 配置的 credential ID
- `X-Lab-Time`: Unix 秒十進位
- `X-Lab-Nonce`: 32 lowercase hex（每 request 新值）
- `X-Lab-Signature`: 64 lowercase hex HMAC-SHA256
- message UTF-8: `CLOUDLAB-M1\n{audience}\n{credential_id}\n{generation}\n{METHOD}\n{pathname}\n{timestamp}\n{nonce}\n{raw_body_sha256_hex}`（沒有尾換行）。禁止 query string。
- ±120s clock skew，nonce 保留 ≥600s。credential 與 grant 各自期限／撤銷；secrets 不進 DB、public config、logs。

### 看板與提交

`GET /api/bootstrap` → `{workspace_id,resource_ref,recipe_ref,now,capabilities,request_id}`。
`GET /api/commands` → `{commands:[record],now,request_id}`，最多最近 20 筆並限制回應 ≤32 KiB；較舊命令仍可用 ID 查詢。
`POST /api/commands` body 沿 M0 SubmitCommand 的完整欄位：schema_version=`cloudlab.command.v1`、schema_minor=0、workspace_id、resource_ref={resource_id,generation}、recipe_ref={recipe_id,version,digest}、parameters={max_sample_age_seconds:30}、idempotency_key、not_before、dispatch_deadline、execution_deadline、timeout_seconds=10、output_budget_bytes=16384。回 `{command:record,request_id}`；精確 raw bytes 去重。
`GET /api/commands/{id}` → 同上。
`POST /api/commands/{id}/cancel` body `{}` → 同上。只是取消意圖；已派送不宣稱 stopped。
`GET /api/commands/{id}/artifact` → JSON artifact，另需 artifact:read，7 天到期後 410。

record 欄位：`command_id,revision,command,delivery,cancel_requested,external_ref,attempt,result,created_at,updated_at`。
`external_ref={owner:'python-node-health',adapter_id:'node-health',external_id:command_id}`；只由第一次 dispatch 固定。
`attempt={attempt_id,fence,mode,lease_expires_at}`，mode=dispatch 或 reconcile_only；15 秒 lease。
`result=null` 或 `{owner_outcome,started_at,finished_at,received_at,late,validation:{status,checks},health,artifact_sha256,artifact_expires_at}`。
`health` 僅 healthy/unhealthy/unknown，unknown 和 stale 不得變綠；node observation freshness 以 finished_at 和 parameters.max_sample_age_seconds 判斷，不用 received_at 延長。

### Runner

`POST /api/runner/claim` body `{}` → `{assignment:null|{command_id,command,attempt,external_ref},request_id}`。先領取 expired lease 的 reconcile_only，再領取 accepted；不派送第二個同 node 工作。claim 由 API 原子選取；相同 holder 在 lease 有效時取得同一 assignment。
`POST /api/runner/report` body 嚴格為 `{command_id,attempt_id,fence,owner_outcome,started_at,finished_at,artifact}`。outcome 只 succeeded 或 unknown。
- succeeded：started_at／finished_at 是 UTC，artifact 是精確 JSON 字串，格式 `{status:'healthy',sample_age_seconds:0,checks:{collector:'ok'},metrics:{load_1m_milli:100,cpu_count:4,disk_free_percent:70}}`（status 依上述固定門檻驗證；checks.collector 必須 ok；觀測失敗送 unknown）。此固定 collector profile 的 sample_age_seconds 必須為0（非零記 schema failed），因此看板以 finished_at 計算的 freshness 不會遺失額外樣本年齡。artifact SHA 由 receiver 計算，不接受 client validation／late。success 與 healthy 分開。
- unknown：兩個時間及 artifact 均 null；保持 reconciling／unknown，保留 immutable command 和 external ref，不再 dispatch。
- response `{command:record,request_id}`。只有當前 grant／scope／attempt／fence／未過期 lease 可報；terminal 同 payload 重送回原 ACK，不同 payload conflict。late 由 receiver 算。
- Runner durable SQLite journal：command ID 唯一；保存 immutable command digest、external ref、started/completed/result bytes；起跑前先寫 started commit。重啟遇到 started 為 unknown。完成先落 journal 再回報；回報斷線可從 journal 重送，reconcile_only 絕不 collect。journal 不自動刪除。每輪最多一次 claim＋一次 report，網路 timeout 5 秒，循環最少 5 秒；可 `--once`。

排程首次provisioning預設disabled；[HS政策](health-schedule.md)以UTC起始分鐘為錨，支援15／60／1440分鐘與最多7日固定窗口。缺少policy或revision不匹配fail closed；僅目前分鐘及符合間隔的slot可提交，錯過skip、due＋revision冪等、unknown占位，不接受任意cron parser／catch-up。`GET /api/health-schedule`需commands:read與相同scope，提供政策狀態／next_due_at／最近firing／最近完成結果；cron_verified=false，不提供管理寫入。

## 本輪 AC

M1-I1 API：准入／持久去重／單節點容量／grant 撤銷與 scope／CAS lease／snapshot 對帳／取消與 unknown／artifact ACL 與 freshness。
M1-I2 runner：非 root、出站 polling、固定 collector、durable journal、重啟不重跑、HMAC 向量與重送。
M1-I3 看板：提交、取消意圖、結果／時間／stale／unknown、權限錯誤；不注入 HTML、不持久化機器 secret。
M1-I4 驗證：domain、SQLite-backed Worker 邊界與 Python runner 整合、故障案例、獨立 review、repo validators。
M1-LIVE（pending）：真實 Access/D1/Workers、target runner、手機/bot、撤權與恢復、備份／預算。開發授權不代表已取得指定環境或部署批准。

## 縮小範圍與可觀察限制

- IDs 在此 profile 限 ASCII 字母／數字／底線／連字號 1–128 字元。這比 M0 不透明 UTF-8 ID 更窄。
- 一台節點，全域同時一個 active command；unknown 不自動釋放。每 24 小時最多 1440 個命令、總數最多 10000；quota 到達回 429。無自動刪除，保留規劃及 live 容量仍待資格驗證。
- Command row 本身就是 outbox。准入寫入一列原子提交，不額外依賴通知。排程 firing＋command 在 D1 batch 同交易；CAS 另驗 submit／runner grant revision 及 schedule enablement。
- M1 不實作 lease renewal、原生取消、通用 events/seq/gap buffer、對帳後重新派送、artifact 上傳／垃圾回收、管理 UI。unknown 只可查原 journal；沒有證據時持續未知。矛盾 terminal snapshot 回 409 並保留已存原結果，不接納後到資料。
- schema-invalid health artifact 仍保存終態，validation=failed；stale／超時為 incomplete。下載需獨立 artifact:read；7 天後拒絕讀取，但此版尚不自動刪除 bytes。
- HMAC 防重放使用 D1 nonce；Access 使用受信 issuer 的 RS256 JWKS，驗 issuer、audience、subject、expiry、signature。每次取得 JWKS（尚未加入 cache），失敗則拒絕。不能將合成本機 issuer 當作真實 Access 驗收。
- runner 可設獨立配對 CF Access service headers，與本層 HMAC 金鑰分開；未配置的外層 Access 路徑不能宣稱可用。
- 無部署、資源建立、排程啟用或既有元件接管。Workers 模組只使用 Web APIs；Node SQLite shim 是測試邊界。

## 官方 API 依據

2026-10-26 核對 [D1 batch 交易語義](https://developers.cloudflare.com/d1/worker-api/d1-database/)、[Access JWT 驗證](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/)與 [Static Assets binding](https://developers.cloudflare.com/workers/static-assets/binding/)。`run_worker_first=true` 確保資產也經 Worker 驗權；workers.dev／preview 關閉，公開設定不提供任何 route。
