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
  dsn: ""                    # 與dsn_file二選一，DSN視為credential
  dsn_file: /etc/prism/secrets/clickhouse_dsn
  options:
    cluster: ""
    async_insert: "1"          # metrics/traces；logs為穩定write_seq採同步INSERT
    max_execution_time: "55"  # 必須小於query.timeout
    max_memory_usage: "1000000000"
    max_result_rows: "5000000"
    max_rows_to_read: "5000000"
    max_result_bytes: "67108864"
    max_open_conns: "10"
  retention:
    metrics_days: 30
    logs_days: 14
    traces_days: 7
    red_days: 90
  # 多後端組合尚未實作；本期非空split會被config-check拒絕（後續階段）
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
  ingest_api_key_file: /etc/prism/secrets/ingest_api_key # ingest 必填，至少 32 bytes；不得共用 JWT

ingest:
  max_request_bytes: 16MiB   # OTLP 與 remote_write 的 wire／解壓後上限
  queue_depth: 4              # 每訊號三條優先佇列；runtime 單租戶、每訊號兩名 worker
  otlp:
    max_recv_msg_size: 4MiB
    max_concurrent_requests: 16 # HTTP/gRPC 共用即時拒絕的解碼閘門
  batch:
    metrics: {max_items: 10000, max_bytes: 8MiB, flush_interval: 1s}
    logs:    {max_items: 5000,  max_bytes: 8MiB, flush_interval: 1s}
    traces:  {max_items: 5000,  max_bytes: 8MiB, flush_interval: 1s}
  clock_skew_policy: clamp
  max_past: 1h
  max_future: 5m
  memory_limit: 1GiB          # 預設 OTLP + remote_write logical budget 968MiB；非 RSS 硬上限

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

### 1.1 P1-05 寫入容量與生命週期

`all-in-one`／`ingest` 角色在同一 HTTP listener 接收 OTLP 的三條 `/v1/*`
路由與 `POST /prom/api/v1/write`；remote_write 重用 file-backed bearer、
`tenancy.default_tenant` 與 HTTP TLS，OTLP gRPC 繼續使用獨立 listener。
其他角色不掛載 remote_write。關閉時先停止兩個 receiver 的新工作，再完成
HTTP／gRPC shutdown、pipeline drain，最後由 daemon 關閉 backend。

remote_write 有獨立的固定單請求閘門，因此預算必須加入
`2 * ingest.max_request_bytes`（壓縮與解壓 buffer）；不共用 OTLP 解碼閘門。
邏輯預算為
`(3 + 3 * queue_depth + 2) * sum(batch.*.max_bytes)` 加
`2 * max(max_request_bytes, otlp.max_recv_msg_size) * otlp.max_concurrent_requests`
加一份序列化 admission request 與兩份 remote_write receive buffer。
預設從 936 MiB 增加至 **968 MiB**，仍小於 `memory_limit: 1GiB`。
config-check 允許預算恰好等於 limit，超出一 byte 即拒絕。
這個預算不包含 decoded protobuf／pdata、正規化及狀態配置、allocator
與 memory backend 的資料保留，不能視為 RSS 上限。

### 1.2 配置驗證

`prismd --config-check` 必須：
- 驗證全部欄位型別與範圍
- 驗證 `storage.driver` 已註冊
- 驗證所有 `*_file` 路徑存在且可讀
- 驗證 `rules.path` 下的規則可解析
- 驗證 `notify.config_path` 的路由樹無環、receiver 都存在
- 不連線任何後端就完成上述檢查，退出碼 0/1

CI 與部署腳本必須先跑 `--config-check`。

### 1.3 P1-10 ClickHouse 設定接線

Daemon註冊memory與ClickHouse；選storage.driver=clickhouse後沿既有SPI Open→Migrate/Ping→ingest/query→drain→Close。Database須預先存在，單一writer／migrator；cluster非空與split非空不支援，config-check fail closed。此設定接線不提供compose/Grafana部署。

StorageConfig.DSN使用既有secret.String，格式化／JSON／YAML去敏；dsn／dsn_file二選一。dsn_file與username_file／password_file只讀有界regularfiles（最多4KiB），拒絕symlink/FIFO/device，相對路徑依config位置。DSN inline／environment可設定但不得輸出；file與inline credentials來源衝突拒絕。設定驗證不需要連ClickHouse。

storage.retention四個天數是daemon唯一權威（1–36500），轉成driver retention_*_days；options內另給同名retention鍵會被拒絕，避免忽略配置。query.timeout必須大於max_execution_time（預設60s>55s）。Driver context仍可被caller提早取消；原P109UTC／TTLoverflowguard維持。

| Driver option | 預設 | 支援範圍 |
| --- | --- | --- |
| max_execution_time | 55 seconds | 1–3600 |
| max_memory_usage | 1,000,000,000 bytes | 正值，≤2^50 |
| max_result_rows | 5,000,000 | 正值，≤2^30 |
| max_rows_to_read | 5,000,000 | 正值，≤2^30 |
| max_result_bytes | 64MiB | 正值，≤2^40 |
| max_open_conns | 10 | 1–1000 |

Server scan/result設定以throw超限，nativeSQL顯式executioncap；driver累計logicaldecodedrows/bytes並回TooLarge，沒有成功截斷。Iterator持有lease到EOF/Close/取消／錯誤，Backend.Close取消並drain後closeclient一次。Logicalbytes不是processRSS／soak保證。Metrics/traces asyncack、多表非transaction及metadata無TTL限制保留；logs同步INSERT供持久write_seq與drainedrestartseeding。

## 2. 部署形態

### 2.1 Phase 1 本機 all-in-one

可執行設定以 [Compose](../../deploy/docker-compose.yml)、
[部署 README](../../deploy/README.md) 與 [P1-11 規格](../specs/p1-11-deploy-e2e.md)
為準。當期只啟動 prismd、ClickHouse 24.8.14.39 和 Grafana OSS 12.0.0，
所有映像固定 Linux amd64 digest；不啟動尚未實作的 PostgreSQL 控制平面。
HTTP/gRPC/Grafana ports 只公開到 loopback，測試用 ephemeral binds。

既有驗證需要五個 regular secret files：clickhouse_password、clickhouse_dsn、
ingest_api_key、grafana_password、jwt_secret，並需要既有 rules 目錄與有效的
phase1-notify.yaml。此 notify/rules 只滿足配置契約，沒有啟動告警或外部通知。
不要降低 config validation。正式秘密須使用精確 UID/group/ACL 權限；一次性
E2E 產生的 test-only credentials 放在 private temporary root，容器只讀。

`/-/healthy` 表示 HTTP 活性；`/-/ready` 在 backend migration/ping 與所有
listener 成功取得後才變綠，停止接收與 drain 前轉紅。它不是連續儲存或磁碟
監控。容器用 `prismd healthcheck`；systemd reference 使用 bounded stdlib
Unix datagram READY=1/STOPPING=1，尚未安裝主機服務。

ClickHouse XML 提供單機 memory/query bounds，不據此承諾 2C4G 容量、無 OOM
或 production soak。既有 metrics/traces async ack 不是 durable disk 保證；
本輪持久性證明先等待已知資料實際可查，再重啟，未驗證 unflushed crash durability。

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
