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
  - 語義錯誤：直接是規則訊息（如 §1.1 的五條）
  - 不支援：`<feature> is not supported in this version`
- 錯誤回應信封（Loki 格式，非 Prometheus 格式）：純文字 body，`Content-Type: text/plain`，HTTP 400。**這是 Loki 與 Prometheus 的一個不一致之處，必須照抄。** 查詢 HTTP 的逐字 body 與 header 見 `02` §3.4 AC-41。

---

## 3. Parser 實作規格

### 3.1 檔案分工

| 檔案 | 職責 |
|---|---|
| `lexer.go` | 手寫 scanner。輸出 `Token{Kind, Lit, Line, Col}` |
| `token.go` | Token 種類常數與字串化（用於錯誤訊息） |
| `parser.go` | 遞迴下降。輸出 `spi.LogQuery` |
| `literals.go` | P2-01 parser 所需的 number/duration/bytes 字面值轉換 |
| `compile.go` | P2-02 正則預編譯與 `LiteralHint` 抽取 |
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
5. 若走訪到的任一節點帶大小寫折疊旗標（FoldCase），整段 hint 回空字串：大小寫不敏感的子串無法用於精確索引。看的是 Simplify 之後留在節點上的旗標，不是原始字串裡有沒有寫 (?i)。星號、可選與交替的子節點仍會走訪，巢狀旗標一樣讓整段回空。
6. 走訪節點上限 8192、深度上限 128。超過任一個就回空 hint。
```

實測 `ExtractLiteralHint`：`(?i)123` 為空字串（語法樹仍把旗標留在 `123` 上），`abc(?i)` 為 `abc`（旗標沒有留在節點上），`(?i:k)abc` 為空字串（`k` 帶旗標，整段回空）。

含 U+FFFD 的字面不得作 hint（Go regexp 把非法 UTF-8 byte 當 U+FFFD 匹配）。同一正則裡其他不含 U+FFFD 的必要字面仍可作 hint。

**正確性要求**：`LiteralHint` 必須是**必要條件**（所有匹配字串都含它），不需是充分條件。抽錯會導致漏資料，因此規則全部往保守方向設計。回空 hint 不會漏資料。

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
// plan 標明驅動已處理的部分。不接收 Limits。
func Execute(ctx context.Context, it spi.LogIterator, q spi.LogQuery,
             plan spi.PushdownPlan) (spi.LogResult, error)
```

`06` §3.4 的簽名與此相同。`promqladapter.Limits` 不是日誌執行器的參數。

執行順序（必須與 Loki 一致，順序影響結果）：

```
for each record from iterator:
    1. 若 !plan.Filters[i]，依序套用第 i 個 LineFilter，任一不過 → 跳過
    2. 若 !plan.Stages，套用 ParseStage（json/logfmt），產生 parsed fields
    3. 若 !plan.Fields，套用 FieldFilter，任一不過 → 跳過
    4. 若 q.Agg == nil 或 plan.Agg：加入輸出 stream
       否則：餵給聚合器
       僅當 !plan.Limit 且 q.Limit > 0，且本步是在收集 stream：
       輸出筆數達到 q.Limit 就 Close() 並返回
```

`q.Agg != nil` 且 `plan.Agg == false` 時結果是 Matrix，Streams 為空。`plan.Agg == true` 時執行器不聚合，回傳通過前述步驟的 Streams；與驅動 Matrix 的相等性見 AC-18。

**串流要求**：上面的截斷只在執行器自己套用 Limit 時成立。AC-19：100 萬行、`limit=100`、`plan.Limit=false`，實際讀取筆數必須 < 10 萬。

### 3.6 解析階段語義

**`| json`**（無參數形式）：

- Body 必須是合法 JSON 物件（非陣列、非純量），否則該行的 parsed fields 為空，**但該行不被丟棄**（Loki 行為；會加上 `__error__="JSONParserErr"` 欄位）。
- 巢狀物件展平為 `a_b_c`（底線，非點）。Loki 公開的 Log queries 文件同樣用 `_`。
- 無參數形式跳過陣列，不產生 `a_0` 或 `a_0_b`。Loki 公開文件註明 arrays are skipped。
- 深度從根物件算，根為第 0 層；進入子物件加 1。層數大於 5 的值不再拆開，該鍵的值是子樹的緊湊 JSON（無空白）。深度 5 是本文件既有的資源上限，Loki 公開文件沒有這條。
- 數字先解析成 `float64`，再用 `strconv.FormatFloat(v, 'f', -1, 64)` 轉成十進位，不用科學記號，也不保留 JSON 原文。因此 `401.0` → `401`，`1e3` → `1000`，`1.50` → `1.5`。float64 無法精確表示的數用該 float64 的值，不另報錯：`9007199254740993` → `9007199254740992`。布林為 `true` 或 `false`。JSON `null` 不建標籤。
- 鍵名只保留 ASCII 字母、數字、底線與冒號，其餘字元改成 `_`，不合併連續底線。`a.b-c` → `a_b_c`。Loki 公開文件要求抽出的鍵符合 Prometheus 標籤字元。清理後若為空或以數字開頭，只在前面加一個 `_`。
- 同一個 JSON 物件裡的重複鍵留第一個。Loki 公開文件寫抽出的鍵出現兩次時留第一個值。這與 logfmt 同階段的「後者覆蓋」不同。
- 多個 parser 都讀原始 Body，不改寫 Body。跨 parser 合併時，同名只留先出現的值。上一條的重複鍵不是這條。

**`| logfmt`**：

- 解析 `key=value` 與 `key="quoted value"` 與裸 `key`（值為 `""`）。
- 解析失敗加 `__error__="LogfmtParserErr"`，不丟棄該行。
- 同一階段內的重複鍵：後者覆蓋前者。併入已經抽出的標籤時，仍是先出現的值保留。

**stream label**：只指 `utm.LogRecord.Labels`。`Attrs` 不是 stream label，不參與撞名，也不當欄位過濾的輸入。parsed field 與 stream label 同名時，stream label 留原名，parsed field 只加一次 `_extracted`，不加第二次（Loki 公開文件會加這個後綴；後綴只加一次是這裡寫死的，避免 `_extracted_extracted`）。目標名若已被 stream label 或先收下的抽出標籤佔用，這筆丟掉。物件文字順序決定誰先佔名。`__error__` 同樣處理，不另開例外。

**欄位過濾**：

- 字串 `=`、`=~` 在標籤不存在時不過；`!=`、`!~` 在標籤不存在時過。Loki 公開文件說字串過濾與 Prometheus label matcher 相同。
- 欄位 `=~` / `!~` 比對整段標籤值，與 stream selector 一樣等價於 `^(?:樣式)$`。行過濾 `|~` / `!~` 不加錨點。P2-02 的 `Compile` 目前對欄位正則呼叫 `regexp.Compile` 原樣，沒有加錨點；P2-03 不能把未錨定的 `Compiled.MatchString` 子字串命中當成通過。這份文件不改 `compile.go`。
- 數值比較用抽出的字串解析成 `float64`，與 `FieldFilter.Num` 比較，不把 `Value` 再當成門檻解析。`Num == nil` 回 `spi.ErrBadRequest`。
- 抽出的字串無法轉成數字，或數值欄位不存在：該行不丟，並加上 `__error__="LabelFilterErr"`。Loki 公開文件說轉換失敗時不丟行並加上 `__error__`；錯誤字串本身公開文件沒有寫死，這裡固定為 `LabelFilterErr`。該行已有 `__error__` 時留先值，不改寫，也不為第二個錯誤再加 `_extracted`。

### 3.7 `agg.go` — 聚合

**範圍函式**（在每個 stream 上獨立計算）：

| 函式 | 語義 |
|---|---|
| `count_over_time` | 窗口內記錄數 |
| `rate` | `count_over_time / window_seconds` |
| `bytes_over_time` | 窗口內 `len(Body)` 總和 |
| `bytes_rate` | `bytes_over_time / window_seconds` |

窗口為 `(t-Window, t]`（左開右閉）。`t` 與 `LogRecord.TS` 都是奈秒。對齊原點是 `q.Start`，不是 Unix epoch：`Step > 0` 時 `t = Start + n*Step`，且 `Start <= t < End`。`Sample.TS = utm.NanoToMilli(t)`。有輸入紀錄的 stream，每個 `t` 都輸出樣本，空窗口為 0。`Step == 0` 只輸出一個樣本，`t = q.End`；輸入範圍仍是 `[Start, End)`，所以時間戳等於 `End` 的紀錄不在迭代器裡。`Step < 0`，或 `0 < Step < 1ms`，回 `spi.ErrBadRequest`，避免毫秒時間戳重複。`Window <= 0` 對任一範圍函式也回 `spi.ErrBadRequest`，避免 `rate` 除以 0。Loki 公開文件只說 step 是解析度，沒有寫對齊到 Unix epoch，也沒有寫這兩個拒絕條件。

**向量聚合**：`sum` / `avg` / `min` / `max` / `count` 的 `by` 只留列出的標籤，`without` 去掉列出的標籤。`topk` / `bottomk` 的 `by` / `without` 只用來分組：每一組各取 `K` 條，輸出保留原標籤，不先把標籤縮掉再做全域排序。Prometheus 公開的 aggregation operators 寫明 `topk` / `bottomk` 回傳原標籤，`by` / `without` 只做分桶。組內先比數值（topk 大者在前，bottomk 小者在前），數值相同再比標籤字典序。組與組之間依分組標籤字典序排列；Prometheus 不保證組的順序，這裡排定是為了驗收固定。`By` 與 `Without` 同時非空時回 `spi.ErrBadRequest`；parser 已拒絕這種語法，這是 IR 防線。

**記憶體上限**：輸出序列數超過 `query.max_agg_series`（預設 10 000）時回 `spi.ErrTooLarge`，訊息：`query would produce N series, exceeding the limit of M; add a 'by' clause or reduce the time range`。這一條只數輸出。`sum by` 可以把很多輸入收成一條輸出，輸出上限不會觸發。輸入要不要另計，見下一節，尚未決定，P2-04 的 AC-29 至 AC-41 不含這一題。

#### 待決（owner）：聚合輸入序列上限

以下不是現行規範。實作在 owner 點頭之前維持「只限輸出」。

缺口：`sum` / `avg` / `min` / `max` / `count` 的每個輸入 stream 都要留窗口狀態。`topk` / `bottomk` 保留原標籤，輸出條數接近輸入，現有上限已經罩得住。會漏的是會把標籤縮掉的聚合。

建議：新增 `query.max_agg_input_series`，預設 10 000。不要把 `query.max_agg_series` 改成同時數輸入。超過時回 `spi.ErrTooLarge`，訊息 `query scanned N input series, exceeding the limit of M; narrow the stream selector or reduce the time range`。輸出那句「add a by」維持不變。

利：

- 新 key 補上「輸出只有 1 條、輸入無上限」的記憶體洞。
- 沿用同一個 key 會讓今天合法、輸出只有幾條的 `sum by` 突然失敗，而且錯誤叫使用者再加 `by`，`by` 並不減少輸入。
- 預設先與輸出上限同為 10 000，記憶體不會比現在宣稱的上限更鬆。以後可以單獨調高輸入或調低輸出。

弊：

- 多一個設定。預設 10 000 會拒絕今天能跑完的大 `sum by`，這是行為變更。
- 只數進入聚合的 stream 數，不數單一 stream 的樣本數。樣本數仍靠 `query.max_points`、`max_range` 與掃描列數。

採納才生效的 AC：Given 10 001 個 stream，標籤 `host` 各不相同、`job` 都是 `api`，每個在窗口內一筆。When `sum by (job) (count_over_time({host=~".+"}[1m]))`。Then `spi.ErrTooLarge`，訊息中的 `N` 是 `10001`、`M` 是 `10000`，Matrix 與 Streams 皆空。這個案例的輸出只有 1 條，輸出上限不會先觸發。

---

## 4. 測試矩陣

| 類別 | 要求 |
|---|---|
| 正向 | §1 文法的每條產生式至少一個測試 |
| 負向（語法） | 每種語法錯誤有測試，驗證 line/col 正確 |
| 負向（語義） | §1.1 五條約束各有測試 |
| 不支援 | §1.2 每一列有測試，驗證錯誤訊息完全相符 |
| 抽取 | §3.4 的 property test + 8 個種子語料 |
| 執行 | §4.2 的 AC-14 至 AC-18，以及 AC-20 至 AC-22、AC-25、AC-28 |
| 聚合 | §4.2 的 AC-9 至 AC-13、AC-18、AC-23、AC-26、AC-27 |
| 串流 | §4.2 的 AC-19 |
| 相容性 | 對照表：同一查詢送給真實 Loki 與 Prism，結果集合相同（人工執行，記錄於 `test/compat/logql-parity.md`） |

最後一項是 clean-room 實作的驗證方式：**比對行為，不看原始碼**。

### 4.1 分期驗收邊界

P2-01 驗收 lexer/parser 的正向、語法、五條語義、不支援語法與範圍／向量函式組合解析；依 [P2-01 規格](../specs/p2-01-logql-parser.md) 驗證資源上限、取消及錯誤分類。抽取 property test 屬 P2-02；執行、聚合結果與串流驗收屬 P2-03，案例是 §4.2 的 AC-1 至 AC-28；Loki HTTP 驗收是 `02` §3.4 的 AC-29 至 AC-41，不續寫在本節。函式組合在 P2-01 的測試只驗證 IR，不能視為聚合執行或相容性驗收。

### 4.2 P2-03 驗收

編號固定。`TS` 為奈秒。未寫的 `Labels` 與 `Attrs` 為空。`Direction` 為 `Forward`，除非案例另寫。比較結果時忽略 `Stats`。

**AC-1** Given Body `{"status":401,"ok":true,"n":null,"servers":[{"b":1}]}`，一個 `| json`，`plan.Stages=false`。When Execute。Then 該行保留，標籤 `status="401"`、`ok="true"`。沒有 `n`、`servers`、`servers_0_b`，也沒有 `__error__`。

**AC-2** Given Body `{"a":{"b":{"c":{"d":{"e":{"f":{"g":1}}}}}}}`。When `| json`。Then 只有標籤 `a_b_c_d_e_f`，值為 `{"g":1}`。沒有 `a_b_c_d_e_f_g`。

**AC-3** Given Body `not-json`。When `| json`。Then 該行保留，抽出標籤只有 `__error__="JSONParserErr"`。

**AC-4** Given Body `{"a":"1"}`，Stages 依序為 `| json`、`| logfmt`。When Execute。Then 標籤 `a="1"`、`__error__="LogfmtParserErr"`。Body 仍是 `{"a":"1"}`。

**AC-5** Given 沒有標籤 `status`，也沒有 Stages。When `status="401"`，Then 該行不在輸出。When `status!="401"`，Then 該行在輸出。When `status=~"401"`，Then 不在輸出。When `status!~"401"`，Then 在輸出。

**AC-6** Given 抽出 `status="401"`，過濾 `status > 400` 且 `Num` 指向 `400`。Then 該行在輸出。Given 同一行且 `Num` 指向 `500`。Then 該行不在輸出。Given 抽出 `status="nope"` 且 `Num` 指向 `400`。Then 該行在輸出，並有 `__error__="LabelFilterErr"`。Given 數值運算但 `Num == nil`。Then `spi.ErrBadRequest`，Streams 與 Matrix 皆空。

**AC-7** Given `Labels` 為 `job="api"`、`app="web"`，`Attrs` 為 `app="meta"`，Body `{"app":"parsed","status":"1"}`。When `| json`。Then 輸出標籤為 `job="api"`、`app="web"`、`app_extracted="parsed"`、`status="1"`。`Attrs` 仍是 `app="meta"`。

**AC-8** Given `Labels` 為 `__error__="kept"`，Body `not-json`。When `| json`。Then `__error__="kept"`、`__error___extracted="JSONParserErr"`，該行保留。

**AC-9** Given 一筆 `Labels` 為 `job="api"`、`TS=1000000`，`Start=0`，`End=3000000`，`Step=1000000`，`Window=1000000`，`count_over_time`，無向量聚合，`plan.Agg=false`。Then Matrix 一個序列 `job="api"`，樣本（毫秒, 值）為 `(0,0)`、`(1,1)`、`(2,0)`。Streams 為空。

**AC-10** Given AC-9 的同一筆紀錄且 Body 為 `ab`，分別查 `rate`、`bytes_over_time`、`bytes_rate`。Then 時間戳仍是 `0`、`1`、`2`。`rate` 的值為 `0`、`1000`、`0`。`bytes_over_time` 為 `0`、`2`、`0`。`bytes_rate` 為 `0`、`2000`、`0`。

**AC-11** Given AC-9 的紀錄，`Step=0`，`Window=3000000`，其餘同 AC-9。Then 一個樣本 `(3,1)`。`3` 是 `utm.NanoToMilli(q.End)`。

**AC-12** Given `By` 為 `job` 且 `Without` 為 `host`。When Execute。Then `spi.ErrBadRequest`，Streams 與 Matrix 皆空。

**AC-13** Given 同一 `t` 上 `{job="c"}=2`、`{job="b"}=1`、`{job="a"}=1`。When `topk(2)`。Then 順序為 `{job="c"}`、`{job="a"}`。When `bottomk(1)`。Then 只有 `{job="a"}`。

**AC-14** Given 迭代器依序為 `b1`、`b2`、`b3`，皆通過過濾，`q.Limit=1`，`plan.Limit=false`，`Agg=nil`。Then 輸出只有 `b1`，且迭代器已 `Close`。Given 迭代器給出兩行，`q.Limit=1`，`plan.Limit=true`。Then 輸出兩行，執行器不再截斷。

**AC-15** Given 三行皆匹配，`q.Limit=0`，`plan.Limit=true`。Then 輸出三行。Given 同樣三行，`q.Limit=0`，`plan.Limit=false`。Then 仍輸出三行。

**AC-16** Given 兩行 Body `keep` 與 `drop`，過濾 `|= "keep"`。When `plan.Filters[0]=false`。Then 只剩 `keep`。When 迭代器只含已留下的 `keep` 且 `plan.Filters[0]=true`。Then 輸出仍是 `keep`。

**AC-17** Given `| json | status="ok"`，`Limit=10`，`Agg=nil`。兩行 Body 為 `{"status":"ok"}` 與 `nope`。十六種組合只變 `Stages`、`Fields`、`Agg`、`Limit`。`Selectors` 與 `TimeRange` 保持 true。`Filters` 不是這四個位元。位元為 true 時，測試先把該步驟套到迭代器：`Stages` 已抽出標籤，`Fields` 只留通過欄位過濾的行，`Limit` 已截到 10，本案例沒有聚合。Then 十六種的 Streams 都等於四個位元全 false 的結果：一行，Body `{"status":"ok"}`，標籤 `status="ok"`。Streams 依標籤字典序，紀錄依迭代順序，比對 `TS`、`Body`、`Labels`、`Attrs`。

**AC-18** Given AC-9。When `plan.Agg=false`。Then Matrix 等於 AC-9，Streams 為空。When `plan.Agg=true`。Then Execute 回傳通過過濾的 Streams，不回傳 Matrix。以同一套聚合規則把這批 Streams 算出的 Matrix，必須與 AC-9 的 Matrix 在標籤、`Sample.TS`、`Value` 上完全相等，沒有誤差帶。Streams 不直接與 Matrix 比較。

**AC-19** Given 100 萬行皆匹配，`q.Limit=100`，`plan.Limit=false`。Then 輸出 100 行，從迭代器讀到的筆數 < 100000。

**AC-20** Given Body `{"status":"first","status":"second"}`。When `| json`。Then 標籤 `status="first"`。沒有 `second`。

**AC-21** Given stream label `app="web"`，Body `{"app_extracted":"from-key","app":"from-app"}`。When `| json`。Then `app="web"`、`app_extracted="from-key"`。沒有 `app_extracted_extracted`。Given 同一 stream label，Body `{"app":"from-app","app_extracted":"from-key"}`。Then `app="web"`、`app_extracted="from-app"`。Given stream labels `app="web"` 與 `app_extracted="kept"`，Body `{"app":"x"}`。Then 只有 `app="web"`、`app_extracted="kept"`。

**AC-22** Given 抽出 `status="401"`。When `status=~"40"`。Then 該行不在輸出。When `status=~"401"` 或 `status=~"40.*"`。Then 該行在輸出。When `status!~"40"`。Then 該行在輸出。

**AC-23** Given 同一 `t` 上 `{job="a",instance="1"}=5`、`{job="a",instance="2"}=1`、`{job="b",instance="1"}=9`。When `topk by (job) (1)`。Then 兩條序列，標籤不縮成只有 `job`：先 `{job="a",instance="1"}=5`，再 `{job="b",instance="1"}=9`。

**AC-24** Given Body `{"a":401.0,"b":1e3,"c":1.50,"d":9007199254740993}`。When `| json`。Then `a="401"`、`b="1000"`、`c="1.5"`、`d="9007199254740992"`。

**AC-25** Given Body `{"a.b-c":"v"}`。When `| json`。Then 標籤 `a_b_c="v"`。沒有鍵 `a.b-c`。

**AC-26** Given `Window=0`，範圍函式是 `rate`。When Execute。Then `spi.ErrBadRequest`，Streams 與 Matrix 皆空。

**AC-27** Given `Step=500000`（0.5ms）、`Start=0`、`End=2000000`，其餘足以產生兩個以上的點。When Execute。Then `spi.ErrBadRequest`，Streams 與 Matrix 皆空。`Step=0` 仍依 AC-11，不算這個錯誤。

**AC-28** Given Body `not-json`，接著數值過濾 `status > 1` 且 `Num` 指向 `1`。When `| json` 後再過濾。Then 該行保留，`__error__="JSONParserErr"`。沒有 `LabelFilterErr`，也沒有 `__error___extracted`。
