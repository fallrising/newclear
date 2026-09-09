# 20 — 自身遙測登記表

Prism 自己的指標、日誌欄位與 webhook payload 都是**對外契約**：使用者會據此寫告警規則與儀表板。變更需視為 breaking change。

指標命名遵循 Prometheus 慣例：`prism_<subsystem>_<name>_<unit>`，counter 以 `_total` 結尾。

## 1. Ingest

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_ingest_received_total` | counter | `signal`,`tenant`,`protocol` | 收到的資料點/記錄/span 數 |
| `prism_ingest_received_bytes_total` | counter | `signal`,`tenant`,`protocol` | 解壓後位元組數 |
| `prism_ingest_accepted_total` | counter | `signal`,`tenant` | 通過限制並進入 batcher |
| `prism_ingest_rejected_total` | counter | `signal`,`tenant`,`reason` | 見 §1.1 |
| `prism_ingest_dropped_total` | counter | `signal`,`tenant`,`reason` | batcher 之後被丟棄 |
| `prism_ingest_normalized_total` | counter | `signal`,`action` | `action`: `truncate`/`rename`/`drop_label`/`clamp_time`/`sanitize_name` |
| `prism_ingest_high_cardinality_total` | counter | `tenant`,`metric`,`label` | 基數告警觸發次數 |
| `prism_ingest_active_series` | gauge | `tenant` | 估算值（HLL） |
| `prism_ingest_queue_depth` | gauge | `signal`,`priority` | `priority`: `high`/`normal`/`low` |
| `prism_ingest_queue_capacity` | gauge | `signal`,`priority` | |
| `prism_ingest_batch_size` | histogram | `signal` | 每批筆數 |
| `prism_ingest_flush_duration_seconds` | histogram | `signal` | batcher → 驅動的耗時 |
| `prism_ingest_delta_series` | gauge | — | delta→cumulative 轉換器持有的序列數 |
| `prism_ingest_request_duration_seconds` | histogram | `protocol`,`status` | receiver 端到端 |

### 1.1 `reason` 值域（rejected）

`auth`、`tenant_unknown`、`rate_limit`、`queue_full`、`too_large`、`decode_error`、`clock_skew`、`cardinality`、`empty_log`、`invalid_id`、`unsupported_version`、`disk_pressure`

### 1.2 `reason` 值域（dropped）

`write_failed`、`queue_overflow`、`shutdown`、`disk_pressure`

**`rejected` 與 `dropped` 的區別**：`rejected` 是同步告知客戶端（回 4xx/429，客戶端可重試）；`dropped` 是已接受後才丟棄（客戶端不知道）。**後者是資料遺失，前者不是。** 告警規則必須對 `dropped` 更敏感。

## 2. Storage

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_storage_write_duration_seconds` | histogram | `driver`,`signal`,`status` | |
| `prism_storage_write_items_total` | counter | `driver`,`signal` | |
| `prism_storage_query_duration_seconds` | histogram | `driver`,`signal`,`path`,`status` | `path`: `pushdown`/`fallback` |
| `prism_storage_query_series_returned` | histogram | `driver`,`signal` | |
| `prism_storage_query_bytes_scanned` | histogram | `driver`,`signal` | 驅動能回報時才有 |
| `prism_storage_errors_total` | counter | `driver`,`op`,`class` | `class` 為 `spi.ErrClass` |
| `prism_storage_retries_total` | counter | `driver`,`op`,`class` | |
| `prism_storage_up` | gauge | `driver` | `Ping` 結果，1/0 |
| `prism_storage_ping_duration_seconds` | histogram | `driver` | |
| `prism_disk_pressure_level` | gauge | — | 0/1/2/3/4，見 `11` §5 |
| `prism_disk_free_ratio` | gauge | `backend` | |

## 3. Query

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_query_requests_total` | counter | `api`,`type`,`status` | `api`: `prom`/`loki`/`jaeger`；`type`: `instant`/`range`/`labels`/`series`/`traces` |
| `prism_query_duration_seconds` | histogram | `api`,`type` | |
| `prism_query_fallback_total` | counter | `signal`,`reason` | `reason`: `no_native_support`/`forced`/`partial_pushdown` |
| `prism_query_concurrent` | gauge | — | 目前執行中 |
| `prism_query_rejected_total` | counter | `reason` | `reason`: `too_many_points`/`range_too_long`/`concurrency`/`timeout`/`too_large` |
| `prism_query_samples_scanned_total` | counter | `api` | PromQL 引擎回報 |
| `prism_logql_parse_errors_total` | counter | `kind` | `kind`: `syntax`/`semantic`/`unsupported` |
| `prism_logql_unsupported_total` | counter | `feature` | 使用者實際用到哪些不支援的語法——**產品決策的重要輸入** |

`prism_logql_unsupported_total` 是刻意設計的：它直接告訴我們 LogQL 子集該優先補哪些語法。

## 4. Ruler 與 Alerting

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_rule_group_last_eval_timestamp_seconds` | gauge | `group`,`tenant` | |
| `prism_rule_group_eval_duration_seconds` | histogram | `group`,`tenant` | |
| `prism_rule_eval_duration_seconds` | histogram | `group`,`rule` | |
| `prism_rule_eval_failures_total` | counter | `group`,`rule`,`reason` | `reason`: `query`/`template`/`timeout` |
| `prism_rule_group_interval_seconds` | gauge | `group` | 供計算「評估是否跟得上」 |
| `prism_rules_loaded` | gauge | `kind`,`source` | `kind`: `alert`/`record`；`source`: `file`/`db` |
| `prism_alerts_state` | gauge | `state`,`tenant` | `state`: `pending`/`firing` |
| `prism_alerts_transitions_total` | counter | `from`,`to`,`tenant` | |
| `prism_dispatch_group_count` | gauge | — | dispatcher 中的活躍分組 |
| `prism_silences_active` | gauge | `tenant` | |
| `prism_inhibitions_active` | gauge | `tenant` | |
| `prism_notification_sent_total` | counter | `channel`,`receiver`,`status` | `status`: `success`/`failure` |
| `prism_notification_latency_seconds` | histogram | `channel` | |
| `prism_notification_retry_total` | counter | `channel` | |
| `prism_notification_dead_total` | counter | `channel`,`receiver` | |
| `prism_notification_queue_depth` | gauge | `status` | `pending`/`failed` |
| `prism_notification_oldest_pending_seconds` | gauge | — | **最重要的通知健康指標** |

## 5. Agent（`prism-agent` 自身，也上報至平台）

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_agent_up` | gauge | — | 恆為 1，用於存活判定 |
| `prism_agent_build_info` | gauge | `version`,`go_version` | 恆為 1 |
| `prism_agent_input_records_total` | counter | `input`,`name` | |
| `prism_agent_input_errors_total` | counter | `input`,`name`,`reason` | |
| `prism_agent_filelog_open_files` | gauge | `name` | |
| `prism_agent_filelog_offset_bytes` | gauge | `name`,`path` | 高基數，`agent.detailed_metrics` 開啟時才上報 |
| `prism_agent_wal_bytes` | gauge | — | |
| `prism_agent_wal_segments` | gauge | — | |
| `prism_agent_wal_oldest_age_seconds` | gauge | — | **後端不可用時長的直接指標** |
| `prism_agent_wal_dropped_bytes_total` | counter | `reason` | `reason`: `max_bytes`/`max_age`/`disk_full` |
| `prism_agent_wal_corrupt_records_total` | counter | — | |
| `prism_agent_export_batches_total` | counter | `status` | |
| `prism_agent_export_rejected_total` | counter | `code` | gRPC status code |
| `prism_agent_export_duration_seconds` | histogram | — | |
| `prism_agent_config_version` | gauge | — | 目前套用的配置版本 |
| `prism_agent_config_errors_total` | counter | `reason` | |

## 6. 控制平面

| 指標 | 型別 | 標籤 | 說明 |
|---|---|---|---|
| `prism_console_requests_total` | counter | `route`,`method`,`status` | `route` 為 pattern，非實際路徑 |
| `prism_console_request_duration_seconds` | histogram | `route`,`method` | |
| `prism_auth_attempts_total` | counter | `kind`,`result` | `kind`: `password`/`jwt`/`apikey` |
| `prism_apikey_cache_hits_total` / `_misses_total` | counter | — | |
| `prism_agents_registered` | gauge | `tenant`,`status` | |
| `prism_db_query_duration_seconds` | histogram | `op` | Postgres |
| `prism_db_pool_connections` | gauge | `state` | `idle`/`in_use` |

## 7. 執行期

標準的 Go collector（`prometheus/client_golang`）加上：

| 指標 | 說明 |
|---|---|
| `prism_build_info{version,revision,go_version,driver}` | 恆為 1 |
| `prism_start_time_seconds` | 行程啟動時間 |
| `prism_config_reload_success_timestamp_seconds` | 最後一次成功重載配置 |
| `prism_config_reload_failures_total` | |

## 8. 結構化日誌欄位

`log_format: json` 時的固定欄位（其餘欄位自由）：

| 欄位 | 型別 | 說明 |
|---|---|---|
| `time` | RFC3339Nano | |
| `level` | string | `debug`/`info`/`warn`/`error` |
| `msg` | string | 固定的簡短訊息，**不得內嵌變數**（供聚合） |
| `component` | string | `ingest`/`query`/`ruler`/`notify`/`storage`/`console`/`agent` |
| `tenant` | string | 有租戶脈絡時 |
| `request_id` | string | HTTP 請求 |
| `trace_id` | string | 自身 trace（`telemetry.self_trace` 開啟時） |
| `error` | string | 錯誤訊息 |
| `error_class` | string | `spi.ErrClass` |
| `driver` | string | 存儲操作時 |
| `duration_ms` | number | |

**`msg` 不得內嵌變數**是硬性規定：`"failed to write batch"` 而非 `"failed to write batch of 5000 to clickhouse"`。變數放獨立欄位。這讓日誌可以用 `msg` 聚合統計。

### 8.1 取樣

高頻的錯誤日誌必須取樣，避免日誌本身成為故障源：

| 情境 | 策略 |
|---|---|
| 解碼錯誤 | 每租戶每分鐘最多 10 條 |
| 寫入失敗 | 每驅動每分鐘最多 20 條，其餘只計指標 |
| 查詢錯誤 | 每租戶每分鐘最多 30 條 |
| 規則評估失敗 | 每規則每次評估最多 1 條 |

取樣器丟棄的數量必須定期彙總輸出一條 `"suppressed N similar log entries"`。

## 9. Webhook payload（對外契約）

`webhook_configs` 的 payload **必須與 Alertmanager 完全一致**，讓既有的接收端不用改：

```json
{
  "version": "4",
  "groupKey": "{}:{alertname=\"HostDown\", cluster=\"prod\"}",
  "truncatedAlerts": 0,
  "status": "firing",
  "receiver": "oncall",
  "groupLabels": {"alertname": "HostDown", "cluster": "prod"},
  "commonLabels": {"alertname": "HostDown", "cluster": "prod", "severity": "critical"},
  "commonAnnotations": {"runbook_url": "https://..."},
  "externalURL": "https://prism.example.com",
  "alerts": [{
    "status": "firing",
    "labels": {"alertname": "HostDown", "instance": "web-01", "severity": "critical"},
    "annotations": {"summary": "web-01 is down"},
    "startsAt": "2026-09-05T10:00:00Z",
    "endsAt": "0001-01-01T00:00:00Z",
    "generatorURL": "https://prism.example.com/prom/graph?g0.expr=...",
    "fingerprint": "a1b2c3d4e5f6a7b8"
  }]
}
```

要點：

- `version` 固定 `"4"`。
- `endsAt` 在 firing 時為零值時間 `"0001-01-01T00:00:00Z"`（**不是** null 或省略）。
- `fingerprint` 為 16 位小寫 hex（`uint64` 的十六進位），與 Alertmanager 一致。
- `truncatedAlerts` 為因 `max_alerts` 被截斷的數量。
- `groupKey` 格式為 `{route_path}:{group_labels}`。

**Prism 擴充欄位一律以 `prism_` 前綴放在頂層**，接收端可忽略：

```json
"prism_tenant": "acme",
"prism_delivery_id": "uuid",
"prism_attempt": 1
```

`prism_delivery_id` 讓接收端可以做冪等去重——這是原生 Alertmanager 沒有、但實務上很需要的能力。

## 10. 指標基數預算

自身指標的基數必須有上限，否則監控系統會被自己的指標壓垮。

| 指標群 | 預估序列數 | 上限機制 |
|---|---|---|
| ingest（`tenant` × `signal` × `reason`） | 租戶數 × 3 × 12 ≈ 360（10 租戶） | 租戶數受控 |
| storage（`driver` × `signal` × `op`） | < 100 | 固定 |
| query（`api` × `type`） | < 50 | 固定 |
| rules（`group` × `rule`） | **規則數量級** | `prism_rule_eval_duration_seconds` 按 `group` 而非 `rule` 上報；per-rule 僅在 `telemetry.detailed_rules: true` 時啟用 |
| agent filelog（`name` × `path`） | **檔案數量級** | 預設關閉，`agent.detailed_metrics` 才開 |
| notification（`channel` × `receiver`） | receiver 數 × 6 | receiver 數受控 |

兩個標記為粗體的是唯一會隨使用規模線性增長的，都已加開關。**新增指標時必須在此表登記並評估基數。**
