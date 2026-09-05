# 16 — LogQL 子集：形式文法與 Parser 規格

**Clean-room 聲明**：本文件的文法依 Grafana 公開的 LogQL 語法文件與對 Loki HTTP API 的黑箱實測撰寫。實作者不得閱讀 `grafana/loki` 原始碼。見 `13-ADR.md` ADR-004。

實作位置：`internal/query/logql`。輸出：`spi.LogQuery`（見 `14-SPI-GO-REFERENCE.md` §6）。

---

## 1. 文法（EBNF）

```ebnf
query           = log_query | metric_query ;

(* ---------- 日誌查詢 ---------- *)
log_query       = stream_selector { line_filter } { pipeline_stage } ;

stream_selector = "{" [ matcher { "," matcher } ] "}" ;
matcher         = label_name match_op string_lit ;
match_op        = "=" | "!=" | "=~" | "!~" ;

line_filter     = line_filter_op string_lit ;
line_filter_op  = "|=" | "!=" | "|~" | "!~" ;

pipeline_stage  = parser_stage | label_filter ;
parser_stage    = "|" ( "json" | "logfmt" ) ;
label_filter    = "|" label_name cmp_op ( string_lit | number | duration | bytes ) ;
cmp_op          = "=" | "!=" | "=~" | "!~" | ">" | ">=" | "<" | "<=" ;

(* ---------- 指標查詢 ---------- *)
metric_query    = vector_agg | range_agg ;

range_agg       = range_fn "(" log_query "[" duration "]" ")" ;
range_fn        = "count_over_time" | "rate" | "bytes_over_time" | "bytes_rate" ;

vector_agg      = vector_fn [ grouping ] "(" [ number "," ] range_agg ")" [ grouping ] ;
vector_fn       = "sum" | "avg" | "min" | "max" | "count" | "topk" | "bottomk" ;
grouping        = ( "by" | "without" ) "(" label_name { "," label_name } ")" ;

(* ---------- 詞法 ---------- *)
label_name      = ( letter | "_" ) { letter | digit | "_" } ;
string_lit      = '"' { char | escape } '"' | "`" { char } "`" ;
escape          = "\\" ( '"' | "\\" | "n" | "r" | "t" | "/" | unicode ) ;
duration        = number ( "ns" | "us" | "ms" | "s" | "m" | "h" | "d" | "w" ) ;
bytes           = number ( "b" | "kb" | "mb" | "gb" | "kib" | "mib" | "gib" ) ;
number          = [ "-" ] digit { digit } [ "." digit { digit } ] ;
```

### 1.1 語義約束（文法之外）

1. `stream_selector` 必須至少含一個「非空值的 `=` 或 `=~`」匹配。純 `{job!=""}` 這類會掃全庫的查詢一律拒絕，錯誤訊息：`queries require at least one regexp or equality matcher that does not have an empty-compatible value`（與 Loki 一致）。
2. `label_filter` 只能出現在至少一個 `parser_stage` 之後，否則錯誤：`label filter requires a parser stage before it`。**例外**：對 `stream_selector` 中已存在的標籤做過濾是允許的（此時等價於收窄選擇器）。
3. `topk` / `bottomk` 必須帶 `number` 第一參數。
4. `grouping` 只能出現在 `vector_fn` 的前或後其中一處，不可兩處都有。
5. `range_agg` 的 duration 必須 > 0 且 ≤ `query.max_range`。

### 1.2 v1 明確不支援（必須回明確錯誤，不得靜默忽略）

| 語法 | 錯誤訊息 |
|---|---|
| `\| unwrap x` | `unwrap is not supported in this version` |
| `\| pattern "<...>"` | `pattern parser is not supported in this version` |
| `\| regexp "..."` | `regexp parser is not supported in this version` |
| `\| line_format "..."` | `line_format is not supported in this version`（Phase 4 支援） |
| `\| label_format ...` | `label_format is not supported in this version` |
| `\| drop ...` / `\| keep ...` | `drop/keep are not supported in this version` |
| `\| decolorize` | `decolorize is not supported in this version` |
| `quantile_over_time` 等 unwrap 類函式 | `<fn> requires unwrap which is not supported in this version` |
| `absent_over_time` | `absent_over_time is not supported in this version` |
| 二元運算（`+ - * / and or`） | `binary operations are not supported in this version` |
| `label_replace` | `label_replace is not supported in this version` |
| `offset` / `@` 修飾符 | `<modifier> is not supported in this version` |

**每一條不支援的語法都必須被 parser 認得**：先解析成功再回「不支援」，而不是回「語法錯誤」。使用者需要知道「我寫對了但你不支援」，而非「我寫錯了」。這需要 parser 的文法比實際支援的範圍更寬，是刻意的設計。

---

## 2. 錯誤訊息格式

Grafana 會把錯誤原文顯示給使用者，格式必須與 Loki 一致：

```
parse error at line 1, col 15: syntax error: unexpected IDENTIFIER, expecting STRING
```

實作要求：

- `line` / `col` 從 1 起算，`col` 以 rune 計（非 byte），讓中文字元的位置正確。
- 錯誤型別分三類，全部走 HTTP 400 + Loki 的錯誤信封：
  - 語法錯誤：`parse error at line L, col C: <details>`
  - 語義錯誤：直接是規則訊息（如 §1.1 的三條）
  - 不支援：`<feature> is not supported in this version`
- 錯誤回應信封（Loki 格式，非 Prometheus 格式）：純文字 body，`Content-Type: text/plain`，HTTP 400。**這是 Loki 與 Prometheus 的一個不一致之處，必須照抄。**

---

## 3. Parser 實作規格

### 3.1 檔案分工

| 檔案 | 職責 |
|---|---|
| `lexer.go` | 手寫 scanner。輸出 `Token{Kind, Lit, Line, Col}` |
| `token.go` | Token 種類常數與字串化（用於錯誤訊息） |
| `parser.go` | 遞迴下降。輸出 `spi.LogQuery` |
| `compile.go` | 正則預編譯、`LiteralHint` 抽取、duration/bytes 解析 |
| `exec.go` | 中間層補算執行器 |
| `agg.go` | 範圍與向量聚合 |
| `errors.go` | 三類錯誤的建構與格式化 |

**不建 AST 樹**：parser 直接填 `spi.LogQuery` 的扁平欄位。理由見 `13-ADR.md` ADR-003。唯一的例外是 `metric_query` 的外層聚合，用 `LogAggregation` 結構承載，仍是扁平的。

### 3.2 Lexer 要點

- 字串字面值支援雙引號（含逃逸）與反引號（raw，不處理逃逸）。正則通常用反引號，避免雙重逃逸。
- `!=` 有歧義：在 `stream_selector` 內是 matcher，在其後是 line filter。**由 parser 依位置決定**，lexer 只回 `NEQ` token。
- 註解：LogQL 無註解語法，遇到 `#` 視為一般字元。
- 空白與換行皆為分隔符，不產生 token。

### 3.3 Parser 要點

- 先嘗試 `metric_query`（以 `range_fn` 或 `vector_fn` 開頭），失敗則回退為 `log_query`。用一個 token 的 lookahead 即可判斷，不需回溯。
- `log_query` 中，`line_filter` 必須全部出現在 `pipeline_stage` 之前（LogQL 允許交錯，但 v1 收緊為此順序，並對交錯情形回明確錯誤：`line filters must come before pipeline stages in this version`）。
- Direction 與 Limit 不來自查詢字串，由 HTTP 參數提供，parser 不填。

### 3.4 `compile.go` — `LiteralHint` 抽取演算法

輸入正則字串，輸出「所有匹配字串必然包含的字面子串」或空字串。

```
1. 用 regexp/syntax.Parse(re, syntax.Perl) 取得 syntax.Regexp AST
2. 呼叫 .Simplify()
3. 遞迴計算每個節點的「必含字面集合」：
   OpLiteral        → {該字面}
   OpConcat         → 子節點結果的聯集
   OpCapture        → 子節點結果
   OpPlus           → 子節點結果（至少出現一次）
   OpRepeat(min>=1) → 子節點結果
   OpStar / OpQuest / OpRepeat(min==0) → {}（可能不出現）
   OpAlternate      → {}（保守：不同分支不保證共同子串）
   OpCharClass / OpAnyChar / OpAnyCharNotNL → {}
   其他             → {}
4. 從集合中取最長者；長度 < 3 則回空字串
5. 若正則帶 (?i) 旗標，回空字串（大小寫不敏感的子串無法用於精確索引）
```

**正確性要求**：`LiteralHint` 必須是**必要條件**（所有匹配字串都含它），不需是充分條件。抽錯會導致漏資料，因此規則全部往保守方向設計。

**Property test（必做）**：

```go
func FuzzLiteralHint(f *testing.F) {
    f.Fuzz(func(t *testing.T, pattern, input string) {
        re, err := regexp.Compile(pattern)
        if err != nil { t.Skip() }
        hint := ExtractLiteralHint(pattern)
        if hint == "" { return }
        if re.MatchString(input) && !strings.Contains(input, hint) {
            t.Fatalf("hint %q not present in matching input %q (pattern %q)", hint, input, pattern)
        }
    })
}
```

種子語料必須包含：`error.*timeout`、`(a|b)cd`、`^prefix`、`suffix$`、`a{2,5}b`、`(?i)Error`、`\d+ERROR\d+`、`[a-z]+fatal`。

### 3.5 `exec.go` — 補算執行器

```go
// Execute 對驅動回傳的迭代器補做未下推的條件。
// plan 標明驅動已處理的部分。
func Execute(ctx context.Context, it spi.LogIterator, q spi.LogQuery,
             plan spi.PushdownPlan, lim Limits) (spi.LogResult, error)
```

執行順序（必須與 Loki 一致，順序影響結果）：

```
for each record from iterator:
    1. 若 !plan.Filters[i]，依序套用第 i 個 LineFilter，任一不過 → 跳過
    2. 若 !plan.Stages，套用 ParseStage（json/logfmt），產生 parsed fields
    3. 若 !plan.Fields，套用 FieldFilter，任一不過 → 跳過
    4. 若 q.Agg == nil：加入輸出 stream；達 Limit 則 Close() 並返回
       否則：餵給聚合器
```

**串流要求**：步驟 4 的「達 Limit 立即返回」是硬性要求。`goleak` 與記憶體測試會驗證：對 100 萬行、`limit=100` 的查詢，實際讀取的記錄數必須 < 10 萬（允許驅動的批次預讀）。

### 3.6 解析階段語義

**`| json`**（無參數形式）：

- Body 必須是合法 JSON 物件（非陣列、非純量），否則該行的 parsed fields 為空，**但該行不被丟棄**（Loki 行為；會加上 `__error__="JSONParserErr"` 欄位）。
- 巢狀物件展平為 `a_b_c`（**底線，非點**——這是 LogQL 與 OTel 的差異，必須照 Loki 來）。
- 陣列展平為 `a_0`、`a_1`。
- 深度上限 5，超過則該子樹整體 JSON 字串化。
- 值一律轉字串。

**`| logfmt`**：

- 解析 `key=value` 與 `key="quoted value"` 與裸 `key`（值為 `""`）。
- 解析失敗加 `__error__="LogfmtParserErr"`，不丟棄該行。
- 重複鍵：後者覆蓋前者。

**與 stream label 的衝突**：parsed field 與 stream label 同名時，parsed field 加 `_extracted` 後綴（Loki 行為）。

### 3.7 `agg.go` — 聚合

**範圍函式**（在每個 stream 上獨立計算）：

| 函式 | 語義 |
|---|---|
| `count_over_time` | 窗口內記錄數 |
| `rate` | `count_over_time / window_seconds` |
| `bytes_over_time` | 窗口內 `len(Body)` 總和 |
| `bytes_rate` | `bytes_over_time / window_seconds` |

窗口對齊：與 Prometheus `rate()` 一致，窗口為 `(t-window, t]`（左開右閉），`t` 為 step 的整數倍。

**向量聚合**：`by`/`without` 決定輸出標籤集；`topk`/`bottomk` 在每個時間點上獨立取前 k。

**記憶體上限**：輸出序列數超過 `query.max_agg_series`（預設 10 000）時回 `spi.ErrTooLarge`，訊息：`query would produce N series, exceeding the limit of M; add a 'by' clause or reduce the time range`。

---

## 4. 測試矩陣

| 類別 | 要求 |
|---|---|
| 正向 | §1 文法的每條產生式至少一個測試 |
| 負向（語法） | 每種語法錯誤有測試，驗證 line/col 正確 |
| 負向（語義） | §1.1 三條約束各有測試 |
| 不支援 | §1.2 每一列有測試，驗證錯誤訊息完全相符 |
| 抽取 | §3.4 的 property test + 8 個種子語料 |
| 執行 | 每種 `PushdownPlan` 組合（2^4 = 16 種）對同一資料產生相同結果 |
| 聚合 | 每個範圍函式 × 每個向量函式的組合 |
| 串流 | 100 萬行 + `limit=100` 的記憶體與讀取量斷言 |
| 相容性 | 對照表：同一查詢送給真實 Loki 與 Prism，結果集合相同（人工執行，記錄於 `test/compat/logql-parity.md`） |

最後一項是 clean-room 實作的驗證方式：**比對行為，不看原始碼**。
