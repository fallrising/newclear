# clarkQ 路線圖

## 產品目標（北極星）

做一個 **輕量、可單機部署、可選持久化與分片** 的 HTTP 消息隊列：

| 場景 | 是否適合 clarkQ |
|------|----------------|
| 服務間任務分發 / worker pool | ✅ |
| 開發測試、邊緣節點、sidecar 緩衝 | ✅ |
| 需要 Kafka 級吞吐與保留策略 | ❌ 用 Kafka/NATS/Pulsar |
| 需要跨 AZ 強一致 + 自動選主 | ❌ v1 不做；見 v2 |

**定位一句話：** 比 Redis list 更完整的隊列語義，比 Rabbit/Kafka 輕一個數量級。

---

## 版本定義

### ✅ v1.0.0「初版」— 2026-07-29

### ✅ v1.1.0「集群韌性」

### ✅ v1.2.0「落盤 outbox + catch-up」

### ✅ v1.3.0「寫 quorum + epoch fencing」

### ✅ v1.4.0「讀 quorum + linearizable 消費」

### ✅ v1.5.0「租約選主 + 多租戶配額」— **現在**

初版 = **功能閉環可上線試用**，不是研究原型。

| 能力 | 狀態 |
|------|------|
| 命名 FIFO 隊列 + REST | ✅ |
| 認證（API Key / JWT）+ 可選 ACL | ✅ |
| 加密（明文 / 客戶端 E2E / server RSA） | ✅ |
| 持久化（WAL + 快照） | ✅ |
| 指標 + 追蹤 | ✅ |
| 分片集群 + 可選多副本 | ✅ |
| 部署（Docker / Compose / Helm） | ✅ |
| 客戶端 SDK 骨架 | ✅ |
| 版本 API + 發布物 | ✅ |

**完成標準（Definition of Done）：**

1. `go test ./...` 全綠  
2. 單機：enqueue → restart（WAL/snapshot）→ dequeue 成功  
3. 雙節點：分片轉發可用；RF=2 時副本可見  
4. 文檔：README + USAGE + CHANGELOG 覆蓋主路徑  
5. Git tag `v1.0.0`  

→ **初版在打上 `v1.0.0` tag 時視為完成。**

### v1.x（穩定期，按需）

- 文檔與示例補全、bugfix
- SDK 加密 helper 完善、更多語言
- Helm values 生產默認值打磨
- ✅ 指標：`replication_errors_total`、`quorum_errors_total`、`lease_errors_total`、outbox/membership gauges
- ✅ **多進程集群壓測 demo**（`demo/cluster/`，3 節點 RF=2）
- ✅ 集群瞬時錯誤 `Retry-After` + `retryable` / `retry_after_ms`（STALE_EPOCH / NOT_OWNER / OWNER_GRACE / LEASE…）
- ✅ linearizable + lease 進階壓測入口 `demo/cluster/run-stress.sh`（soak / partition / netem）
- ✅ `./run-stress.sh --long` / `make stress-long`（預設 5 分鐘 soak）
- ✅ Prometheus 告警規則示例（`deploy/prometheus/alerts.yml`）
- 真實跨 AZ 部署驗證 — 按需在自有拓撲跑

### ✅ 已下沉（v1.1–v1.2）

| 項目 | 狀態 |
|------|------|
| Peer 探活 + owner 在存活集上重哈希 | ✅ v1.1 |
| 異步複製 outbox + 指數退避 | ✅ v1.1 |
| 落盤 outbox / 重啟後續傳 | ✅ v1.2 |
| 副本 catch-up / 缺失 ID 對賬 | ✅ v1.2 |
| 集群狀態 API + generation | ✅ v1.1 |

### ✅ 已下沉到 v1.3–v1.4

| 項目 | 狀態 |
|------|------|
| Write quorum | ✅ v1.3 |
| Epoch fencing | ✅ v1.3 |
| Owner grace | ✅ v1.3 |
| Read quorum + linearizable consume | ✅ v1.4 |

### ✅ 已下沉到 v1.5

| 項目 | 狀態 |
|------|------|
| 多數派租約選主 / 續約 | ✅ |
| 多租戶配額與隊列綁定 | ✅ |

### v2.0（仍待做）

| 項目 | 說明 | 粗估 |
|------|------|------|
| 跨區域異步複製拓撲 | 多 AZ 延遲優化 | 2–3 週 |
| 外部 etcd/Consul 租約適配 | 可插拔租約後端 | 1–2 週 |
| 進階管理 UI | v1.5.1 已有嵌入式 `/ui/`；v2 可加深運維能力 | 按需 |

---

## 你現在該怎麼用初版

**推薦單機生產試點：**

```bash
export CLARKQ_API_KEY=...
export CLARKQ_WAL_PATH=./data/clarkq.wal
export CLARKQ_SNAPSHOT_PATH=./data/snapshot.json
export CLARKQ_SNAPSHOT_INTERVAL=30s
./bin/clarkq
```

**可選分片 + 同步雙副本：**

```bash
export CLARKQ_CLUSTER_NODES=http://n1:8080,http://n2:8080
export CLARKQ_CLUSTER_ADVERTISE_URL=http://n1:8080
export CLARKQ_REPLICATION_FACTOR=2
export CLARKQ_REPLICATION_MODE=sync   # 或 async 換吞吐
export CLARKQ_CLUSTER_SECRET=...
```

---

## 一句話結論

- **目標：** 輕量 HTTP 任務隊列，可持久、可觀測、可分片。  
- **初版：** **v1.0.0，當前發布即完成。**  
- **之後：** 故障轉移與更強集群一致性放在 **v2**，不擋初版。
