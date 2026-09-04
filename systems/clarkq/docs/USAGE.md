# clarkQ 客戶端用法指南

> 適用版本：v0.5（含 API Key、加密、long-poll、按隊列加密、快照、指標、YAML 配置）

clarkQ 是一個輕量級 HTTP 消息隊列。客戶端通過 REST API 向命名隊列寫入或讀取消息，讀取為 **FIFO consume**（取出後刪除）。

---

## 1. 快速開始

### 1.1 啟動服務

```bash
cd clarkQ
go build -o bin/clarkq ./cmd/clarkq
# 或: make build

export CLARKQ_API_KEY="your-secret-key"          # 建議生產環境必設
export CLARKQ_ENCRYPTION_MODE="none"             # 默認 none | client | server_rsa
# 可選：按隊列覆蓋加密模式
# export CLARKQ_ENCRYPTION_QUEUES="secure:server_rsa,e2e:client"
# 可選：WAL + 磁盤快照
# export CLARKQ_WAL_PATH=./data/clarkq.wal
# export CLARKQ_SNAPSHOT_PATH=./data/snapshot.json
# export CLARKQ_SNAPSHOT_INTERVAL=30s
# 可選：HTTPS / mTLS
# export CLARKQ_TLS_CERT_FILE=./certs/server.crt
# export CLARKQ_TLS_KEY_FILE=./certs/server.key
# export CLARKQ_TLS_CLIENT_CA_FILE=./certs/client-ca.crt
# 或 YAML：export CLARKQ_CONFIG=configs/clarkq.example.yaml
./bin/clarkq
```

### 1.2 環境變量

| 變量 | 默認 | 說明 |
|------|------|------|
| `CLARKQ_CONFIG` | （空） | YAML 配置文件路徑；env 覆蓋文件值 |
| `CLARKQ_ADDR` | `:8080` | 監聽地址 |
| `CLARKQ_API_KEY` | （空） | 設置後所有 `/api/*` 需認證；支持逗號分隔多個 Key |
| `CLARKQ_ENCRYPTION_MODE` | `none` | **默認**加密模式，見第 4 節 |
| `CLARKQ_ENCRYPTION_QUEUES` | （空） | 按隊列覆蓋：`name:mode,name2:mode2` |
| `CLARKQ_RSA_PUBLIC_KEY` | （空） | `server_rsa` 模式的公鑰 PEM 或文件路徑 |
| `CLARKQ_RSA_KEY_DIR` | `.clarkq-keys` | 未配置公鑰時自動生成密鑰對的目錄 |
| `CLARKQ_SNAPSHOT_PATH` | （空） | 快照檢查點文件 |
| `CLARKQ_SNAPSHOT_INTERVAL` | `30s` | 壓縮間隔；`0` 表示僅關閉時寫入 |
| `CLARKQ_WAL_PATH` | （空） | 追加寫 WAL；每次變更 fsync |
| `CLARKQ_TLS_CERT_FILE` | （空） | HTTPS 證書 |
| `CLARKQ_TLS_KEY_FILE` | （空） | HTTPS 私鑰 |
| `CLARKQ_TLS_CLIENT_CA_FILE` | （空） | 客戶端 CA；設置後啟用 mTLS |

### 1.3 認證方式

當配置了 **API Key** 和/或 **JWT/OIDC** 時，`/api/*` 需通過至少一種方式。  
`GET /health` 與 `GET /metrics` 無需認證。

#### API Key

```http
X-API-Key: your-secret-key
```

或（在未走 JWT 解析時也可作為 Bearer）：

```http
Authorization: Bearer your-secret-key
```

#### JWT / OIDC

```http
Authorization: Bearer <access_token>
```

環境變量：

| 變量 | 說明 |
|------|------|
| `CLARKQ_OIDC_ISSUER` | 期望的 `iss`；未設 JWKS 時做 OIDC discovery |
| `CLARKQ_OIDC_AUDIENCE` | 期望的 `aud` |
| `CLARKQ_OIDC_JWKS_URL` | 明確 JWKS URL |
| `CLARKQ_JWT_HS_SECRET` | HS256 共享密鑰（本地/開發） |
| `CLARKQ_JWT_RSA_PUBLIC_KEY` | 靜態 RS256 公鑰 PEM 或路徑 |

校驗內容：簽名、`exp`（必填）、可選 `iss` / `aud`。支持 RS256（JWKS 或靜態公鑰）與 HS256。

#### JWT 隊列 ACL

```bash
export CLARKQ_JWT_ACL=true
export CLARKQ_JWT_ADMIN_ROLE=admin   # 默認 admin
```

JWT claim 示例：

```json
{
  "aud": "clarkq-api",
  "exp": 1893456000,
  "scope": "queue:orders:write queue:orders:read queue:jobs:read",
  "role": "worker"
}
```

| 權限 | 操作 |
|------|------|
| `queue:NAME:write` | POST 入隊 |
| `queue:NAME:read` | GET 消費 / peek |
| `queue:NAME:admin` | DELETE 清空（含讀寫） |
| `queue:*:…` / `queue:NAME:*` | 通配 |
| `role`/`roles` = `admin` | 全部隊列 |

API Key 調用者不受 ACL 限制。JWT 無權限時返回 `403 FORBIDDEN`。

#### OpenTelemetry

```bash
export CLARKQ_OTEL_ENDPOINT=localhost:4318
export CLARKQ_OTEL_SERVICE_NAME=clarkq
```

#### 多節點分片 + 複製

```bash
export CLARKQ_CLUSTER_ADVERTISE_URL=http://this-node:8080
export CLARKQ_CLUSTER_NODES=http://n1:8080,http://n2:8080,http://n3:8080
export CLARKQ_REPLICATION_FACTOR=2          # 主 + 1 副本
export CLARKQ_CLUSTER_SECRET=shared-token   # 內部 API 認證
```

- 按隊列名 consistent-hash 選擇 **owner**，非 owner 反向代理轉發
- `REPLICATION_FACTOR>1` 時，enqueue 同步寫入 ring 上下一個節點；失敗會回滾主節點並返回 `503`
- dequeue/clear 會通知副本刪除
- `GET /api/v1/queues` 聚合所有 peer，**只統計 primary 擁有的隊列深度**（避免副本雙計）
- `GET /api/v1/queues?local=1` 僅本機

OpenTelemetry span 屬性：`clarkq.op`、`clarkq.queue`、`clarkq.message_id`、`clarkq.auth`。

未帶或認證失敗時返回 `401`：

```json
{"error":{"code":"UNAUTHORIZED","message":"missing or invalid credentials"}}
```

---

## 2. 基礎隊列操作（`none` 模式）

### 2.1 寫入消息

**JSON 格式（推薦）**

```bash
curl -X POST http://localhost:8080/api/v1/queue/orders \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"body":"hello","metadata":{"source":"service-a"}}'
```

響應 `201`：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queue": "orders",
  "created_at": "2026-07-13T12:00:00Z"
}
```

**純文本格式**

```bash
curl -X POST http://localhost:8080/api/v1/queue/orders \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: text/plain" \
  -d 'raw message body'
```

### 2.2 讀取消息（consume）

```bash
curl -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/queue/orders
```

| 狀態碼 | 含義 |
|--------|------|
| `200` | 成功返回一條消息 |
| `204` | 隊列為空 |
| `404` | 隊列不存在 |

響應示例 `200`：

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queue": "orders",
  "body": "hello",
  "metadata": {"source": "service-a"},
  "created_at": "2026-07-13T12:00:00Z"
}
```

### 2.3 長輪詢與只讀查看

隊列為空時，可用 `timeout` 等待新消息。值為整數秒，範圍 `0` 至 `30`；超時仍無消息時返回 `204`：

```bash
curl -H "X-API-Key: your-secret-key" \
  'http://localhost:8080/api/v1/queue/orders?timeout=30'
```

使用 `peek=true` 返回隊首消息但不刪除；可與 `timeout` 組合：

```bash
curl -H "X-API-Key: your-secret-key" \
  'http://localhost:8080/api/v1/queue/orders?peek=true&timeout=10'
```

### 2.4 清空隊列

```bash
curl -X DELETE -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/queue/orders
```

響應 `200`，隊列保留但深度歸零：

```json
{"cleared":3}
```

不存在的隊列返回 `404`。

### 2.5 列出隊列

```bash
curl -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/queues
```

```json
{"queues":[{"name":"orders","depth":3},{"name":"jobs","depth":0}]}
```

### 2.6 健康檢查（無需 API Key）

```bash
curl http://localhost:8080/health
```

### 2.7 指標

```bash
# Prometheus 文本（無需 API Key，便於 scrape）
curl http://localhost:8080/metrics

# JSON（受 API Key 保護）
curl -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/metrics
```

除佇列吞吐（`enqueued_total` / `dequeued_total` / `errors_total`）外，集群路徑還暴露：

| 名稱（Prometheus 前綴 `clarkq_`） | 類型 | 含義 |
|----------------------------------|------|------|
| `replication_errors_total` | counter | 副本推送失敗 |
| `quorum_errors_total` | counter | 讀/寫 quorum 未達成 |
| `lease_errors_total` | counter | 租約取得失敗 |
| `stale_epoch_errors_total` / `not_owner_errors_total` / `owner_grace_errors_total` | counter | membership 抖動相關 |
| `outbox_depth` | gauge | 待重試 outbox 深度 |
| `cluster_alive_nodes` / `cluster_generation` / `leases_held` | gauge | 集群健康與租約 |

範例 scrape 與 **告警規則**（`ClarkQReplicationErrors`、`ClarkQOutboxBacklog` 等）見：

- [deploy/prometheus/README.md](../deploy/prometheus/README.md)
- [deploy/prometheus/alerts.yml](../deploy/prometheus/alerts.yml)

### 2.8 持久化（WAL + 快照）

推薦同時開啟：

```bash
export CLARKQ_WAL_PATH=./data/clarkq.wal          # 每次 enqueue/dequeue/clear 追加並 fsync
export CLARKQ_SNAPSHOT_PATH=./data/snapshot.json  # 週期檢查點
export CLARKQ_SNAPSHOT_INTERVAL=30s
./bin/clarkq
# SIGTERM/SIGINT 時 compact：寫快照並截斷 WAL
```

啟動順序：載入 snapshot → replay WAL。

### 2.8.1 HTTPS / mTLS

```bash
export CLARKQ_TLS_CERT_FILE=./certs/server.crt
export CLARKQ_TLS_KEY_FILE=./certs/server.key
export CLARKQ_TLS_CLIENT_CA_FILE=./certs/client-ca.crt  # 可選，要求客戶端證書
./bin/clarkq
```

### 2.9 YAML 配置

```bash
export CLARKQ_CONFIG=configs/clarkq.example.yaml
./bin/clarkq
```

加載順序：**默認值 → YAML → 環境變量**。

---

## 3. 隊列命名規則

- 允許字符：`[a-zA-Z0-9_-]`
- 長度：1–64
- 大小寫敏感（`Orders` ≠ `orders`）
- 非法名稱返回 `400 INVALID_QUEUE_NAME`

---

## 4. 加密模式

服務端通過 `CLARKQ_ENCRYPTION_MODE` 指定**默認**模式，並可用
`CLARKQ_ENCRYPTION_QUEUES` 為單個隊列覆蓋模式。寫入時按**隊列名**
選擇對應 provider，客戶端行為因該隊列的模式而異。

### 4.1 模式對照

| 模式 | 寫入 | 讀取 | 誰持有解密鑰匙 |
|------|------|------|----------------|
| `none` | 明文 | 明文 | — |
| `server_rsa` | **明文**（服務端加密後存儲） | **密文** + `encryption` 元數據 | 客戶端私鑰 |
| `client` | **密文** + `encryption` 元數據 | 密文 + 元數據（原樣返回） | 客戶端對稱密鑰 |

### 4.2 按隊列覆蓋

```bash
export CLARKQ_ENCRYPTION_MODE=none
export CLARKQ_ENCRYPTION_QUEUES="secure-orders:server_rsa,tenant-a:client"
./bin/clarkq
```

| 隊列 | 生效模式 |
|------|----------|
| `orders`（未列出） | `none`（默認） |
| `secure-orders` | `server_rsa` |
| `tenant-a` | `client` |

規則：

- 格式：`queue:mode`，多項用逗號分隔
- 隊列名須符合命名規則（`[a-zA-Z0-9_-]`，1–64）
- 只要任意隊列（或默認）使用 `server_rsa`，即可請求公鑰接口
- 同一進程內 `server_rsa` 隊列共用一組 RSA 密鑰

查詢當前配置：

```bash
curl -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/crypto/config
```

```json
{
  "mode": "none",
  "algorithms": [],
  "queues": {
    "secure-orders": "server_rsa",
    "tenant-a": "client"
  }
}
```

`mode` / `algorithms` 描述**默認**模式；`queues` 僅在有覆蓋時出現。

---

## 5. `server_rsa` 模式用法

服務端持有**公鑰**（加密），客戶端持有**私鑰**（解密）。適合「信任運維環境，但靜態數據需加密」的場景。

### 5.1 密鑰準備

**開發環境**：不配置 `CLARKQ_RSA_PUBLIC_KEY` 時，服務首次啟動會在 `CLARKQ_RSA_KEY_DIR`（默認 `.clarkq-keys/`）自動生成：

```
.clarkq-keys/
├── public.pem    # 服務端使用，也可通過 API 獲取
└── private.pem   # 僅客戶端持有，用於解密
```

**生產環境**：自行生成 RSA-4096 密鑰對，公鑰部署到服務端：

```bash
# 生成私鑰
openssl genrsa -out private.pem 4096
# 導出公鑰
openssl rsa -in private.pem -pubout -out public.pem

export CLARKQ_RSA_PUBLIC_KEY="./public.pem"
# private.pem 僅分發給需要消費消息的客戶端
```

也可通過 API 獲取公鑰：

```bash
curl -H "X-API-Key: your-secret-key" \
  http://localhost:8080/api/v1/crypto/public-key
```

### 5.2 生產者（寫入）

POST **明文**即可，服務端自動信封加密（AES-256-GCM + RSA-OAEP）：

```bash
curl -X POST http://localhost:8080/api/v1/queue/orders \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{"body":"sensitive order data"}'
```

### 5.3 消費者（讀取 + 解密）

GET 返回密文與元數據：

```json
{
  "id": "...",
  "queue": "orders",
  "body": "<base64 AES 密文>",
  "encryption": {
    "mode": "server_rsa",
    "algorithm": "rsa-oaep-4096+aes-256-gcm",
    "key_id": "server-pubkey-v1",
    "nonce": "<base64>",
    "encrypted_key": "<base64 RSA 加密的 DEK>"
  },
  "created_at": "..."
}
```

客戶端解密步驟：

1. Base64 解碼 `encryption.encrypted_key`，用 **RSA 私鑰**（OAEP + SHA-256）解出 DEK（32 字節）
2. Base64 解碼 `encryption.nonce` 與 `body`
3. 用 DEK + nonce 做 **AES-256-GCM** 解密 `body`

完整 Go 示例見 [`examples/client/main.go`](../examples/client/main.go)。

---

## 6. `client` 模式用法（客戶端 E2E）

服務端**不接觸明文與密鑰**，只存儲客戶端提交的密文。適合「不信任服務端部署環境」的場景。

### 6.1 寫入

客戶端自行加密後 POST：

```bash
# body 為你已加密的 base64 密文
curl -X POST http://localhost:8080/api/v1/queue/secure \
  -H "X-API-Key: your-secret-key" \
  -H "Content-Type: application/json" \
  -d '{
    "body": "<base64 ciphertext>",
    "encryption": {
      "mode": "client",
      "algorithm": "aes-256-gcm",
      "key_id": "my-key-v1",
      "nonce": "<base64 nonce>"
    },
    "metadata": {"source": "app-a"}
  }'
```

必填字段：

| 字段 | 說明 |
|------|------|
| `body` | 密文（建議 base64 編碼） |
| `encryption.mode` | 必須為 `"client"` |
| `encryption.algorithm` | 必須提供，建議 `"aes-256-gcm"` |

### 6.2 讀取

GET 原樣返回密文與 `encryption` 元數據，客戶端用本地密鑰解密。

### 6.3 推薦加密流程（AES-256-GCM）

```
1. 生成 12 字節隨機 nonce
2. 用共享密鑰（32 字節）+ nonce 加密明文 → ciphertext
3. POST body=base64(ciphertext), encryption.nonce=base64(nonce)
4. GET 後用相同密鑰 + nonce 解密
```

密鑰分發由客戶端自行管理（環境變量、KMS 等），服務端不參與。

---

## 7. 錯誤碼

| HTTP | code | 說明 |
|------|------|------|
| 400 | `INVALID_QUEUE_NAME` | 隊列名不合法 |
| 400 | `EMPTY_BODY` | 消息體為空 |
| 400 | `INVALID_JSON` | JSON 格式錯誤 |
| 400 | `INVALID_ENCRYPTION` | 加密元數據不符合當前模式 |
| 400 | `INVALID_TIMEOUT` | `timeout` 不是 `0` 至 `30` 的整數 |
| 400 | `INVALID_PEEK` | `peek` 不是布爾值 |
| 401 | `UNAUTHORIZED` | 缺少或錯誤的 API Key |
| 404 | `QUEUE_NOT_FOUND` | 隊列不存在 |
| 404 | `PUBLIC_KEY_UNAVAILABLE` | 非 `server_rsa` 模式請求公鑰 |
| 413 | `MESSAGE_TOO_LARGE` | 超過單條消息大小限制 |
| 507 | `QUEUE_FULL` | 隊列已滿 |
| 507 | `QUEUE_LIMIT_REACHED` | 隊列數量達上限 |

錯誤響應格式：

```json
{"error":{"code":"QUEUE_FULL","message":"queue 'orders' has reached max depth 10000"}}
```

---

## 8. 典型集成模式

### 8.1 任務隊列（明文 + API Key）

```
Producer                         clarkQ                         Worker
   │ POST /queue/jobs  ──────────►│                               │
   │                              │◄──────── GET /queue/jobs ───│
   │                              │         (consume)             │
```

```bash
# Producer
curl -X POST http://localhost:8080/api/v1/queue/jobs \
  -H "X-API-Key: $KEY" -H "Content-Type: application/json" \
  -d '{"body":"{\"task\":\"send_email\",\"to\":\"a@b.com\"}"}'

# Worker 循環消費；空隊列時每次最多等待 30 秒
while true; do
  curl -s -H "X-API-Key: $KEY" \
    'http://localhost:8080/api/v1/queue/jobs?timeout=30'
done
```

長輪詢超時後返回 `204`，Worker 可立即發起下一次請求。

### 8.2 敏感數據傳遞（server_rsa）

```
Producer (明文)  ──POST──►  clarkQ (加密存儲)  ──GET──►  Consumer (私鑰解密)
```

### 8.3 零信任傳遞（client E2E）

```
Producer (加密)  ──POST 密文──►  clarkQ (透傳)  ──GET 密文──►  Consumer (解密)
```

---

## 9. 示例代碼與 SDK

| 文件 | 說明 |
|------|------|
| [`examples/curl.sh`](../examples/curl.sh) | curl 一鍵演示（三種模式） |
| [`examples/client/main.go`](../examples/client/main.go) | Go 客戶端：認證、寫入、讀取、`server_rsa` / `client` 加解密 |
| [`sdk/`](../sdk/) | Go / Python / JS 客戶端骨架 |

### 運行 Go 示例

> **重要**：`-mode` 必須與服務端 `CLARKQ_ENCRYPTION_MODE` 一致。

```bash
# 先啟動服務（另開終端），按所需模式選擇其一：

# none 模式
export CLARKQ_API_KEY=dev-key CLARKQ_ENCRYPTION_MODE=none && ./bin/clarkq

# server_rsa 模式
export CLARKQ_API_KEY=dev-key CLARKQ_ENCRYPTION_MODE=server_rsa && ./bin/clarkq

# client 模式
export CLARKQ_API_KEY=dev-key CLARKQ_ENCRYPTION_MODE=client && ./bin/clarkq

# 運行對應示例
export CLARKQ_URL=http://localhost:8080 CLARKQ_API_KEY=dev-key
go run ./examples/client -mode none
go run ./examples/client -mode server_rsa -private-key .clarkq-keys/private.pem
go run ./examples/client -mode client
```

### 運行 curl 示例

```bash
export CLARKQ_URL=http://localhost:8080
export CLARKQ_API_KEY=dev-key
bash examples/curl.sh
```

---

## 10. 注意事項

- 消息存在**進程內存**，服務重啟後丟失
- 讀取為 **consume** 語義，同一消息只會被一個消費者取走
- `peek=true` 為只讀語義，多個客戶端可能讀到同一消息
- 建議生產環境前置反向代理啟用 **TLS**
- `text/plain` 寫入在 `client` 模式下不可用（缺少 `encryption` 元數據）
- `server_rsa` 下 GET 返回的是密文，需客戶端解密後使用
