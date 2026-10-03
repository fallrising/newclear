# 05 — 共用契約與安全模型

狀態：v0.1 normative design，尚未產生機器可驗證 schema。M0 將本文落為 `contracts/openapi.yaml`、JSON Schema 及 TS/Go positive/negative fixtures；不能跳過契約 gate 讓三線各自解讀。

## 1. Principal 與 capability

Human 經 Cloudflare Access，後端驗 issuer／audience／signature／expiry 再查 workspace membership；不直接信任 Email header、來源網域或前端角色。瀏覽器同源 secure session、CSRF／Origin 防護、CSP；Access 產品費用／方案也須在部署時另核對。[S20](../SOURCES.md#s20)

Node 採 per-node key，不走人類登入，不以共享 API_SECRET 取得整個 fleet 權限。collector 只有 `telemetry:write`／被授權的 `logs:write`，courier 有 `jobs:claim`／`jobs:result`；兩者不能建立 approval 或更換主機本地信任根。

RBAC 最小集合：viewer 看摘要；log-reader 看獲授權來源；operator 建候選 job；approver 簽批准；node-admin 管註冊／撤銷；admin 管成員與政策上限。單人可兼角色，但仍保留每項授權判斷與審批證據。workspace_id 由授權結果決定，不信任 body 指定範圍。

## 2. Enrollment 與 request authentication

Enrollment token 設計為 256-bit random、初值 10 分鐘、單次使用；伺服器存 hash。機器本地產生 Ed25519 key pair，送 public key 與一次性 challenge proof，原子消耗 enrollment record。初次 token 被竊仍有搶註冊風險，需 operator 核 fingerprint／預期節點，或經驗證的 provider identity 才升為 active。

同一 enrollment + 同一 public key 的回應遺失，可由該 key 證明持有權後取回既有 node ID；換 key 重放必須拒絕，不能重新發一個有效身份。撤銷、換機與信任根輪換產生新的 enrollment generation；hostname／IP 不是安全身份。

機器 HTTP 簽章綁定 version、purpose、credential ID、method、normalized path/query、request ID、sent_at、nonce、body SHA-256。M0 必須固定 byte encoding／path normalization 並用 Go/Workers 跨實作向量核對。不要自行設計密碼演算法；使用已維護的標準實作。

envelope 設計時鐘容忍 ±120 秒；過時資料可帶舊 observed_at，但 envelope 必須是當次新簽。metrics 以 boot_id+seq+digest 去重；命令／變更另存 request ID 與 digest，重放不能再產生副作用。credential revoked、purpose 不符、generation 不符、schema major 不支援均 fail-closed。

## 3. API 面積

所有路徑為擬定 v1；回應一律有 request_id，错误使用 `{code,message,retryable,request_id}`，不回傳 secret／SQL／堆疊。default page 50，max 200；所有時間查詢有最大區間與 bytes 上限。表中僅是設計契約，不是存在的 endpoint。

| Method / path | Caller | 契約要點 |
| --- | --- | --- |
| POST `/api/v1/enrollments` | node-admin | 指定 scope/TTL，返回一次性 token，只顯示一次 |
| POST `/agent/v1/enroll` | bootstrap proof | 一次性 consume；key 綁定；可恢復同 key 的 lost response |
| POST `/agent/v1/telemetry` | collector | body <=256 KiB；sample dedupe；durable ack；不帶命令 |
| POST `/agent/v1/log-chunks` | logs capability | 初版經 Worker stream 接收；壓縮前後大小上限、cursor/digest；commit manifest 後 ACK |
| GET `/api/v1/nodes`、`/nodes/:id` | viewer | ACL、freshness、mode、capabilities、revision |
| GET `/api/v1/nodes/:id/metrics` | viewer | from/to/resolution，最大 7 天 raw 視窗，點數上限 |
| GET `/api/v1/nodes/:id/logs` | log-reader | source/time/cursor，最多 200 records／256 KiB，明確截斷 |
| POST `/api/v1/recipes`、`/recipes/:id/versions` | operator | artifact 先驗證；每版不可變 |
| POST `/api/v1/jobs` | operator | Idempotency-Key；初版單 node/generation；凍結 manifest |
| POST `/api/v1/jobs/:id/approvals` | approver | 外部簽署 exact bytes；server 與主機各自驗證 |
| POST `/agent/v1/jobs/claim` | courier | max 1；purpose／authority 檢查；CAS／lease／fence |
| POST `/agent/v1/jobs/:id/start-permit` | courier + executor challenge | 最後授權／取消檢查；短效可驗 permit；不取代 owner approval |
| POST `/agent/v1/jobs/:id/events` | courier | attempt/fence/sequence/digest；acked durable result |
| POST `/api/v1/jobs/:id/cancel` | operator | idempotent；只表示 cancel_requested，等待停止證據 |
| GET `/api/v1/jobs/:id` | scoped human | revision、每次 attempt、unknown、output cursor |
| POST `/api/v1/nodes/:id/revoke` | node-admin | 收回機器後續權限；無法撤銷已發生副作用 |
| GET `/api/v1/events`（WS upgrade） | scoped human | 短效 session／重新驗權、invalidation、snapshot refetch |

HTTP：401 未通過 authentication；403 權限／local capability 不符；409 idempotency payload 衝突或 CAS 失敗；413 太大；422 schema／平台不符；429 配額；503 暫不可用。Retry-After 不許造成無限重試。idempotency record 保留至少覆蓋允許重試／approval 有效窗口；清理後不得重新接受已到期 run。

## 4. Typed recipe 與不可變批准

RecipeVersion 必須含 artifact digest、來源 revision、entrypoint/interpreter、parameters schema、OS/arch、run_as、capabilities、read/write paths、network policy、timeout、pre/postcheck、reboot policy、retry safety。artifact URL 不是權威內容識別。

RunManifest 初版包含以下語義（下面是示意欄位，不是有效可執行 approval）：

```json
{
  "schema_version": "edgeops.run.v1",
  "workspace_id": "ws_example",
  "job_id": "job_example",
  "attempt_id": "attempt_example",
  "node_id": "node_example",
  "enrollment_generation": 1,
  "recipe_version": "service-status@1",
  "artifact_sha256": "<64-lowercase-hex>",
  "parameters": {"unit": "example.service"},
  "execution_profile": "unprivileged-diagnostic",
  "policy_digest": "<64-lowercase-hex>",
  "timeout_seconds": 30,
  "not_before": "<UTC-RFC3339>",
  "expires_at": "<UTC-RFC3339>",
  "nonce": "<random-run-nonce>"
}
```

公開 schema 嚴格拒絕 duplicate keys、unknown privileged fields、非有限數字與不支援版本。初版不允許浮點參數、未限定環境變數或任意 secret value；必要秘密只用已允許的 secret reference。manifest 大小上限 32 KiB。

簽署對象為精確 UTF-8 manifest bytes 的 SHA-256 加 domain separator `EDGEOPS-RUN-V1\n`；固定 domain bytes + 32 raw digest bytes，以 Ed25519 簽署。保存原始 bytes，不在驗簽前重新 serialize。CLI 和 execd 必須使用同一嚴格 schema，並在 golden/negative vectors 驗證語義一致。

CLI 在獨立可信環境顯示完整待執行內容與明文非秘密參數，operator 核對後才簽；approval key 不在 CF Worker，也不在從該 Worker 載入的 Web JavaScript。修改目標、generation、參數、權限、期限或 artifact 均使 approval 失效。單人相同帳號按兩次確認不等於獨立信任域。

主機 root-owned policy 固定可信 approval public keys、profile、允許 recipe/digest、最大權限／時間；自遠端收到較寬政策不得自動套用。keys 與 executor 更新有独立本地／已審核簽署流程，不由普通 job 任意改寫。

## 5. Start permit、job 狀態與重試

Node 本地驗 manifest 後產生隨機 challenge，courier 申請短效 start permit。server 重新確認 job 未取消、未撤銷、lease/fence/generation 仍有效，並以獨立 control-plane permit key 簽署 challenge、manifest digest、node/generation、attempt/fence、最晚起跑時間；初值 30 秒。execd 固定 permit public key，用 monotonic elapsed bound 輔助本地時間檢查。permit 私鑰只可批准已通過條件的啟動，不具有 owner approval key 的權力。

permit 可以減少斷線後啟動過期已取消任務，**不能在 CF 被入侵時取代主機本地 approval 驗證**，也不能保證撤銷在程序開始的最後一瞬間即時生效。時間不可信或未取得 permit，就不開始新的 mutation。

```text
Job: draft → awaiting_approval → queued → leased → running
                                           ↘ expired
running → succeeded | failed | timed_out | cancelled
lease lost / connection lost / crash → reconciling → known terminal | unknown
cancel_requested 是要求，不是已停止的 terminal evidence
```

claim 或 start ACK 丟失重送同一 attempt；execd 以 durable journal 回傳已有狀態。lease 逾時不自動建立新 attempt。unknown 不自動當 failed 後 retry；經 operator 對帳及明確新 approval 才能新 attempt。任意腳本即使帶 idempotency key 也不自然具有 exactly-once 效果。

本地 durable journal + online claim 仍不能完全防止「雲端被入侵且 VM snapshot 回滾了已執行 journal」的組合重放；需要額外不可回滾狀態／硬體身分或停用該類 mutation。此 residual risk 明確列入 P2 gate，不宣稱軟體簽章解決所有 rollback 攻擊。

## 6. Threat model

| 威脅 | 預防／偵測 | 殘餘風險 |
| --- | --- | --- |
| 一台 collector key 外洩 | 單 node/scope/generation、revocation、無操作權 | 可偽造該主機資料，不能信任它做安全證明 |
| Worker／D1 被入侵 | host-local policy、獨立 approval key、固定 artifact | 可讀雲端 logs、篡改觀測、DoS；可能重送仍有效且符合批准的任務 |
| 日誌／腳本供應鏈注入 | 不執行 log、immutable hash、簽章、純文字 UI | 已被批准的惡意 root script 仍具 root 破壞力 |
| command courier 被入侵 | Unix socket 驗輸入、execd 再驗所有安全條件 | 可阻断／重送，但不可自行批准新權限 |
| trusted signer 被入侵 | 私鑰隔離、輪換、雙人審批可選、短效窄目標 | 可能批准惡意操作；需獨立撤銷／救援途徑 |
| 重播／clone／時鐘異常 | nonce、attempt journal、generation、permit、時鐘拒絕 | snapshot rollback 與 cloud compromise 組合未完全解決 |
| 注入／SSRF／IDOR | typed argv、path policy、物件 ID 授權、workspace ACL | root 下任意腳本不是真正 sandbox |
| config／telemetry 洪水 | 本地與雲端 size/rate/cardinality 上限 | 配額／平台故障仍可能降低監控可用性 |

Audit 包含變更前後 digest、actor、批准身份、每次 attempt/result、received time。D1 內的 audit 不是防同一管理員篡改的不可變 WORM；需後續獨立匯出／簽章驗證與保留政策才能提高可信度。

## 7. 版本演進

API major、recipe schema、agent capability、executor policy version 分開。server 至少驗證當前 major 與明確列出的前一版 minor；新增必要特權欄位不可靜默忽略。collector 可降級為受限監控，executor 遇到未知 schema 一律拒絕。

新增／刪除 capability、信任根變更、OS 支援、body limit 提升都需契約 PR。M0 以同一組 fixtures 驗 OpenAPI、TS、Go 與 strict parser；schema未生成前，文件不能稱為已完成 contract test。
