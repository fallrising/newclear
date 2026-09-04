# clarkQ 開發進度

> 最後更新：2026-07-30 · **v1.5.1** + 單機 demo + **多進程集群壓測 demo**  
> 倉庫：https://github.com/fallrising/clarkQ  
> 標籤：`v1.0.0` … `v1.5.1`

---

## 當前狀態

| 項目 | 說明 |
|------|------|
| **分支** | `master` |
| **最新版本** | **v1.5.1** — Admin UI + 單機 smoke 驗證 |
| **單機 Demo** | **`demo/`** — Docker 一鍵 6 場景（已本地綠） |
| **集群 Demo** | **`demo/cluster/`** — 01–07 基礎 + `run-stress.sh` 08–10（已本地綠） |
| **建議用法** | 單機任務隊列 + WAL/Snapshot + API Key + `/ui/` |
| **集群/租約/quorum** | 代碼 + 單測 + **多進程劇本已跑通**；仍建議當實驗能力，上生產前自壓 |

### 已驗證可用（真實二進制 / Docker demo）

- [x] `/health`、`/version`、`/ui/`
- [x] enqueue → list → peek → dequeue → 204
- [x] `/api/v1/metrics` + Prometheus `/metrics`
- [x] WAL + Snapshot 重啟後消息恢復（含 compose restart）
- [x] API Key：無 key → 401；Bearer / `X-API-Key` → 200
- [x] 多租戶配額（max queues / 跨租戶 403）
- [x] 長輪詢 worker 模式
- [x] **`cd demo && ./run-demo.sh`** 全場景通過
- [x] **`cd demo/cluster && ./run-cluster-demo.sh`** 3 進程集群場景通過

```bash
cd demo && ./run-demo.sh                    # 單機 6 場景
cd demo/cluster && ./run-cluster-demo.sh    # 3 進程集群 6 場景
```

### 集群多進程已覆蓋（demo/cluster）

- [x] 三節點 membership / `/api/v1/cluster`
- [x] 分片轉發（任一節點 enqueue → owner）
- [x] RF=2 複製（internal `/ids` ≥2 節點）
- [x] kill 一節點後存活集重哈希 + 續寫續讀 + 重啟
- [x] sync RF 寫路徑（write_quorum 字段 + 連續 enqueue）
- [x] 跨節點併發 enqueue（預設 40）+ drain

### 仍建議自行加深的驗證

- [x] linearizable + lease **定時 soak**（`./run-stress.sh` scenario 08；本地已跑 12–15s 全綠）
- [x] Lease / membership 在 **節點隔離** 下的表現（scenario 09：Docker network disconnect）
- [x] **多 AZ 高延遲** smoke（scenario 10：netem 80ms±40ms）
- [x] 分鐘級 soak 入口：`./run-stress.sh --docker --long`（預設 300s）/ `make stress-long`
- [ ] 真實跨機房拓撲 — 請用自有環境

### 本次驗證（2026-07-30）

- [x] `cd demo && ./run-demo.sh --keep` — 單機 49 checks 綠
- [x] `cd demo/cluster && ./run-cluster-demo.sh --docker` — 集群 51 checks 綠
- [x] Chrome headless 截圖 `/ui/`：online + 隊列列表 + metrics 正常（需 API key）
- [x] `./run-stress.sh --docker` — soak 291/291、partition 恢復、netem 35/35 全綠
- [x] 集群類型指標 + unit tests（`replication_errors_total` 等）
- [x] `deploy/prometheus/alerts.yml` + scrape 示例

---

## 版本線

| 版本 | 內容 |
|------|------|
| **v1.0.0** | 初版：單機閉環、持久化、認證、加密、部署 |
| **v1.1.0** | 探活、owner 重哈希、內存 outbox |
| **v1.2.0** | 落盤 outbox、副本 catch-up |
| **v1.3.0** | 寫 quorum、epoch fencing、owner grace |
| **v1.4.0** | 讀 quorum、linearizable 消費 |
| **v1.5.0** | 多數派租約、多租戶配額 |
| **v1.5.1** | 內建 Admin UI、單機路徑實測 |

詳見 [CHANGELOG.md](CHANGELOG.md)、[ROADMAP.md](ROADMAP.md)。

---

## 功能總覽（按可信度）

### A. 建議上業務的主路徑

| 能力 | 狀態 |
|------|------|
| 命名 FIFO 隊列 HTTP API | ✅ 實測 |
| 長輪詢 / peek / clear / list | ✅ |
| API Key / JWT·OIDC | ✅ 單測 + 部分實測 |
| JWT 隊列 ACL | ✅ 單測 |
| WAL + Snapshot | ✅ 重啟實測 |
| Metrics + OTel 接入點 | ✅ |
| YAML / 環境變量配置 | ✅ |
| Docker / Compose / Helm | ✅ 交付物在 |
| Go/Python/JS SDK 骨架 | ✅ |
| **Admin UI `/ui/`** | ✅ 實測可打開 |

### B. 進階集群（實驗；多進程 demo 已 smoke）

| 能力 | 狀態 |
|------|------|
| 一致哈希分片 + 轉發 | ✅ 3 進程 demo |
| RF 複製 + outbox + catch-up | ✅ RF 可見性 demo；catch-up 靠重啟後背景 |
| Write quorum（sync RF） | ✅ demo smoke |
| Read quorum / linearizable 消費 | ⚠️ 可開 flag 自測，默認 demo 未開 |
| Epoch fencing、owner grace | ⚠️ 單測 + failover 路徑會碰到 |
| 租約選主 | ⚠️ 可開 `CLARKQ_LEASE_ENABLED` 自測 |
| 多租戶配額 | ✅ 單機 demo + 單測 |

---

## 能支撐的業務（摘要）

**適合：** 異步任務（郵件/轉碼/Webhook）、削峰解耦、內網輕消息、邊緣單機排隊、小中型多租戶後台任務。  

**不適合當唯一真相：** 支付/庫存強一致、海量日誌流水、跨機房 exactly-once。  

單機 + WAL + 認證 = 有把握講給業務聽；集群全開 = 先壓測再上。

---

## 快速恢復

```bash
git clone https://github.com/fallrising/clarkQ.git
cd clarkQ
git checkout v1.5.1   # 或 master

# A) Docker 能力劇本（推薦給想「直接看場景」的人）
cd demo && ./run-demo.sh

# B) 本機 binary
make test && make build
./bin/clarkq
# UI: http://localhost:8080/ui/
```

---

## 告一段落說明

到 **v1.5.1** + 集群 demo 為止：

1. 單機主路徑已用真實進程 / Docker smoke 過；  
2. Admin UI 可點可調；  
3. **多進程集群劇本已落地並本地全綠**（分片 / 複製 / failover / 負載）；  
4. 仍 **不宣稱生產級多機高可用**——上線前請用自己的拓撲與負載再壓。  

已補：`Retry-After`、stress suite、集群指標、`--long` soak、**`deploy/prometheus/` 告警規則**。  
若再開工，優先建議：真實跨 AZ 部署驗證，或 Helm ServiceMonitor（可選），而不是繼續堆特性。
