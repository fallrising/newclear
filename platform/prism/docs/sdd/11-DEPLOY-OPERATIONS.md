# 11 — 部署、配置與運維

## 1. 配置檔

單一 YAML，路徑由 `--config` 指定（預設 `/etc/prism/prismd.yaml`）。所有欄位可用環境變數覆寫：`PRISM_<路徑大寫底線>`，如 `PRISM_STORAGE_DRIVER=vmvl`。

```yaml
server:
  http_listen: ":9090"
  grpc_listen: ":4317"
  mode: all-in-one            # all-in-one | ingest | query | ruler | console
  shutdown_timeout: 30s
  external_url: "https://prism.example.com"   # 用於告警的 generatorURL

storage:
  driver: clickhouse          # ★ 換底層只需改這一行
  dsn: "clickhouse://prism:${CH_PASSWORD}@127.0.0.1:9000/prism"
  options:
    cluster: ""
    async_insert: "1"
  retention:
    metrics_days: 30
    logs_days: 14
    traces_days: 7
    red_days: 90
  # 多後端組合：不同 signal 走不同驅動（Phase 5）
  # split:
  #   metrics: {driver: vmvl,       dsn: "..."}
  #   logs:    {driver: vmvl,       dsn: "..."}
  #   traces:  {driver: clickhouse, dsn: "..."}

controlplane:
  postgres_dsn: "postgres://prism:${PG_PASSWORD}@127.0.0.1:5432/prism?sslmode=disable"

tenancy:
  mode: single                # single | strict
  default_tenant: default

auth:
  allow_anonymous_read: true  # 單機自用預設開啟；對外必須關閉
  jwt_secret_file: /etc/prism/secrets/jwt

ingest:
  max_request_bytes: 16MiB
  queue_depth: 64
  batch:
    metrics: {max_items: 10000, max_bytes: 8MiB, flush_interval: 1s}
    logs:    {max_items: 5000,  max_bytes: 8MiB, flush_interval: 1s}
    traces:  {max_items: 5000,  max_bytes: 8MiB, flush_interval: 1s}
  clock_skew_policy: clamp
  max_past: 1h
  max_future: 5m
  memory_limit: 1GiB

limits:                       # 見 04-DATA-MODEL.md §5，此處為全域預設
  max_active_series_per_tenant: 500000
  max_log_line_bytes: 256KiB
  cardinality_alarm_threshold: 10000
  auto_drop_high_cardinality: false

query:
  timeout: 60s
  max_concurrent: 16
  max_concurrent_per_tenant: 8
  max_lookback: 30d
  max_range: 7d
  max_points: 11000
  max_samples: 50000000
  lookback_delta: 5m
  force_fallback: false
  fallback:
    max_range: 24h
    max_rows: 5000000

rules:
  path: /etc/prism/rules
  db_sync_interval: 30s
  eval_timeout: 30s
  state_flush_interval: 60s
  builtin_enabled: true

notify:
  config_path: /etc/prism/alertmanager.yaml
  deadletter_receiver: ops-fallback

telemetry:
  self_monitor: true          # 把自身指標寫入自己的存儲
  log_level: info
  log_format: json
```

### 1.1 配置驗證

`prismd --config-check` 必須：
- 驗證全部欄位型別與範圍
- 驗證 `storage.driver` 已註冊
- 驗證所有 `*_file` 路徑存在且可讀
- 驗證 `rules.path` 下的規則可解析
- 驗證 `notify.config_path` 的路由樹無環、receiver 都存在
- 不連線任何後端就完成上述檢查，退出碼 0/1

CI 與部署腳本必須先跑 `--config-check`。

## 2. 部署形態

### 2.1 單機 all-in-one（v1 預設，2C4G VPS）

```yaml
# deploy/docker-compose.yml
services:
  prismd:
    image: prism/prismd:${VERSION}
    ports: ["9090:9090", "4317:4317"]
    volumes:
      - ./prismd.yaml:/etc/prism/prismd.yaml:ro
      - ./rules:/etc/prism/rules:ro
      - ./secrets:/etc/prism/secrets:ro
    depends_on: [clickhouse, postgres]
    deploy: {resources: {limits: {memory: 1500M}}}
  clickhouse:
    image: clickhouse/clickhouse-server:24.8-alpine
    volumes: ["ch-data:/var/lib/clickhouse", "./clickhouse-config.xml:/etc/clickhouse-server/config.d/prism.xml:ro"]
    ulimits: {nofile: {soft: 262144, hard: 262144}}
    deploy: {resources: {limits: {memory: 2G}}}
  postgres:
    image: postgres:16-alpine
    volumes: ["pg-data:/var/lib/postgresql/data"]
    deploy: {resources: {limits: {memory: 256M}}}
  grafana:
    image: grafana/grafana-oss:12.0.0
    ports: ["3000:3000"]
    volumes: ["./grafana/provisioning:/etc/grafana/provisioning:ro"]
    deploy: {resources: {limits: {memory: 256M}}}
```

`clickhouse-config.xml` 必須調低預設記憶體（單機關鍵）：

```xml
<clickhouse>
  <max_server_memory_usage_to_ram_ratio>0.5</max_server_memory_usage_to_ram_ratio>
  <mark_cache_size>268435456</mark_cache_size>
  <uncompressed_cache_size>0</uncompressed_cache_size>
  <background_pool_size>4</background_pool_size>
  <max_concurrent_queries>16</max_concurrent_queries>
  <logger><level>warning</level></logger>
</clickhouse>
```

不調這些，ClickHouse 預設會吃掉大部分記憶體，在 4G 機器上必然 OOM。

### 2.2 極省資源形態（1C2G）

`storage.driver: vmvl`，VictoriaMetrics single + VictoriaLogs single，兩者合計約 300 MB RSS。代價是沒有 trace。適合純主機監控場景。

### 2.3 systemd（非容器）

`deploy/systemd/` 提供 `prismd.service` 與 `prism-agent.service`，含 §8 的資源限制與加固選項。

## 3. 資源預算（實測基準，必須在 Phase 5 驗證並更新本表）

規模假設：10 台主機、20 個服務、5k active series、2 GB/day 日誌、100 萬 span/day。

| 元件 | RSS | CPU | 磁碟/月 |
|---|---|---|---|
| `prismd`（all-in-one） | 400–800 MB | 0.3–0.8 core | — |
| ClickHouse | 1.0–2.0 GB | 0.3–1.0 core | 指標 3 GB + 日誌 8 GB + span 6 GB ≈ 17 GB |
| PostgreSQL | 100–200 MB | < 0.1 core | < 1 GB |
| Grafana | 150–250 MB | < 0.1 core | < 1 GB |
| `prism-agent`（每台） | 40–120 MB | < 0.1 core | ≤ 512 MB WAL |
| **合計（服務端）** | **~2.5 GB** | **~1.5 core** | **~20 GB/月** |

2C4G 機器可行但無餘裕。**建議 4C8G 起跳**；若堅持 2C4G，用 §2.2 的 vmvl 形態或把 ClickHouse 放到另一台。

壓縮率預期：日誌 ZSTD(3) 約 8–15×，span 約 6–10×，指標 Gorilla+ZSTD 約 4–8×（明顯不如專用 TSDB 的 10–20×）。

## 4. 保留與分級

| 資料 | 預設保留 | 理由 |
|---|---|---|
| 原始日誌 | 14 天 | 排障窗口 |
| Span 明細 | 7 天 | 體積最大，價值衰減最快 |
| 指標原始（15s） | 30 天 | — |
| RED 預聚合（1m） | 90 天 | 趨勢分析 |
| 服務依賴（1h） | 90 天 | — |
| 告警與投遞記錄 | 180 天 | 審計 |
| 審計日誌 | 365 天 | 合規 |

降採樣（Phase 6）：指標 30 天後降為 5 分鐘粒度再保留 1 年。介面預留於 `spi.MetricCaps.Downsampling`。

## 5. 磁碟水位熔斷（必做）

`prismd` 每 30 秒檢查存儲後端所在磁碟的可用比例（ClickHouse 用 `system.disks`，vmvl 用 `/metrics` 的 `vm_free_disk_space_bytes`）：

| 水位 | 動作 |
|---|---|
| > 80% | 觸發 `PrismDiskPressure` 告警 |
| > 90% | 停止寫入 `severity <= debug` 日誌與 `kind=internal` span，回 429 |
| > 95% | 停止全部日誌與 span 寫入，**僅保留指標**（告警的生命線） |
| > 98% | 全部寫入停止，`/-/ready` 回 503，讀取仍可用 |

每個階段的進入與退出都必須記錄 WARN 日誌並改變 `prism_disk_pressure_level` 指標值。退出需有遲滯（低於閾值 5 個百分點才降級），避免抖動。

## 6. 自監控

- `prismd` 與 `prism-agent` 暴露 `/metrics`（Prometheus 格式）。
- `telemetry.self_monitor: true` 時，`prismd` 每 15 秒把自身指標經內部路徑寫入自己的存儲（不走 HTTP）。標籤 `job="prism"`。
- **自監控的循環問題**：Prism 掛了就無法監控自己。因此必須配合：
  1. §7 的外部 watchdog
  2. `deploy/grafana/dashboards/prism-self.json` 儀表板
  3. 一份「Prism 自身故障排查」runbook

## 7. Watchdog（強制部署項）

見 `07-ALERTING.md` §8。`deploy/` 必須提供三種範例：

1. Healthchecks.io / Cronitor 的 ping URL 作為 receiver
2. 另一台主機的 cron + `curl -f http://prism/-/healthy || send_alert`
3. Uptime Kuma 的 push monitor

README 必須用醒目段落說明：**沒有部署 watchdog 的監控系統等於沒有監控系統。**

## 8. 備份與回復

| 資料 | 備份方式 | RPO |
|---|---|---|
| PostgreSQL（規則、租戶、靜默、投遞） | `pg_dump` 每日 + WAL 歸檔 | 1 天 / 5 分鐘 |
| 規則檔 | Git（GitOps） | 即時 |
| 配置與 secrets | Git（secrets 用 SOPS/age 加密） | 即時 |
| ClickHouse 遙測資料 | **不備份** | — |

**遙測資料刻意不備份**：它是時效性資料，重建成本高於價值，且體積使備份不切實際。此決策必須在 README 明確告知使用者。若使用者需要長期保存特定資料，應透過 recording rules 降採樣後存入 Postgres 或匯出。

回復演練（每季）：從 `pg_dump` + Git 重建一個空的 Prism，驗證規則、租戶、通知渠道全部恢復，遙測資料從零開始。演練步驟寫成 `docs/runbooks/restore.md`。

## 9. 升級

- `prismd` 的 schema 遷移在啟動時自動執行，且**必須向後相容一個版本**（新版能讀舊 schema，舊版能讀新 schema 寫的資料）。
- 遷移前自動 `pg_dump` 到 `backup_dir`（可關閉）。
- ClickHouse 的 DDL 變更只允許 `ADD COLUMN`（帶預設值）與 `ADD INDEX`；`DROP COLUMN` 與型別變更需要 major 版本與明確的遷移文件。
- Agent 升級：`prismctl agent upgrade --selector 'env=staging'` 下發新版本 URL 與 sha256，agent 自行下載、校驗、`exec` 替換。失敗時回滾到舊 binary。**預設關閉**（`control.auto_upgrade: false`），需明確啟用。

## 10. Runbook 清單（`docs/runbooks/`，v1 必備）

1. `prism-down.md` — Prism 本身無回應
2. `ingest-dropping.md` — 資料被丟棄
3. `high-cardinality.md` — 基數爆炸定位與處置
4. `disk-pressure.md` — 磁碟壓力
5. `query-slow.md` — 查詢變慢（含下推/回退判定步驟）
6. `notification-failing.md` — 通知發不出去
7. `driver-switch.md` — **切換存儲驅動的完整步驟**（含雙寫過渡期、資料不遷移的說明、回滾）
8. `restore.md` — 災難回復

`driver-switch.md` 是本專案的招牌 runbook，必須寫得可照做：切換不遷移歷史資料，新舊資料分屬不同後端；過渡期可用 `storage.split` 讓不同 signal 走不同驅動；舊資料保留至過期即可。
