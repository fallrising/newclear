# 12 — 實作階段與任務分解

每個 task 有 ID、依賴、允許修改路徑、驗收標準。實作 agent 一次只做一個 task，完成後必須自行執行驗收命令並回報實際輸出。

任務 ID 格式：`P<階段>-<序號>`。依賴以 ID 表示，無依賴者可並行。

---

## Phase 0 — 骨架與契約（不可跳過）

這一階段定義的型別會被後續所有模組使用。**寧可在此多花一週，也不要事後大改。**

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P0-01 | Repo 初始化：`go.mod`、`Makefile`、`.golangci.yml`、`.github/workflows/ci.yml`、`AGENTS.md`、目錄骨架 | — | 全域（僅新建） | `make lint test` 通過（空測試） |
| P0-02 | `pkg/utm`：全部型別 + `time.go` 轉換函式 + 單元測試。**逐字規格見 `14-SPI-GO-REFERENCE.md` §1–§3** | P0-01 | `pkg/utm/**` | 時間轉換與 `FormatPromValue` 的 table-driven 測試全綠；`go vet` 乾淨 |
| P0-03 | `pkg/spi`：`Driver`/`Backend`/三個 Store/`Capabilities`/IR/迭代器/錯誤。**逐字規格見 `14-SPI-GO-REFERENCE.md` §4–§9** | P0-02 | `pkg/spi/**` | 編譯通過；`Register`/`Open`/`Capabilities.Validate` 有測試 |
| P0-04 | `drivers/memory`：完整實作三種 Store（用 map + slice，不求效能） | P0-03 | `drivers/memory/**` | 自身單元測試通過 |
| P0-05 | `pkg/spi/conformance`：L1 測試套件全部測項（見 `10` §2、骨架見 `14` §10） | P0-03 | `pkg/spi/conformance/**` | 對 `memory` 驅動全綠；`Fixtures` 種子固定可重現 |
| P0-06 | 依賴方向 CI 檢查腳本（見 `10` §5.1） | P0-01 | `scripts/`、`.github/` | 故意加一個違規 import，CI 必須失敗 |
| P0-07 | `internal/config`：YAML + env 載入、驗證、`--config-check`（欄位見 `11` §1）+ `21` §5 的安全預設檢查 | P0-01 | `internal/config/**`、`cmd/prismd/**` | 對 `deploy/prismd.yaml` 與 10 個錯誤配置的行為符合預期；安全檢查表每項有測試 |
| P0-08 | `cmd/prismd` 骨架：flag 解析、驅動註冊、HTTP server、`/-/healthy`、`/metrics`、優雅關閉 | P0-04,P0-07 | `cmd/prismd/**`、`internal/server/**` | 啟動、`curl /-/healthy` 回 200、`SIGTERM` 30 秒內乾淨退出（`goleak`） |
| P0-09 | ADR-001..010 落地為 `docs/adr/*.md`（內容見 `13-ADR.md`），含 LogQL clean-room 簽署聲明 | — | `docs/adr/**` | 每篇有決策、理由、後果、替代方案；clean-room 聲明有簽署人與日期 |
| P0-10 | `internal/secret`：`secret.String` 型別 + 遮罩函式 + 全序列化路徑測試（`21` §T2） | P0-01 | `internal/secret/**` | `%v`/`%+v`/`%#v`/JSON/YAML 五種輸出皆不含明文 |
| P0-11 | `internal/telemetry`：自身指標註冊表（`20` §1–§7 的全部指標，先註冊後填值） | P0-01 | `internal/telemetry/**` | `/metrics` 輸出含全部已登記指標；基數預算表有測試 |

**Phase 0 出口條件**：`conformance.Run` 對 `memory` 驅動全綠；依賴方向檢查在 CI 中生效；`prismd` 能啟動與關閉。

---

## Phase 1 — 寫入與讀取閉環（目標：Grafana 能看到資料）

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P1-01 | `internal/ingest/normalize`：OTel → UTM 全部規則（`04` §4 + **`15-PROTOCOL-MAPPING.md` 全文**） | P0-02 | `internal/ingest/normalize/**` | 每條映射有測試；`15` §8 的 golden file 全部建立；delta→cumulative 有狀態機測試 |
| P1-02 | `internal/ingest/limits`：全部限制（`04` §5） | P0-02 | `internal/ingest/limits/**` | 每項限制有測試；HLL 估算誤差 < 3% |
| P1-03 | `internal/ingest/batcher` + pipeline + 背壓 | P1-01,P1-02 | `internal/ingest/**` | 佇列滿回 `ErrThrottled` 不阻塞；`-race` 乾淨 |
| P1-04 | `internal/compat/otlp`：gRPC + HTTP receiver（三訊號） | P1-03 | `internal/compat/otlp/**` | `telemetrygen` 三種訊號寫入 `memory` 成功 |
| P1-05 | `internal/compat/promapi/write.go`：remote_write 接收 | P1-03 | `internal/compat/promapi/**` | 真實 Prometheus remote_write 到 Prism 成功 |
| P1-06 | `internal/compat/lokiapi/push.go`：Loki push（JSON） | P1-03 | `internal/compat/lokiapi/**` | `promtail` / `vector` 推送成功 |
| P1-07 | `internal/query/promqladapter`：`spi` → `storage.Queryable` | P0-03 | `internal/query/promqladapter/**` | `memory` 驅動上 `promqltest` 全綠 |
| P1-08 | `internal/compat/promapi`：query/query_range/series/labels/label values/metadata/buildinfo | P1-07 | `internal/compat/promapi/**` | 回應信封與狀態碼符合 `02` §2；`promtool query` 可用 |
| P1-09 | `drivers/clickhouse`：schema 遷移 + 三種 Store 寫入（**規格見 `17-DRIVER-CLICKHOUSE.md` §1–§3、§10**） | P0-03 | `drivers/clickhouse/**` | 寫入路徑 conformance 測項綠；遷移冪等且 checksum 漂移會擋啟動 |
| P1-10 | `drivers/clickhouse`：查詢實作（**SQL 模板見 `17` §4–§7、錯誤映射見 §9**） | P1-09 | `drivers/clickhouse/**` | `conformance.Run` 全綠；`promqltest` 全綠；`C-MET-05`（空值匹配）特別驗證 |
| P1-11 | `deploy/` 全部產物（**逐字內容見 `22-DEPLOY-ARTIFACTS.md`**）：compose、ClickHouse 調校、Grafana provisioning、Dockerfile、Makefile | P1-08,P1-10 | `deploy/**`、`Makefile` | `docker compose up --wait` 成功；Grafana Prometheus datasource health 綠；`make deps-check` 通過 |

**Phase 1 出口條件**：E2E-01 與 E2E-02（僅 Prometheus datasource）通過；`conformance` 與 `promqltest` 在 `memory` + `clickhouse` 雙驅動全綠。

---

## Phase 2 — 日誌查詢與告警

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P2-01 | `internal/query/logql`：lexer + parser → `spi.LogQuery`（**EBNF 與錯誤訊息表見 `16-LOGQL-GRAMMAR.md` §1–§3.3**） | P0-03 | `internal/query/logql/**` | `16` §4 的測試矩陣全綠；不支援語法回「不支援」而非「語法錯誤」 |
| P2-02 | `internal/query/logql/compile.go`：正則預編譯 + `LiteralHint` 抽取（**演算法見 `16` §3.4**） | P2-01 | 同上 | `FuzzLiteralHint` 通過；8 個種子語料全綠 |
| P2-03 | `internal/query/logql/exec.go` + `agg.go`：串流補算與聚合（**執行順序見 `16` §3.5–§3.7**） | P2-02 | 同上 | 16 種 `PushdownPlan` 組合結果一致；100 萬行 + limit=100 的讀取量斷言通過 |
| P2-04 | `internal/compat/lokiapi`：query_range/query/labels/label values/series/index stats/ready | P2-03 | `internal/compat/lokiapi/**` | Grafana Loki datasource health 綠；Explore 可查與自動完成 |
| P2-05 | `drivers/clickhouse`：`NativeLogQuerier`（**翻譯規則見 `17` §6**） | P2-01,P1-10 | `drivers/clickhouse/**` | `C-LOG-03`/`C-LOG-04`/`C-LOG-05` 綠；logfmt 正確回 `ErrUnsupported` 觸發回退 |
| P2-06 | `internal/alerting/rules`：規則檔解析（Prometheus 格式 + `prism_` 擴充）、熱重載 | P0-07 | `internal/alerting/rules/**` | 真實 rule 檔載入；`promtool check rules` 相容性實測並記入 ADR |
| P2-07 | `internal/alerting/eval` + `state`：評估器、狀態機、`ALERTS` 回寫、Postgres 狀態持久化 | P2-06,P1-08 | `internal/alerting/{eval,state}/**` | A4/A5 驗收通過 |
| P2-08 | `internal/alerting/{silence,inhibit,dispatch}`：靜默、抑制、分組 | P2-07 | 對應路徑 | A7 通過；抑制環在載入時被拒絕 |
| P2-09 | `internal/alerting/notify`：Notifier SPI + 六個渠道（**webhook payload 契約見 `20` §9**） | P2-08,P0-10 | `internal/alerting/notify/**` | 每渠道有測試；payload 與 Alertmanager 逐欄位比對；憑證遮罩測試通過 |
| P2-10 | 通知投遞持久化 + 重試 + dead letter（`07` §6.2） | P2-09 | `internal/alerting/notify/**`、`internal/controlplane/store/**` | A6 通過 |
| P2-11 | `internal/compat/amapi`：Alertmanager API v2 子集 | P2-08 | `internal/compat/amapi/**` | A3（`amtool`）通過；Grafana Alertmanager datasource 綠 |
| P2-12 | 內建規則與 watchdog（`07` §7, §8） | P2-06 | `internal/alerting/builtin/**`、`deploy/**` | 內建告警可觸發；watchdog 範例可用 |

**Phase 2 出口條件**：E2E-04、E2E-05 通過；`07-ALERTING.md` §9 全部驗收項通過。

---

## Phase 3 — APM 與可換底層證明

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P3-01 | `internal/query/tracequery`：`TraceQuery` 執行、trace 組裝、併發控制 | P1-10 | `internal/query/tracequery/**` | L1 追蹤測項綠 |
| P3-02 | `internal/compat/jaegerapi`：全部端點 + OTel→Jaeger 語義映射 + 單位轉換 | P3-01 | `internal/compat/jaegerapi/**` | Grafana Jaeger datasource 綠；瀑布圖正確 |
| P3-03 | `drivers/clickhouse`：`trace_index`、RED 物化視圖、`SpanAggregator`、`DependencyQuerier` | P1-09 | `drivers/clickhouse/**` | `C-TRC-07`/`C-TRC-08` 綠 |
| P3-04 | `internal/apm`：服務列表、RED 查詢、慢請求 top-N、依賴圖（含無 `SpanAggregator` 時的回退） | P3-03 | `internal/apm/**` | 回退路徑與下推路徑結果一致（差分測試） |
| P3-05 | trace ↔ log 關聯：Grafana derived fields provisioning + `trace_id` 查詢優化 | P3-02,P2-04 | `deploy/grafana/**`、對應 driver | E2E-06 的跳轉步驟通過 |
| P3-06 | **`drivers/vmvl`**（**完整規格見 `18-DRIVER-VMVL.md`**） | P0-03 | `drivers/vmvl/**` | `conformance.Run` 全綠；`promqltest` 全綠；`Select` 走 `/api/v1/export` 而非 `query_range`（`18` §3.3） |
| P3-07 | `internal/query/router`：下推決策 + `force_fallback` 開關 + 資源保護（`06` §5） | P3-06 | `internal/query/**` | Q3 差分測試 200 條查詢通過 |
| P3-08 | L3 差分測試套件 + 查詢語料 | P3-07 | `test/differential/**` | 三驅動全綠 |
| P3-09 | Grafana 儀表板 1860 相容性修補（缺什麼 PromQL 功能補什麼） | P3-07 | 對應路徑 | C11 通過 |
| P3-10 | **E2E-07：驅動切換測試** | P3-06,P3-08 | `test/e2e/**` | 同一套斷言在 clickhouse 與 vmvl 上都通過 |

**Phase 3 出口條件**：E2E-07 通過。**這是整個專案核心主張的驗證點；未通過不得進入 Phase 4。**

---

## Phase 4 — Agent

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P4-01 | `internal/agent/wal`：段檔、CRC、fsync 策略、容量與磁碟保護、回放 | P0-02 | `internal/agent/wal/**` | G4/G5 通過；kill -9 注入測試 |
| P4-02 | `internal/agent/input/hostmetrics`：node_exporter 相容指標 | P0-02 | 對應路徑 | 指標名與 node_exporter 逐一比對通過 |
| P4-03 | `internal/agent/input/filelog`：tail、offset、輪替、glob、多行 | P0-02 | 對應路徑 | G3 通過；logrotate 注入測試 |
| P4-04 | `internal/agent/input/{journald,docker}` | P4-03 | 對應路徑 | 各自整合測試 |
| P4-05 | `internal/agent/process`：標籤注入、遮罩、取樣 | P4-03 | 對應路徑 | 遮罩規則測試；預設樣式覆蓋測試 |
| P4-06 | `internal/agent/output` + `cmd/prism-agent`：OTLP export、重試、資源限制 | P4-01..05 | 對應路徑 | G1/G2/G6 通過 |
| P4-07 | `deploy/systemd/prism-agent.service` + 安裝腳本 | P4-06 | `deploy/**` | 乾淨 Debian 12 安裝成功；加固選項生效 |
| P4-08 | 第三方採集器設定與 CI 實測（`08` §9） | P1-04..06 | `docs/collectors/**`、`test/e2e/**` | G7 通過 |
| P4-09 | Loki `/tail` WebSocket（`LogTailer`） | P2-04 | 對應路徑 | Grafana Live tail 可用 |

---

## Phase 5 — 控制平面與多租戶

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P5-01 | Postgres schema 遷移（`09` §2） | P0-07 | `internal/controlplane/migrations/**` | up/down 皆可執行且冪等 |
| P5-02 | `internal/controlplane/store`：全部 CRUD，簽章強制帶 tenant | P5-01 | `internal/controlplane/store/**` | 靜態檢查：無不帶 tenant 的查詢 |
| P5-03 | `authn`：密碼、JWT、API key、快取與失效 | P5-02 | 對應路徑 | P1 通過；SEC-04 通過 |
| P5-04 | `authz`：RBAC middleware | P5-03 | 對應路徑 | 權限矩陣 table-driven 測試 |
| P5-05 | `tenancy` + `WithTenantGuard` | P5-04 | `internal/controlplane/tenancy/**`、`internal/storage/wrap/**` | SEC-01/02/03 通過 |
| P5-06 | 控制平面 REST API 全部端點（**完整 schema 見 `19-CONSOLE-API-REFERENCE.md`**） | P5-04 | `internal/controlplane/api/**`、`api/openapi/**` | `19` §11 的三項一致性檢查通過 |
| P5-07 | `POST /rules/preview` | P5-06,P2-07 | 對應路徑 | P4 通過 |
| P5-08 | Agent 註冊/心跳/配置下發 + `merge` 模式安全限制 | P5-06,P4-06 | `internal/agentproto/**` | SEC-07 通過 |
| P5-09 | 審計日誌 | P5-06 | 對應路徑 | P3 通過 |
| P5-10 | Console UI（`09` §6 的 10 個頁面） | P5-06 | `web/**` | 每頁可用；embed 進 binary |
| P5-11 | `cmd/prismctl`：規則、靜默、agent、狀態查詢 | P5-06 | `cmd/prismctl/**` | 每個子命令有測試 |
| P5-12 | 磁碟水位熔斷（`11` §5） | P1-10 | `internal/storage/**` | SOAK-03 通過 |
| P5-13 | Runbooks（`11` §10 的 8 篇） | 全部 | `docs/runbooks/**` | `driver-switch.md` 被實際照做驗證一次 |

---

### Phase 5 追加

| ID | 任務 | 依賴 | 允許路徑 | 驗收 |
|---|---|---|---|---|
| P5-14 | 安全測試套件（`10` §6 的 `SEC-01`–`SEC-08` + 五個 fuzz 目標） | P5-05 | `test/security/**` | 全綠；fuzz 各跑 5 分鐘無 crash |
| P5-15 | 威脅模型的剩餘對策：`PrismBroadSilenceCreated`、watchdog 不可靜默、refresh token 重用偵測（`21` §T9、§T11） | P5-03,P2-08 | 對應路徑 | 各有針對性測試 |
| P5-16 | `docs/runbooks/security-incident.md`（`21` §6 的五個情境） | P5-14 | `docs/runbooks/**` | 每項有可執行命令 |

---

## Phase 6 — 加固與擴充（v1 之後）

依價值排序，不預先承諾：

1. 查詢結果快取（`06` §6）
2. `storage.split`：不同 signal 走不同驅動
3. 原生直方圖與 exemplar 端到端支援
4. 指標降採樣
5. Elasticsearch `_bulk` / `_search` 相容
6. remote_write v2
7. 分角色部署（`--mode` 實際拆分 + Kafka/NATS 緩衝）
8. 自有 Console 的儀表板（Perses 元件）
9. Profiling / RUM

---

## 進度追蹤

每個 task 完成時，實作 agent 必須輸出：

```
Task: P1-08
Files changed: internal/compat/promapi/{query.go,series.go,labels.go}, +tests
Commands run:
  $ go test ./internal/compat/promapi/... -race   → ok (0 failures)
  $ go test ./test/promqltest -driver=memory      → ok (742 cases)
  $ promtool query instant http://localhost:9090/prom 'up'  → 2 results
Acceptance: 02-COMPATIBILITY-CONTRACT.md §2.2 全部必做端點已實作，§2.1 信封與狀態碼對映有測試覆蓋
Not done: query_exemplars（標記 Phase 3）
Risks: buildinfo 版本號硬編為 2.53.0，見 ADR-005
```

**不得宣稱未實際執行過的驗證。** 命令與輸出必須是真的。
