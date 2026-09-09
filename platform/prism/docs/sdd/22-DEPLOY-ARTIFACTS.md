# 22 — 部署產物（完整檔案內容）

本文件的每個檔案都必須原樣建立在 `deploy/` 下。CI 的 `E2E` 測試直接使用它們，因此它們是**可執行的規格**，不是範例。

## 1. `deploy/docker-compose.yml`

```yaml
name: prism

services:
  prismd:
    image: prism/prismd:${PRISM_VERSION:-dev}
    build: {context: .., dockerfile: deploy/Dockerfile.prismd}
    restart: unless-stopped
    ports:
      - "127.0.0.1:9090:9090"   # HTTP：相容 API + Console
      - "0.0.0.0:4317:4317"     # OTLP gRPC
    volumes:
      - ./prismd.yaml:/etc/prism/prismd.yaml:ro
      - ./rules:/etc/prism/rules:ro
      - ./alertmanager.yaml:/etc/prism/alertmanager.yaml:ro
      - ./secrets:/etc/prism/secrets:ro
    environment:
      PRISM_STORAGE_DSN: "clickhouse://prism:${CH_PASSWORD:?set CH_PASSWORD}@clickhouse:9000/prism"
      PRISM_CONTROLPLANE_POSTGRES_DSN: "postgres://prism:${PG_PASSWORD:?set PG_PASSWORD}@postgres:5432/prism?sslmode=disable"
      GOMEMLIMIT: "1200MiB"
    depends_on:
      clickhouse: {condition: service_healthy}
      postgres:   {condition: service_healthy}
    healthcheck:
      test: ["CMD", "/prismd", "healthcheck", "--url", "http://127.0.0.1:9090/-/ready"]
      interval: 10s
      timeout: 3s
      retries: 5
      start_period: 30s
    deploy:
      resources:
        limits: {memory: 1500M}
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: ["/tmp"]

  clickhouse:
    image: clickhouse/clickhouse-server:24.8-alpine
    restart: unless-stopped
    volumes:
      - ch-data:/var/lib/clickhouse
      - ./clickhouse/prism.xml:/etc/clickhouse-server/config.d/prism.xml:ro
      - ./clickhouse/users.xml:/etc/clickhouse-server/users.d/prism.xml:ro
    environment:
      CLICKHOUSE_DB: prism
      CLICKHOUSE_USER: prism
      CLICKHOUSE_PASSWORD: ${CH_PASSWORD:?set CH_PASSWORD}
    ulimits:
      nofile: {soft: 262144, hard: 262144}
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:8123/ping"]
      interval: 10s
      timeout: 3s
      retries: 10
      start_period: 40s
    deploy:
      resources:
        limits: {memory: 2G}

  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    volumes: [pg-data:/var/lib/postgresql/data]
    environment:
      POSTGRES_DB: prism
      POSTGRES_USER: prism
      POSTGRES_PASSWORD: ${PG_PASSWORD:?set PG_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U prism -d prism"]
      interval: 10s
      timeout: 3s
      retries: 5
    deploy:
      resources:
        limits: {memory: 256M}

  grafana:
    image: grafana/grafana-oss:12.0.0
    restart: unless-stopped
    ports: ["127.0.0.1:3000:3000"]
    volumes:
      - grafana-data:/var/lib/grafana
      - ./grafana/provisioning:/etc/grafana/provisioning:ro
      - ./grafana/dashboards:/var/lib/grafana/dashboards:ro
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD:?set GRAFANA_PASSWORD}
      GF_USERS_ALLOW_SIGN_UP: "false"
      GF_ANALYTICS_REPORTING_ENABLED: "false"
      GF_FEATURE_TOGGLES_ENABLE: "traceToLogsV2"
    depends_on: [prismd]
    deploy:
      resources:
        limits: {memory: 256M}

volumes:
  ch-data:
  pg-data:
  grafana-data:
```

`${VAR:?message}` 的形式讓未設定密碼時 `docker compose up` 直接失敗，而不是用預設密碼起來——刻意的。

## 2. `deploy/clickhouse/prism.xml`

單機 4 GB 記憶體下的必要調校。**不調這些，ClickHouse 會 OOM。**

```xml
<clickhouse>
    <max_server_memory_usage_to_ram_ratio>0.5</max_server_memory_usage_to_ram_ratio>
    <mark_cache_size>268435456</mark_cache_size>
    <uncompressed_cache_size>0</uncompressed_cache_size>
    <index_mark_cache_size>67108864</index_mark_cache_size>

    <background_pool_size>4</background_pool_size>
    <background_schedule_pool_size>4</background_schedule_pool_size>
    <background_merges_mutations_concurrency_ratio>2</background_merges_mutations_concurrency_ratio>

    <max_concurrent_queries>16</max_concurrent_queries>
    <max_thread_pool_size>1000</max_thread_pool_size>

    <merge_tree>
        <max_bytes_to_merge_at_max_space_in_pool>10737418240</max_bytes_to_merge_at_max_space_in_pool>
        <merge_max_block_size>4096</merge_max_block_size>
        <parts_to_delay_insert>500</parts_to_delay_insert>
        <parts_to_throw_insert>1000</parts_to_throw_insert>
    </merge_tree>

    <logger>
        <level>warning</level>
        <size>100M</size>
        <count>3</count>
    </logger>

    <query_log>
        <database>system</database>
        <table>query_log</table>
        <ttl>event_date + INTERVAL 7 DAY DELETE</ttl>
    </query_log>
</clickhouse>
```

## 3. `deploy/clickhouse/users.xml`

```xml
<clickhouse>
    <profiles>
        <default>
            <max_memory_usage>1000000000</max_memory_usage>
            <max_bytes_before_external_group_by>500000000</max_bytes_before_external_group_by>
            <max_execution_time>55</max_execution_time>
            <max_result_rows>5000000</max_result_rows>
            <result_overflow_mode>throw</result_overflow_mode>
            <readonly>0</readonly>
            <async_insert>1</async_insert>
            <wait_for_async_insert>0</wait_for_async_insert>
            <async_insert_max_data_size>10485760</async_insert_max_data_size>
            <async_insert_busy_timeout_ms>1000</async_insert_busy_timeout_ms>
        </default>
    </profiles>
</clickhouse>
```

`max_execution_time = 55` 必須小於 Prism 的 `query.timeout`（60s），讓 ClickHouse 先超時並回結構化錯誤，而不是 Prism 端的 context 取消（後者拿不到後端的診斷資訊）。

## 4. `deploy/grafana/provisioning/datasources/prism.yaml`

**這個檔案是 ADR-001 相容策略的直接體現：四個標準 datasource 全部指向同一個 `prismd`。**

```yaml
apiVersion: 1

datasources:
  - name: Prism-Metrics
    uid: prism-metrics
    type: prometheus
    access: proxy
    url: http://prismd:9090/prom
    isDefault: true
    jsonData:
      httpMethod: POST
      timeInterval: 15s
      prometheusType: Prometheus
      prometheusVersion: 2.53.0        # 必須與 buildinfo 一致，見 ADR-005
      exemplarTraceIdDestinations:
        - name: trace_id
          datasourceUid: prism-traces
    editable: false

  - name: Prism-Logs
    uid: prism-logs
    type: loki
    access: proxy
    url: http://prismd:9090
    jsonData:
      maxLines: 1000
      timeout: 60
      derivedFields:
        # 從日誌中抽出 trace_id 並連到 Jaeger datasource
        - name: TraceID
          matcherType: label
          matcherRegex: trace_id
          url: '${__value.raw}'
          datasourceUid: prism-traces
        # 相容：body 中內嵌 trace_id 的情形
        - name: TraceIDInline
          matcherType: regex
          matcherRegex: 'trace[_-]?id["\s:=]+([a-f0-9]{32})'
          url: '$${__value.raw}'
          datasourceUid: prism-traces
    editable: false

  - name: Prism-Traces
    uid: prism-traces
    type: jaeger
    access: proxy
    url: http://prismd:9090/jaeger
    jsonData:
      tracesToLogsV2:
        datasourceUid: prism-logs
        spanStartTimeShift: '-2m'
        spanEndTimeShift: '2m'
        filterByTraceID: true
        filterBySpanID: false
        tags:
          - key: service.name
            value: service
      tracesToMetrics:
        datasourceUid: prism-metrics
        spanStartTimeShift: '-2m'
        spanEndTimeShift: '2m'
        queries:
          - name: 'Request rate'
            query: 'sum(rate(traces_span_metrics_calls_total{$$__tags}[5m]))'
      nodeGraph:
        enabled: true
    editable: false

  - name: Prism-Alerts
    uid: prism-alerts
    type: alertmanager
    access: proxy
    url: http://prismd:9090/alertmanager
    jsonData:
      implementation: prometheus
      handleGrafanaManagedAlerts: false
    editable: false
```

`derivedFields` 的兩條規則同時存在是刻意的：結構化的 `trace_id` 標籤走第一條，只在日誌正文中出現 trace id 的舊系統走第二條。`E2E-06` 的 trace→log 跳轉測試必須驗證第一條。

## 5. `deploy/grafana/provisioning/dashboards/prism.yaml`

```yaml
apiVersion: 1
providers:
  - name: prism
    orgId: 1
    folder: Prism
    type: file
    disableDeletion: true
    updateIntervalSeconds: 30
    allowUiUpdates: false
    options:
      path: /var/lib/grafana/dashboards
      foldersFromFilesStructure: false
```

`deploy/grafana/dashboards/` 必須包含：

| 檔案 | 內容 |
|---|---|
| `prism-self.json` | Prism 自身健康：ingest 速率/丟棄、查詢延遲與 pushdown 比例、規則評估、通知佇列、磁碟壓力 |
| `hosts.json` | 主機總覽（基於 node_exporter 相容指標） |
| `apm-services.json` | 服務 RED 總覽 |
| `apm-service-detail.json` | 單服務下鑽：RED + 慢請求 + 錯誤 trace + 相關日誌 |
| `agents.json` | Agent 艦隊狀態：版本分佈、WAL 深度、丟棄計數 |

外部儀表板（Node Exporter Full，Grafana ID 1860）不內建，由文件指引使用者匯入——它是相容性的試金石（`C11`），不是我們的產物。

## 6. `deploy/systemd/prismd.service`

```ini
[Unit]
Description=Prism observability server
Documentation=https://github.com/OWNER/prism
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=prism
Group=prism
ExecStart=/usr/local/bin/prismd --config /etc/prism/prismd.yaml
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5s
TimeoutStopSec=45s
KillSignal=SIGTERM

Environment=GOMEMLIMIT=1200MiB

# 加固
NoNewPrivileges=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ProtectClock=yes
ProtectHostname=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
SystemCallFilter=~@privileged @resources
CapabilityBoundingSet=
AmbientCapabilities=
ReadWritePaths=/var/lib/prism
StateDirectory=prism

# 資源
MemoryMax=1500M
TasksMax=4096
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
```

`Type=notify` 要求 `prismd` 實作 sd_notify（`READY=1` 在存儲後端連通且 HTTP server 開始監聽後發送，`STOPPING=1` 在收到 SIGTERM 時發送）。這讓 systemd 的依賴順序與健康判定準確。

## 7. `deploy/systemd/prism-agent.service`

```ini
[Unit]
Description=Prism telemetry agent
After=network-online.target
Wants=network-online.target

[Service]
Type=notify
User=prism-agent
Group=prism-agent
# 讀取 /var/log 需要；若只讀特定目錄可改用 SupplementaryGroups
SupplementaryGroups=adm systemd-journal
ExecStart=/usr/local/bin/prism-agent --config /etc/prism/agent.yaml
ExecReload=/bin/kill -HUP $MAINPID
Restart=always
RestartSec=5s
TimeoutStopSec=30s

Environment=GOMEMLIMIT=200MiB

NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ProtectHome=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictNamespaces=yes
RestrictRealtime=yes
RestrictSUIDSGID=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service
CapabilityBoundingSet=CAP_DAC_READ_SEARCH
AmbientCapabilities=CAP_DAC_READ_SEARCH
ReadWritePaths=/var/lib/prism-agent
StateDirectory=prism-agent

MemoryMax=256M
CPUQuota=20%
TasksMax=512
LimitNOFILE=1024

[Install]
WantedBy=multi-user.target
```

`CAP_DAC_READ_SEARCH` 讓 agent 能讀取任意日誌檔而不需要 root。這是「以非 root 執行採集器」的關鍵——**文件必須說明這仍是一個強權限**（可讀取系統上所有檔案），使用者若不接受，應改用 `SupplementaryGroups` 精確授權。

## 8. `deploy/agent.yaml`（完整範例，也是 schema 的事實文件）

```yaml
agent:
  hostname: ""                    # 空 = 自動偵測
  state_dir: /var/lib/prism-agent
  config_mode: merge              # local | remote | merge
  labels:
    env: prod
    role: web
  detailed_metrics: false

output:
  endpoint: prismd.internal:4317
  protocol: otlp-grpc
  api_key_file: /etc/prism/secrets/agent_key
  compression: gzip
  batch_size: 1000
  batch_timeout: 1s
  tls:
    enabled: true
    insecure_skip_verify: false
    ca_file: ""
    client_cert_file: ""
    client_key_file: ""
  retry:
    initial_interval: 1s
    max_interval: 60s
    max_elapsed_time: 0s          # 0 = 永久重試（資料在 WAL 中）

wal:
  enabled: true
  max_bytes: 512MiB
  max_age: 4h
  segment_bytes: 8MiB
  sync_policy: interval           # always | interval | never
  sync_interval: 1s
  min_free_bytes: 1GiB

control:
  enabled: true
  endpoint: https://prismd.internal:9090
  heartbeat_interval: 30s
  auto_upgrade: false

inputs:
  hostmetrics:
    enabled: true
    interval: 15s
    collectors: [cpu, memory, disk, filesystem, network, load, uptime, filefd]
    filesystem:
      ignore_mount_points: '^/(dev|proc|sys|run|var/lib/docker/.+)($|/)'
      ignore_fs_types: '^(autofs|binfmt_misc|cgroup.*|configfs|debugfs|devpts|devtmpfs|fusectl|hugetlbfs|mqueue|nsfs|overlay|proc|procfs|pstore|rpc_pipefs|securityfs|selinuxfs|squashfs|sysfs|tracefs)$'
    process:
      enabled: false
      top_n: 20

  filelog:
    - name: nginx-access
      paths: ["/var/log/nginx/access.log"]
      labels: {service: nginx, log_type: access}
      max_line_bytes: 262144
    - name: app
      paths: ["/var/log/app/*.log"]
      exclude: ["/var/log/app/*.gz"]
      labels: {service: app}
      multiline:
        start_pattern: '^\d{4}-\d{2}-\d{2}'
        max_lines: 500
        timeout: 3s
      discovery_interval: 10s
      delete_grace: 30s

  journald:
    enabled: true
    units: []                     # 空 = 全部
    exclude_units: ["prism-agent.service"]   # 避免自我循環

  docker:
    enabled: false
    socket: /var/run/docker.sock
    label_allowlist: ["com.docker.compose.service", "com.docker.compose.project"]

process:
  redact:
    - pattern: '(?i)(password|passwd|pwd)\s*[=:]\s*\S+'
      replace: '$1=***'
    - pattern: '(?i)authorization:\s*bearer\s+\S+'
      replace: 'authorization: bearer ***'
    - pattern: '(?i)(api[_-]?key)\s*[=:]\s*\S+'
      replace: '$1=***'
    - pattern: '-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----'
      replace: '***PRIVATE KEY REDACTED***'
    - pattern: '\b(?:\d[ -]*?){13,16}\b'
      replace: '***CARD REDACTED***'
  sample: []

telemetry:
  log_level: info
  log_format: json
  self_metrics_port: 0            # 0 = 不開 HTTP，自身指標經 OTLP 上報
```

`exclude_units: ["prism-agent.service"]` 是必須的預設：agent 採集自己的 journald 日誌會形成放大迴圈（每條錯誤日誌產生新的錯誤日誌）。

## 9. `deploy/alertmanager.yaml`

```yaml
global:
  resolve_timeout: 5m
  smtp_smarthost: 'smtp.example.com:587'
  smtp_from: 'prism@example.com'
  smtp_auth_username: 'prism@example.com'
  smtp_auth_password_file: /etc/prism/secrets/smtp_password

route:
  receiver: default
  group_by: ['alertname', 'cluster', 'service']
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  routes:
    # Watchdog 必須走獨立路由，最短間隔，且永不靜默
    - matchers: ['alertname="PrismWatchdog"']
      receiver: watchdog
      group_wait: 0s
      group_interval: 1m
      repeat_interval: 1m
      continue: false

    # 平台自身的致命問題送到獨立渠道（避免用壞掉的渠道通知渠道壞了）
    - matchers: ['alertname=~"PrismNotificationDead|PrismBroadSilenceCreated"']
      receiver: ops-fallback
      group_wait: 0s
      repeat_interval: 30m
      continue: false

    - matchers: ['severity="critical"']
      receiver: oncall
      group_wait: 10s
      repeat_interval: 1h
      continue: false

inhibit_rules:
  # 主機掛了就不用報該主機上服務的告警
  - source_matchers: ['alertname="HostDown"']
    target_matchers: ['severity=~"warning|info"']
    equal: ['instance']
  # critical 抑制同名的 warning
  - source_matchers: ['severity="critical"']
    target_matchers: ['severity="warning"']
    equal: ['alertname', 'instance']
  # 存儲掛了就不用報依賴存儲的所有 Prism 告警
  - source_matchers: ['alertname="PrismStorageUnavailable"']
    target_matchers: ['alertname=~"PrismIngestDropping|PrismRuleEvaluationFailing"']
    equal: ['cluster']

receivers:
  - name: default
    email_configs:
      - to: 'ops@example.com'
        send_resolved: true

  - name: oncall
    prism_lark_configs:
      - webhook_url_file: /etc/prism/secrets/lark_oncall
        sign_secret_file: /etc/prism/secrets/lark_sign
        send_resolved: true

  - name: watchdog
    webhook_configs:
      - url_file: /etc/prism/secrets/healthchecks_url
        send_resolved: false

  - name: ops-fallback
    prism_telegram_configs:
      - bot_token_file: /etc/prism/secrets/tg_token
        chat_id: -1001234567890
        send_resolved: true
```

**三條刻意的設計**：

1. `watchdog` 路由 `repeat_interval: 1m` 且不靜默——外部系統據此判斷 Prism 是否存活。
2. `ops-fallback` 用**不同的渠道類型**接收「通知渠道壞了」的告警。用同一種渠道通知渠道壞了是邏輯矛盾。
3. 第三條 inhibit 防止存儲故障時的告警風暴（一個根因會觸發五六條衍生告警）。

## 10. `deploy/rules/` 的內建規則

`deploy/rules/prism-builtin.yml` 對應 `07-ALERTING.md` §7。此檔案由 `prismd` 在 `rules.builtin_enabled: true` 時內嵌載入，同時也放在 `deploy/` 供使用者參考與覆寫。

```yaml
groups:
  - name: prism-platform
    interval: 30s
    rules:
      - alert: PrismWatchdog
        expr: vector(1)
        labels: {severity: none}
        annotations:
          summary: "Prism is alive. If you stop receiving this, Prism is down."

      - alert: PrismStorageUnavailable
        expr: prism_storage_up == 0
        for: 2m
        labels: {severity: critical}
        annotations:
          summary: "Storage backend {{ $labels.driver }} unreachable"
          runbook_url: "https://docs/runbooks/prism-down"

      - alert: PrismIngestDropping
        expr: sum by (signal, reason) (rate(prism_ingest_dropped_total[5m])) > 0
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: "Dropping {{ $labels.signal }} data: {{ $labels.reason }} ({{ $value | humanize }}/s)"
          runbook_url: "https://docs/runbooks/ingest-dropping"

      - alert: PrismHighCardinalityLabel
        expr: increase(prism_ingest_high_cardinality_total[15m]) > 0
        labels: {severity: warning}
        annotations:
          summary: "High cardinality on {{ $labels.metric }}.{{ $labels.label }} (tenant {{ $labels.tenant }})"
          runbook_url: "https://docs/runbooks/high-cardinality"

      - alert: PrismRuleEvaluationFailing
        expr: sum by (group) (rate(prism_rule_eval_failures_total[10m])) > 0
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: "Rule group {{ $labels.group }} failing to evaluate"

      - alert: PrismRuleEvaluationSlow
        expr: prism_rule_group_eval_duration_seconds > prism_rule_group_interval_seconds
        for: 15m
        labels: {severity: warning}
        annotations:
          summary: "Rule group {{ $labels.group }} takes longer than its interval"

      - alert: PrismNotificationDead
        expr: increase(prism_notification_dead_total[15m]) > 0
        labels: {severity: critical}
        annotations:
          summary: "{{ $value }} notifications gave up after all retries on {{ $labels.channel }}"
          runbook_url: "https://docs/runbooks/notification-failing"

      - alert: PrismNotificationBacklog
        expr: prism_notification_oldest_pending_seconds > 600
        for: 5m
        labels: {severity: critical}
        annotations:
          summary: "Oldest pending notification is {{ $value | humanizeDuration }} old"

      - alert: PrismDiskPressure
        expr: prism_disk_pressure_level > 0
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: "Storage disk pressure level {{ $value }} ({{ $labels.backend }})"
          runbook_url: "https://docs/runbooks/disk-pressure"

      - alert: PrismAgentDown
        expr: time() - prism_agent_last_seen_timestamp_seconds > 180
        for: 5m
        labels: {severity: warning}
        annotations:
          summary: "Agent {{ $labels.hostname }} has not reported for {{ $value | humanizeDuration }}"

      - alert: PrismAgentWALGrowing
        expr: prism_agent_wal_oldest_age_seconds > 600
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: "Agent {{ $labels.hostname }} WAL backlog is {{ $value | humanizeDuration }} old"

      - alert: PrismQueryRejecting
        expr: sum by (reason) (rate(prism_query_rejected_total[5m])) > 0.1
        for: 10m
        labels: {severity: warning}
        annotations:
          summary: "Rejecting queries: {{ $labels.reason }}"
```

`PrismWatchdog` 的 `severity: none` 讓它不被任何 severity-based 的 inhibit 規則影響。

## 11. `deploy/Dockerfile.prismd`

```dockerfile
FROM golang:1.23-alpine AS build
WORKDIR /src
RUN apk add --no-cache git ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
ARG VERSION=dev
ARG REVISION=unknown
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags "-s -w -X main.version=${VERSION} -X main.revision=${REVISION}" \
    -o /out/prismd ./cmd/prismd

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/prismd /prismd
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
USER nonroot:nonroot
EXPOSE 9090 4317
ENTRYPOINT ["/prismd"]
CMD ["--config", "/etc/prism/prismd.yaml"]
```

`CGO_ENABLED=0` + distroless 讓映像 < 30 MB 且無 shell。代價是 journald 輸入需要純 Go 實作（`08` §3.3 已註明可讀 `/var/log/journal`）——agent 的映像若需要 cgo 版 sd-journal，另建一個非 distroless 的 Dockerfile。

## 12. `Makefile`（關鍵目標）

```makefile
VERSION  ?= $(shell git describe --tags --always --dirty 2>/dev/null || echo dev)
REVISION ?= $(shell git rev-parse --short HEAD 2>/dev/null || echo unknown)
DRIVERS  ?= memory clickhouse vmvl

.PHONY: build lint test conformance promql differential e2e deps-check ci

build:
	go build -trimpath -ldflags "-X main.version=$(VERSION) -X main.revision=$(REVISION)" \
		-o bin/ ./cmd/...

lint:
	golangci-lint run ./...
	go vet ./...

deps-check:
	@! go list -deps ./pkg/...            | grep -E '/(internal|drivers)/' || (echo "FAIL: pkg depends on internal/drivers"; exit 1)
	@! go list -deps ./drivers/...        | grep -E '/internal/'           || (echo "FAIL: drivers depend on internal"; exit 1)
	@! go list -deps ./internal/compat/...| grep -E '/drivers/'            || (echo "FAIL: compat depends on drivers"; exit 1)
	@! go list -deps ./...                | grep -E 'grafana/(loki|tempo|grafana)' || (echo "FAIL: AGPL dependency"; exit 1)
	@echo "deps-check OK"

test:
	go test -race -count=1 ./...

conformance:
	@for d in $(DRIVERS); do echo "== conformance: $$d"; \
		go test -race -count=1 ./test/conformance -driver=$$d || exit 1; done

promql:
	@for d in $(DRIVERS); do echo "== promqltest: $$d"; \
		go test -count=1 ./test/promqltest -driver=$$d || exit 1; done

differential:
	@for d in clickhouse vmvl; do echo "== differential: $$d"; \
		go test -count=1 ./test/differential -driver=$$d || exit 1; done

e2e:
	docker compose -f deploy/docker-compose.yml up -d --wait
	go test -count=1 -tags=e2e ./test/e2e/...
	docker compose -f deploy/docker-compose.yml down -v

ci: lint deps-check test conformance promql differential
```

`deps-check` 是整個架構承諾的機械化執行者。它必須在 `ci` 目標中、在測試之前執行——架構違規應該比測試失敗更早被發現。
