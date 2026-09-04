# clarkQ 集群壓測 Demo（多進程）

對 **分片 / 複製 / 故障切換 / quorum 寫路徑 / 併發負載** 做真實多節點驗證。  
預設用 **本機 3 個進程**（真正的 multi-process）；也可用 Docker 3 容器。

> 這不是「生產級 HA 背書」，而是把進階集群能力從「只有單測」推進到「可一鍵跑通的多進程劇本」。

## 一行跑完全部

```bash
# 需要：已 build 的 bin/clarkq（沒有會自動 go build）、curl
cd clarkQ
make build          # 若尚無 binary
cd demo/cluster
chmod +x *.sh scenarios/*.sh
./run-cluster-demo.sh
```

成功結尾：`All cluster scenarios passed.`

### 常用參數

```bash
./run-cluster-demo.sh --keep          # 跑完保留 3 進程
./run-cluster-demo.sh --down          # 停掉本地 / docker 集群
./run-cluster-demo.sh --docker        # 改用 Compose 3 節點

CLARKQ_CLUSTER_BASE_PORT=19081 ./run-cluster-demo.sh
CLARKQ_CLUSTER_LOAD_N=80 ./run-cluster-demo.sh
CLARKQ_REPLICATION_MODE=async ./run-cluster-demo.sh
CLARKQ_LINEARIZABLE_CONSUME=true CLARKQ_LEASE_ENABLED=true ./run-cluster-demo.sh
# 同上 + Docker：
CLARKQ_LINEARIZABLE_CONSUME=true CLARKQ_LEASE_ENABLED=true ./run-cluster-demo.sh --docker
```

### 進階長穩 / 分區 / 多 AZ 延遲（推薦）

```bash
# 強制 linearizable + lease；預設 soak 20s
./run-stress.sh --docker

# ~5 分鐘 soak（進度每 30s 打一行）
./run-stress.sh --docker --long
# 等同：make stress-long

CLARKQ_STRESS_SECS=45 CLARKQ_PARTITION_SECS=10 ./run-stress.sh --docker
# 本機 3 進程（分區用 SIGSTOP；無 netem）
./run-stress.sh
```

| 變量 | 預設 | 說明 |
|------|------|------|
| `CLARKQ_STRESS_SECS` | `20` | soak 時長 |
| `CLARKQ_STRESS_PRODS` / `CONS` | `4` / `2` | 併發產消 |
| `CLARKQ_PARTITION_SECS` | `8` | 隔離時長 |
| `CLARKQ_NETEM_DELAY` | `80ms` | 模擬跨 AZ RTT |
| `CLARKQ_LEASE_TTL` | stress 下 `3s` | 加速租約周轉 |

## 場景一覽

| # | 場景 | 驗證什麼 |
|---|------|----------|
| 01 | Membership | 三節點 `/health`、`/api/v1/cluster`、alive/generation |
| 02 | Shard forward | 任一節點 enqueue 同一隊列 → owner 代理；FIFO 可 drain |
| 03 | Replication | RF=2 時 internal `/ids` 在 ≥2 節點可見；consume 後清除 |
| 04 | Failover | kill 一節點 → 存活集重哈希 → 仍可 enqueue/consume → 重啟 |
| 05 | Quorum smoke | sync RF 下連續寫入 5 條 + `write_quorum` 字段 |
| 06 | Load smoke | 跨節點併發 enqueue（預設 40）再 drain（≥90%） |
| 07 | Linearizable + lease | **可選**；flags 關則 skip。開：`CLARKQ_LINEARIZABLE_CONSUME=true CLARKQ_LEASE_ENABLED=true` |
| 08 | Soak stress | **進階** `./run-stress.sh`：linearizable+lease 定時併發產消 |
| 09 | Partition / jitter | 隔離一節點（Docker network disconnect / 本機 SIGSTOP）後恢復 |
| 10 | High-latency AZ | Docker netem 延遲（需 `CAP_NET_ADMIN` + iproute2） |

## 拓撲

```text
:38481  node1  ──┐
:38482  node2  ──┼── consistent-hash ownership + RF=2 sync replicate
:38483  node3  ──┘
```

| 變量 | 預設 |
|------|------|
| `CLARKQ_REPLICATION_FACTOR` | `2` |
| `CLARKQ_REPLICATION_MODE` | `sync` |
| `CLARKQ_CLUSTER_PROBE_INTERVAL` | `1s` |
| `CLARKQ_CLUSTER_FAIL_THRESHOLD` | `2` |
| `CLARKQ_API_KEY` | `dev-key` |
| `CLARKQ_CLUSTER_SECRET` | `dev-cluster-secret` |
| data dir (local) | `/tmp/clarkq-cluster-demo` |

## 目錄

```text
demo/cluster/
  README.md
  run-cluster-demo.sh    # 基礎 01–07 入口
  run-stress.sh          # 進階 08–10（soak / partition / latency）
  start-local.sh / stop-local.sh
  docker-compose.yml     # --docker（含 NET_ADMIN 供 netem）
  run-scenarios.sh
  lib.sh
  scenarios/01_…10_….sh
```

## 只起集群、自己 curl

```bash
./start-local.sh
# shell
. /tmp/clarkq-cluster-demo/env.sh
curl -s $CLARKQ_URL/health | head
curl -s -H "X-API-Key: $CLARKQ_API_KEY" $CLARKQ_URL/api/v1/cluster | head
./stop-local.sh
```

## 與單機 demo 的關係

| | `demo/` 單機 | `demo/cluster/` |
|--|-------------|-----------------|
| 目標 | 業務主路徑 | 集群進階路徑 |
| 節點 | 1 | 3 |
| 已承諾程度 | 建議上業務 | 實驗能力 + 可重複驗證 |

單機劇本仍是：`cd demo && ./run-demo.sh`。

## 失敗時

```bash
# local
tail -n 80 /tmp/clarkq-cluster-demo/logs/n*.log

# docker
docker compose -p clarkqcluster -f demo/cluster/docker-compose.yml logs
```

常見原因：埠被占用（換 `CLARKQ_CLUSTER_BASE_PORT`）、binary 過舊（`make build`）、failover 後 membership 尚未收斂（腳本已重試；仍失敗可看 probe 日誌）。
