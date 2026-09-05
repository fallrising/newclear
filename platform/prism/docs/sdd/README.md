# Prism — 可換底層的可觀測性平台 SDD Document Pack

狀態：Draft v0.2 · 2026-09-05 · 24 份文件

## 這是什麼

一份 implementation-ready 的 SDD，用來讓 coding agent 依序實作一個自建 APM / 日誌 / 監控 / 告警平台。

核心設計主張：**平台本體是一層「相容中間層」，不是一個存儲系統。**

就像 MySQL wire protocol 讓無數引擎可以被同一批客戶端使用、Redis 協議變成 cache 的事實標準、Hive 用 SQL 方言接管數倉一樣，可觀測性領域已經存在事實標準協議：

| 面向 | 事實標準 | 類比 |
|---|---|---|
| 寫入 | OTLP | MySQL wire protocol |
| 指標查詢 | PromQL + Prometheus HTTP API v1 | SQL 方言 |
| 日誌查詢 | LogQL / Loki HTTP API | SQL 方言 |
| 追蹤查詢 | Jaeger Query API | SQL 方言 |
| 告警分發 | Alertmanager API v2 + Prometheus rule YAML | — |

Prism 對外**只說這些標準協議**，對內用一套 SPI（Storage Provider Interface）驅動任意開源後端。
底層可以是 ClickHouse、VictoriaMetrics + VictoriaLogs，甚至記憶體。
換底層 = 換一個 driver，不改一行業務邏輯、不換 Grafana、不改客戶端 SDK、不改告警規則。

## 文件地圖

### 第一部分：設計主張（先讀這四份，決定要不要做）

| # | 文件 | 內容 |
|---|---|---|
| 00 | `00-SDD-OVERVIEW.md` | 願景、範圍、原則、開源選型與**授權分析** |
| 01 | `01-ARCHITECTURE.md` | 四層架構、依賴規則、程序拓撲、路由總表、Go 模組樹 |
| 02 | `02-COMPATIBILITY-CONTRACT.md` | ★ 北向與南向協議契約（對外唯一公開介面） |
| 03 | `03-STORAGE-SPI.md` | ★ 存儲驅動介面、能力協商、部分下推規則 |

### 第二部分：核心契約（實作前必須全部讀完）

| # | 文件 | 內容 |
|---|---|---|
| 04 | `04-DATA-MODEL.md` | UTM 模型、時間單位、正規化、基數治理、參考 DDL |
| 14 | `14-SPI-GO-REFERENCE.md` | ★ `pkg/utm` 與 `pkg/spi` 的**逐字 Go 規格** |
| 15 | `15-PROTOCOL-MAPPING.md` | OTLP / remote_write / Loki push 的**逐欄位映射** |
| 23 | `23-GLOSSARY-CONVENTIONS.md` | 術語表、Go 編碼規範、依賴白名單、版本相容承諾 |

### 第三部分：模組規格（做到哪個模組讀哪份）

| # | 文件 | 內容 |
|---|---|---|
| 05 | `05-INGEST-PIPELINE.md` | 寫入鏈路、背壓、丟棄優先序 |
| 06 | `06-QUERY-ENGINE.md` | 下推決策、PromQL 回退、資源保護 |
| 16 | `16-LOGQL-GRAMMAR.md` | ★ LogQL 子集的 EBNF、parser 規格、錯誤訊息表 |
| 07 | `07-ALERTING.md` | 規則、狀態機、分組抑制靜默、通知與投遞可靠性 |
| 08 | `08-AGENT-AND-COLLECTORS.md` | 節點 Agent、WAL、第三方採集器契約 |
| 09 | `09-CONTROL-PLANE.md` | 控制平面職責、Postgres schema、RBAC、多租戶 |
| 19 | `19-CONSOLE-API-REFERENCE.md` | 控制平面 API 的完整 request/response schema |

### 第四部分：驅動實作（兩個參考驅動的完整規格）

| # | 文件 | 內容 |
|---|---|---|
| 17 | `17-DRIVER-CLICKHOUSE.md` | 每個 SPI 方法的 SQL、錯誤映射、遷移、已知限制 |
| 18 | `18-DRIVER-VMVL.md` | IR→LogSQL 翻譯、PromQL 下推、能力差異對照表 |

### 第五部分：品質與運維

| # | 文件 | 內容 |
|---|---|---|
| 10 | `10-CONFORMANCE-TESTING.md` | ★ 六層測試、驅動一致性套件、差分測試、CI 矩陣 |
| 20 | `20-SELF-TELEMETRY-REGISTRY.md` | 自身指標登記表、日誌欄位、webhook payload 契約 |
| 21 | `21-SECURITY-THREAT-MODEL.md` | 威脅模型 T1–T11、安全預設檢查表、事件回應 |
| 11 | `11-DEPLOY-OPERATIONS.md` | 配置檔、部署形態、資源預算、磁碟熔斷、備份 |
| 22 | `22-DEPLOY-ARTIFACTS.md` | ★ 完整的 compose / systemd / Grafana provisioning / Makefile |

### 第六部分：執行

| # | 文件 | 內容 |
|---|---|---|
| 12 | `12-IMPLEMENTATION-PHASES.md` | ★ Phase 0–6 的任務分解、依賴序、允許路徑、驗收標準 |
| 13 | `13-ADR.md` | ADR-001–010：每個關鍵決策的理由、後果、替代方案 |
| — | `AGENTS.md` | 實作 agent 必須遵守的架構、授權、工程、安全紀律 |

## 給實作 agent 的第一段話

1. 先讀 `AGENTS.md`，再讀第一部分四份、第二部分四份。共八份，是進入實作的最低門檻。
2. 從 `12-IMPLEMENTATION-PHASES.md` 的 **P0-01** 開始，一次一個 task。
3. **不要跳過 Phase 0 的 `pkg/utm` 與 `pkg/spi`**（P0-02、P0-03）——所有後續模組都依賴它們的型別定義，先定錯會全盤重來。`14-SPI-GO-REFERENCE.md` 是這兩個套件的逐字規格，照著建立即可。
4. 每個 task 完成後依 `12` 末尾的格式回報，**不得宣稱未實際執行過的驗證**。

## 三個貫穿全文的核心機制

1. **能力協商**（`03` §2）：驅動宣告自己支援什麼，中間層據此決定下推或回退。宣告了就必須真的支援，由一致性測試強制。
2. **部分下推 + 補算**（`03` §4.2、`06` §3.5）：驅動處理它能做的，中間層補齊其餘。這是「弱後端也不缺功能」的實現方式，也是最容易寫出「日誌少了」這類 bug 的地方——`C-LOG-04` 專測此點。
3. **差分測試**（`10` §4）：`force_fallback` 開關讓同一查詢走兩條路徑，結果必須逐點相同。這是「下推優化沒有改變語義」的唯一保證。

## 專案代號與命名

代號 `Prism`（分光稜鏡：一束統一遙測進來，分到不同後端）。

- Go module：`github.com/OWNER/prism`（`OWNER` 在 Phase 0 決定，寫進 `go.mod` 後不再更動）
- 二進位：`prismd`、`prism-agent`、`prismctl`
- 指標前綴：`prism_` · 環境變數前綴：`PRISM_`

改名程序見 `23-GLOSSARY-CONVENTIONS.md` §5。**名稱應在 Phase 0 定案**——發佈後改指標前綴是 breaking change。
