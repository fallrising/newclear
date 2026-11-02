# Transport 與 adapter contract v0.1（草案）

上位規格：[SDD](../SDD.md)。本文件屬本項目的新協定，不實作或相容 Alma wire protocol。M1 須產生 JSON Schema、codec fixtures 與 conformance tests；目前只有規格。

## P-01 身分與路由

`tenant_id` 來自驗證成功的 credential，不接受 client body 自稱；`endpoint_id` 是註冊過的目標；`route_id` 是可輪換的 opaque locator，不是 secret 或 capability。DO key 由 tenant/endpoint 共同構成，不跨租戶共用。

connector 使用持久裝置 key 對 challenge 的 proof-of-possession 取得短效 admission credential；relay authority 登錄 device/public key 與 owner 批准結果。首版可手動匯入 allowlist 的公鑰，禁止匿名註冊。該 admission 與端上 grants 分開。M1 的 deployment manifest 明列最多 10 個已准入 endpoint IDs，Worker 在建立／路由 DO 前比對；不依賴每個 DO 的局部計數假裝全域配額。動態 enrollment／多租戶 provisioning 需另設 authority store，不在首版自動開放。

## P-02 控制 API（規劃）

| Endpoint | 呼叫者 | 規則 |
| --- | --- | --- |
| GET /healthz | 任意 | 只回 edition/protocol/readiness，不列裝置、route 或使用者 |
| POST /v1/ws-tickets | 已授權 client | 短效單次 ticket，綁 target、principal、origin、scope；不提供憑空授權 |
| GET /v1/connectors/{endpoint_id} | connector WSS | 驗證 admission 後登錄；route 不攜帶長期 token |
| GET /v1/sessions/{route_id} | client WSS | 驗證 origin 與一次 ticket，再要求端上授權；無權限與未知 route 對外相同 |

Browser WebSocket 無自訂 Authorization header 的流程使用短效單次 ticket；交握首個應用 frame 在 5 秒內送達，驗證前最多讀取 4 KiB，不開 service stream。ticket 由已驗證的 HTTPS session 取得，禁止放長期 bearer 到 query。browser 使用 Secure/HttpOnly/SameSite session cookie 時須防 CSRF、嚴格 Origin allowlist；不在本案擅加特定 IdP。CLI 可用 header + PoP；實際 authority profile 在 M1 freeze。

單次 ticket jti 需在目標 DO 原子消耗，expiry 上限 60 秒。重用／過期 fail closed，不依賴日誌或記憶體做去重。所有 session 須有外層 admission 和端上 grant 雙重批准。

## P-03 外層與內層

外層僅 `version, type, session_id, connection_epoch, sequence, length`，及路由必要的 stream identifier；不得放業務 URL／文字。控制訊息 JSON 上限 16 KiB；payload 走 binary chunks，不能全量 base64。

`version` 是 major/minor；握手協商最高共同 major/minor，無共同 major 回 UNSUPPORTED_VERSION。新增可選欄位可忽略；未知必要 feature／frame type 必須拒絕。不允許失敗後降到 plaintext profile。

trusted-relay-lab 的內層是明文（只允許合成資料）；e2ee-v1 的內層是經核准 crypto profile 的 authenticated record。兩者標頭不同且不可互相 fallback；binding 必須包含 negotiated profile、端點身分、session/epoch、stream/sequence，防跨連線移植。wire byte layout 在 M2 選型後固定，不自行猜測 AEAD nonce 格式。

```json
{
  "type": "OPEN",
  "request_id": "synthetic-request-001",
  "stream_id": "1",
  "service_id": "status-api",
  "adapter": "http",
  "method": "GET",
  "path": "/health",
  "headers": {},
  "deadline_ms": 30000
}
```

這是內層語義範例；不是直接發給任意雲端的可用 API。

## P-04 訊息與狀態機

| 訊息 | 方向／語義 |
| --- | --- |
| HELLO / WELCOME | 版本、profile、limits 協商；不建立業務存取權 |
| REGISTER / REGISTERED | connector admission；回 connection_epoch |
| SESSION_OPEN / SESSION_READY | client 要求 target；端上驗 grant／配對身分後才 READY |
| OPEN / OPENED | 指定 service/adapter；端上限權檢查，不接受任意 host/port |
| DATA | 每 stream 有序 payload；HTTP bytes 或 WS message fragments |
| WINDOW_UPDATE | 收到方消費後增加可發 byte credit；是流控，不是業務 ACK |
| END | 單方向 EOF；雙方向結束才能釋放正常 stream |
| CANCEL | 停止傳輸／AbortSignal；可重入，非 rollback |
| ERROR / CLOSE | 顯式錯誤／終止；late frames 丟棄，不能復活 stream |
| GOAWAY | 停止新 OPEN，既有 stream 有界 drain |

Connector：DISCONNECTED → CONNECTING → AUTHENTICATING → REGISTERED → DRAINING／DISCONNECTED。
Session：NEW → AUTHORIZING → READY → DRAINING → CLOSED。
Stream：NEW → OPENING → OPEN → HALF_CLOSED → CLOSED；任何非終態可 → FAILED/CANCELLED。

只有 READY session 可 OPEN。每個 client session 自己分配單調 stream_id；ID 不在同一 session 重用。relay key 是 `(tenant, endpoint, epoch, session, stream)`，不能僅用自增數字。epoch 由 DO 原子增加；新 connector 經同一 device 身分驗證後 fence 舊連線。舊 epoch 的資料一律拒絕。

## P-05 HTTP／SSE／WebSocket 邊界

HTTP：保留 method、正規化相對 path、受限 headers、status、body；不聲稱任意 HTTP reverse proxy 相容。移除 hop-by-hop headers 及 Connection 所列欄位、client supplied Host；Authorization/Cookie 預設不轉送，service 個別顯式允許。拒絕 CONNECT、TRACE、absolute-form URL；redirect 不自動跟隨，避免 SSRF／憑證外洩。未知 Content-Length 不豁免 byte limit。trailers、100-continue 與透明 cookie-domain rewrite 不在 v1 範圍。

SSE：使用同一 HTTP adapter；content-type 與 event bytes 原樣分段；禁止整體 response buffering。client 斷線立即傳 CANCEL。Last-Event-ID 是應用選擇的 header，不使 relay 具 replay store。

WebSocket：內層 OPEN 指定 service；保留 text/binary、message boundary 與允許的 close code。fragment 包含 message_id、offset、final；每訊息最大 1 MiB，stream chunks 最大 64 KiB。subprotocol 必須由 service allowlist 映射；不轉送任意 extensions，預設關閉壓縮。終端應用消息確認不等於 transport delivery。

HTTP 受限服務不得依賴外部 absolute URL、任意 cookies 或無限大上傳；需要這些能力須另訂 adapter，而不是悄悄放寬核心。

## P-06 流控、背壓與資源預算

以下為個人規模預設設計值，不是 CF 平台額度或已測吞吐。

| 項目 | 預算／行為 |
| --- | --- |
| endpoints / active sessions per endpoint | 10（部署 admission cap）/ 4 |
| streams per endpoint | 32，包含所有 session；超過 RESOURCE_EXHAUSTED |
| 控制 frame / binary data chunk | 16 KiB / 64 KiB（含 header 另計） |
| per-stream unconsumed credit | 每方向 256 KiB |
| per-endpoint application-owned buffers | 16 MiB，所有方向、metadata／pending queues 都要計帳 |
| pre-auth bytes / handshake deadline | 4 KiB / 5 秒 |
| HTTP request body / response body | 16 MiB / 16 MiB；SSE 改用 stream quota |
| stream throughput / endpoint throughput | token bucket，預設 1 MiB/s / 4 MiB/s，可向下配置 |
| HTTP header deadline / stall | 30 秒 / 30 秒無消費進展 |
| HTTP total deadline | 120 秒；SSE/WS session 最長 15 分鐘後重新授權 |
| CLOSE/drain deadline | 5 秒，超時終止 |

收方消費 bytes 才回 WINDOW_UPDATE。按 stream round-robin 且優先控制 frame；不因某一 stream 耗盡 credit 就停止所有 stream。application-owned 記憶體上限不等於 CF isolate 的總 RAM 保證：runtime send buffers 也要量測，不能只測 Map 大小。

credit 收到值必須正且不超過最大 window；檢查整數溢位與累積超量。超額發送視為協定違規，先關 stream、重複濫用關 session。限制須在解密前（frame size）與解密後（inner schema/body limit）都執行。

CF Worker/DO 本身還有 plan／message／CPU 限制；應用分片不能宣稱繞過平台限制。[來源 S2–S4](sources-and-decisions.md)

## P-07 錯誤、取消與重試

| Error | 行為 | 可否自動重試 |
| --- | --- | --- |
| UNAUTHENTICATED / FORBIDDEN / REVOKED | 不 open 服務；關閉相應授權通道 | 否；先修正權限 |
| ENDPOINT_OFFLINE | 不儲存待執行請求 | 只可重試連線，不重播 mutation |
| UNSUPPORTED_VERSION / UNSUPPORTED_ADAPTER | 顯式拒絕 | 否；不降級安全 |
| RESOURCE_EXHAUSTED | 回 retry_after，釋放 buffer | 只重試 admission，業務另決定 |
| DEADLINE_EXCEEDED / CANCELLED | AbortSignal；清理 stream | 不保證停止已提交工作 |
| CONNECTION_LOST / UNKNOWN_OUTCOME | 結果不確定，丟棄 late frame | 查業務 idempotency 狀態 |
| PROTOCOL_ERROR | fail closed，保留無敏感 metadata 診斷 | 不無限重連 |

重連採 capped exponential backoff＋jitter（1–30 秒），身份錯誤停止重試。應用需長時工作時，讓本機 durable job API 回 job_id，後續另開 session 查詢；relay 不維護工作生命週期。
