# 02 — 相容協議契約（北向與南向）

這份文件是 Prism 對外的**唯一**公開契約。實作必須逐條對照；任何偏離都要在 `13-ADR.md` 記錄理由。

驗收基準統一為：**Grafana OSS 12.x 把 Prism 當作原生 Prometheus / Loki / Jaeger / Alertmanager datasource，health check 通過，常用面板可用。**

## 0. 通用規則

### 0.1 租戶識別

所有相容 API 依序嘗試以下方式解析租戶，取第一個成功者：

1. HTTP header `X-Scope-OrgID`（與 Cortex/Mimir/Loki 多租戶慣例一致，Grafana 可直接設定）
2. HTTP header `X-Prism-Tenant`
3. API key 綁定的租戶（`Authorization: Bearer <key>`）
4. mTLS 客戶端憑證 CN
5. 設定檔 `tenancy.default_tenant`（單租戶部署時使用，預設 `default`）

若 `tenancy.mode: strict` 且無法解析，回 `401`。

### 0.2 認證

- 寫入端點：`Authorization: Bearer <api_key>`，或 mTLS。
- 查詢端點：同上；`auth.allow_anonymous_read: true` 時可略過（單機自用預設開啟）。
- 控制平面：JWT。

### 0.3 時間參數

- Prometheus / Alertmanager 端點：RFC3339 或 Unix 秒（可帶小數）。
- Loki 端點：Unix **奈秒**字串，或 RFC3339Nano，或 `1h`/`5m` 相對值。
- Jaeger 端點：Unix **微秒**。

三套單位不同是既有現實，實作必須在 `pkg/utm/time.go` 集中處理，禁止各 handler 自行換算。

### 0.4 錯誤格式

各相容 API 使用其原生錯誤格式（見各節）。所有錯誤回應必須帶 header `X-Prism-Error-Class`，值為 `spi.ErrClass` 字串，便於除錯。

---

## 1. OTLP 接收（南向，必做）

### 1.1 gRPC — `:4317`

實作 `opentelemetry.proto.collector.{trace,logs,metrics}.v1` 三個 Service 的 `Export` 方法。

- 使用 `go.opentelemetry.io/collector/pdata` 解析（Apache-2.0）。
- 成功回空的 `ExportXxxServiceResponse`。
- 部分失敗：填 `partial_success{rejected_data_points/log_records/spans, error_message}`，仍回 `OK`。
- 佇列滿：回 `codes.ResourceExhausted`，客戶端會自行重試退避。
- 必須支援 gzip compressor。
- `max_recv_msg_size` 預設 4 MiB，可設定。

### 1.2 HTTP — `:9090`（路徑由規範固定在根）

| 方法 | 路徑 | Content-Type |
|---|---|---|
| POST | `/v1/traces` | `application/x-protobuf` 與 `application/json` 皆須支援 |
| POST | `/v1/logs` | 同上 |
| POST | `/v1/metrics` | 同上 |

- 支援 `Content-Encoding: gzip`。
- 成功回 `200` + 對應 protobuf/JSON 的空 response。
- 錯誤回 `google.rpc.Status` 的 protobuf/JSON 編碼。

### 1.3 其他南向協議

| 端點 | 格式 | 階段 |
|---|---|---|
| `POST /prom/api/v1/write` | Prometheus remote_write v1（snappy + protobuf） | Phase 1 必做 |
| `POST /loki/api/v1/push` | Loki push JSON 與 protobuf（snappy） | Phase 1 必做（JSON 必做，protobuf Phase 2） |
| `POST /api/v1/es/_bulk` | Elasticsearch bulk 子集 | Phase 6，選配 |
| `:8125/udp` statsd、`/write` Influx line protocol | — | 不做，留擴充點 |

remote_write 解析必須支援 `X-Prometheus-Remote-Write-Version: 0.1.0`；v2 (`2.0.0`) 若出現在 header，回 `400` 並提示不支援（Phase 6 再加）。

---

## 2. Prometheus HTTP API v1（北向，必做）

Base path：`/prom`。以下路徑均相對於 base path。

### 2.1 回應信封（所有端點一致）

```json
{
  "status": "success" | "error",
  "data": <依端點而定>,
  "errorType": "bad_data|timeout|canceled|execution|internal|unavailable|not_found",
  "error": "human readable",
  "warnings": ["..."],
  "infos": ["..."]
}
```

HTTP 狀態碼對映：`bad_data`→400、`unavailable`→503、`not_found`→404、`timeout`→503、`canceled`→503、其他→422 或 500。**Grafana 依賴這個對映**，不可自創。

### 2.2 端點清單

| 方法 | 路徑 | 必做 | 說明 |
|---|---|---|---|
| GET/POST | `/api/v1/query` | ✅ | 參數 `query`、`time`、`timeout`、`limit` |
| GET/POST | `/api/v1/query_range` | ✅ | 參數 `query`、`start`、`end`、`step`、`timeout` |
| GET/POST | `/api/v1/series` | ✅ | 參數 `match[]`（可多個）、`start`、`end`、`limit` |
| GET | `/api/v1/labels` | ✅ | 參數 `match[]`、`start`、`end`、`limit` |
| GET | `/api/v1/label/{name}/values` | ✅ | 同上 |
| GET | `/api/v1/metadata` | ✅ | 參數 `metric`、`limit`；無資料回空物件 |
| GET | `/api/v1/query_exemplars` | ⬜ Phase 3 | 有 exemplar 才實作 |
| GET | `/api/v1/rules` | ✅ | Ruler 提供；參數 `type=alert|record` |
| GET | `/api/v1/alerts` | ✅ | 目前 firing/pending 告警 |
| GET | `/api/v1/status/buildinfo` | ✅ | Grafana 用它偵測功能可用性 |
| GET | `/api/v1/status/runtimeinfo` | ✅ | 可回最小集合 |
| GET | `/api/v1/targets`, `/api/v1/targets/metadata` | ⬜ | 回空清單即可（Prism 不做 scrape） |
| POST | `/api/v1/read` | ✅ | remote_read，回 snappy+protobuf |

`/api/v1/status/buildinfo` 必須回：

```json
{"status":"success","data":{"version":"2.53.0","revision":"prism-<ver>","branch":"","buildUser":"prism","buildDate":"","goVersion":"go1.23"}}
```

**`version` 必須宣告成一個 Grafana 認得的 Prometheus 版本號**，否則 Grafana 會關閉部分功能。此為刻意的相容性謊報，須在 ADR 記錄。

### 2.3 `resultType` 與資料形狀

- `vector`：`[{"metric":{...},"value":[<ts float sec>,"<value string>"]}]`
- `matrix`：`[{"metric":{...},"values":[[<ts>,"<value>"],...]}]`
- `scalar` / `string`：`[<ts>,"<value>"]`
- 值一律是**字串**，特殊值序列化為 `"NaN"`、`"+Inf"`、`"-Inf"`。
- 原生直方圖（native histogram）v1 不支援；若後端回傳直方圖資料，轉成 `_bucket`/`_sum`/`_count` 經典形式。

### 2.4 PromQL 支援度

必須通過 `prometheus/promql/promqltest` 的官方 testdata（見 `10-CONFORMANCE-TESTING.md` §3）。因為引擎直接使用上游套件，這一點是「預設成立、由測試守住」。

---

## 3. Loki HTTP API（北向 + 南向，必做子集）

Base path：根（Grafana Loki datasource 會自帶 `/loki/api/v1` 前綴）。

| 方法 | 路徑 | 必做 | 說明 |
|---|---|---|---|
| POST | `/loki/api/v1/push` | ✅ | 寫入 |
| GET | `/loki/api/v1/query_range` | ✅ | `query`、`start`、`end`、`limit`、`direction`、`step` |
| GET | `/loki/api/v1/query` | ✅ | instant，主要給 metric query 用 |
| GET | `/loki/api/v1/labels` | ✅ | `start`、`end` |
| GET | `/loki/api/v1/label/{name}/values` | ✅ | |
| GET | `/loki/api/v1/series` | ✅ | `match[]` |
| GET | `/loki/api/v1/index/stats` | ✅ | Grafana 查詢前會呼叫；可回估算值 |
| GET | `/loki/api/v1/tail` | ⬜ Phase 4 | WebSocket 即時追蹤 |
| GET | `/loki/api/v1/patterns` | ⬜ | 不做，回 404 |
| GET | `/ready` | ✅ | Loki datasource health check 走這裡 |

### 3.1 push 請求格式（JSON）

```json
{"streams":[{"stream":{"host":"h1","service":"api","level":"error"},
             "values":[["1757030400000000000","log line", {"trace_id":"abc"}]]}]}
```

第三個元素（structured metadata）為選配，必須支援解析並存入 UTM `Attrs`。

### 3.2 query_range 回應

```json
{"status":"success",
 "data":{"resultType":"streams",
         "result":[{"stream":{"host":"h1"},"values":[["<unix_ns string>","line"]]}],
         "stats":{"summary":{"bytesProcessedPerSecond":0,"execTime":0.01,"totalBytesProcessed":0,"totalLinesProcessed":0},
                  "ingester":{},"store":{}}}}
```

`resultType` 為 `matrix` 時（metric query，如 `count_over_time`），形狀與 Prometheus `matrix` 相同。
`stats` 欄位可填近似值但**結構不得缺**，Grafana 會直接讀取。

### 3.3 LogQL 支援子集（v1）

必做：

```
{selector}                                  標籤選擇器：= != =~ !~
{selector} |= "s"  != "s"  |~ "re"  !~ "re"  行過濾
{selector} | json                           解析階段（無參數形式）
{selector} | logfmt
{selector} | label = "v"                    解析後標籤過濾（= != =~ !~ > < >= <=）
{selector} | line_format "{{.field}}"       選配，Phase 4
count_over_time({sel}[5m])
rate({sel}[5m])
bytes_over_time / bytes_rate
sum|avg|min|max|count|topk|bottomk by/without (labels) ( <上述> )
```

不做（v1 明確回 `400` 並附清楚訊息）：`unwrap`、`| pattern`、`| regexp`、`| drop`/`keep`、`label_replace`、二元運算組合、`absent_over_time`、`quantile_over_time`。

錯誤訊息格式：`parse error at line X, col Y: <reason>`（Loki 的格式，Grafana 會直接顯示）。

**Clean-room 約束**：本節語法定義來自 Grafana 官方 LogQL 文件與實測回應。實作者不得閱讀或複製 `grafana/loki` 的原始碼。

---

## 4. Jaeger Query API（北向，必做）

Base path：`/jaeger`。

| 方法 | 路徑 | 必做 | 回應 |
|---|---|---|---|
| GET | `/api/services` | ✅ | `{"data":["svc"],"total":1,"limit":0,"offset":0,"errors":null}` |
| GET | `/api/services/{service}/operations` | ✅ | 同信封，`data` 為 operation 名陣列 |
| GET | `/api/operations?service=&spanKind=` | ✅ | `data` 為 `[{"name":"","spanKind":""}]` |
| GET | `/api/traces` | ✅ | 見 §4.1 |
| GET | `/api/traces/{traceID}` | ✅ | 同信封，`data` 為單元素 Trace 陣列 |
| GET | `/api/dependencies?endTs=&lookback=` | ✅ | `data` 為 `[{"parent":"","child":"","callCount":N}]` |

### 4.1 `/api/traces` 查詢參數

`service`（必填）、`operation`、`start`（µs）、`end`（µs）、`lookback`（如 `1h`）、`minDuration`、`maxDuration`（如 `100ms`）、`limit`（預設 20）、`tags`（JSON 物件字串，如 `{"http.status_code":"500"}`）。

### 4.2 Trace JSON 結構（欄位名與大小寫不得更動）

```json
{
  "traceID": "0af7651916cd43dd8448eb211c80319c",
  "spans": [{
    "traceID": "0af7...", "spanID": "b7ad6b7169203331", "operationName": "GET /api/orders",
    "references": [{"refType": "CHILD_OF", "traceID": "0af7...", "spanID": "parent..."}],
    "startTime": 1757030400000000, "duration": 12345,
    "tags": [{"key": "http.status_code", "type": "int64", "value": 200},
             {"key": "span.kind", "type": "string", "value": "server"},
             {"key": "error", "type": "bool", "value": true}],
    "logs": [{"timestamp": 1757030400001000, "fields": [{"key":"event","type":"string","value":"exception"}]}],
    "processID": "p1", "warnings": null
  }],
  "processes": {"p1": {"serviceName": "orders", "tags": [{"key":"host.name","type":"string","value":"h1"}]}},
  "warnings": null
}
```

**單位陷阱**：`startTime` 與 `duration` 皆為**微秒**；OTLP 內部是奈秒；Prism 的 UTM 存奈秒。轉換只在 `internal/compat/jaegerapi` 一處發生。

`type` 允許值：`string`、`bool`、`int64`、`float64`、`binary`。OTel attribute 型別到 Jaeger tag 型別的映射表寫在 `internal/compat/jaegerapi/tagmap.go`。

### 4.3 OTel → Jaeger 語義映射（必做）

| OTel | Jaeger |
|---|---|
| `Span.Kind` | tag `span.kind` = `client/server/producer/consumer/internal` |
| `Status.Code=ERROR` | tag `error` = `true` + tag `otel.status_code` = `ERROR` |
| `Status.Message` | tag `otel.status_description` |
| `Span.Events` | `logs[]`，event name 存為 field `event` |
| `Resource.service.name` | `processes[pN].serviceName` |
| 其餘 Resource attrs | `processes[pN].tags` |
| `Links` | `references` 附加 `refType: FOLLOWS_FROM` |

---

## 5. Alertmanager API v2（北向，必做子集）

Base path：`/alertmanager`。

| 方法 | 路徑 | 必做 | 說明 |
|---|---|---|---|
| GET | `/api/v2/status` | ✅ | 回 `cluster.status="ready"`、`versionInfo`、`config.original` |
| GET | `/api/v2/alerts` | ✅ | 參數 `active`、`silenced`、`inhibited`、`filter`、`receiver` |
| POST | `/api/v2/alerts` | ✅ | 接收外部推來的告警（讓 Prism 可當純 AM 用） |
| GET | `/api/v2/alerts/groups` | ✅ | 依 dispatcher 分組後的視圖 |
| GET | `/api/v2/silences` | ✅ | 參數 `filter` |
| POST | `/api/v2/silences` | ✅ | 建立/更新靜默，回 `{"silenceID":"uuid"}` |
| GET | `/api/v2/silence/{id}` | ✅ | |
| DELETE | `/api/v2/silence/{id}` | ✅ | 過期化，非硬刪除 |
| GET | `/api/v2/receivers` | ✅ | |

Alert 物件欄位：`labels`、`annotations`、`startsAt`、`endsAt`、`updatedAt`、`generatorURL`、`fingerprint`、`status{state:"active|suppressed|unprocessed", silencedBy[], inhibitedBy[]}`、`receivers[]`。

Silence 物件欄位：`id`、`matchers[{name,value,isRegex,isEqual}]`、`startsAt`、`endsAt`、`createdBy`、`comment`、`status{state:"expired|active|pending"}`、`updatedAt`。

---

## 6. 相容性測試矩陣（驗收）

| # | 檢查 | 工具 | 通過標準 |
|---|---|---|---|
| C1 | Prometheus datasource health | Grafana `Save & test` | 綠 |
| C2 | Loki datasource health | Grafana `Save & test` | 綠 |
| C3 | Jaeger datasource health | Grafana `Save & test` | 綠 |
| C4 | Alertmanager datasource health | Grafana `Save & test` | 綠 |
| C5 | PromQL 官方測試集 | `promqltest` testdata | 全綠 |
| C6 | Explore 日誌查詢 + 標籤自動完成 | Grafana Explore | 可用 |
| C7 | Trace 瀑布圖渲染 | Grafana Explore | 可用 |
| C8 | trace → logs 關聯跳轉 | Grafana derived fields | 可跳且有結果 |
| C9 | `promtool check rules` | promtool | 通過 |
| C10 | `amtool alert query` / `amtool silence add` | amtool | 通過 |
| C11 | 官方 Node Exporter Full 儀表板 | Grafana Dashboard 1860 | 主要面板有資料 |

C11 是最狠也最有價值的一項：它同時壓測 PromQL 覆蓋度、label API、`rate`/`irate`/`histogram_quantile` 與大量並行查詢。**Phase 3 必須通過。**
