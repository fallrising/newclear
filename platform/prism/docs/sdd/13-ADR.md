# 13 — 架構決策記錄（ADR）

格式：決策 / 背景 / 理由 / 後果 / 替代方案 / 狀態。

實作過程中若要偏離任一 ADR，必須先新增一篇取代它的 ADR，不得直接改碼。

---

## ADR-001：以既有事實標準協議作為唯一對外契約

**狀態**：Accepted

**決策**：Prism 對外只提供 OTLP（寫）與 Prometheus / Loki / Jaeger / Alertmanager API（讀與告警），不設計任何 Prism 專屬的遙測協議或查詢語言。

**背景**：自建可觀測性平台的最大隱性成本不是存儲，而是生態——SDK、儀表板、告警規則、採集器、團隊既有知識。

**理由**：
- 協議本身不受著作權保護，相容是合法且常見的策略（MySQL 協議、S3 API、Redis 協議都有大量第三方實作）。
- Grafana 直接可用，省掉整個前端可視化的開發。
- 使用者的遷移成本與被鎖定的恐懼同時降到接近零，這是自建平台被採用的前提。
- 反向也成立：Prism 若失敗，使用者換回 Prometheus + Loki 也幾乎零成本。這種「可逆性」本身就是產品優勢。

**後果**：
- 必須忍受這些協議的歷史包袱（三套不同時間單位、Prometheus 值用字串、Jaeger 用微秒）。
- 新功能若無對應標準協議，只能放進控制平面 API，可能造成能力割裂。
- 必須向 Grafana 謊報 Prometheus 版本號（見 ADR-005）。

**替代方案**：設計自有 gRPC API + 自有前端。已否決——工作量高一個數量級，且沒有生態。

---

## ADR-002：存儲以 `database/sql/driver` 模式抽象

**狀態**：Accepted

**決策**：`pkg/spi` 提供極小的必選介面（Tier-1 原語）+ 型別斷言取得的可選介面（Tier-2 下推）+ 顯式的 `Capabilities` 宣告。

**背景**：需要在不改業務碼的前提下切換底層存儲，而候選後端（ClickHouse、VictoriaMetrics、VictoriaLogs）能力差異極大。

**理由**：
- 「最小公分母」介面會讓強後端的能力浪費；「最大公約數」介面會讓弱後端無法實作。可選介面同時解決兩者。
- Go 標準庫用同一模式支撐了從 SQLite 到分散式資料庫的全部差異，模式已被驗證。
- 顯式能力宣告讓路由決策是查表而非猜測，也讓使用者能在 `/status` 看到自己的後端能做什麼。

**後果**：
- 必須有「回退引擎」補齊弱後端缺的能力，這是額外工作量。
- 必須有一致性測試強制能力宣告的誠實性，否則宣告會腐化。
- 下推與回退兩條路徑必須產生相同結果，需要差分測試。

**替代方案**：只支援一個後端（ClickHouse）。已否決——ClickHouse 存指標的效能明顯不如專用 TSDB，鎖死單一後端會在指標量增長時無路可走。

---

## ADR-003：指標查詢用字串下推 + 上游 PromQL 引擎回退；日誌與追蹤用結構化 IR

**狀態**：Accepted

**決策**：PromQL 以原始字串形式下推給支援的後端；不支援時用 `prometheus/promql` 引擎在本地執行。LogQL 與 Jaeger 查詢先解析成 `spi.LogQuery` / `spi.TraceQuery` 結構化 IR，再由驅動翻譯。

**理由**：
- PromQL 語法龐大（子查詢、`@` 修飾符、offset、二元運算的向量匹配規則），建 IR 的成本極高且容易語義錯誤；但它有一個 Apache-2.0 的成熟引擎可直接複用，只需提供 `storage.Queryable`。
- LogQL 的 v1 子集與 Jaeger 查詢都是線性、簡單的結構，建 IR 成本低；而 Loki 引擎是 AGPL，本來就不可複用。
- 字串下推要求後端支援同一方言（VictoriaMetrics 支援 PromQL，ClickHouse 不支援），IR 下推則對任何後端都可翻譯。兩種機制各用在合適的地方。

**後果**：
- 兩套不同的下推機制，程式碼不對稱，需要文件說明。
- LogQL 子集有限，使用者從 Loki 遷來可能遇到不支援的語法，必須有清楚的錯誤訊息。
- PromQL 回退路徑的效能取決於 `Select` 的效率，弱後端上會慢，需要更嚴格的資源保護（`06` §5.3）。

---

## ADR-004：LogQL 引擎採 clean-room 自行實作

**狀態**：Accepted

**決策**：不 import `grafana/loki` 的任何套件。LogQL 子集的 lexer/parser/executor 依據 Grafana 公開的 LogQL 語法文件與實測 HTTP 回應格式撰寫。

**背景**：Loki 是 AGPL-3.0。若 Prism 未來以 SaaS 形式提供，AGPL 的網路 copyleft 會要求開源整個服務。

**理由**：協議與 API 形狀不受著作權保護；具體實作受保護。提供 Loki 相容 API 合法，抄其實作不合法（且會傳染授權）。

**後果**：
- 實作者必須簽署一份 clean-room 聲明，記錄於 `docs/adr/ADR-004-cleanroom-declaration.md`，載明未閱讀 Loki 原始碼。
- CI 必須有 import 護欄（`10` §5.1 的最後一條）。
- 語法覆蓋度會落後 Loki，需在文件明確列出支援子集。

**替代方案**：直接 import Loki 並接受 AGPL。已否決——會讓商業化選項在第一天就關閉。

---

## ADR-005：向 Grafana 宣告相容的 Prometheus 版本號

**狀態**：Accepted

**決策**：`/prom/api/v1/status/buildinfo` 回傳一個實際存在的 Prometheus 版本號（如 `2.53.0`），而非 Prism 自己的版本。

**背景**：Grafana 的 Prometheus datasource 依 `buildinfo.version` 決定啟用哪些功能（如 `@` 修飾符、exemplar、原生直方圖）。回傳無法解析的版本號會讓 Grafana 降級到最保守的行為。

**理由**：這是相容層的必要代價。所宣告的版本必須是 Prism 實際支援其全部相關功能的版本，不得虛報。

**後果**：
- 升級所宣告的版本前，必須先確認新增功能真的支援，否則 Grafana 會呼叫我們沒實作的端點。
- 真實的 Prism 版本改放在 `revision` 欄位與 `/api/console/v1/status`。
- 此行為必須在 README 明確說明，避免被視為欺騙。

---

## ADR-006：服務端不做 WAL，可靠性責任在採集端

**狀態**：Accepted

**決策**：`prismd` 的 ingest 在寫入失敗且重試耗盡後直接丟棄並記錄指標，不寫本地 WAL。`prism-agent` 則有完整 WAL。

**理由**：
- OTLP 與 remote_write 都在協議層定義了「回 429/503 則客戶端重試」，可靠性責任本來就在客戶端。
- 服務端 WAL 會引入 replay、去重、順序、磁碟管理、多副本一致性等一整套問題，對單機部署的收益遠低於複雜度。
- 把 WAL 放在 agent 端還有額外好處：網路中斷時資料留在來源主機，不需要中間層一直可用。

**後果**：
- 不會重試的客戶端（`curl`、簡單腳本）在服務端過載時會丟資料。這是客戶端的選擇，文件需說明。
- Phase 6 保留 `ingest.wal.enabled` 選項的可能性。

---

## ADR-007：`Attrs` 統一為 `map[string]string`，寫入時序列化

**狀態**：Accepted

**決策**：OTel 的 `AnyValue`（含巢狀 map/array）在 ingest 時展平並序列化為字串。

**理由**：
- ClickHouse 的 `Map(String,String)`、VictoriaLogs 的欄位、Loki 的 structured metadata 都是字串鍵值。沒有一個候選後端能有效索引異質型別。
- 型別資訊對查詢的價值低（過濾時通常做字串比較或數值轉換），對複雜度的成本高（每個驅動要處理 8 種型別）。

**後果**：
- 數值比較需要在查詢時轉型（`toFloat64OrNull` 之類），效能略差。
- 巢狀結構展平為 `a.b.c` 形式的鍵，可能與原始鍵名衝突（用 `__` 逃逸處理）。
- 若未來需要真正的型別，可加 `Attrs["x__type"]` 側車欄位，不需改介面。

---

## ADR-008：服務依賴圖採用近似計算

**狀態**：Accepted

**決策**：依賴邊在 ingest 時於單一批次內做 span→parent 的本地 join，join 不到的記入 `pending_links` 由背景任務每 5 分鐘補算一次。結果標示為近似值。

**背景**：精確的依賴圖需要對每個 span join 其 parent span，跨批次、跨時間、跨服務，成本極高。

**理由**：同一 trace 的 span 在實務上絕大多數會在數秒內到達同一個 ingest 節點，本地 join 命中率高（實測應 > 90%，Phase 3 需驗證並記錄實際數字）。依賴圖是拓撲概覽，不是計費資料，近似可接受。

**後果**：
- 呼叫次數會低估，UI 與 API 必須標示「近似」。
- 極端場景（span 延遲數分鐘到達）下部分邊會缺失。
- 若使用者需要精確依賴，Phase 6 可加離線批算。

---

## ADR-009：遙測資料不備份

**狀態**：Accepted

**決策**：只備份 PostgreSQL（規則、租戶、靜默、投遞記錄）與 Git 中的配置。ClickHouse / VictoriaMetrics 的遙測資料不備份。

**理由**：遙測資料時效性強、體積大，備份成本高於其價值；災難後從零開始收集是可接受的。

**後果**：存儲後端的磁碟故障 = 歷史資料全失。必須在 README 顯著位置說明，讓使用者自行決定是否要加 RAID 或後端層級複製。

---

## ADR-010：v1 不做自有儀表板

**狀態**：Accepted

**決策**：Console 只做控制平面 CRUD；所有曲線、日誌搜尋、trace 視圖交給 Grafana，Console 提供深層連結。

**理由**：Grafana 在這個領域有壓倒性優勢，重做等於用最大的成本換最差的結果。ADR-001 的相容策略讓我們可以直接白拿這個能力。

**後果**：
- 使用者必須額外部署 Grafana。`deploy/docker-compose.yml` 預設包含它以降低摩擦。
- 產品的「一體感」較弱。Phase 6 可用 Apache-2.0 的 Perses 元件補上，不需要 fork Grafana。

## ADR-011：Phase 1 OTLP 寫入使用單租戶 file-backed bearer

**狀態**：P1-04 實作決策，2026-10-03。

**背景**：P1-03 的 tenant context 只接受可信身分。完整 API-key store、mTLS
租戶映射及控制平面尚未實作；直接信任客戶端租戶 header 會繞過隔離。

**決策**：P1-04 先支援 `tenancy.mode: single`，寫入一律驗證
`auth.ingest_api_key_file` 載入的獨立 bearer key，且只允許設定的 default tenant。
`X-Scope-OrgID`、`X-Prism-Tenant` 若出現，必須單一且等於該租戶；跨租戶或
互相衝突的 selector 不能覆蓋 key 身分。這明確限縮 `02` §0.1 的通用解析順序：
在完整認證映射實作前，不提供任意 header 選租戶，也不提供 mTLS 身分認證。
`all-in-one`／`ingest` 在缺少有效 key 或設定 strict tenancy 時拒絕啟動與
config-check。其他角色仍不需要 ingest key。JWT secret 不重用為寫入 key。

**結果**：可驗收真實三訊號接收且不引入匿名寫入。部署需自行管理與輪替 key；
本次不提供 live reload、多租戶 key store 或部署。TLS certificate 設定同時套用
HTTP 與 gRPC；明文只適合本機測試或可信網路。key 不進 log、錯誤或序列化設定。

**計數**：OTLP 部分失敗以原始 datapoint/log/span 為單位。若一個 metric point
展開出的任一 UTM child 被拒絕，原始 point 計一次 rejected；其他 child 可能已被
接受，客戶端不得因 partial success 重送整批。delta baseline、metadata 不支援與
可恢復正規化警告不可冒充資料點拒絕數。詳見 [P1-04 設計](../specs/p1-04-otlp.md)
及 [OTLP 規範](https://opentelemetry.io/docs/specs/otlp/)。

**容量**：daemon 使用一租戶、每 lane queue depth 4 的預設，與保留相容性的
pipeline package defaults 分開。`ingest.memory_limit` 驗證邏輯 payload 與接收
buffer 預算；它不是硬性 RSS 上限，不包含 memory backend 無界資料保留。

**gRPC 早期限流**：固定版本 grpc-go 的 tap abort 不保留 status details，因此解碼前
的 receiver 容量不足回 `Unavailable`，讓 OTLP 客戶端使用標準 backoff 重試。
pipeline 佇列／rate limit 仍在正常 unary handler 回 `ResourceExhausted` 加
`RetryInfo`，符合 `02` §1.1 的佇列滿契約。使用標準 MethodDesc 及 bounded raw
request，避免依賴不受支援的 stream descriptor flags；協定錯誤在 handler
分類，原生 framing/compression 錯誤保留函式庫行為。


## ADR-012：remote_write v1 的有界接收與部分拒絕

**狀態**：P1-05 實作決策，2026-10-04。

**決策**：remote_write 使用 ADR-011 同一個 file-backed bearer 與固定 tenant。
HTTP endpoint 為 `/prom/api/v1/write`，僅接受 snappy block 與 v1 protobuf。
解壓配置大小和 protobuf 元素在生成 decoder 配置 slice 前驗證；每個 receiver
固定一個非阻塞 slot，從 body read 持有至 normalize/submit 完成。Stop 拒絕新工作，
既有 HTTP drain 與 pipeline 關閉順序不變。

**回應**：成功入列回空 204；入列前容量/速率拒絕回 429 與 Retry-After。
任何 sample 部分拒絕回不重試的 400，成功部分可能已保存，不能將整批當成尚未提交。
此行為遵循 remote_write v1；metadata/native histogram 等既有非致命 mapping
警告用限量且不含使用者字串的日誌呈現。保留 raw decompressed bytes 做 byte admission。

**容量與範圍**：在 P1-04 logical budget 上加入兩個 max_request_bytes buffer，
預設共 968 MiB，並非 RSS 保證。單 slot 選擇偏保守，仍可由 client batching 使用；
不增加設定或依賴。不引入自動重載、多租戶控制面、查詢 API、遠端寫入 v2、WAL
或部署。此切片不使用跨請求 buffer pool，避免保留最大請求記憶體及敏感資料；
各請求資源在結束時釋放，與 SDD05 的 pool 建議相比採用更明確的保留上限。

詳見 [P1-05 規格](../specs/p1-05-remote-write.md) 與
[remote_write v1](https://prometheus.io/docs/specs/prw/remote_write_spec/)。

## ADR-013：Go 1.27 維護基準與單一版本來源

**狀態**：2026-10-04 明確授權的 Go 升級決策。

**決策**：以 `go.mod` 的 `go 1.27.1` 同時宣告最低 toolchain 與 Go 1.27
語言基準；Prism 兩個 CI job 使用 `go-version-file` 讀同一檔案，並以
`GOTOOLCHAIN=local` 驗證所安裝版本。lint 工具更新為支援此版本的
v2.14.0，保留啟用的檢查。既有 require/replace、go.sum、SPI 與協議不變。

**理由與後果**：Go 1.23 已超出官方支援窗口。先前 P1-05 的 Go 1.27
試跑是可行性證據；本次重新驗證提高 go directive 後的實際語言／runtime
基準。歷史驗證不改寫，現行操作指引與 SDD 建置版本同步。舊 compiler
關閉自動切換時應清楚拒絕；不承諾未量測的效能收益，不包含系統全域
安裝、容器部署或下一功能。詳見 [升級契約](../specs/go-1.27-upgrade.md)。


## ADR-014：Phase 1 Loki JSON push 使用獨立受限接收器

**決策**：沿用固定單租戶 file-backed bearer 與既有 pipeline，支援 JSON／gzip，protobuf push 留在 Phase 2。原始解壓 JSON 長度用於 byte admission；token/schema/duplicate/depth/element 與展開工作量預檢先於 materialization。接收器採獨立單一 slot，取消 callback 完成後才釋放。

**理由與後果**：避免壓縮與共享 stream metadata 放大、租戶偽造及取消後資源累积。新增兩個 request-size receive buffers，預設 logical budget 1000 MiB，並非RSS限制。全數接收回204；語意 partial 回400且有效資料可能已入列；committed internal failure回500仍可能重送重複。

**替代方案**：複用OTLP容量gate會改變既有協定背壓；直接無預檢JSONdecode會在拒絕前配置不受元素限制的物件。範圍、狀態碼與實測驗收見 [P1-06 contract](../specs/p1-06-loki-push.md)。


## ADR-015：PromQL adapter 的 SPI series 生命週期

- **狀態**：P1-07 實作決策；驗收依 [里程碑規格](../specs/p1-07-promql-adapter.md)。
- **原因**：SDD14 §7 的 SPI Series 只在下一次 Next 前有效；Prometheus v0.53.0 storage.Series 允許稍後或重複取得樣本迭代器。SDD06 的零拷貝薄包裝示意不能直接滿足兩者。
- **決策**：列舉時複製完整 labels 身分，呈現時隱藏內部保留標籤。每次樣本 Iterator 以可信 tenant 與相等 matcher 重新 Select，再比對完整 labelset，排除多餘 labels 及 absent/empty 的誤配。保持該 SPI set 未前進直到樣本讀完；耗盡、錯誤或 Querier.Close 關閉且只關一次。設定有限的 series、rows、sets 與 metadata 預算，所有重開與 Seek 工作都計量。
- **取捨**：不改公共 SPI、不收集整份樣本結果，但增加選取次數；SPI 沒有跨呼叫快照，因此不宣稱與並行寫入隔離。既有 memory driver 的內部 materialization 不由 adapter 消除，也不能以 adapter 上限宣稱整個程序 RSS 有界。生命週期測試必須使用會在 Next 回收 Series 緩衝區的 fake backend。
- **相容性邊界**：SDD02 §2.3 的 v1 float/classic-histogram 契約優先於「所有上游 testdata」的概括句。官方 corpus 的 native-histogram 相依案例需逐例列出原因，其餘相容案例必須真的經過 memory SPI 與 adapter。P1-08 才接 HTTP、query router 與完整 AST/output 政策。


## ADR-016：P1-08 HTTP 查詢的可信單租戶边界

- **決策**：P1-08 沿用現有single-tenant runtime，以default_tenant固定storage身分；tenantheader只可驗證相同身分，不授權切換。allow_anonymous_read允許無credential讀取固定tenant，否則沿用既有APIkey；提供錯誤credential不得當匿名忽略。strict模式未有control-plane身分映射，明確拒絕啟動。
- **原因**：SDD02通用header優先序尚缺可信授權映射，直接接受header會使未授權租戶可讀。現有memory與寫入runtime契約先維持安全的一致邊界。完整多租戶與mTLS身分映射屬後續控制平面。
- **查詢邊界**：P1-08補齊HTTP labels中的__name__並在AST／output防守reservedlabels；保留P1-07串流reselect與float-only限制。限流、時間範圍、回應容量、路由觀測及shutdown依 [P1-08 contract](../specs/p1-08-prometheus-http.md)。


## ADR-017：Prometheus HTTP numeric timestamp parser 校正

- **問題**：既有ParsePromTime沿用SDD14的SecFloatToMilli逐字公式，負秒數有1ms偏移且NaN／Inf／溢位無錯誤，與SDD02 Unixseconds相容契約衝突。P1-08獨立審查以實際redtest確認。
- **決策**：只校正ParsePromTime numeric branch：拒絕非有限／超出可表示int64毫秒範圍的秒數，正負都四捨五入到毫秒（half away from zero）。RFC3339原行為保留，公共識別字及legacy SecFloatToMilli helper與它的直接測試不变；parser舊負數測試從-999改為正確-1000。SDD14示意parser不再覆蓋本ADR的輸入驗證與負數校正。
- **後果**：HTTP維持集中UTM換算；畸形與溢位時間不再被轉成有效範圍，沒有新增依賴。極大浮點Unixseconds仍受float64毫秒精度限制，無微／奈秒精度保證。與Prometheus2.53的Modf浮點分段捨入在tie可差1ms，例如-1.2345本parser為-1235ms、上游因浮點fraction為-1234ms；此處保留明確對稱捨入契約，不宣稱tie逐位相同。

## ADR-018：P1-09 ClickHouse write-only driver 與現行 SPI 適配

2026-10-05，owner 已批准 P1-09 與官方 clickhouse-go/v2 v2.48.0 的必要依賴。以現行可執行 SPI 為契約，不改公開識別字。MetricPoint 沒有 fingerprint 欄位，ClickHouse writer 使用既有 utm.Fingerprint 對完整 sorted labels（含 metric 與 trusted tenant）計算；不另定 hash。series cache 在 seen 範圍延伸時仍寫 metadata，避免 first_seen/last_seen 因 cache 命中而失真。

本輪只有遷移、三訊號寫入與保守 capabilities；所有 production reads classified Unsupported、未實作 optional interfaces，不宣稱 full conformance。非空 cluster classified Unsupported，replicated deployments 另行驗證後才支持。Log/span schema 補存完整 Resource，span 另存 TraceState 與 link attrs；既有 SPI 不能表示的狀態不以改接口解決。

所有 batch/history/cache/concurrency 有有限 bounds，ctx 與 Close 保護 native client 的生命週期。遷移 receipt 同步完成；預設 async telemetry ack 不是持久化保證，部分多表成功不能回滾，不自動 retry。checksum 對渲染前 SQL，TTL 改動另外冪等 reconcile。Local dependency join 包含 tenant+trace+span，未解 parent 寫 pending_links；Phase3 定時補算与 graph query 不在本輪。詳見 [P1-09 specification](../specs/p1-09-clickhouse-write.md)。

P1-09 真 ClickHouse 24.8.14.39 驗證發現 trace_index 的 groupUniqArrayArray 回傳 Array(String)，不相容原 Array(LowCardinality(String)) storage type；改為 Array(String)，保持聚合語義。Series first_seen/last_seen 使用 DateTime64(3) 保留毫秒；metadata 無 TTL 與 samples 的 retention 分開明示，Retention.Enforced=false。Server max_execution_time 預設55秒，driver operation timeout包含5秒overhead並涵蓋admission。所有schema timestamp受最弱DateTime預聚合範圍1970到2106限制，預I/O拒絕非法值。

獨立審查確認四項邊界後，P1-09 契約要求全零 ID 按 UTM helper 拒絕、metric label 名稱與值先驗 UTF-8、migration008 使用 canonical MATERIALIZED labels_str。ClickHouse24.8 TTL expression 不接受 DateTime64，而 DateTime 加 retention 可溢位導致提前刪除；因此明確使用 UTC TTL，寫入前驗證 TTL source 加有效 retention 仍小於2106上限，Migrate 在任何 TTL ALTER 前先驗全部八表既有最大來源時間。變更 retention 前須停排其他 backend/process writer，避免舊設定跨過 MAX 到 ALTER 的檢查窗口；不靜默縮短 retention、不改公開 SPI 或原 hash。span start 使用 max(trace,RED,1day)，end/events 只受原始範圍限制。

官方2.48.0 client 會按 ctx deadline 覆寫 protocol max_execution_time。P1-09 保留完整 deadline/cancellation，受控 migration scan 與 INSERT 額外以 SQL SETTINGS 強制設定上限。Native batch 無 column-list 才能保留此 SETTINGS，所以準備後必須核對返回的 column count/name 與原固定 INSERT list 完全相同，任何 schema 漂移關閉 batch 並 fail closed，不按猜測欄序寫資料。DDL 保留 client max_execution_time+5 秒限時；其 protocol server 上限由上游 deadline 規則決定，不宣稱與 scan/INSERT 設定逐值相同。


## ADR-019：P1-10 mandatory query 與現有 SPI 語義適配

狀態：設計已確認，2026-10-06；驗證結果以inventory為準。

SDD17早期SQL不是現有SPI的逐字實作。P1-10只實作mandatoryreads：PromQL仍走既有回退引擎；optionalmetricmetadata/delete/nativequery、NativeLogQuerier、RED/Dependencies仍不宣告。完整labels.Compare排序使用無分隔符歧義的sortedlabeltuples；不能因008的labels_str存在就承諾所有合法value的字典序。跨monthmetadata先合併完整identity；catalog使用實際sample存在，避免metadata無TTL或extent窗口hole造成幽靈series。

Metrics時間inclusive毫秒，logs/traces依現有半開奈秒契約；missinglabel等於空字串做matcher，但catalog只有真正有鍵才回該值。LogSearch只下推selectors/time/sort，未實作filters/stages/fields/agg能力false且不得在補算前limit。Trace duration用完整trace的root最大duration，root存在但duration0仍不fallback；無root才用最大span。FindTraceIDs時間/其他filter決定matching spans的start/end；GetTrace index最大時間是span start，必須包含末筆及late span。

新增009只加logs.write_seq UInt64 DEFAULT0，保留001–008checksums。MergeTree physicalpart/offset會隨merge改變，無法提供持久writeorder，因此新單一writer的logwrites在同一operation lease內以context-aware gate序列化：首次有界查max(write_seq)，先檢查overflow再保留sequence；失敗／lost reply也不重用。Log INSERT用async_insert=0，確保成功後可查，drained writer重新開啟時可seed；metrics/traces保持原asyncack限制。排序為ts方向、write_seq升序。舊row預設0只能用確定性內容次序，不能重建原本未存的歷史writeorder；獨立process writers需外部序列化，不承諾global同時order。這是schema加法與logack語義的必要改變，不擴張deployment／協調系統。

所有iterator持有admission/context/nativeRows lease直到EOF/Close/error/cancel；Backend.Close取消且等待callbacks/rowsdrain後closeclient一次。Server/local scan/resultlogicalbytes有明確上限，overflow回TooLarge，沒有成功截斷。這些上限不是RSS／soak保證。ConfigDSN使用既有secret.String/file引用，storage.retention唯一來源傳到driver，非空split本期failclosed，server execution timeout小於query timeout；只啟用現有daemonSPI接線。詳見`docs/specs/p1-10-clickhouse-query.md`及SDD11／17當期邊界。

現有metricconformance以__name__識別series且多個points沒有冗餘Name，memory也接受。P1-10需將Name空時由validated非空__name__推導localcopy；非空Name仍requireexactmatch，兩者空／矛盾beforeIO拒絕。這是既有executablecontract適配，不修改SPI、不包裝conformancefactory、不放寬tenant/UTF8／time／payloadvalidation，也不改P109歷史spec。

真實24.8.14.39 probe確認，pinned native client的time.Time query argument會失去DateTime64邊界所需的毫秒／奈秒精度。讀取條件改綁Unix整數，再用fromUnixTimestamp64Milli／Nano轉回server時間型別，保持現有inclusive／half-open契約，writer仍使用UTM時間轉換。Metadata map identity使用排序後的key/value tuples，避免Go map編碼順序導致同一series被誤判為collision。

GetTrace直接讀tenant+trace_id的spans，保留既有bloom及server scan cap；不以derived trace_index存在或extent當完整性前提，避免index lag／最後或late span漏查。先讀index縮小掃描屬未來效能選項，未驗證的大量掃描可能fail closed，不宣稱production latency／soak。

完整corpus雖579／189／6296通過，原fuzz seed抓到單點／批首-0在既有Float64 Gorilla codec落庫變+0；raw reinterpretAsUInt64亦確認已失bit，reader不能恢復。批准新增010的UInt64 value_bits DEFAULT reinterpretAsUInt64(value)，writer顯式寫math.Float64bits、reader以math.Float64frombits重建，不改SPI／原codec／既有001–008。新UInt64持久路徑已在私人實庫probe確認signed-zero可保留；最終fullpackage還須重跑。舊row可讀，已丟失的歷史signed-zero不可重建。這是mandatory float fidelity必要加欄，不增加依賴或擴張native histogram範圍。

ADR-019 follow-up (P1-10 D010/D011): Independent frozen-source review reproduced caller-context memory-cap bypass and a trace default-value discrepancy. Read SQL now fixes the validated memory cap. The existing SPI/memory reference governs nonpositive trace limits and exact empty-service selection; positive requested limits remain after full filters/order, and backend safety caps still fail closed. These changes preserve interfaces, dependencies and other drivers.
