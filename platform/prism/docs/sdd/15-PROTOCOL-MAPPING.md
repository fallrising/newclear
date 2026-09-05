# 15 — 南向協議逐欄位映射

本文件消除 ingest 實作的所有歧義。每個外部協議欄位都必須在此找到對應的 UTM 去處，或明確標示「丟棄」。

## 1. OTLP Traces → `utm.Span`

### 1.1 Resource 層

| OTLP | UTM | 備註 |
|---|---|---|
| `resource.attributes["service.name"]` | `Resource.Service` | 缺失時填 `"unknown_service"`（OTel 規範預設） |
| `resource.attributes["service.instance.id"]` | `Resource.ServiceInstance` | 缺失時回退 `host.id` |
| `resource.attributes["service.version"]` | `Resource.ServiceVersion` | |
| `resource.attributes["service.namespace"]` | `Resource.Namespace` | |
| `resource.attributes["host.name"]` | `Resource.Host` | 回退 `k8s.node.name` → `net.host.name` |
| `resource.attributes["k8s.cluster.name"]` | `Resource.Cluster` | 回退 `prism.cluster` |
| `resource.attributes["deployment.environment.name"]` | `Resource.Env` | 回退 `deployment.environment`（舊版 semconv） |
| 其餘 `resource.attributes` | `Resource.Attrs[k]` | 值序列化見 §5 |
| `resource.dropped_attributes_count` | 丟棄 | 遞增 `prism_ingest_upstream_dropped_total` |
| `schema_url` | 丟棄 | v1 不使用 |

### 1.2 Scope 層

| OTLP | UTM | 備註 |
|---|---|---|
| `scope.name` | `Span.Attrs["otel.scope.name"]` | |
| `scope.version` | `Span.Attrs["otel.scope.version"]` | |
| `scope.attributes` | `Span.Attrs["otel.scope."+k]` | |

### 1.3 Span 層

| OTLP | UTM | 備註 |
|---|---|---|
| `trace_id` (bytes[16]) | `Span.TraceID` | hex 小寫；全零 → 丟棄整個 span 並記錄 |
| `span_id` (bytes[8]) | `Span.SpanID` | 同上 |
| `parent_span_id` | `Span.ParentSpanID` | 全零 → 空字串（root） |
| `trace_state` | `Span.TraceState` | |
| `name` | `Span.Name` | 空字串 → `"unknown"` |
| `kind` | `Span.Kind` | `SPAN_KIND_UNSPECIFIED`(0) → `KindUnspecified` |
| `start_time_unix_nano` | `Span.StartNano` | 0 → 丟棄 span |
| `end_time_unix_nano` | `Span.EndNano` | 0 或 < start → 設為 start（duration 0）並記錄警告 |
| `attributes` | `Span.Attrs` | |
| `dropped_attributes_count` | `Span.Attrs["otel.dropped_attributes_count"]` | 非 0 時才寫 |
| `events[]` | `Span.Events` | |
| `events[].time_unix_nano` | `SpanEvent.TS` | |
| `events[].name` | `SpanEvent.Name` | |
| `events[].attributes` | `SpanEvent.Attrs` | |
| `links[]` | `Span.Links` | |
| `status.code` | `Span.StatusCode` | `UNSET`(0)/`OK`(1)/`ERROR`(2) |
| `status.message` | `Span.StatusMsg` | |
| `flags` | 丟棄 | v1 不使用 |

### 1.4 派生欄位（ingest 計算後寫入 `Attrs`）

| Attr | 來源 | 用途 |
|---|---|---|
| `prism.duration_ns` | `EndNano - StartNano` | 便於後端索引 |
| `prism.is_root` | `ParentSpanID == ""` | 服務入口判定 |
| `prism.error` | `StatusCode == StatusError` 或 `attributes["error"]==true` 或 `http.response.status_code >= 500` | 統一的錯誤判定，RED 指標依此計算 |

**`prism.error` 的三重判定必須實作**：只看 `status.code` 會漏掉大量未正確設定 status 的 SDK，這是實務上 RED 錯誤率不準的頭號原因。

## 2. OTLP Logs → `utm.LogRecord`

| OTLP | UTM | 備註 |
|---|---|---|
| `time_unix_nano` | `LogRecord.TS` | 0 時回退 `observed_time_unix_nano`；再為 0 則用接收時間並標記 `prism.ts_synthesized=true` |
| `observed_time_unix_nano` | `LogRecord.ObservedTS` | 0 時填接收時間 |
| `severity_number` | `LogRecord.Severity` | 見 §2.1 |
| `severity_text` | `LogRecord.SeverityText` | `severity_number` 為 0 時用它反推 |
| `body` | `LogRecord.Body` | 見 §2.2 |
| `attributes` | `LogRecord.Attrs`，其中低基數者提升為 `Labels`（見 §2.3） | |
| `trace_id` | `LogRecord.TraceID` | |
| `span_id` | `LogRecord.SpanID` | |
| `flags` | 丟棄 | |
| `event_name` | `Attrs["event.name"]` | OTel 1.35+ |

### 2.1 SeverityNumber 映射

| OTel `severity_number` | `utm.Severity` |
|---|---|
| 0（UNSPECIFIED） | 由 `severity_text` 推斷，再失敗則 `SevUnknown` |
| 1–4（TRACE） | `SevTrace` |
| 5–8（DEBUG） | `SevDebug` |
| 9–12（INFO） | `SevInfo` |
| 13–16（WARN） | `SevWarn` |
| 17–20（ERROR） | `SevError` |
| 21–24（FATAL） | `SevFatal` |

`severity_text` 反推規則（不分大小寫，前綴匹配）：
`trace|trc|t` → Trace；`debug|dbg|d` → Debug；`info|information|notice|i` → Info；`warn|warning|w` → Warn；`error|err|e|severe` → Error；`fatal|crit|critical|panic|emerg|alert|f` → Fatal。單字母匹配僅在整個字串長度為 1 時適用。

### 2.2 Body 序列化

| `body` 型別 | `LogRecord.Body` |
|---|---|
| `string_value` | 原值 |
| `int_value` / `double_value` / `bool_value` | `strconv` 結果 |
| `bytes_value` | base64 |
| `kvlist_value` / `array_value` | JSON（緊湊格式）。**同時**把 kvlist 的頂層鍵展開進 `Attrs`，前綴 `body.` |
| 未設定 | 空字串。若 `Attrs` 也為空則丟棄該筆並遞增 `prism_ingest_rejected_total{reason="empty_log"}` |

### 2.3 Attributes → Labels 提升規則

日誌的 `Labels` 決定 Loki API 的 stream 切分，必須是低基數。提升規則：

1. 白名單優先：`limits.log_label_allowlist`（預設 `["level","service","host","env","cluster","unit","container","namespace","pod","job","log_type","source"]`）中的鍵一律提升。
2. 黑名單絕不提升：`04-DATA-MODEL.md` §5 的降級正則。
3. 其餘一律留在 `Attrs`。

**不做自動基數偵測後提升**：那會讓 stream 集合隨資料變動，破壞查詢的可預測性。白名單是刻意的保守設計，使用者可透過設定擴充。

## 3. OTLP Metrics → `utm.MetricPoint`

### 3.1 型別展開

見 `04-DATA-MODEL.md` §4.4。此處補上逐欄位細節：

| OTLP | UTM | 備註 |
|---|---|---|
| `metric.name` | `MetricPoint.Name` | 經 `SanitizeMetricName` |
| `metric.description` | `MetricMetadata.Help` | 存入 metadata，不進樣本 |
| `metric.unit` | `MetricMetadata.Unit`；並依 §3.2 加後綴 | |
| `data_point.attributes` | `MetricPoint.Labels` | 經 `SanitizeLabelName` |
| `data_point.time_unix_nano` | `MetricPoint.TS`（轉毫秒） | |
| `data_point.start_time_unix_nano` | 丟棄（v1） | Phase 6 用於 counter reset 偵測 |
| `data_point.flags` bit0 (`NO_RECORDED_VALUE`) | 寫入 `NaN`（Prometheus stale marker 語義） | |
| `data_point.exemplars` | `MetricPoint.Exemplar`（取第一個） | `Exemplars=false` 的驅動會忽略 |

### 3.2 單位後綴

依 OTel→Prometheus 慣例補後綴（若名稱未以該後綴結尾）：

| `unit` | 後綴 |
|---|---|
| `s`、`seconds` | `_seconds` |
| `ms`、`milliseconds` | 轉換數值為秒並加 `_seconds` |
| `By`、`bytes` | `_bytes` |
| `1`、`{ratio}` | 無 |
| `%` | `_ratio`，數值除以 100 |
| 其他 | 無後綴，原樣保留 |

Counter 型別額外補 `_total`（若未以 `_total` 結尾）。

### 3.3 Counter reset 處理

OTLP cumulative counter 若 `value` 較前一次變小，代表來源重啟。v1 **不做特殊處理**，直接寫入——PromQL 的 `rate()`/`increase()` 本身就會偵測並修正 reset。這是刻意的：在 ingest 層修正反而會與 PromQL 的處理衝突。

## 4. Prometheus remote_write → `utm.MetricPoint`

| remote_write | UTM |
|---|---|
| `TimeSeries.labels[]` | `MetricPoint.Labels`；`__name__` 提取為 `Name` |
| `TimeSeries.samples[].value` | `Value` |
| `TimeSeries.samples[].timestamp` | `TS`（已是毫秒，直接用） |
| `TimeSeries.exemplars[]` | `Exemplar` |
| `TimeSeries.histograms[]` | v1 丟棄並記錄 warning；Phase 6 支援 |
| `metadata[]`（v1 協議中的 `MetricMetadata`） | `MetricMetadata` |

**型別推斷**：remote_write 不帶型別。依名稱後綴推斷：`_total`/`_count`/`_sum` → `TypeCounter`；`_bucket` → `TypeHistogram`；其餘 `TypeGauge`。若有 metadata 則以 metadata 為準。

解碼要求：`Content-Encoding: snappy`，`Content-Type: application/x-protobuf`。header `X-Prometheus-Remote-Write-Version` 非 `0.1.0` 時回 `400`，訊息明確指出僅支援 v1。

## 5. AnyValue 序列化（三種訊號共用）

| OTLP `AnyValue` | 字串結果 |
|---|---|
| `string_value` | 原值 |
| `bool_value` | `"true"` / `"false"` |
| `int_value` | `strconv.FormatInt(v, 10)` |
| `double_value` | `strconv.FormatFloat(v, 'f', -1, 64)` |
| `bytes_value` | `base64.StdEncoding` |
| `array_value` | JSON 陣列（緊湊） |
| `kvlist_value` | 展平為 `parent.child` 鍵（見下），**同時**把整體 JSON 存於 `parent` 鍵 |
| 未設定 | 空字串 |

**展平規則**：巢狀深度上限 5，超過則整體 JSON 化。鍵名中原本就含 `.` 的，逃逸為 `\.`。展平後鍵數超過 `max_attrs_per_record` 時，保留字典序前 N 個（行為可預測，見 `04` §5）。

## 6. Loki push → `utm.LogRecord`

| Loki push | UTM |
|---|---|
| `streams[].stream`（map） | `LogRecord.Labels`。其中 `level`/`severity` 額外映射到 `Severity` |
| `streams[].values[i][0]` | `TS`（奈秒字串） |
| `streams[].values[i][1]` | `Body` |
| `streams[].values[i][2]`（structured metadata，選配） | `Attrs`。其中 `trace_id`/`traceID` → `TraceID`，`span_id`/`spanID` → `SpanID` |

`Resource` 從 Labels 反推：`service`/`job` → `Service`；`host`/`instance` → `Host`；`cluster` → `Cluster`；`env` → `Env`。

支援 `Content-Type: application/json` 與 `application/x-protobuf`（snappy）。protobuf 版本為 Phase 2。

## 7. UTM → Jaeger（北向，回程映射）

見 `02-COMPATIBILITY-CONTRACT.md` §4.3。此處補上 tag 型別推斷：

| `Attrs` 值 | Jaeger tag `type` | `value` |
|---|---|---|
| `"true"` / `"false"` | `bool` | JSON bool |
| 可 `ParseInt` 且無小數點 | `int64` | JSON number |
| 可 `ParseFloat` | `float64` | JSON number |
| 其餘 | `string` | JSON string |

**推斷順序不可調換**：`"1"` 必須是 `int64` 而非 `float64`，Jaeger UI 對兩者的顯示不同。

已知的誤判風險：版本號 `"1.20"` 會被判為 `float64`。可接受，因為 Jaeger UI 對兩者的過濾行為一致。若使用者需要精確型別，可在 attribute 名加 `_str` 後綴（記錄於 driver README）。

## 8. 映射的測試要求

`internal/ingest/normalize` 必須有一組 **golden file 測試**：

```
test/fixtures/otlp/
├── traces_full.json      # 涵蓋本文件每一個 span 欄位
├── traces_full.golden    # 對應的 UTM JSON
├── logs_full.json  / .golden
├── metrics_full.json / .golden
├── remote_write_full.pb  / .golden
├── loki_push_full.json / .golden
└── edge_cases/           # 全零 ID、0 時間戳、空 body、超深巢狀、非 UTF-8…
```

任何映射規則變更都必須同時更新 golden file，讓 diff 直接顯示語義變化。這是防止「悄悄改了映射導致下游全錯」的唯一有效手段。
