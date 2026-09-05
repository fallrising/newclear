# 23 — 術語表與編碼規範

## 1. 術語表

實作與文件必須使用這裡的詞彙，不得混用同義詞。中英對照是為了讓程式碼識別字與文件對得上。

| 術語 | 英文 / 識別字 | 定義 |
|---|---|---|
| 訊號 | signal | 三種遙測資料之一：metrics / logs / traces |
| 統一遙測模型 | UTM，`pkg/utm` | Prism 內部的資料表示，對齊 OTel |
| 相容層 | compat layer，`internal/compat` | 說外部標準協議的編解碼層 |
| 北向 API | northbound | 對消費端（Grafana、CLI）暴露的查詢與告警 API |
| 南向協議 | southbound | 接收資料的協議（OTLP、remote_write、Loki push） |
| 驅動 | driver，`drivers/*` | 實作 SPI 的存儲後端適配器 |
| 後端 | backend，`spi.Backend` | 驅動開啟後的實例；也泛指底層存儲系統 |
| 能力 | capabilities，`spi.Capabilities` | 驅動宣告自己支援什麼 |
| Tier-1 原語 | primitives | 所有驅動必須實作的最小介面 |
| Tier-2 下推 | pushdown | 可選介面，讓後端直接執行完整查詢 |
| 回退 | fallback | 後端不支援時，中間層本地計算 |
| 部分下推 | partial pushdown | 驅動處理一部分條件，中間層補算其餘 |
| 補算 | post-filtering / `Execute` | 中間層對驅動結果套用未下推的條件 |
| 查詢 IR | query IR，`spi.LogQuery` / `spi.TraceQuery` | 語法無關的結構化查詢表示 |
| 序列 | series | 一組標籤唯一標識的時間序列 |
| 指紋 | fingerprint | 標籤集合的 hash，序列身分 |
| 基數 | cardinality | 不同序列或不同標籤值的數量 |
| 流 | stream | 日誌領域中，一組標籤唯一標識的日誌流 |
| 告警 | alert | 規則評估產生的一個具體實例（由 fingerprint 標識） |
| 規則 | rule | 告警或記錄規則的定義 |
| 規則組 | rule group | 共用評估間隔、依序評估的規則集合 |
| 分組 | grouping | dispatcher 把多個告警合併成一次通知 |
| 抑制 | inhibition | 一個告警存在時，壓下另一批告警 |
| 靜默 | silence | 依 matcher 暫時不發送通知 |
| 投遞 | delivery | 一次通知發送的持久化記錄 |
| 租戶 | tenant | 資料隔離的邊界 |
| 採集器 | collector | 泛指 `prism-agent` 或第三方（Vector、otelcol） |
| 控制平面 | control plane | 管理元資料的部分，不碰遙測資料 |
| 一致性測試 | conformance | 驗證驅動遵守 SPI 契約的測試套件 |
| 差分測試 | differential | 驗證下推與回退產生相同結果的測試 |

**易混淆詞的紀律**：

- 「**丟棄（drop）**」與「**拒絕（reject）**」語義不同，見 `20-SELF-TELEMETRY-REGISTRY.md` §1。前者是資料遺失，後者不是。程式碼與指標中不得混用。
- 「**不支援（unsupported）**」與「**不可用（unavailable）**」語義不同（`19` §9）。前者是設計上沒有，後者是暫時故障。
- 「**Backend**」在 `spi` 語境指驅動實例，在部署語境指 ClickHouse/VM 等外部系統。文件中若有歧義，用「存儲後端」或「`spi.Backend`」明確化。

## 2. Go 編碼規範

### 2.1 命名

| 對象 | 規範 | 範例 |
|---|---|---|
| 套件 | 小寫單字，無底線，不用複數 | `promqladapter`、`logql`、`normalize` |
| 介面 | 動作者名詞（`-er`）或能力名 | `NativeLogQuerier`、`SeriesSet` |
| 建構子 | `New<Type>` / `Open<Type>` | `NewRouter`、`OpenBackend` |
| 錯誤變數 | `Err<Condition>` | `ErrTooLarge` |
| 常數群 | 帶型別前綴 | `SignalMetrics`、`MatchEqual`、`SevError` |
| 測試 | `Test<Func>_<Case>` | `TestExecute_PartialPushdown` |
| 基準 | `Benchmark<Func>_<Scale>` | `BenchmarkSelect_10kSeries` |

**指標與 signal 的縮寫禁令**：不得用 `m`/`l`/`t` 代表 metrics/logs/traces。用完整詞或 `Signal` 型別。

### 2.2 錯誤處理

```go
// 正確
if err != nil {
    return nil, spi.Wrap(spi.ErrUnavailable, "clickhouse", "logs.Search", err)
}

// 錯誤：丟失分類
if err != nil {
    return nil, fmt.Errorf("search failed: %w", err)
}

// 錯誤：吞掉原因
if err != nil {
    return nil, errors.New("search failed")
}
```

- 驅動邊界一律用 `spi.Wrap`。
- 中間層內部用 `fmt.Errorf("...: %w", err)` 保留鏈。
- **禁止裸 `panic`**，除了 `init()` 中的程式設計錯誤（如 `spi.Register` 重複註冊）。
- 每個 HTTP handler 頂層有 recover middleware，記錄 stack 並回 500。

### 2.3 併發

- 每個長駐 goroutine 必須：接受 `context.Context`、在 `ctx.Done()` 時退出、由一個明確的擁有者啟動與等待（`errgroup` 或 `sync.WaitGroup`）。
- **禁止裸 `go func()`**（無 context、無 wait）。CI 用 lint 規則檢查。
- 共享狀態優先用 channel 或 `sync.Map`；用 mutex 時註明保護哪些欄位：

```go
type Limiter struct {
    mu      sync.RWMutex // 保護 buckets 與 lastReload
    buckets map[string]*rate.Limiter
    lastReload time.Time
}
```

- 所有含 goroutine 的套件必須有 `goleak.VerifyTestMain(m)`。

### 2.4 資源

- 任何回傳迭代器/`io.Closer` 的函式，呼叫端立即 `defer Close()`。
- HTTP response body 一律 `defer resp.Body.Close()` 且讀完或 `io.Copy(io.Discard, ...)`（否則連線不回收）。
- 大 slice 用 `sync.Pool` 重用；歸還前必須 `s = s[:0]` 且清空指標元素（避免記憶體洩漏）。
- **禁止無界 `append`**：任何可能隨輸入增長的 slice 都要有上限檢查。

### 2.5 時間

- 遙測時間戳用 `int64` + `pkg/utm` 的轉換函式，不用 `time.Time`（避免每點 24 bytes 的開銷與時區問題）。
- 業務時間（規則的 `for`、心跳間隔）用 `time.Duration` 與 `time.Time`。
- 測試中不得用 `time.Now()`：注入 `spi.Clock`。
- **禁止 `time.Sleep` 做同步**；用 channel 或 `context`。測試中的等待用 `require.Eventually`。

### 2.6 設定

- 所有可調參數必須在 `internal/config` 有欄位、有預設值、有驗證、有文件（`11-DEPLOY-OPERATIONS.md` §1）。
- **禁止硬編碼魔數**。`const` 只用於協議規定的固定值（如 Jaeger 的微秒、Prometheus 的 `version: "2.53.0"`）。
- 新增設定項時必須同步更新：結構體、預設值、`--config-check` 驗證、`11` §1 的範例、`deploy/prismd.yaml`。

### 2.7 日誌

- 用 `log/slog`，結構化欄位見 `20-SELF-TELEMETRY-REGISTRY.md` §8。
- `msg` 為固定字串，變數放欄位。
- 熱路徑（每筆資料）不得記日誌，只能記指標。
- 高頻錯誤必須取樣（`20` §8.1）。

### 2.8 測試

| 類型 | 要求 |
|---|---|
| 單元 | 表格驅動；每個匯出函式的正常路徑 + 至少一個錯誤路徑 |
| golden | 協議映射（`15` §8）、序列化格式 |
| property | `LiteralHint` 抽取、標籤正規化的冪等性 |
| fuzz | 五個解析入口（`10` §6） |
| 併發 | 所有 `-race` |
| 洩漏 | `goleak` |

**測試不得依賴外部網路**。需要後端的測試用 `testcontainers` 或 `-short` 跳過，且 CI 明確跑非 short 模式。

### 2.9 依賴

允許的直接依賴白名單（新增需 PR 說明）：

| 用途 | 套件 |
|---|---|
| PromQL 與 label | `prometheus/prometheus`、`prometheus/common` |
| 指標 | `prometheus/client_golang` |
| 告警分發 | `prometheus/alertmanager` |
| OTLP | `go.opentelemetry.io/collector/pdata`、`opentelemetry-proto` |
| gRPC | `google.golang.org/grpc`、`protobuf` |
| HTTP 路由 | `go-chi/chi/v5` |
| ClickHouse | `ClickHouse/clickhouse-go/v2` |
| Postgres | `jackc/pgx/v5` |
| 遷移 | `golang-migrate/migrate/v4` |
| YAML | `goccy/go-yaml` 或 `gopkg.in/yaml.v3` |
| 壓縮 | `golang/snappy`、`klauspost/compress` |
| 主機指標 | `shirou/gopsutil/v4` |
| hash | `cespare/xxhash/v2` |
| 限流 | `golang.org/x/time/rate` |
| 測試 | `stretchr/testify`、`uber-go/goleak`、`testcontainers-go` |

**禁止清單**：任何 AGPL 專案（見 `AGENTS.md`）、任何未維護超過 2 年的套件、任何引入 cgo 的套件（agent 的 journald 除外，且必須有純 Go 回退）。

## 3. 文件規範

- SDD 文件用繁體中文，程式碼識別字、協議名、設定鍵用原文。
- 每個決策必須寫「為什麼」，不只寫「是什麼」。**沒有理由的規定會在半年後被人以為是隨意的而推翻。**
- 標示「必須 / 不得 / 應該 / 可以」時語義明確（RFC 2119 精神）：
  - **必須 / 不得**：違反即為 bug，CI 或 review 應攔截
  - **應該**：預設如此，偏離需在 PR 說明
  - **可以**：實作者自由決定
- 跨文件引用用 `` `NN-FILENAME.md` §X ``的格式，讓引用可被 grep 檢查。
- 程式碼區塊標明語言。
- 表格優於長段落列舉。

## 4. 版本與相容性

| 對象 | 相容性承諾 |
|---|---|
| `pkg/utm`、`pkg/spi` | 語意化版本。v1 後的 breaking change 需 major |
| 北向相容 API | 跟隨所模仿的上游協議；不主動 breaking |
| `/api/console/v1` | 加欄位不算 breaking；刪欄位或改語義需 v2 |
| `prism_*` 指標 | 視為公開契約；改名需經過一個版本的雙寫過渡 |
| webhook payload | 與 Alertmanager 對齊；`prism_*` 擴充欄位可增不可減 |
| 設定檔 | 舊欄位廢棄時保留一個版本並輸出 WARN |
| ClickHouse schema | 只允許 `ADD COLUMN`（帶預設）與 `ADD INDEX`；其他需 major |
| Agent ↔ Server | Server 必須支援前後各一個 minor 版本的 Agent |

最後一條特別重要：agent 部署在使用者的每一台主機上，**不可能與 server 同步升級**。所有 agent 協議變更必須是加法式的。

## 5. 專案改名程序

代號 `Prism` 只出現在四處（`README.md` 末段）。改名步驟：

1. `go.mod` 的 module path
2. `cmd/` 下的二進位名與 `Makefile`
3. 指標前綴 `prism_`（**這是 breaking change**，需依 §4 走雙寫過渡）
4. 環境變數前綴 `PRISM_`

若在 v1 發佈前改名，第 3、4 項無成本。發佈後改名的成本主要在第 3 項——使用者的儀表板與告警規則會失效。**因此名稱應在 Phase 0 定案。**
