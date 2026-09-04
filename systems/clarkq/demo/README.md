# clarkQ Demo — 用 Docker 看能力

這套 demo **用 Docker 起真實 clarkQ**，再跑一組腳本，對應常見業務場景。  
重點展示**已實測、可放心試**的單機能力（不是空口文檔）。

## 你會看到什麼

| # | 場景 | 對應業務 |
|---|------|----------|
| 01 | Health / Version / **Admin UI** | 運維探活、可視化控制台 |
| 02 | 任務隊列 FIFO（peek + consume） | 異步任務：郵件、轉碼、Webhook |
| 03 | API Key 認證 | 內網多服務共用、防裸奔 |
| 04 | **多租戶配額** | 多團隊/多客戶限隊列數、防跨租戶寫 |
| 05 | **重啟後消息仍在**（WAL + Snapshot） | 進程掛掉可恢復的緩衝 |
| 06 | 長輪詢 worker + Prometheus metrics | 低空轉 worker、可觀測 |

跑完後可手動打開 UI：

```text
http://localhost:8080/ui/
API Key: dev-key
```

## 一行跑完全部劇本

需要：Docker（含 `docker compose`）、本機 `curl`（沒有的話腳本會用容器跑）。

```bash
git clone https://github.com/fallrising/newclear/systems/clarkq.git
cd clarkQ/demo
chmod +x run-demo.sh run-scenarios.sh scenarios/*.sh
./run-demo.sh
```

成功時結尾會有 `All demo scenarios passed.`

### 常用參數

```bash
# 換埠
CLARKQ_DEMO_PORT=18080 ./run-demo.sh

# 跑完不要關容器（方便自己點 UI）
./run-demo.sh --keep

# 關掉並刪 volume
./run-demo.sh --down
```

### 只起服務、自己點

```bash
cd demo
docker compose -p clarkqdemo up --build -d
# UI: http://localhost:8080/ui/   key: dev-key
docker compose -p clarkqdemo down -v
```

### 只跑腳本（伺服器已在跑）

```bash
export CLARKQ_URL=http://127.0.0.1:8080
export CLARKQ_API_KEY=dev-key
# 若無法 docker restart，可跳過持久化場景：
export CLARKQ_DEMO_SKIP_RESTART=1
./run-scenarios.sh
```

## Demo 預設配置（`docker-compose.yml`）

| 變量 | 值 | 用意 |
|------|-----|------|
| `CLARKQ_API_KEY` | `dev-key` | 示範認證 |
| `CLARKQ_WAL_PATH` | `/data/clarkq.wal` | 持久化 |
| `CLARKQ_SNAPSHOT_PATH` | `/data/snapshot.json` | 快照 |
| `CLARKQ_TENANT_QUOTAS` | `true` | 租戶場景 |
| `CLARKQ_TENANT_MAX_QUEUES` | `2` | 第三個隊列會 429 |

**刻意沒開**多節點 / quorum / lease：進階能力見 **`demo/cluster/`**（本機 3 進程一鍵壓測）。本目錄保證「單機主路徑看得見、跑得通」。

## 目錄

```text
demo/
  README.md              # 本文件
  docker-compose.yml     # clarkQ + 可選 runner
  run-demo.sh            # 用戶入口：build → up → 劇本 → 可選 down
  run-scenarios.sh       # 只跑場景
  lib.sh                 # curl 斷言小工具
  scenarios/
    01_health_and_ui.sh
    02_task_queue.sh
    03_auth.sh
    04_tenants.sh
    05_persistence.sh
    06_metrics_and_longpoll.sh
```

## 失敗時

```bash
docker compose -p clarkqdemo logs clarkq
docker compose -p clarkqdemo ps
```

若 05 持久化失敗：確認 `docker compose restart` 權限、volume 是否被 `--down -v` 清掉後再測。

## 與「大特性」的關係

| 能力 | Demo 裡？ | 說明 |
|------|-----------|------|
| 單機隊列 / UI / 認證 / 租戶 / WAL | ✅ | 劇本覆蓋 |
| 集群分片、複製、failover、併發 | ✅ 見 **`demo/cluster/`** | 3 進程一鍵：`./run-cluster-demo.sh` |
| 租約 / linearizable 默認全開 | ⚠️ | cluster demo 可用 env 打開自測 |
