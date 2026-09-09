# 10 — 一致性測試

「底層可隨意切換」如果沒有測試強制，三個月後就是謊言。這份文件定義的測試套件是該承諾的**唯一執行機制**，優先級等同功能開發，不可推遲。

## 1. 測試層級

| 層級 | 位置 | 對象 | 何時跑 |
|---|---|---|---|
| L1 驅動一致性 | `pkg/spi/conformance` | 每個驅動 | 每次 PR，全驅動矩陣 |
| L2 PromQL 正確性 | `test/promqltest` | 每個驅動 | 每次 PR |
| L3 下推 vs 回退差分 | `test/differential` | 支援下推的驅動 | 每次 PR |
| L4 協議相容性 | `test/compat` | 北向 API | 每次 PR |
| L5 端到端 | `test/e2e` | 完整棧 + Grafana | 每次 merge to main |
| L6 混沌 / 負載 | `test/soak` | 完整棧 | 每夜 |

## 2. L1：驅動一致性套件

**這是本專案最重要的單一資產。** 它是一個可被任何第三方驅動引用的公開測試套件。

```go
package conformance

type Factory func(t *testing.T) (spi.Backend, func())

type Options struct {
    // 允許驅動宣告已知的合理偏差，每一項都必須附理由字串。
    // 空理由或未在白名單內的偏差 → 測試失敗。
    KnownDeviations map[string]string
    // 寫入後到可讀取的最大延遲（如 ClickHouse async_insert）
    WriteVisibilityDelay time.Duration
}

// Run 執行全部測項。驅動作者只需寫：
//   func TestConformance(t *testing.T) { conformance.Run(t, newBackend, conformance.Options{}) }
func Run(t *testing.T, f Factory, opts Options)
```

### 2.1 通用測項

| ID | 測項 |
|---|---|
| `C-GEN-01` | `Migrate()` 可重複執行且冪等 |
| `C-GEN-02` | `Ping()` 在後端可用時回 nil |
| `C-GEN-03` | `Close()` 後所有操作回 `ErrUnavailable`，不 panic |
| `C-GEN-04` | 不支援的 signal，對應 `Xxx()` 回 nil 且 `Capabilities.Signals` 不含它 |
| `C-GEN-05` | **能力誠實性**：每個宣告 `true` 的可選能力，對應介面確實被實作（型別斷言成功） |
| `C-GEN-06` | **能力誠實性反向**：宣告 `false` 的可選介面未被實作 |
| `C-GEN-07` | `context` 取消後 1 秒內所有操作返回，無 goroutine 洩漏（`goleak`） |
| `C-GEN-08` | 所有錯誤可被 `spi.Classify` 分類，且分類合理（連線失敗 → `ErrUnavailable`） |
| `C-GEN-09` | 併發 100 goroutine 混合讀寫，無 data race（`-race`） |

### 2.2 指標測項

| ID | 測項 |
|---|---|
| `C-MET-01` | 寫入 → `Select` 讀回，labels 與樣本值逐一相符 |
| `C-MET-02` | `SeriesSet` 依 labels 字典序遞增 |
| `C-MET-03` | 每個 Series 的樣本依時間嚴格遞增，無重複時間戳 |
| `C-MET-04` | 時間範圍邊界為**閉區間**：`Start` 與 `End` 上的點都必須回傳 |
| `C-MET-05` | 四種 Matcher（`=`、`!=`、`=~`、`!~`）語義正確，含空值匹配（`foo=""` 匹配不存在該標籤的序列） |
| `C-MET-06` | `LabelNames` / `LabelValues` 尊重 matchers 與時間範圍 |
| `C-MET-07` | 相同 `(fingerprint, ts)` 重複寫入，讀回單一值（去重或後寫覆蓋） |
| `C-MET-08` | 亂序寫入在 `OutOfOrderWindow` 內被接受並正確排序；窗口外的行為與宣告一致 |
| `C-MET-09` | 特殊值 `NaN`、`+Inf`、`-Inf` 寫入讀出保真 |
| `C-MET-10` | 空結果集回空 `SeriesSet` 而非 nil 或錯誤 |
| `C-MET-11` | 高基數：10_000 個序列寫入後 `Select` 可正確分頁讀完 |
| `C-MET-12` | `NativePromQL=true` 時，`QueryRange` 對基準查詢集的結果與回退路徑逐點相同 |

### 2.3 日誌測項

| ID | 測項 |
|---|---|
| `C-LOG-01` | 寫入 → `Search` 讀回，`Body`、`TS`、`Labels`、`Attrs`、`TraceID` 全部保真 |
| `C-LOG-02` | `Direction: Backward` 回傳新→舊；`Forward` 回傳舊→新 |
| `C-LOG-03` | **下推誠實性**：對每個宣告可下推的過濾類型，構造「若未下推則結果不同」的資料，驗證結果正確 |
| `C-LOG-04` | **未下推不得漏資料**：對驅動宣告**不**支援的過濾，`Search` 回傳的必須是超集（中間層才能補算正確） |
| `C-LOG-05` | `Limit` 語義：只有全部過濾都下推時才截斷；否則回傳未截斷結果或 `ErrTooLarge` |
| `C-LOG-06` | 超長日誌行（1 MiB）寫入讀出保真或依限制正確截斷 |
| `C-LOG-07` | UTF-8 與非 UTF-8 位元組序列不損毀 |
| `C-LOG-08` | 同一奈秒時間戳的多筆日誌全部回傳，順序穩定（次序鍵為寫入序） |
| `C-LOG-09` | `LabelValues` 只回傳該時間範圍內存在的值 |

`C-LOG-04` 是最關鍵的一項：它把「部分下推」這個最容易寫錯的機制變成可自動驗證的契約。

### 2.4 追蹤測項

| ID | 測項 |
|---|---|
| `C-TRC-01` | 寫入 span → `GetTrace` 回傳完整 trace，含 events、links、attrs |
| `C-TRC-02` | `FindTraceIDs` 對 service / operation / duration / tag 過濾正確 |
| `C-TRC-03` | `FindTraceIDs` 的 `Limit` 是 **trace 數**而非 span 數 |
| `C-TRC-04` | 跨服務 trace（3 個服務、10 個 span）完整組裝，parent 關係正確 |
| `C-TRC-05` | 遲到 span（trace 已寫入 10 分鐘後補一個 span）能被 `GetTrace` 讀到 |
| `C-TRC-06` | `Services` / `Operations` 尊重時間範圍 |
| `C-TRC-07` | `RED=true` 時，`ServiceRED` 的 requests/errors 與掃描 span 現算的結果一致（分位數允許 ±1% 誤差） |
| `C-TRC-08` | `Dependencies=true` 時，依賴邊與預期拓撲一致 |

### 2.5 偏差白名單

允許的 `KnownDeviations` key 僅限以下，其他一律視為 bug：

| key | 允許理由範例 |
|---|---|
| `C-MET-08` | 「後端不接受亂序，已宣告 `OutOfOrderWindow: 0`」 |
| `C-LOG-08` | 「後端不保證同奈秒順序穩定」 |
| `C-TRC-05` | 「後端 trace 索引為不可變段，遲到 span 需等下次合併」 |

白名單必須寫在 `drivers/<name>/conformance_test.go` 內且理由具體。CI 檢查白名單條目數 ≤ 3；超過表示驅動設計有問題，需要 ADR 討論。

## 3. L2：PromQL 正確性

直接使用 Prometheus 上游的官方測試資料（Apache-2.0）：

```go
// test/promqltest/run_test.go
func TestPromQLAgainstDriver(t *testing.T) {
    for _, driver := range drivers() {
        t.Run(driver, func(t *testing.T) {
            st := newPrismStorage(t, driver)   // 實作 promqltest 需要的 storage 介面
            promqltest.RunBuiltinTests(t, st)  // 或 RunTest 逐檔跑 testdata/*.test
        })
    }
}
```

需要一個 `promqltest.LazyLoader` 相容的 adapter，把 `load` 指令的樣本寫入驅動、`eval` 指令走 Prism 的查詢路徑。

**這一項一旦通過，PromQL 相容性就不再是需要人工判斷的事。**

## 4. L3：下推 vs 回退差分測試

```go
// test/differential/diff_test.go
func TestPushdownEqualsFallback(t *testing.T) {
    for _, q := range queryCorpus {          // ≥ 200 條真實查詢
        got  := run(t, driver, q, query.Options{ForceFallback: false})
        want := run(t, driver, q, query.Options{ForceFallback: true})
        assertEqual(t, want, got, 1e-9)      // 逐序列、逐點比對
    }
}
```

查詢語料 `test/differential/corpus/`：

- `metrics.txt`：從 Node Exporter Full 儀表板（Grafana 1860）抽出的全部 PromQL，加上常見告警規則的表達式。
- `logs.txt`：涵蓋 `02` §3.3 每一條語法的組合。
- `traces.json`：涵蓋每種過濾組合。

語料以檔案形式維護，任何 bug 修復都必須先在語料中加入觸發該 bug 的查詢（回歸保護）。

## 5. L4/L5：協議與端到端

### 5.1 依賴方向檢查（CI 必跑）

```bash
# 禁止 pkg 依賴 internal 或 drivers
go list -deps ./pkg/... | grep -E '/(internal|drivers)/' && exit 1
# 禁止 drivers 依賴 internal 或彼此
go list -deps ./drivers/... | grep -E '/internal/' && exit 1
# 禁止 compat 直接依賴 drivers
go list -deps ./internal/compat/... | grep -E '/drivers/' && exit 1
# 禁止 import AGPL 專案
go list -deps ./... | grep -E 'grafana/(loki|tempo|grafana)' && exit 1
```

最後一條是授權護欄，必須存在。

### 5.2 端到端場景（docker-compose，`test/e2e`）

| ID | 場景 |
|---|---|
| `E2E-01` | 起棧 → `telemetrygen` 灌三種訊號 → 各相容 API 查得到 |
| `E2E-02` | Grafana 自動 provision 四個 datasource，全部 health check 通過（透過 Grafana HTTP API 驗證） |
| `E2E-03` | 匯入 Grafana 儀表板 1860，透過 Grafana `/api/ds/query` 驗證主要面板回傳非空資料 |
| `E2E-04` | 觸發告警 → webhook 接收端（測試用 HTTP server）收到符合 Alertmanager 格式的 payload |
| `E2E-05` | `amtool` 建立靜默 → 告警被抑制 → 靜默過期 → 恢復通知 |
| `E2E-06` | OTel SDK 示範服務 → 服務列表 / RED / trace 瀑布 / trace→log 跳轉 |
| `E2E-07` | **切換驅動**：同一份測試資料與同一組斷言，在 `clickhouse` 與 `vmvl` 上分別跑一次，結果一致 |
| `E2E-08` | `prismd` 重啟後告警 `for` 計時不重置 |
| `E2E-09` | 後端停機 5 分鐘 → agent WAL 緩衝 → 恢復後資料完整 |

`E2E-07` 是整個 SDD 的最終驗收：**它直接測的就是「底層可換」這個核心主張。**

## 6. 安全測試

| ID | 測項 |
|---|---|
| `SEC-01` | 租戶 A 的憑證無法讀寫租戶 B 的資料（遍歷所有相容 API 與控制平面端點） |
| `SEC-02` | 使用者傳入的 matcher 無法覆寫 `__tenant__` 標籤 |
| `SEC-03` | LogQL / PromQL 注入嘗試（如 `{job="a"} \| json \| __tenant__="b"`）被拒絕 |
| `SEC-04` | 撤銷的 API key 在快取 TTL 內失效 |
| `SEC-05` | 回應與日誌中不出現 API key、密碼、webhook URL 中的 token |
| `SEC-06` | `/api/v2/status` 的 `config.original` 已遮罩憑證 |
| `SEC-07` | Agent 的 `merge` 配置模式下，遠端配置無法變更 `output.endpoint` |
| `SEC-08` | 超大 / malformed payload 不造成 panic 或記憶體爆炸（fuzz） |

Fuzz 目標（`go test -fuzz`）：OTLP 解碼、remote_write 解碼、Loki push 解碼、LogQL parser、規則 YAML 解析。這五個都是直接處理不可信輸入的地方。

## 7. 負載與混沌（L6，每夜）

| ID | 場景 | 通過標準 |
|---|---|---|
| `SOAK-01` | 24 小時持續 10k points/s + 5 MB/s 日誌 | 無 OOM、無 goroutine 洩漏、P99 查詢延遲不劣化超過 20% |
| `SOAK-02` | 後端隨機斷線（每 10 分鐘斷 30 秒） | 無資料遺失（agent WAL 內）、無 panic |
| `SOAK-03` | 磁碟填滿至 95% | 熔斷生效，服務不崩潰，恢復空間後自動恢復 |
| `SOAK-04` | 注入 100k 基數的標籤 | 基數保護生效，記憶體上限內 |
| `SOAK-05` | 1000 條規則同時評估 | 評估延遲 < interval，後端不過載 |

## 8. CI 矩陣

```yaml
# .github/workflows/ci.yml 的核心矩陣
strategy:
  matrix:
    driver: [memory, clickhouse, vmvl]
    include:
      - driver: clickhouse
        services: [clickhouse]
      - driver: vmvl
        services: [victoriametrics, victorialogs]
```

每個 PR 必跑：`lint` → `依賴方向檢查` → `unit` → `L1 conformance × 3 driver` → `L2 promqltest × 3` → `L3 differential` → `L4 compat`。
merge 到 main 追加 `L5 e2e`。每夜追加 `L6 soak` 與 `fuzz`（30 分鐘）。

**PR 不得在 L1/L2/L3 有任何驅動失敗的情況下合併。** 這一條是架構承諾的最後防線。
