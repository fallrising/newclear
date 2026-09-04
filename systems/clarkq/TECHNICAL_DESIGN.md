# clarkQ 技術設計文檔

> 版本：v0.1  
> 日期：2026-07-10  
> 狀態：設計階段（Phase 1 待實作）

---

## 1. 項目概述

**clarkQ** 是一個輕量級、進程內存型消息隊列服務。客戶端通過 HTTP 接口向指定名稱的隊列寫入或讀取消息。服務重啟後消息丟失，適合短期緩衝、任務傳遞、開發測試等場景。

### 1.1 目標

| 階段 | 目標 |
|------|------|
| **Phase 1** | 多命名隊列 + POST/GET HTTP API + 健康檢查 |
| **Phase 2** | 可選加密層（KMS），支持不同信任模型下的加解密方案 |

### 1.2 技術棧

- **語言**：Go 1.22+
- **HTTP 框架**：標準庫 `net/http`（Phase 1）；必要時引入 `gin` 或 `chi`
- **並發**：`sync.RWMutex` + 每隊列獨立結構
- **配置**：環境變量 + 可選 YAML
- **部署**：單二進制，無外部依賴

---

## 2. 系統架構

```
┌─────────────┐     POST/GET      ┌──────────────────────────────────┐
│   Client    │ ────────────────► │           clarkQ Server          │
│             │  /api/v1/queue/   │                                  │
│  (optional  │     {name}         │  ┌─────────┐  ┌─────────┐       │
│   encrypt/  │                   │  │ queue-A │  │ queue-B │ ...  │
│   decrypt)  │ ◄──────────────── │  └─────────┘  └─────────┘       │
└─────────────┘                   │         QueueManager (in-memory)  │
                                  └──────────────────────────────────┘
```

### 2.1 核心組件

```
clarkQ/
├── cmd/clarkq/          # 入口 main
├── internal/
│   ├── server/          # HTTP 路由與 handler
│   ├── queue/           # 隊列數據結構與 QueueManager
│   ├── crypto/          # Phase 2：加密適配層（預留）
│   └── config/          # 配置加載
├── docs/
│   └── TECHNICAL_DESIGN.md
└── go.mod
```

### 2.2 QueueManager

- 維護 `map[string]*Queue`，key 為隊列名稱
- 隊列按需創建（首次 POST/GET 時 lazy init）或通過配置預聲明
- 每個 `Queue` 內部為線程安全的 FIFO 切片
- 全局可配置：**最大隊列數**、**每隊列最大深度**、**單條消息最大字節**

---

## 3. HTTP API 設計

Base URL 示例：`http://localhost:8080`

### 3.1 命名隊列路由

所有讀寫操作通過隊列名稱區分：

```
POST /api/v1/queue/{QUEUE_NAME}   # 寫入一條消息
GET  /api/v1/queue/{QUEUE_NAME}   # 讀取一條消息（consume）
```

`{QUEUE_NAME}` 約束：

- 允許字符：`[a-zA-Z0-9_-]`，長度 1–64
- 大小寫敏感（`Orders` 與 `orders` 為不同隊列）
- 非法名稱返回 `400 Bad Request`

### 3.2 POST — 寫入消息

**請求**

```http
POST /api/v1/queue/orders HTTP/1.1
Content-Type: application/json

{
  "body": "hello world",
  "metadata": {
    "source": "service-a",
    "trace_id": "abc-123"
  }
}
```

| 字段 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `body` | string | 是 | 消息正文；Phase 2 可為 base64 密文 |
| `metadata` | object | 否 | 客戶端自定義鍵值，服務端原樣存儲 |

也支持 `Content-Type: text/plain`，body 直接作為消息正文（無 metadata）。

**響應**

| 狀態碼 | 說明 |
|--------|------|
| `201 Created` | 寫入成功 |
| `400 Bad Request` | 格式錯誤、隊列名非法、body 超限 |
| `413 Payload Too Large` | 單條消息超過大小限制 |
| `507 Insufficient Storage` | 隊列已滿 |

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queue": "orders",
  "created_at": "2026-07-10T12:00:00Z"
}
```

### 3.3 GET — 讀取消息（Consume）

**語義**：FIFO，取出後從隊列刪除（非 peek）。

**請求**

```http
GET /api/v1/queue/orders HTTP/1.1
```

可選 Query 參數（Phase 1 預留，默認不啟用）：

| 參數 | 說明 |
|------|------|
| `timeout` | 長輪詢秒數（Phase 1.1） |
| `peek` | `true` 時只讀不刪（Phase 1.1） |

**響應**

| 狀態碼 | 說明 |
|--------|------|
| `200 OK` | 成功返回一條消息 |
| `204 No Content` | 隊列為空（非阻塞模式） |
| `404 Not Found` | 隊列不存在且未啟用 auto-create |

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "queue": "orders",
  "body": "hello world",
  "metadata": {
    "source": "service-a"
  },
  "created_at": "2026-07-10T12:00:00Z"
}
```

### 3.4 輔助接口

```http
GET  /health          # 健康檢查，返回 200
GET  /api/v1/queues   # 列出隊列名稱及各自深度（Phase 1.1）
DELETE /api/v1/queue/{QUEUE_NAME}  # 清空隊列（Phase 1.1，可選）
```

### 3.5 錯誤響應格式

```json
{
  "error": {
    "code": "QUEUE_FULL",
    "message": "queue 'orders' has reached max depth 10000"
  }
}
```

---

## 4. 隊列行為與配置

### 4.1 默認行為

| 項目 | 默認值 |
|------|--------|
| 隊列創建策略 | lazy（首次寫入時創建） |
| 讀取模式 | 非阻塞；空隊列返回 `204` |
| 順序 | FIFO |
| 讀取副作用 | consume（彈出） |

### 4.2 環境變量

| 變量 | 默認 | 說明 |
|------|------|------|
| `CLARKQ_ADDR` | `:8080` | 監聽地址 |
| `CLARKQ_MAX_QUEUES` | `1000` | 最大隊列數量 |
| `CLARKQ_MAX_DEPTH` | `10000` | 單隊列最大消息數 |
| `CLARKQ_MAX_MESSAGE_BYTES` | `1048576` (1MB) | 單條消息上限 |
| `CLARKQ_AUTO_CREATE` | `true` | GET 時是否自動創建空隊列 |

---

## 5. 並發與數據結構（Phase 1）

```go
// 概念結構，實作時可調整

type Message struct {
    ID        string
    Body      string
    Metadata  map[string]string
    CreatedAt time.Time
}

type Queue struct {
    mu       sync.Mutex
    name     string
    messages []Message
    maxDepth int
}

type Manager struct {
    mu     sync.RWMutex
    queues map[string]*Queue
    config Config
}
```

- `Manager` 級別 `RWMutex`：讀取隊列列表用讀鎖；創建隊列用寫鎖
- `Queue` 級別 `Mutex`：單隊列 Push/Pop 串行化，不同隊列並行無競爭
- 消息 ID 使用 UUID v4

---

## 6. 加密層設計（Phase 2）

Phase 2 引入可選加密，需先明確**信任邊界**：你是否信任部署 clarkQ 的運行環境（機器、容器、運維、進程內存、日誌系統）。

### 6.1 兩種方案對比

#### 方案 A：完全客戶端加解密（Client-Side E2E）

```
Client                          clarkQ Server
  │                                   │
  │  encrypt(plaintext, key)          │
  │ ─── POST {body: ciphertext} ────► │  存 ciphertext（不透明字節）
  │                                   │
  │ ◄── GET {body: ciphertext} ────── │
  │  decrypt(ciphertext, key)         │
```

| 維度 | 說明 |
|------|------|
| 密鑰位置 | 僅客戶端持有，服務端不接觸任何密鑰 |
| 服務端可見性 | 僅密文；無法解密（除非客戶端泄露密鑰） |
| 信任要求 | **不需要信任** server 運行環境 |
| 優點 | 安全邊界最清晰；server 被攻破也只泄露密文 |
| 缺點 | 密鑰分發、輪換、多消費者協調均由客戶端負責；服務端無法做內容審計或檢索 |
| 適用場景 | 不信任部署環境；多租戶；消息內容高度敏感 |

#### 方案 B：服務端加密 + 客戶端解密（Server Encrypt / Client Decrypt）

此處「服務端放加密鑰匙、客戶端放解密鑰匙」在實踐中對應 **非對稱加密** 或 **信封加密（Envelope Encryption）**。

##### B1 — 非對稱模式（推薦的 Split-Key 實現）

```
密鑰對生成：
  - 公鑰（加密鑰匙）→ 部署在 clarkQ server
  - 私鑰（解密鑰匙）→ 僅客戶端持有

寫入路徑（server 加密）：
  Client ── POST plaintext (TLS) ──► Server
                                         │ encrypt with public key
                                         ▼
                                    store ciphertext

讀取路徑：
  Client ◄── GET ciphertext ──── Server
    │
    decrypt with private key
```

| 維度 | 說明 |
|------|------|
| 密鑰位置 | 公鑰在 server；私鑰僅 client |
| 傳輸 | 明文經 TLS 到達 server 後才加密 |
| 靜態存儲 | 密文；server 無私鑰，**無法解密歷史消息** |
| 信任要求 | **部分信任** server 環境：進程在加密前能接觸明文 |
| 風險 | 惡意/被入侵的 server 可在加密前竊聽、寫日誌、篡改明文 |
| 優點 | 客戶端邏輯簡單（POST 明文即可）；靜態數據保護好 |
| 適用場景 | 信任部署環境「基本可信但不希望靜態泄露」；內部服務間傳遞 |

##### B2 — 對稱信封加密（Server 持 KEK）

```
Server 持有 KEK（對稱密鑰，存在 env / K8s Secret / 外部 KMS）
每條消息：
  - 生成隨機 DEK
  - 用 DEK 加密消息
  - 用 KEK 包裹 DEK
  - 存 {encrypted_dek, ciphertext, nonce}
Client 需持有 KEK 或通過獨立 KMS 獲取 DEK 才能解密
```

| 維度 | 說明 |
|------|------|
| 信任要求 | **需要信任** server 環境（server 必須能加密，通常也能解密） |
| 優點 | 性能好；與雲 KMS 集成成熟 |
| 缺點 | 若 server 被完全控制，攻擊者可拿到 KEK 解密全部消息 |
| 適用場景 | 私有雲內部、server 運行環境強管控 |

#### 方案對照表

|  | 方案 A<br>客戶端 E2E | 方案 B1<br>公鑰加密 | 方案 B2<br>對稱 KEK |
|--|---------------------|---------------------|---------------------|
| Server 見明文 | 否 | **是**（加密前） | **是** |
| Server 能解密存儲 | 否 | 否 | **是** |
| 信任 deploy 環境 | 不需要 | 部分 | 需要 |
| 客戶端複雜度 | 高 | 低 | 中 |
| 靜態泄露防護 | 強 | 強 | 中（取決於 KEK 保護） |
| 性能 | 中 | 低（非對稱） | 高 |

### 6.2 決策建議

```
                    是否信任 clarkQ 部署環境？
                              │
              ┌───────────────┴───────────────┐
              │ 否                            │ 是
              ▼                               ▼
        方案 A                          是否需要靜態加密？
     客戶端 E2E                              │
                                    ┌────────┴────────┐
                                    │ 是              │ 否
                                    ▼                 ▼
                              方案 B1            Phase 1 明文
                           公鑰加密存儲          或 TLS only
                           私鑰僅 client
```

**推薦策略：兩種都支持，按隊列配置切換。**

- 默認 Phase 1：明文存儲（依賴 TLS 傳輸加密）
- Phase 2 增加 `encryption_mode` 配置：

| 模式 | 值 | 說明 |
|------|-----|------|
| 明文 | `none` | 默認 |
| 客戶端 E2E | `client` | server 只存密文，不參與加解密 |
| 服務端加密 | `server_rsa` | server 用公鑰加密，client 用私鑰解密 |

可按隊列名稱或全局配置指定模式，例如：

```yaml
encryption:
  default: none
  queues:
    sensitive-orders: client
    internal-tasks: server_rsa
```

### 6.3 Phase 2 消息格式擴展

**client 模式（方案 A）** — 客戶端 POST 密文：

```json
{
  "body": "<base64 ciphertext>",
  "encryption": {
    "mode": "client",
    "algorithm": "aes-256-gcm",
    "key_id": "client-key-v1",
    "nonce": "<base64>"
  },
  "metadata": {}
}
```

**server_rsa 模式（方案 B1）** — 客戶端 POST 明文，server 加密後存儲；GET 返回：

```json
{
  "id": "...",
  "body": "<base64 ciphertext>",
  "encryption": {
    "mode": "server_rsa",
    "algorithm": "rsa-oaep-4096",
    "key_id": "server-pubkey-v1"
  },
  "created_at": "..."
}
```

### 6.4 密鑰管理接口（預留）

```
GET /api/v1/crypto/public-key     # server_rsa 模式：下發公鑰
GET /api/v1/crypto/config         # 當前加密策略與算法列表
```

私鑰**永遠不**通過 API 下發。`client` 模式下 server 不提供密鑰接口。

### 6.5 實作模塊預留

```go
// internal/crypto/provider.go

type Provider interface {
    Mode() string
    Encrypt(plaintext []byte) (ciphertext []byte, meta EncryptionMeta, err error)
    // Decrypt 僅在 server 需要處理明文的路徑使用；
    // client 模式下 server 不實現 Decrypt。
}
```

Phase 1 實現 `NoopProvider`（明文直通），Phase 2 追加 `ClientPassthroughProvider` 與 `RSAEncryptProvider`。

---

## 7. 安全考量（Phase 1）

| 項目 | Phase 1 措施 |
|------|-------------|
| 傳輸 | 建議前置反向代理啟用 TLS |
| 認證 | 暫無（內網假設）；Phase 1.1 可加 API Key / mTLS |
| 輸入驗證 | 隊列名白名單字符、body 大小限制 |
| 資源耗盡 | 隊列數/深度/消息大小上限 |

---

## 8. 實作計劃

### Phase 1 — 基礎隊列（當前）

- [ ] 初始化 Go module 與項目骨架
- [ ] 實現 `Queue` / `Manager` 核心邏輯
- [ ] 實現 `POST/GET /api/v1/queue/{name}`
- [ ] 實現 `GET /health`
- [ ] 單元測試：FIFO 順序、並發安全、隊列上限
- [ ] 集成測試：HTTP API end-to-end

### Phase 1.1 — 運維增強

- [ ] `GET /api/v1/queues` 隊列統計
- [ ] 長輪詢 `?timeout=N`
- [ ] API Key 認證
- [ ] 結構化日誌（`slog`）

### Phase 2 — 加密層

- [ ] `encryption.mode` 配置
- [ ] `client` 模式：密文透傳
- [ ] `server_rsa` 模式：公鑰加密存儲
- [ ] 公鑰分發接口
- [ ] 客戶端 SDK 示例（Go / curl）

---

## 9. 本地運行（Phase 1 完成後）

```bash
cd clarkQ
go run ./cmd/clarkq

# 寫入
curl -X POST http://localhost:8080/api/v1/queue/orders \
  -H "Content-Type: application/json" \
  -d '{"body":"hello","metadata":{"from":"test"}}'

# 讀取
curl http://localhost:8080/api/v1/queue/orders
```

---

## 10. 待決議項

以下問題可在 Phase 1 實作前後持續確認：

1. **GET 空隊列**：當前設計為 `204 No Content`；是否改為 `404`？
2. **隊列持久化**：是否需要可選的磁盤快照（超出內存隊列範疇）？
3. **加密默認模式**：Phase 2 全局默認 `none` 還是強制 `client`？
4. **多消費者**：同一隊列多個 GET 消費者搶消息（當前設計支持，類似 worker pool）是否滿足需求？

---

## 附錄 A：方案選擇速查

| 你的情況 | 建議 |
|----------|------|
| 完全不信任 server 所在機器/運維 | **方案 A**（客戶端 E2E） |
| 信任運維但怕磁盤/內存 dump 泄露 | **方案 B1**（server 公鑰加密） |
| 私有部署、環境強管控、要高性能 | **方案 B2**（對稱 KEK + KMS） |
| 僅防網絡竊聽 | Phase 1 明文 + **TLS** 即可 |