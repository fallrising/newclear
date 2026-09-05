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
