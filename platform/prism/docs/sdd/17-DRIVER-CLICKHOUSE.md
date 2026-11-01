# 17 — 參考驅動：ClickHouse

位置：`drivers/clickhouse`。Schema DDL 見 `04-DATA-MODEL.md` §6，本文件補完**每個 SPI 方法的查詢實作**。

## 當期 P1-10 契約與後续設計

P1-09提供單節點nativefactory、migration與三Storewrites。P1-10完成mandatoryqueries與最小daemon接線的當期設計，見[查詢契約](../specs/p1-10-clickhouse-query.md)與[ADR-019](13-ADR.md#adr-019p1-10-mandatory-query-與現有-spi-語義適配)；驗收只由inventory實測支持。非空cluster明確Unsupported，不聲稱replicated完成。Optionalmetricmetadata/delete/nativequery、NativeLogQuerier及P3RED/Dependencies仍不實作／宣告；Retention.Enforced=false（seriesmetadata無TTL）。後面fullcapabilitytable、groupArray／labels_str排序、logfilter/nativeaggregation與RED/dependencySQL是後续階段草稿，不取代現有SPI或当期spec。P2-05 的編號驗收在 §6.5。Owner 已於 2026-10-20 鎖定該節。本規格 PR 仍不實作，本段的「尚未實作／宣告」維持到實作 PR。

當期查詢必須以實際sample存在做catalog，跨monthmetadata合併避免join倍增；完整labels.Compare排序不能單用008分隔符labels_str。Metricsinclusive毫秒，logs/traces依現有半開奈秒；missing鍵與empty值的matcher等價，但catalog只回真正有鍵的值。LogSearch只下推selectors/time/sort且不在補算前limit；trace duration從整個trace取root最大duration，沒有root才maxspan，零durationroot仍有效；GetTrace包含late／末筆span。

Streamingrowsiterator持lease至EOF/Close/error/cancel，server/localrows/bytes超限throw，沒有成功截斷。新增009logs.write_seq UInt64 DEFAULT0保存newwriter順序，按ts方向／write_seq ASC；context-aware序列化及reserve-before-send避免lostreply重用，logs用synchronousINSERT，metrics/traces保留async。舊seq0無法重建historicalwriteorder，只提供確定性次序；多processwriters需外部序列化。前八migrationbytes不變。

新增010metric_samples.value_bits UInt64 DEFAULT reinterpretAsUInt64(value)：新writer存math.Float64bits，reader用math.Float64frombits，避免既有Gorilla在批首-0丟失符號位。Legacy rows可從原Float64讀，已失去的歷史位元不能恢復；不改既有codec／SPI／dependency版本。下方未來SQL若只用value欄，不代表當期bit-preserving reader。

## 1. DSN 與 Options

```
clickhouse://user:password@host:9000/database?secure=false&dial_timeout=5s
```

| Option | 預設 | 說明 |
|---|---|---|
| `cluster` | `""` | 當期非空回Unsupported；replicated為後续設計。 |
| `max_execution_time` | `55` | 秒。必須 < `query.timeout`，讓 CH 先超時並回明確錯誤 |
| `max_memory_usage` | `1000000000` | 單查詢記憶體上限（1 GB） |
| `max_result_rows` | `5000000` | 正值≤2^30；超出回`ErrTooLarge`。 |
| `max_rows_to_read` | `5000000` | 正值≤2^30；server scan cap。 |
| `max_result_bytes` | `67108864` | 正值≤2^40；server／logical result cap。 |
| `async_insert` | `1` | metrics/traces；logs為write_seq採同步INSERT。 |
| `max_open_conns` | `10` | |
| `retention_metrics_days` / `_logs_days` / `_traces_days` / `_red_days` | 30/14/7/90 | 寫入 DDL 的 TTL |

## 2. 宣告的能力

下面這段仍是草圖，不要原樣貼上驅動。Owner 於 2026-10-20 鎖定的目標在 §6.5：`Validate` 改為允許 `NativeLogQuery=true` 而 `ParsedFieldLogfmt=false`、`Limit=false`（AC-59）；logfmt 仍回 `ErrUnsupported`；`Stats` 維持 false；`Aggregation` 等 AC-52 與 AC-58 做得到才設 true。`Retention.Enforced`、`Traces.RED`、`Dependencies` 不因 P2-05 改成 true。

```go
spi.Capabilities{
    Driver: "clickhouse", Version: buildVersion,
    Signals: []spi.Signal{spi.SignalMetrics, spi.SignalLogs, spi.SignalTraces},
    Metrics: spi.MetricCaps{
        NativePromQL: false,  // CH 不懂 PromQL，走回退引擎
        Exemplars:    false,  // Phase 6
        Metadata:     true,
        DeleteSeries: true,
    },
    Logs: spi.LogCaps{
        NativeLogQuery: true,
        Pushdown: spi.LogPushdown{
            Substring: true, Regex: true,
            ParsedFieldJSON: true, ParsedFieldLogfmt: false,
            Limit: false, Sort: true,  // Limit=false：logfmt 未下推，見 §6.3
        },
        Aggregation: true, LiveTail: false, Stats: true,
    },
    Traces: spi.TraceCaps{
        TagFilter: true, DurationFilter: true, SpanKindFilter: true,
        Dependencies: true, RED: true,
    },
    MultiTenant: false,           // 用 tenant 欄位隔離，靠 WithTenantGuard
    OutOfOrderWindow: -1,         // 無限制：MergeTree 天然接受亂序
    Retention: spi.RetentionCaps{PerSignal: true, PerTenant: false, Enforced: true},
}
```

上方應為 `OutOfOrderWindow: -1`（無限制），MergeTree 完全接受亂序寫入。語義定義見 `03-STORAGE-SPI.md` §2。

## 3. 寫入

### 3.1 通用

所有寫入用 `clickhouse-go` 的 batch API：

```go
batch, err := conn.PrepareBatch(ctx, "INSERT INTO logs")
for _, r := range records { batch.Append(...) }
err = batch.Send()
```

連線層 settings：

```go
clickhouse.Settings{
    "async_insert":                 1,
    "wait_for_async_insert":        0,
    "async_insert_max_data_size":   10485760,
    "async_insert_busy_timeout_ms": 1000,
    "insert_deduplicate":           0,   // 我們自己處理去重語義
}
```

### 3.2 指標寫入

兩張表，同一批次內都要寫：

1. `metric_series`：僅寫該批次中**首次出現**的 fingerprint（驅動內維護一個 LRU，容量 `100_000`，避免每次都寫）。
2. `metric_samples`：全部樣本。

現行 `MetricPoint` SPI 沒有 fingerprint 欄位；P1-09 使用唯一既有 `utm.Fingerprint` 對 complete sorted labels（含 metric、trusted tenant）取得 identity，不引入另一算法或公開欄位（ADR-018）。Cache 命中而 first/last_seen 延伸時仍需寫 metadata，時間保留 DateTime64(3) 精度。

### 3.3 日誌寫入

`labels` 與 `attrs` 分別寫入兩個 `Map`。`severity` 寫 Enum 字串。

**空值處理**：`trace_id`/`span_id` 為空時寫空字串（非 NULL），讓 bloom filter 索引正常運作。

### 3.4 Span 寫入

`events` 與 `links` 用 `Nested`，clickhouse-go 需以平行陣列傳入：

```go
batch.Append(..., eventTS []time.Time, eventName []string, eventAttrs []map[string]string, ...)
```

同一批次額外觸發 §8 的依賴邊本地 join。

## 4. `MetricStore.Select`

```sql
WITH matched AS (
    SELECT fingerprint, labels
    FROM metric_series
    WHERE tenant = {tenant:String}
      AND metric = {metric:String}          -- 從 __name__ matcher 提取；無則省略此行
      {label_conditions}
      AND last_seen  >= {start:DateTime}
      AND first_seen <= {end:DateTime}
)
SELECT m.fingerprint, any(mt.labels) AS labels,
       groupArray(m.ts) AS tss, groupArray(m.value) AS vals
FROM metric_samples AS m
INNER JOIN matched AS mt ON m.fingerprint = mt.fingerprint
WHERE m.tenant = {tenant:String}
  AND m.metric = {metric:String}
  AND m.ts >= {start:DateTime64(3)} AND m.ts <= {end:DateTime64(3)}
GROUP BY m.fingerprint
ORDER BY labels
SETTINGS max_execution_time = {max_exec:UInt32}, max_result_rows = {max_rows:UInt64}
```

### 4.1 `{label_conditions}` 生成

| Matcher | SQL |
|---|---|
| `k = "v"`（v 非空） | `labels[{k:String}] = {v:String}` |
| `k = ""` | `(NOT mapContains(labels, {k:String}) OR labels[{k:String}] = '')` |
| `k != "v"` | `labels[{k:String}] != {v:String}` |
| `k =~ "re"` | `match(labels[{k:String}], {re:String})` |
| `k !~ "re"` | `NOT match(labels[{k:String}], {re:String})` |

**`k = ""` 的處理是正確性關鍵**：Prometheus 語義中「標籤不存在」與「標籤為空字串」等價，漏掉會讓 `{foo=""}` 這類查詢結果錯誤（`C-MET-05` 測項專測此點）。

正則必須先由驅動轉為 RE2 相容形式並錨定：`^(?:re)$`。ClickHouse 的 `match` 是部分匹配，不錨定會多回結果。

### 4.2 排序與串流

`ORDER BY labels` 在 ClickHouse 中對 `Map` 的排序規則與 Go 的 `labels.Compare` **不一致**。因此：

- SQL 不做 `ORDER BY labels`，改為 `ORDER BY fingerprint`（穩定但非字典序）
- 驅動在 Go 端用小根堆做 k-way merge 排序後輸出

**或者**（推薦，實作更簡單）：把 labels 序列化為 Prometheus 的規範字串形式存為額外欄位 `labels_str`，`ORDER BY labels_str` 即與 Go 端一致：

```sql
ALTER TABLE metric_series ADD COLUMN labels_str String MATERIALIZED
    arrayStringConcat(arraySort(arrayMap((k, v) -> concat(k, '\x00', v),
        mapKeys(labels), mapValues(labels))), '\x01');
```

採用後者。此欄位為 `MATERIALIZED`，不佔額外寫入成本。

### 4.3 大結果集的分批

`groupArray` 對長序列會爆記憶體。當預估點數 > `1_000_000` 時，改用不聚合的形式串流：

```sql
SELECT fingerprint, ts, value FROM metric_samples
WHERE ... ORDER BY fingerprint, ts
```

驅動在 Go 端依 `fingerprint` 變化切分 Series。這條路徑必須是預設，`groupArray` 只作為小結果集的優化（用 `EXPLAIN ESTIMATE` 或 `metric_series` 的計數判斷）。

## 5. `MetricStore.LabelNames` / `LabelValues`

```sql
-- LabelNames
SELECT DISTINCT arrayJoin(mapKeys(labels)) AS name
FROM metric_series
WHERE tenant = {tenant:String} {label_conditions}
  AND last_seen >= {start:DateTime} AND first_seen <= {end:DateTime}
ORDER BY name LIMIT {limit:UInt64}

-- LabelValues
SELECT DISTINCT labels[{name:String}] AS value
FROM metric_series
WHERE tenant = {tenant:String} AND mapContains(labels, {name:String}) {label_conditions}
  AND last_seen >= {start:DateTime} AND first_seen <= {end:DateTime}
ORDER BY value LIMIT {limit:UInt64}
```

`__name__` 是特例：`LabelValues("__name__")` 改查 `SELECT DISTINCT metric FROM metric_series`。

## 6. `LogStore.Search` 與 `NativeLogQuerier.SearchNative`

### 6.1 `LogQuery` → SQL 的翻譯規則

| IR 元素 | SQL 片段 |
|---|---|
| `Selectors` | 只比 `labels`，與現在的 `Search` 相同。`service`／`host`／`env`／`cluster`／`severity` 的原生欄位不是 stream selector（AC-60） |
| `Start`/`End` | `ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}` |
| `LineContains` | `position(body, {v:String}) > 0` |
| `LineNotContains` | `position(body, {v:String}) = 0` |
| `LineMatch` + `LiteralHint` | `hasToken(body, {hint:String}) AND match(body, {re:String})` |
| `LineMatch` 無 hint | `match(body, {re:String})` |
| `LineNotMatch` | `NOT match(body, {re:String})`（不可用 hint 加速） |
| `ParseJSON` + `FieldFilter` | `Op=Eq`：SQL 只做粗篩，driver 再精篩（本節下一段，AC-49、AC-65 至 AC-69、AC-71）。其他 `CompareOp` 回 `ErrUnsupported`（AC-49） |
| `ParseLogfmt` + `FieldFilter` | `extractGroups(body, ...)`，或退化為中間層補算（見 §6.3） |
| `Direction` | `ORDER BY ts DESC`（Backward）/ `ASC`（Forward），其後 `write_seq ASC`（AC-51）。不用 `_part_offset` |
| `Limit` | `LIMIT {n:UInt64}`，僅在全部條件都已在 SQL 下推、且沒有只做粗篩的 JSON `Eq` 時使用。有 JSON `Eq` 時精篩後才截斷（AC-70） |

`hasToken(body, hint)` 能命中 `idx_body_tokens` 的 tokenbf 索引，是日誌查詢效能的關鍵。**前提是 hint 必須是完整 token**（被非字母數字分隔）——若 hint 含分隔符，改用 `position()`（無索引加速但正確）。

Owner 於 2026-10-20 鎖定次序鍵為 `write_seq ASC`，與檔頭、ADR-019 和已落地的 `Search` 相同。`_part_offset` 會隨 merge 改變，不用。

Owner 於 2026-10-20 對 JSON `Eq` 漏列選方案 1。SQL 的 JSON 述詞只做粗篩：回傳列必須是執行器套用 `16` §3.6 的 `| json`、再做欄位 `=` 之後所留列的超集，不得少列。`JSONExtractString(body, field) = value` 不是最終條件，也不能單獨當粗篩。它會漏掉巢狀攤平、sanitize 後的鍵、深度大於 5 的緊湊 JSON、與 `FormatFloat` 不一致的數字，以及 stream label 撞名後改到 `name_extracted` 的列。粗篩可以不下 JSON 述詞，或用已證明不會少列的述詞。本規格不鎖定某一句 SQL。

精篩在 `drivers/clickhouse` 內完成，不改 `internal/query`。規則與 `16` §3.6 的 `| json` 加上欄位 `=` 相同，可觀察的列集合與同一 `LogQuery` 走 `Search` 再經執行器相同：

- 巢狀物件以 `_` 攤平。
- 鍵名只留 ASCII 字母、數字、`_`、`:`。其餘字元改成 `_`，不合併連續底線。清理後為空或以數字開頭，只在前面加一個 `_`。
- 深度從根物件算，根為第 0 層。層數大於 5 的值不再拆開，該鍵的值是子樹的緊湊 JSON（無空白）。
- 數字先 `strconv.ParseFloat`，再 `strconv.FormatFloat(v, 'f', -1, 64)`。不用科學記號，也不保留 JSON 原文。
- 同一個物件裡的重複鍵留第一個。陣列與 JSON `null` 不建標籤。布林為 `true` 或 `false`。
- stream label 與 parsed field 同名時，stream label 留原名，parsed field 只加一次 `_extracted`。目標名已被 stream label 或先收下的抽出標籤佔用，該值丟掉。`Attrs` 不參與撞名，也不當欄位過濾的輸入。

缺欄，或 parse 之後沒有該標籤：該列不在結果中，不是 `ErrUnsupported`。非 `Eq` 的 `CompareOp` 仍是 `ErrUnsupported`。`ParsedFieldJSON` 維持 true，因為 `SearchNative` 回傳的是精篩後的列。`Pushdown.Limit` 維持 false（AC-57）。沒有 JSON `Eq` 時，AC-50 的 `LIMIT` 仍在 SQL。有 JSON `Eq` 時，SQL 在精篩前不加 `LIMIT`；精篩後依 `Direction` 與 `write_seq` 次序套用 `Limit`。空字串 `Eq`（`Value=""`）Owner 於 2026-10-20 鎖定，與執行器相同（AC-71）：空字串值不建標籤。執行器的標籤模型（`labels.Builder.Set`）把值 `""` 當成刪除，所以 `{"k":""}` 不會留下標籤 `k`。缺鍵、JSON `null`、沒建成標籤的物件或陣列同樣沒有該標籤。因此這五筆都不在結果中，結果是 0 列，不是 `ErrUnsupported`。`JSONExtractString(body, field) = ''` 會把這些列多收回來，只能當超集粗篩，不能當最終條件。

### 6.2 完整查詢模板

```sql
SELECT ts, observed_ts, tenant, cluster, host, service, env,
       severity, severity_text, body, trace_id, span_id, labels, attrs
FROM logs
WHERE tenant = {tenant:String}
  {selector_conditions}
  AND ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}
  {line_filter_conditions}
  {field_filter_conditions}
ORDER BY ts {dir}, write_seq ASC
LIMIT {limit:UInt64}
SETTINGS max_execution_time = {max_exec:UInt32},
         max_memory_usage = {max_mem:UInt64},
         max_rows_to_read = {max_rows_read:UInt64},
         max_result_rows = {max_rows:UInt64},
         max_result_bytes = {max_bytes:UInt64}
```

`{field_filter_conditions}` 在 JSON `Eq` 時只放粗篩，或整段省略。有 JSON `Eq` 時，上面的 `LIMIT` 整段省略，精篩後再截斷（AC-70）。

### 6.3 logfmt 的處理

ClickHouse 沒有原生 logfmt 解析。方案：

- 宣告 `ParsedFieldJSON: true`、`ParsedFieldLogfmt: false`（能力宣告區分兩種解析器，定義見 `03-STORAGE-SPI.md` §2）。
- logfmt 的欄位過濾由中間層補算。
- 連帶地 `Pushdown.Limit` 必須為 **false**（未完成全部過濾就截斷會漏資料；`Limit=true` 仍要求全部過濾位為 true）。Owner 於 2026-10-20 改 `Validate`：`NativeLogQuery=true` 不再要求 `ParsedFieldLogfmt` 與 `Limit` 為 true（AC-59）。`SearchNative` 遇到 logfmt 階段時仍回 `spi.ErrUnsupported`，讓呼叫端改走 `Search` + 補算。本階段的 HTTP 不接這條路徑。

替代方案（Phase 6）：用 `extractAllGroupsHorizontal(body, '(\\w+)=("[^"]*"|\\S*)')` 在 SQL 中解析，但正則成本高且邊界情況多，v1 不採用。

### 6.4 聚合下推

```sql
SELECT toStartOfInterval(ts, INTERVAL {step:UInt32} SECOND) AS t,
       {group_keys},
       count() AS v                          -- count_over_time
       -- sum(length(body)) AS v             -- bytes_over_time
FROM logs
WHERE {同 §6.2 的條件}
GROUP BY t, {group_keys}
ORDER BY t
```

`rate` = `count / window_seconds`，在 Go 端除。**滑動窗口的處理**：LogQL 的 `[5m]` 是滑動窗口，而 `toStartOfInterval` 是固定桶。當 `window != step` 時，SQL 只能算固定桶，必須改為：

- 若 `window == step`：直接用上述 SQL（最常見情形，Grafana 預設如此）
- 若 `window != step` 且 `window` 是 `step` 的整數倍：成功結果必須與執行器的 `(t-Window, t]` 相同（AC-58）。SQL 桶大小不規定。原先「最大公因數」只是草稿，不是驗收。

**若 `window` 不是 `step` 的整數倍**：`SearchNative` 回 `ErrUnsupported`（AC-53），由中間層補算。不得把固定桶當成成功結果。

### 6.5 P2-05 驗收（AC-43 起）

這一節是文件。Owner 已於 2026-10-20 鎖定 AC-43 至 AC-64 裡未被本段改寫的條文。同日對 JSON `Eq` 漏列選方案 1，因此 §6.1 的 JSON 與 `Limit` 列、AC-49 改寫，並新增 AC-65 至 AC-71。空字串 `Eq` 已鎖定為 AC-71。Owner 於 2026-10-20 把該條改成 0 列：空字串值不建標籤，與執行器相同。實作另開 PR，合併這次規格前不寫程式。編號接在 AC-42 之後。HTTP 案例仍是 `02` §3.4 的 AC-29 至 AC-41，執行器案例仍是 `16` §4.2 的 AC-1 至 AC-28 與 AC-42。這裡不改那些條文。

#### 範圍

範圍內是 `12` 的 P2-05：`drivers/clickhouse` 的 `NativeLogQuerier`。另外改 `pkg/spi` 的 `Capabilities.Validate`（AC-59），以及 `pkg/spi/conformance` 裡 C-LOG-03、C-LOG-04、C-LOG-05 對 `NativeLogQuery` 與 pushdown 的分流（AC-63、AC-64）。不改 conformance 的其他測項，也不把巢狀 JSON 補進 C-LOG-03 的共用 fixture（見 `10` §2.3）。翻譯規則沿用本節 §6.1 至 §6.4，其中 JSON `Eq` 以本次改寫的 §6.1 為準。Owner 於 2026-10-20 選 2：`Search` 契約不變，已宣告的過濾改由 `SearchNative` 驗。JSON 精篩仍在 `drivers/clickhouse`，不擴大路徑。

範圍外：

- Phase 6 的 `extractAllGroupsHorizontal` logfmt SQL。
- `LiveTail`（Phase 4）、RED、`DependencyQuerier`（P3）、非空 `cluster`。
- `internal/query` 路由器與 `query.force_fallback` 的接線。那是 P3-07。`11` 已有 `force_fallback: false`，本階段不新造預設值。
- `internal/compat/lokiapi`。現在的查詢 HTTP 仍是 `Search` 加執行器。
- P2-06 以後。
- 改 `LogStore.Search`。P1-10 契約保持：只下推 selectors、時間與排序，補算前不加 `LIMIT`，同奈秒次序鍵是寫入序。

`06` §1 寫：`caps.Logs.NativeLogQuery == true` 時把 `LogQuery` 交給 `NativeLogQuerier`，否則 `Search` 加補算。`NativeLogQuerier.SearchNative` 回 `LogResult`，不是 `LogIterator`。`Agg == nil` 填 `Streams`，`Agg != nil` 填 `Matrix`。`Search` 是 Tier-1，始終保留。logfmt 階段讓 `SearchNative` 回 `spi.ErrUnsupported`，呼叫端改走 `Search` 加執行器。這條回退是階段出口，不是新介面。

#### 設定

`SearchNative` 沿用 §1 的 driver options，不新增值。未覆寫時：

| 項目 | 預設 |
|---|---|
| `max_execution_time` | `55` 秒，必須小於 `query.timeout`（`11` 的預設是 60 秒） |
| `max_memory_usage` | `1000000000` |
| `max_result_rows` | `5000000`（正值，≤2^30） |
| `max_rows_to_read` | `5000000`（正值，≤2^30） |
| `max_result_bytes` | `67108864`（正值，≤2^40） |
| `async_insert` | 不適用於這條讀取。logs 寫入仍是同步 INSERT |
| `cluster` | `""`。非空仍是 Unsupported |

超出 `max_result_rows` 回 `ErrTooLarge`。設定名用 §1：`max_rows_to_read` 與 `max_result_bytes`。不用 `max_bytes_to_read`。數字以 §1 為準。

#### 錯誤

`SearchNative` 使用 §9 的對照，不另做一張表。`SYNTAX_ERROR` 是 `ErrInternal`：SQL 由驅動生成。logfmt 階段是 `ErrUnsupported`，不是語法錯誤。`ErrTooLarge` 沿用驅動現有句子：驅動自己擋下的結果上限，底層文字是 `query result exceeds limit`；ClickHouse 錯誤碼經現有 `classifiedError` 對照時，底層文字是 `storage operation failed`，不回伺服器原文。

#### 測試怎麼分

單元測試沒有 `//go:build integration`。`make test` 與 Prism CI 的 `make lint test` 是 `go test -race -count=1 ./...`，不會連上 ClickHouse。這層覆蓋翻譯結果、logfmt 的 `ErrUnsupported`、以及能力位與介面同真同假。

整合測試在 `drivers/clickhouse` 的 `//go:build integration` 檔。`make conformance` 經 `drivers/clickhouse/run-integration.py` 執行：有 `PRISM_CLICKHOUSE_TEST_DSN` 就用它，否則腳本自起容器。`C-LOG-03`、`C-LOG-04`、`C-LOG-05` 要在這層、對著真實 ClickHouse 維持成立，分流見 `10` §2.3。`make test` 通過不表示這三條已經在 ClickHouse 上跑過。

**AC-43** Given 實作 P2-05。When 看變更路徑。Then 驅動程式在 `drivers/clickhouse/**`。路徑外只允許兩處：`pkg/spi` 的 `Capabilities.Validate`（AC-59），以及 `pkg/spi/conformance` 裡 C-LOG-03、C-LOG-04、C-LOG-05 對 `NativeLogQuery` 與 pushdown 的分流（AC-63、AC-64）。沒有 `internal/query` 路由器，也沒有 `internal/compat/lokiapi`：HTTP 繼續 `Search` 加執行器。`LogStore.Search` 的可觀察契約不變：selectors、時間、排序，補算前沒有 `LIMIT`。沒有 Phase 6 的 logfmt SQL，沒有 `LiveTail`、RED、`DependencyQuerier`、非空 `cluster`。

**AC-44** Given `Logs()`。When `NativeLogQuery` 為 true。Then 同一個值實作 `NativeLogQuerier`：`SearchNative(ctx, LogQuery) (LogResult, error)`。`Agg == nil` 時結果在 `Streams`，`Agg != nil` 時結果在 `Matrix`。`Search` 仍回 `LogIterator`。When 能力位是 false。Then 不得實作這個介面（C-GEN-06）。`NativeLogQuery` 可以在 `ParsedFieldLogfmt=false` 且 `Limit=false` 時為 true，前提是 AC-59 的 `Validate` 通過。

**AC-45** Given `Stages` 含 `ParseLogfmt`。When `SearchNative`。Then `spi.Classify` 為 `ErrUnsupported`。不得把截斷後的 `Streams` 或 `Matrix` 當成成功。不使用 `extractAllGroupsHorizontal`。`ParsedFieldLogfmt` 維持 false。

**AC-46** Given 兩筆 `{host="h1"}`：`TS=1757030400000000000`／body `in`，`TS=1757030401000000000`／body `out`。When `SearchNative`，`Start=1757030400000000000`，`End=1757030401000000000`，沒有行過濾、沒有 parse、`Agg=nil`，`Limit` 大於 1，`Direction=Forward`。Then `Streams` 只有 `in`。等於 end 的 `out` 不在 `[Start, End)`。

**AC-47** Given 區間內兩筆 `{host="h1"}`，較早的 body 是 `alpha`，較晚的是 `beta`。When `Filters` 為 `LineContains` `"alp"`。Then 只有 `alpha`。When 改成 `LineNotContains` `"alp"`。Then 只有 `beta`。

**AC-48** Given body `hello token` 與 `hello-token`。When `LineMatch`，正則來源是 `hello token`。Then 只有中間為空白的那筆。`LiteralHint` 含分隔符時不得改這個結果：不得多收 `hello-token`，也不得漏掉 `hello token`。Given body `hello` 與 `hello token`。When `LineNotMatch`，正則來源是 `^hello$`，且沒有可用 hint。Then 排除 `hello`，留下 `hello token`。

**AC-49** Given body `{"status":"500"}` 與 `{"status":"200"}`，`Stages` 只有 `ParseJSON`，`Fields` 一筆 `Field=status`、`Op=Eq`、`Value=500`。When `SearchNative`。Then 只有第一筆。列集合與同一查詢走 `Search` 再經執行器相同。When 同一組資料把 `Op` 改成 `Ne`、`Re`、`NotRe`、`Gt`、`Gte`、`Lt` 或 `Lte`。Then `spi.Classify` 為 `ErrUnsupported`，不是篩過或沒篩的成功結果。Given 另外的 body `{"other":"1"}`，同一組 `Field=status`、`Op=Eq`、`Value=500`。When `SearchNative`。Then 該列不在結果中。Given body `{"a":{"c":"v"}}`，`Field=a_b`、`Op=Eq`、`Value=v`。When `SearchNative`。Then 該列不在結果中。這是缺欄，或巢狀路徑在 `16` §3.6 的 parse 之後沒有該標籤。不是 `ErrUnsupported`。

**AC-50** Given 區間內三筆，時間由早到晚：body `keep-a`、`drop`、`keep-b`。When `LineContains` `"keep"`，`Limit=1`，`Direction=Forward`，沒有 parse。Then 只有 `keep-a`。When 只把 `Direction` 改成 `Backward`。Then 只有 `keep-b`。When 同一組過濾再加上 `ParseLogfmt`。Then `ErrUnsupported`，不是只回一筆。

**AC-51** Given 同一奈秒兩筆 `{host="h1"}`，寫入順序先 body `a`、後 body `b`。When `Direction=Forward`。Then `a` 在 `b` 前面，兩筆都在。When `Direction=Backward`。Then 兩筆都在，寫入序仍是 `a` 在 `b` 前面。這是 C-LOG-08。SQL 是 `ORDER BY ts` 加上該方向，其後 `write_seq ASC`。不用 `_part_offset`。

**AC-52** Given `{host="h1"}` 的 body `in` 在 `1757030400000000000`，body `out` 在 `1757030399000000000`。`Start=1757030400000000000`，`End=1757030401000000000`，`Window=1s`，`Step=1s`，`VectorOp` 空。When `RangeFunc=count_over_time`。Then `Matrix` 一條 `{host="h1"}`，一個樣本，`TS=1757030400000` 毫秒，`Value=1`。`out` 在左開邊界上，不計入。窗口是 `(t-Window, t]`。When `RangeFunc=rate`。Then 同一個樣本位置，`Value=1`（筆數除以 1 秒，在 Go 端除）。When `RangeFunc=bytes_over_time`。Then `Value=2`。

**AC-53** Given 一筆 `{host="h1"}` 在 `1757030401000000000`。`Start` 是這個時間，`End=Start+3s`，`Window=2s`，`Step=3s`，`count_over_time`。2 不是 3 的整數倍。When `SearchNative`。Then `spi.Classify` 為 `ErrUnsupported`。不得回成功的 `Matrix`，不論樣本落在 `1757030401000` 或對齊 Unix epoch 的 `1757030400000`。

**AC-54** Given `SearchNative` 碰到 ClickHouse `TOO_MANY_ROWS`(158)、`TOO_MANY_BYTES`(307) 或 `MEMORY_LIMIT_EXCEEDED`(241)。Then `ErrTooLarge`，底層文字是現有的 `storage operation failed`，不是伺服器原文，也不是新造的長句。When 驅動自己的結果上限擋下查詢。Then `ErrTooLarge`，底層文字是現有的 `query result exceeds limit`。When `TIMEOUT_EXCEEDED`(159)。Then `ErrTimeout`。When `SYNTAX_ERROR`(62)。Then `ErrInternal`，不是 `ErrBadRequest`。

**AC-55** Given driver options 用 §1 的預設。When `SearchNative` 送出查詢。Then settings 含 `max_execution_time = 55`、`max_memory_usage = 1000000000`、`max_rows_to_read = 5000000`、`max_result_rows = 5000000`、`max_result_bytes = 67108864`。沒有名為 `max_bytes_to_read` 的設定。超出 `max_result_rows` 回 `ErrTooLarge`，底層文字見 AC-54。

**AC-56** Given 單元測試。When `make test`。Then 不需要 ClickHouse，也不編譯 `//go:build integration`。這層要蓋到 AC-45 的 `ErrUnsupported`，能力位與 `NativeLogQuerier` 同真同假，以及 JSON `Eq` 的 SQL 在精篩前沒有 `LIMIT`、也沒有會少列的 `JSONExtractString` 相等當成最終條件。Given 整合測試。When `make conformance`。Then 才連接 ClickHouse。`NativeLogQuery=true` 時，C-LOG-03 的已宣告過濾由 `SearchNative` 驗已濾好，`Search` 驗超集；`NativeLogQuery=false` 的驅動仍只走 `Search`，既有結果不得失敗。見 AC-63、AC-64。AC-65 至 AC-71 在這層對真實列比對 `Search` 再經執行器。

**AC-57** Given P2-05 的目標能力。Then `ParsedFieldLogfmt=false`、`Limit=false`、`Stats=false`、`LiveTail=false`。`Logs()` 不實作 `LogStatser`。`Retention.Enforced`、`Traces.RED`、`Dependencies` 維持 false。不得把 logfmt 標成已下推。§2 草圖不是這組能力。`Aggregation` 的開關見 AC-61，不在本條提前設成 true。

**AC-58** Given 一筆 `{host="h1"}` 在 `1757030400000000000`。`Start` 是這個時間，`End=Start+2s`，`Window=2s`，`Step=1s`，`count_over_time`，`VectorOp` 空。When `SearchNative` 回成功。Then 兩個樣本，毫秒 `1757030400000` 與 `1757030401000`，值都是 `1`。窗口是 `(t-Window, t]`。SQL 桶大小不規定。

**AC-59** Given `NativeLogQuery=true`，`Substring`、`Regex`、`ParsedFieldJSON`、`Sort` 為 true，`ParsedFieldLogfmt=false`，`Limit=false`。When `Capabilities.Validate`。Then 回 nil。`Limit=true` 而 `ParsedFieldLogfmt=false` 仍回錯。Given 同一組但 `Substring=false`。When `Validate`。Then 回錯。實作改 `pkg/spi` 的這條檢查，不改 HTTP。

**AC-60** Given 一筆 logs 的原生欄位 `service="api"`，`labels` 只有 `{host="h1"}`。When `SearchNative` 的 selector 是 `service="api"`。Then 沒有這一筆。Given 原生欄位 `service="other"`，`labels` 含 `service="api"`。When 同一個 selector。Then 有這一筆。`host`、`env`、`cluster`、`severity` 用同一條規則：只比 `labels`，不比原生欄位。

**AC-61** Given AC-52 與 AC-58 都還沒通過。Then `Logs.Aggregation` 為 false。Given 這兩條都通過的 P2-05 驅動。Then `Logs.Aggregation` 為 true。此位為 true 不表示每種聚合都下推。

**AC-62** Given `count_over_time`，`Window=1s`，`Step=0`，區間內一筆。When `SearchNative`。Then `ErrUnsupported`，不是執行器那種落在 `q.End` 的單點。Given `Window=500µs`，`Step=500µs`。When `SearchNative`。Then `ErrUnsupported`。Given AC-52 的資料，`RangeFunc=bytes_rate`，`Window=1s`，`Step=1s`。When `SearchNative`。Then `ErrUnsupported`，不是 `2`。Given AC-52 的資料，`VectorOp` 為 `sum`、`avg`、`min`、`max`、`count`、`topk` 或 `bottomk`。When `SearchNative`。Then `ErrUnsupported`。

**AC-63** Given `NativeLogQuery=true`，`Substring`、`Regex`、`ParsedFieldJSON` 為 true，`ParsedFieldLogfmt=false`。C-LOG-03 的 substring、regex、json 三組各兩筆，一筆 `Attrs["expected"]="true"`。When `SearchNative`。Then 只回那筆 `expected=true`，`Body`、`Labels`、`Attrs` 與寫入相同。When 同一組改走 `Search`。Then 兩筆都在。Given 同一驅動的 logfmt 兩筆。When `Search`。Then 兩筆都在。When `SearchNative`。Then `ErrUnsupported`，不是只回 `expected=true`。Given C-LOG-05 的三筆，時間由早到晚：`keep first`、`drop`、`keep second`，`LineContains "keep"`，`Limit=1`，`Direction=Forward`。When `Search`。Then 三筆都在，或 `ErrTooLarge`。When `SearchNative`。Then 只有 `keep first`。

**AC-64** Given `NativeLogQuery=false`。When 跑 C-LOG-03、C-LOG-04、C-LOG-05。Then 只呼叫 `Search`，不呼叫 `SearchNative`。宣告了 `Substring` 或 regex 或 JSON 的驅動，C-LOG-03 仍要求 `Search` 濾好。沒宣告的過濾，C-LOG-04 仍要求 `Search` 回超集。`NativeLogQuery=false` 的既有驅動不得因 AC-63 失敗。

**AC-65** Given 三筆，`Stages` 只有 `ParseJSON`。body `{"a":{"b":"v"}}`、`{"a":{"b":"no"}}`、`{"a_b":"v"}`。`Fields` 一筆 `Field=a_b`、`Op=Eq`、`Value=v`。When `SearchNative`。Then 第一筆與第三筆在，第二筆不在。列集合與同一查詢走 `Search` 再經執行器相同。不得因欄位名含 `_` 回 `ErrUnsupported`：頂層鍵 `a_b` 與攤平後的 `a_b` 都要留。

**AC-66** Given 四筆。body `{"a.b":"v"}`、`{"a-b":"v"}`、`{"a.b":"no"}`、`{"1x":"v"}`。`Stages` 只有 `ParseJSON`。When `Field=a_b`、`Op=Eq`、`Value=v`。Then 前兩筆在，後兩筆不在。When 同一組改查 `Field=_1x`、`Op=Eq`、`Value=v`。Then 只有第四筆。When `Field=1x`、`Op=Eq`、`Value=v`。Then 沒有列。sanitize 不合併連續底線；非字母、數字、`_`、`:` 的字元各改成一個 `_`；清理後以數字開頭則前面加一個 `_`。見 `16` §3.6。列集合與 `Search` 再經執行器相同。

**AC-67** Given body 與 `16` AC-2 相同：`{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}`。`Stages` 只有 `ParseJSON`。When `Field=a_b_c_d_e_f`、`Op=Eq`、`Value={"g":1}`。Then 該筆在。When `Field=a_b_c_d_e_f_g`、`Op=Eq`、`Value=1`。Then 該筆不在。值是子樹的緊湊 JSON，沒有空白。列集合與 `Search` 再經執行器相同。

**AC-68** Given 四筆同時在區間內：`{"n":1e-7}`、`{"n":1e21}`、`{"n":9007199254740993}`、`{"n":-0}`。`Stages` 只有 `ParseJSON`。數字規則與 `16` §3.6 相同。When `Field=n`、`Op=Eq`、`Value=0.0000001`。Then 只有第一筆。When `Value=1000000000000000000000`。Then 只有第二筆。When `Value=9007199254740992`。Then 只有第三筆。When `Value=-0`。Then 只有第四筆。When `Value` 為 `1e-7`、`1e21`、`9007199254740993` 或 `0`。Then 沒有列。列集合與 `Search` 再經執行器相同。

**AC-69** Given `Labels` 為 `app="web"`，body `{"app":"parsed"}`。`Stages` 只有 `ParseJSON`。When `Field=app_extracted`、`Op=Eq`、`Value=parsed`。Then 該筆在。When `Field=app`、`Op=Eq`、`Value=parsed`。Then 該筆不在：stream label `app` 仍是 `web`。Given `Labels` 為 `app="web"` 與 `app_extracted="kept"`，body `{"app":"x"}`。When `Field=app_extracted`、`Op=Eq`、`Value=x`。Then 該筆不在。目標名已被佔用，抽出值丟掉，不加 `app_extracted_extracted`。見 `16` §3.6 與 AC-7、AC-21。列集合與 `Search` 再經執行器相同。

**AC-70** Given 時間由早到晚兩筆：body `{"status":"200"}`、body `{"a":{"b":"v"}}`。`Stages` 只有 `ParseJSON`，`Field=a_b`、`Op=Eq`、`Value=v`，`Limit=1`，`Direction=Forward`。When `SearchNative`。Then 只有第二筆。精篩前的 SQL 不得加 `LIMIT`。粗篩若先截成第一筆，精篩後會變成空結果，那不是本條的結果。`Pushdown.Limit` 仍是 false。

**AC-71** Given 五筆，`Stages` 只有 `ParseJSON`。body `{"other":"1"}`（缺鍵 `k`）、`{"k":null}`、`{"k":{"a":1}}`（物件）、`{"k":""}`、`{"k":[1]}`（陣列）。`Fields` 一筆 `Field=k`、`Op=Eq`、`Value=""`。When `SearchNative`。Then 結果是 0 列。五筆都不在結果中。不是 `ErrUnsupported`。Owner 於 2026-10-20 鎖定：與執行器相同。執行器的標籤模型（`labels.Builder.Set`）把值 `""` 當成刪除，所以 `{"k":""}` 不會留下標籤 `k`。缺鍵、JSON `null`、沒建成標籤的物件或陣列也不建標籤 `k`。列集合與同一查詢走 `Search` 再經執行器相同。`JSONExtractString(body, k) = ''` 會把這五筆多收回來，不能當最終條件。

## 7. 追蹤查詢

### 7.1 `GetTrace`

```sql
SELECT * FROM spans
WHERE tenant = {tenant:String} AND trace_id = {tid:String}
  {AND ts >= {start} AND ts < {end}}          -- 有時間範圍時加上
ORDER BY ts
LIMIT {max_spans_per_trace:UInt64}
```

無時間範圍時先查 `trace_index` 取得 `start_ts`/`end_ts`，再帶範圍查 `spans`：

```sql
SELECT min(start_ts) AS s, max(end_ts) AS e FROM trace_index
WHERE tenant = {tenant:String} AND trace_id = {tid:String}
```

**兩段式查詢是必須的**：`spans` 的 `ORDER BY` 前綴是 `(tenant, service, name, ts)`，不帶時間範圍會掃全表。

### 7.2 `FindTraceIDs`

```sql
SELECT trace_id, min(ts) AS start_ts, max(ts) AS end_ts
FROM spans
WHERE tenant = {tenant:String}
  AND service = {service:String}
  {AND name = {operation:String}}
  {AND kind = {kind:String}}
  AND ts >= {start:DateTime64(9)} AND ts < {end:DateTime64(9)}
  {AND duration_ns >= {min_dur:UInt64}}
  {AND duration_ns <= {max_dur:UInt64}}
  {AND attrs[{tk:String}] = {tv:String}}       -- 每個 tag 一條
GROUP BY trace_id
ORDER BY start_ts DESC
LIMIT {limit:UInt64}
```

**duration 過濾的語義**：Jaeger 的 `minDuration` 指的是 **trace 的總時長**（root span 的 duration），而非任一 span。上述 SQL 過濾的是單一 span。正確做法：

```sql
SELECT trace_id, min(ts) AS start_ts, max(ts) AS end_ts,
       maxIf(duration_ns, parent_id = '') AS root_dur
FROM spans WHERE ... GROUP BY trace_id
HAVING root_dur >= {min_dur:UInt64} AND root_dur <= {max_dur:UInt64}
ORDER BY start_ts DESC LIMIT {limit:UInt64}
```

若 trace 無 root span（採樣或截斷），`root_dur` 為 0，用 `max(duration_ns)` 作為回退。此語義差異必須寫進 driver README。

### 7.3 `Services` / `Operations`

```sql
SELECT DISTINCT service FROM spans
WHERE tenant = {tenant:String} AND ts >= {start} AND ts < {end}
ORDER BY service

SELECT DISTINCT name, toString(kind) AS span_kind FROM spans
WHERE tenant = {tenant:String} AND service = {service:String}
  {AND kind = {kind:String}}
  AND ts >= {start} AND ts < {end}
ORDER BY name
```

這兩個查詢在資料量大時很慢（`DISTINCT` 掃分區）。**優化（Phase 3 必做）**：建 `service_ops` 的 `AggregatingMergeTree` MV，直接查該表。

```sql
CREATE TABLE service_ops (
    day DateTime, tenant LowCardinality(String),
    service LowCardinality(String), name LowCardinality(String),
    kind LowCardinality(String), cnt SimpleAggregateFunction(sum, UInt64)
) ENGINE = AggregatingMergeTree PARTITION BY toYYYYMM(day)
ORDER BY (tenant, service, name, kind, day) TTL day + INTERVAL 90 DAY;

CREATE MATERIALIZED VIEW mv_service_ops TO service_ops AS
SELECT toDate(ts) AS day, tenant, service, name, toString(kind) AS kind, count() AS cnt
FROM spans GROUP BY day, tenant, service, name, kind;
```

### 7.4 `SpanAggregator.ServiceRED`

```sql
SELECT service, name,
       toStartOfInterval(minute, INTERVAL {step:UInt32} SECOND) AS t,
       sum(requests) AS reqs, sum(errors) AS errs, sum(lat_sum) AS lsum,
       quantilesMerge(0.5, 0.9, 0.95, 0.99)(lat) AS q
FROM service_red_1m
WHERE tenant = {tenant:String}
  {AND service IN {services:Array(String)}}
  {AND name = {operation:String}}
  AND minute >= {start:DateTime} AND minute < {end:DateTime}
GROUP BY service, name, t
ORDER BY t
```

`step` 必須 ≥ 60 秒（MV 粒度）。小於 60 秒時向上取整並回 warning。

## 8. `DependencyQuerier`

見 `13-ADR.md` ADR-008 的近似策略。實作：

### 8.1 寫入時的本地 join

```go
// 在同一批次內建立 spanID → service 的索引
idx := map[string]string{}
for _, s := range batch { idx[s.SpanID] = s.Resource.Service }
for _, s := range batch {
    if s.ParentSpanID == "" { continue }
    if parentSvc, ok := idx[s.ParentSpanID]; ok {
        if parentSvc != s.Resource.Service {
            edges = append(edges, edge{parentSvc, s.Resource.Service, isError(s)})
        }
    } else {
        pending = append(pending, pendingLink{s.TraceID, s.ParentSpanID, s.Resource.Service, isError(s), s.StartNano})
    }
}
```

### 8.2 補算任務

```sql
CREATE TABLE pending_links (
    ts DateTime64(9), tenant LowCardinality(String),
    trace_id String, parent_span_id String,
    child_service LowCardinality(String), is_error UInt8
) ENGINE = MergeTree PARTITION BY toDate(ts) ORDER BY (tenant, ts)
TTL toDateTime(ts) + INTERVAL 1 DAY;
```

每 5 分鐘執行：

```sql
INSERT INTO service_deps_1h
SELECT toStartOfHour(p.ts) AS hour, p.tenant, s.service AS parent,
       p.child_service AS child, count() AS calls, sum(p.is_error) AS errors
FROM pending_links AS p
INNER JOIN spans AS s
    ON s.trace_id = p.trace_id AND s.span_id = p.parent_span_id AND s.tenant = p.tenant
WHERE p.ts >= now() - INTERVAL 10 MINUTE AND p.ts < now() - INTERVAL 1 MINUTE
  AND s.ts >= now() - INTERVAL 15 MINUTE
  AND s.service != p.child_service
GROUP BY hour, p.tenant, parent, child;
```

處理後刪除已消化的 `pending_links`（用分區刪除或依賴 TTL）。

**必須記錄命中率指標** `prism_dep_local_join_ratio`，Phase 3 驗收時實測並寫入 ADR-008。

## 9. 錯誤映射

| ClickHouse 錯誤碼 | `spi.ErrClass` |
|---|---|
| 網路錯誤、`NETWORK_ERROR`(210)、`SOCKET_TIMEOUT`(209) | `ErrUnavailable` |
| `TIMEOUT_EXCEEDED`(159) | `ErrTimeout` |
| `MEMORY_LIMIT_EXCEEDED`(241) | `ErrTooLarge` |
| `TOO_MANY_ROWS`(158)、`TOO_MANY_BYTES`(307) | `ErrTooLarge` |
| `TOO_MANY_SIMULTANEOUS_QUERIES`(202) | `ErrThrottled` |
| `UNKNOWN_TABLE`(60)、`UNKNOWN_DATABASE`(81) | `ErrUnavailable`（尚未 Migrate） |
| `SYNTAX_ERROR`(62)、`ILLEGAL_TYPE_OF_ARGUMENT`(43) | `ErrInternal`（我們生成的 SQL 有 bug） |
| `AUTHENTICATION_FAILED`(516) | `ErrUnavailable` |
| 其他 | `ErrInternal` |

`SYNTAX_ERROR` 映射為 `ErrInternal` 而非 `ErrBadRequest` 是刻意的：SQL 由驅動生成，語法錯是我們的 bug，不是使用者的。

## 10. 遷移

`drivers/clickhouse/migrations/`：

```
001_init_logs.sql
002_init_spans.sql
003_init_metrics.sql
004_trace_index.sql
005_service_red.sql
006_service_deps.sql
007_service_ops.sql
008_labels_str.sql
009_log_write_seq.sql        # P1-10加法式欄位；原001–008不改
010_metric_value_bits.sql    # UInt64保留新write的完整float bits；legacy DEFAULT源於原value
```

執行機制：

```sql
CREATE TABLE IF NOT EXISTS prism_schema_migrations (
    version UInt32, name String, applied_at DateTime DEFAULT now(),
    checksum String
) ENGINE = MergeTree ORDER BY version;
```

- 依 version 遞增執行未套用者。
- 每個檔案的 sha256 存為 `checksum`；已套用的檔案內容變更時**啟動失敗**並提示（防止靜默的 schema 漂移）。
- TTL 天數以 Go template 注入，因此 checksum 對「渲染前」的模板計算。
- 保留期變更不新增遷移檔，改為啟動時執行 `ALTER TABLE ... MODIFY TTL`（冪等）。

## 11. driver README 必載明的已知限制

1. ClickHouse 不是時序資料庫，指標壓縮與查詢效能明顯不如專用 TSDB（見 `04` §6.5）。
2. `PromQL` 全部走中間層回退引擎，大範圍高基數查詢會慢。
3. logfmt 解析不下推。
4. 服務依賴圖為近似值（ADR-008）。
5. Jaeger `minDuration`/`maxDuration` 作用於 root span；無 root span 的 trace 用 max span duration 回退。
6. 不支援 exemplar 與原生直方圖（Phase 6）。
7. TTL 精度為天（`ttl_only_drop_parts = 1`）。

P1-10 executable-contract clarification: `FindTraceIDs` 的非正 `Limit` 不要求結果截斷，空 service 作精確空字串匹配；positive limit 在完整 duration/filter/order 後按 trace 計，安全 scan/result caps 仍 fail closed。所有 read SQL 明確包含已驗證的 `max_memory_usage`，不由 native caller context 覆寫。SDD14 草案的額外前置條件不取代本期現有 SPI/memory 行為；裁決與實測見 P1-10 spec D010/D011。
