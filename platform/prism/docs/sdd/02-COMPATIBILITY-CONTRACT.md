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
- Loki 的 `start`、`end`、`time`：Unix **奈秒**的十進位整數字串，或 RFC3339Nano，或 Go duration 相對值（`1h`、`5m`、`500ms`）。純數字是奈秒，不依位數猜成秒。`step` 另見 §3.4，那裡才接受「純數字＝秒」。
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
{"status":"success","data":{"version":"2.53.0","revision":"prism-<ver>","branch":"","buildUser":"prism","buildDate":"","goVersion":"go1.27.1"}}
```

**`version` 必須宣告成一個 Grafana 認得的 Prometheus 版本號**，否則 Grafana 會關閉部分功能。此為刻意的相容性謊報，須在 ADR 記錄。

### 2.3 `resultType` 與資料形狀

- `vector`：`[{"metric":{...},"value":[<ts float sec>,"<value string>"]}]`
- `matrix`：`[{"metric":{...},"values":[[<ts float sec>,"<value>"],...]}]`
- `scalar` / `string`：`[<ts float sec>,"<value>"]`
- 上面三處的 `<ts float sec>` 都是 Unix 秒的 JSON 數字。Loki 的 matrix / vector 用同一單位，見 §3.2。
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

### 3.2 query 與 query_range 回應

成功回應是 JSON。時間單位依 `resultType` 分開，不要把 §2.3 的秒和日誌的奈秒合成一種：

- `streams`：`values[][0]` 是十進位 Unix **奈秒字串**。
- `matrix` 與 `vector`：時間是 JSON **數字**，單位是 Unix **秒**，與 §2.3 的 `<ts float sec>` 相同。引擎 `Sample.TS` 是 Unix 毫秒；寫出前記 `utm.MilliToSecFloat`（除以 1000）。整秒寫成 `1757030400`，不是 `1757030400.0`；半秒寫成 `1757030400.5`。不是奈秒，也不是毫秒。

```json
{"status":"success","data":{"resultType":"streams","result":[{"stream":{"host":"h1"},"values":[["1757030400000000000","line"]]}],"stats":{"summary":{"bytesProcessedPerSecond":0,"execTime":0,"totalBytesProcessed":0,"totalLinesProcessed":0},"ingester":{},"store":{}}}}
```

`stats` 必須帶這個結構。沒有 `LogStatser` 時四個 summary 數字都是 `0`，`ingester` 與 `store` 是 `{}`。有 `LogStatser` 時只填這四個：`totalBytesProcessed`＝`TotalBytesProcessed`，`totalLinesProcessed`＝`TotalLinesProcessed`，`execTime`＝`ExecTimeSeconds`，`bytesProcessedPerSecond` 在 `execTime` 為 0 時是 `0`，否則是 `TotalBytesProcessed / ExecTimeSeconds`。不補公開統計範例裡的其他計數；Explore 讀的是 summary 這幾項。逐字案例見 §3.4。

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

錯誤訊息格式：`parse error at line X, col Y: <reason>`（Loki 的格式，Grafana 會直接顯示）。HTTP 狀態與 body 不是 Prometheus 的 `errorType` JSON；信封見 §3.4，與 `16` §2 的純文字相同。

**Clean-room 約束**：本節語法定義來自 Grafana 官方 LogQL 文件與實測回應。實作者不得閱讀或複製 `grafana/loki` 的原始碼。

### 3.4 P2-04 驗收（AC-29 起）

編號接在 `16` §4.2 的 AC-28 之後，因為那裡已經用到 AC-28。HTTP 案例放在本節，不寫進引擎文件。來源是 Grafana 公開的 [Loki HTTP API](https://grafana.com/docs/loki/latest/reference/loki-http-api/) 與 [query limits](https://grafana.com/docs/loki/latest/configure/loki-limits/)；不讀 Loki 原始碼。只鎖 Explore 與 health 會碰到的參數。`since`、`interval`、Parquet、`index/volume` 不在這組驗收；多出來的 query 參數忽略，避免 Explore 多送一個欄位就失敗。

規則：

- `query_range` 的 `end` 缺省是請求當下的 now，`start` 缺省是 `end` 減 1 小時。區間是 `[start, end)`：時間戳大於等於 start、小於 end。公開 API 寫的是 greater or equal to start、lower than end。
- `labels`、`label/{name}/values`、`series` 的 `end` 缺省是 now，`start` 缺省是 now 減 6 小時。labels 的公開頁寫了 6 小時；series 用同一扇窗。
- `index/stats` 的缺省窗與 `query_range` 相同（1 小時）。
- 時間字串見 §0.3。`2025-09-05T00:00:00.000000000Z` 等於 `1757030400000000000`。相對值用 `time.ParseDuration`（`ns`/`us`/`µs`/`ms`/`s`/`m`/`h`），意思是 now 減去該長度。`1d`、`1w`、`1y` 不接受。LogQL 範圍裡的 `[1d]` 仍照 `16` 的文法，與 HTTP 參數無關。
- `step` 只對 matrix 有效，streams 忽略它。接受 Go duration，或純數字（可帶小數）表示秒。`300` 與 `5m` 都是 300 秒；`0.5` 與 `500ms` 都是 500 毫秒。這是公開 API 的 duration or float number of seconds，也是文件裡 `step=300` 的例子。缺省 `15s`。`step=0`、負數、`1d` 回 400。
- instant 的評估時間參數名是 `time`，缺省 now。單位與 `start` 相同。`/loki/api/v1/query` 只接受 metric query；日誌查詢回 400。公開 API 寫 instant queries return 400 for a log query。
- `limit` 缺省 `100`，只截 streams。`1` 到 `5000` 有效。缺值、`0`、負數、非整數回 400，body `limit must be a positive integer`。大於 5000 回 400，body `max entries limit per query exceeded, limit > max_entries_limit_per_query (N > 5000)`，`N` 是請求值。5000 是公開 limits 頁的 `max_entries_limit_per_query` 預設。metric query 忽略 `limit`。
- `direction` 只接受小寫 `backward` 與 `forward`。缺省 `backward`（新到舊）。其他值回 400，body `direction must be forward or backward`。
- 成功 JSON 的 `Content-Type` 是 `application/json`。標籤鍵依 UTF-8 升序。下面案例的統計物件，除了另寫數字的那一則，都是 §3.2 的四個 0。
- 錯誤 body 是純文字，不是 `{"status":"error","errorType":...}`。`Content-Type` 的 media type 是 `text/plain`。body 等於訊息本身，不加引號、不加換行。header `X-Prism-Error-Class: bad_request`。這是 `16` §2 已寫的 Loki 信封；此處明寫，避免查詢 API 沿用 §2.1。

**AC-29** Given 兩筆 `{host="h1"}`：`1757030400000000000`／`old`，`1757030400500000000`／`new`。沒有 `LogStatser`。When `GET /loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=1757030400000000000&end=1757030401000000000`（不帶 `limit`、`direction`、`step`）。Then `200`，body 是

```json
{"status":"success","data":{"resultType":"streams","result":[{"stream":{"host":"h1"},"values":[["1757030400500000000","new"],["1757030400000000000","old"]]}],"stats":{"summary":{"bytesProcessedPerSecond":0,"execTime":0,"totalBytesProcessed":0,"totalLinesProcessed":0},"ingester":{},"store":{}}}}
```

**AC-30** Given 另有一筆時間戳等於 end 的 `1757030401000000000`／`nope`。When 與 AC-29 相同的請求。Then body 與 AC-29 相同，沒有 `nope`。

**AC-31** Given 請求的 now 是 `1757034000000000000`，只有 AC-29 那兩筆。When `GET /loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D`，不帶 `start`、`end`。Then 查詢區間是 `[1757030400000000000, 1757034000000000000)`，body 與 AC-29 相同。When 改帶 `start=1h`、不帶 `end`。Then 同一區間、同一 body。When 改帶 `start=1d`。Then `400`，body `start must be unix nanoseconds, RFC3339Nano, or a Go duration`。

**AC-32** Given 一筆 `{host="h1"}` 在 `1757030400000000000`。When `GET /loki/api/v1/query_range?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)&start=1757030400000000000&end=1757030700000000000&step=300`。Then `200`，`resultType` 是 `matrix`，只有一個點，時間 `1757030400`。When 只把 `step` 改成 `5m`。Then body 相同。When `step=1d`。Then `400`，body `step must be a Go duration or a number of seconds`。When 同一查詢不帶 `step`，區間改成 `end=1757030460000000000`（60 秒）。Then 四個點，時間依序是 `1757030400`、`1757030415`、`1757030430`、`1757030445`。缺省 step 是 15 秒。

**AC-33** Given `{host="h1"}` 在 `1757030399999999999`。When `GET /loki/api/v1/query?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B1s%5D)&time=1757030400000000000`。Then HTTP 層設 `q.End=1757030400000000000`、`q.Start=q.End-window`、`Step=0`。`200`，body 是

```json
{"status":"success","data":{"resultType":"vector","result":[{"metric":{"host":"h1"},"value":[1757030400,"1"]}],"stats":{"summary":{"bytesProcessedPerSecond":0,"execTime":0,"totalBytesProcessed":0,"totalLinesProcessed":0},"ingester":{},"store":{}}}}
```

When 不帶 `time`，且 now 是 `1757030400000000000`。Then body 相同。When `query` 改成 `{host="h1"}`。Then `400`，body `instant queries are only supported for metric queries`。

**AC-34** Given `{host="h1"}` 在 `1757030400000000000`。When `GET /loki/api/v1/query_range?query=count_over_time(%7Bhost%3D%22h1%22%7D%5B500ms%5D)&start=1757030400000000000&end=1757030401000000000&step=500ms`。Then `200`，body 是

```json
{"status":"success","data":{"resultType":"matrix","result":[{"metric":{"host":"h1"},"values":[[1757030400,"1"],[1757030400.5,"0"]]}],"stats":{"summary":{"bytesProcessedPerSecond":0,"execTime":0,"totalBytesProcessed":0,"totalLinesProcessed":0},"ingester":{},"store":{}}}}
```

`1757030400.5` 來自 `Sample.TS` `1757030400500` 毫秒。When 只把 `step` 改成 `0.5`。Then body 相同。

**AC-35** Given 同一 `{host="h1"}` 有 `line-0` 到 `line-100`，時間戳 `1757030400000000000+i`。When `GET /loki/api/v1/query_range?query=%7Bhost%3D%22h1%22%7D&start=1757030400000000000&end=1757030400000000101`，不帶 `limit` 與 `direction`。Then `values` 長度 100，第一筆是 `["1757030400000000100","line-100"]`，最後一筆是 `["1757030400000000001","line-1"]`，沒有 `line-0`。When 加上 `direction=forward&limit=1`。Then `values` 只有 `["1757030400000000000","line-0"]`。When `limit=5001`。Then `400`，body `max entries limit per query exceeded, limit > max_entries_limit_per_query (5001 > 5000)`。When `direction=Backward`。Then `400`，body `direction must be forward or backward`。

**AC-36** Given 沒有日誌。When `GET /loki/api/v1/labels?start=1757030400000000000&end=1757030401000000000`。Then `200`，body `{"status":"success","data":[]}`。Given 一筆 `{app="api",host="h1"}` 在 `1757012400000000000`，以及一筆 `{only="out"}` 在 `1757012399999999999`。When 同一請求，但 now 是 `1757034000000000000` 且不帶 `start`、`end`。Then `200`，body `{"status":"success","data":["app","host"]}`。沒有 `only`。窗是 `[1757012400000000000, 1757034000000000000)`。

**AC-37** Given 沒有日誌。When `GET /loki/api/v1/label/host/values?start=1757030400000000000&end=1757030401000000000`。Then `200`，body `{"status":"success","data":[]}`。Given 一筆 `{app="api",host="h1"}` 在 `1757030400000000000`。When 同一路徑與同一組 `start`、`end`。Then `200`，body `{"status":"success","data":["h1"]}`。When 路徑改成 `/loki/api/v1/label/missing/values`。Then `200`，body `{"status":"success","data":[]}`。

**AC-38** Given 沒有日誌。When `GET /loki/api/v1/series?start=1757030400000000000&end=1757030401000000000&match[]=%7Bhost%3D%22h1%22%7D`。Then `200`，body `{"status":"success","data":[]}`。Given AC-37 那筆、`{host="edge"}` 在 `1757012400000000000`，以及 `{host="out"}` 在 `1757012399999999999`。When 第一個請求。Then `200`，body `{"status":"success","data":[{"app":"api","host":"h1"}]}`。When now 是 `1757034000000000000`，`GET /loki/api/v1/series?match[]=%7Bhost%3D~%22.%2B%22%7D`，不帶 `start`、`end`。Then `200`，body `{"status":"success","data":[{"host":"edge"},{"host":"h1"}]}`。沒有 `out`。窗是 `[1757012400000000000, 1757034000000000000)`。When 拿掉 `match[]`。Then `400`，body `at least one match[] parameter is required`。

**AC-39** Given 沒有實作 `LogStatser`。When `GET /loki/api/v1/index/stats?query=%7Bhost%3D%22h1%22%7D&start=1757030400000000000&end=1757030401000000000`。Then `200`，body `{"streams":0,"chunks":0,"entries":0,"bytes":0}`。沒有 `status` 包裝。Given `LogStats` 為 `Streams=2`、`Chunks=3`、`TotalLinesProcessed=4`、`TotalBytesProcessed=100`、`ExecTimeSeconds=0.5`。When 同一請求。Then body `{"streams":2,"chunks":3,"entries":4,"bytes":100}`。`ExecTimeSeconds` 不出現在這個 JSON。When 改打 AC-29 的 `query_range`，且這次有這個 `LogStatser`。Then `stats` 是 `{"summary":{"bytesProcessedPerSecond":200,"execTime":0.5,"totalBytesProcessed":100,"totalLinesProcessed":4},"ingester":{},"store":{}}`。

**AC-40** Given 行程已就緒，此時 `GET /-/ready` 是 `200`、body `ok\n`。When `GET /ready`。Then `200`，`Content-Type: text/plain; charset=utf-8`，body `ready\n`。`/-/ready` 仍是 `ok\n`。Given 行程未就緒，此時 `GET /-/ready` 是 `503`、body `not ready\n`。When `GET /ready`。Then `503`，同一個 `Content-Type`，body `not ready\n`。`/-/ready` 的路徑、狀態與 body 維持 `11` §2.1 與現有 handler，不改成 `ready\n`。未就緒的 `/ready` body 是 `not ready\n`。

**AC-41** Given `GET /loki/api/v1/query_range?query=%7Bjob%3DSECRET%7D&start=1757030400000000000&end=1757030401000000000`。Then `400`，body 等於 `parse error at line 1, col 6: syntax error: unexpected IDENTIFIER, expecting STRING`，header `X-Prism-Error-Class: bad_request`，body 第一個字元不是 `{`。Given `query` 改成 `{job!=""}`。Then `400`，body 等於 `queries require at least one regexp or equality matcher that does not have an empty-compatible value`。Given 拿掉 `query`。Then `400`，body `query is required`。

聚合輸入上限是 AC-42，寫在 `16` §4.2，不屬於這組 HTTP 案例。

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
