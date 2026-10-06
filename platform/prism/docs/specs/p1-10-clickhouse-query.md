# P1-10 — ClickHouse mandatory queries and daemon core chain

狀態：design fixed before implementation；2026-10-06。範圍限於 P1-10。Go1.27.1、clickhouse-go/v2 v2.48.0，readonly modules。

## 目標與範圍

完成 SDD12 P1-10、SDD17 §4–§7／§9 的 mandatory SPI reads，透過現有 daemon ingestion→ClickHouse→PromQL 回退路徑提供實際可查詢的 float samples。以現有 pkg/spi、memory reference 與 executable conformance 為權威；SDD 草稿不成立的新介面或前置條件不得取代它們。保留全部 PromQL corpus exclusions，沒有 P2 NativeLogQuerier、P3 RED／Dependencies 或 P1-11 compose/Grafana。

不改公開 SPI、其他 driver、root workflows、go.mod/go.sum／依賴版本。保留八個 P1-09 migration 原始 bytes／checksums與歷史證據。新增 additive migration009：logs.write_seq UInt64 DEFAULT0。只允許加欄位，不改既有migration或新增conformance deviation。新單一writer寫入以context-aware gate在同一operation lease序列化，首次有界讀取max(write_seq)seed，檢查UInt64overflow後先保留sequence；任何send失敗／lost reply也不重用sequence。Log INSERT強制async_insert=0，成功回應後row可見，下一個writer在drain後可seed；metrics/traces原async設定保持。依ts方向、write_seq ASC排序；舊row的seq0用確定性內容次序，無法重建未曾保存的歷史write order。多process writer需要外部序列化；本期daemon單一backend。理由見ADR-019。

P110-D007（真庫red後、實作前批准）：ClickHouse24.8的既有Float64 Gorilla codec在單點／批首負零可把0x8000000000000000存成正零。新增additive010_metric_value_bits.sql，metric_samples.value_bits UInt64 DEFAULT reinterpretAsUInt64(value)。新writer同時寫math.Float64bits(Value)，read只從UInt64重建float，保留所有NaN/stale／Inf／signed-zero bits，不改SPI／原codec／001–008。既有value欄仍供歷史readback；舊row DEFAULT保持可讀，但先前已失去的負零位元不可重建。固定INSERT column guard與receipt count同步；原native5column isolatedbatch test須保留。完整unchanged PromQL package（含所有fuzz seeds）及實庫driver重新驗證，不排除負零。

## 查詢設計

現有SPI conformance的metricpoints可只帶__name__ label，不填冗餘Name。必要writer適配：Name空時從非空且已驗證的__name__推導localcopy；Name非空仍需完全相同，兩者空／矛盾仍beforeIO BadRequest。不得用testfactorywrapper填Name掩蓋backend不合；caller資料與其他tenant/UTF8/retention/boundsguard維持。

- 所有查詢固定 tenant 條件，所有 telemetry 值／matcher 名稱與值以 native arguments 綁定；不讓輸入成為 SQL identifier。拒絕矛盾 __tenant__、無效 matcher/type/regex，保留 context identity及去敏分類。閉合 backend 的操作先回 Unavailable。
- Metrics.Select 回傳依完整 labels.Compare 字典序的 series；每 series sample timestamp 嚴格遞增、去重。重複 timestamp 契約要求唯一，未承諾 latest-wins；不得藉聚合變更 NaN／Inf／stale-marker bits。Labels 字典序不得依有分隔符歧義的 labels_str 單獨決定；使用完整 sorted tuples 或在明確有界資料上依 Go comparator 排序。跨 partition metadata先按 tenant+metric+fingerprint 合併，避免 metadata join乘倍樣本。Metadata identity 不自洽應 fail closed。
- Metrics 為 inclusive [Start,End] 毫秒；負值／超出已存範圍的讀取必須可回空／相交結果，不能阻斷 corpus 的 negative offset／@ 查詢。Hints 不可降採樣或忽略需要的原始樣本。
- LabelNames／LabelValues sorted unique、按 matcher/time 篩选；只列有真實保留樣本的 series，不能以 first_seen/last_seen 當窗口存在證明。LabelNames排除 reserved prefix；LabelValues 的明確空值保留，不把不存在鍵創成空值。四種 matcher 對不存在鍵使用空字串語意，regex 完全錨定、與現有 Go matcher一致；涵蓋 newline／separator 值。
- Logs.Search只承諾 selectors、半開 [Start,End) 奈秒与方向排序；本期保留未實作 filter/stage/field/aggregation能力 false，返回完整 bounded superset。不能在補算前套 q.Limit；超過安全 scan/result 上限回 TooLarge，不截成看似成功結果。相同 timestamp寫入順序須穩定，raw body bytes/full resource/attrs/labels保留。Log catalog 依實際 logs/time/matcher。
- Traces.FindTraceIDs 的 service/operation/kind/tags/time匹配 spans形成 trace candidates；duration使用整個 tenant+trace 的 root-span最大 duration，沒有root時使用全trace最大 span duration，root為0仍是有效root。返回matching spans的min start/max end，start降序、traceID升序，q.Limit以trace計；非正值不要求截斷，空 service 是精確空字串匹配，server/client 安全上限仍維持。GetTrace保留全部資源／events／links／TraceState，含late與最後span；index的end_ts是最大span start，不能用排他的上界丟掉最後span。Services/Operations依實际spans半開窗口，sorted unique，保留現有空service行為。
- Native rows必須有有限讀取／執行／memory/result設定，overflow_mode=throw；增加明確max_rows_to_read與max_result_bytes options（defaults 5,000,000 rows／64MiB；正值並有 ceiling），維持max_result_rows/max_memory_usage/max_execution_time現有選項。Client additionally累計解碼rows／logical bytes；超限是錯誤，不聲稱RSS界限。SQL顯式 server cap守住pinned client context override。
- 每個 streaming iterator持有 backend admission/connection lease直到EOF/Close/error/cancel；Close idempotent，backend.Close取消並drain iterator及callback後只close native connection一次。取消／deadline在query與Next期間均能停止，errors.Is保留。無無主長駐goroutine；race/goleak驗證並檢查rows.Close錯誤去敏。

## 最小 daemon/config 接線及允許檔案

實作前已確認daemon有 spi.Open、Migrate/Ping、runtime shutdown/Close；不改 ingest/server 架構。

| 必要檔案 | 設計與驗證 |
| --- | --- |
| cmd/prismd/main.go、main_test.go、新增 storage_test.go | blank import clickhouse；Storage.DSN明確string轉換後交SPI；storage option preparation及retention傳遞。測試registered driver/config-check、memory照常、Close順序保留。 |
| internal/config/types.go、validate.go、新增 storage.go／storage_test.go；config_test.go僅必要型別斷言與storage.split fail-closed情境適配 | StorageConfig.DSN使用既有secret.String，支援dsn_file（二選一），bounded regular-file／no symlink／FIFO读取、relative credential-file路徑解析；禁止去敏繞過。Config-check對ClickHouse DSN／numeric/time/options做有限安全校驗，不連DB、不加driver→internal依賴。 |
| internal/config/storage.go（新增） | 最小 config-side validation/options conversion；storage.retention唯一權威轉成四個retention_*_days，衝突option來源拒絕；query timeout應大於server max_execution_time；非空storage.split本期fail closed，避免設定看似生效卻被忽略。 |
| deploy/prismd.yaml、docs/sdd/11-DEPLOY-OPERATIONS.md | 同步DSN secret/file、retention、query bound與timeout文件；保留能用memory的範例，ClickHouse database需预先存在。types/default/config-check/SDD11/deploy五處同步。 |
| test/promqltest/engine_test.go及新增clickhouse_fixture_test.go（integration build） | 以-driver=clickhouse選擇真DB factory，clear使用隔離DB並cleanup；原始corpus bytes、manifest、exclusions/comparator保持。Epoch fixture只用test retention36500與同步insert，分批不超writer上限。 |
| drivers/clickhouse/query_integration_test.go、conformance_integration_test.go、run-integration.py、run_integration_test.py | 實庫conformance全mandatory、query/limits/lifetime/tenant/metadata window／ordering regression；runner缺fixture明確失敗，owned loopback容器有限資源、cleanup僅自己fixture。 |
| test/e2e/clickhouse_query_test.go（integration） | 真daemon選ClickHouse、三種已支援ingress持久化、PromQL instant/range/catalog與core tenant/auth／SIGTERM chain。沒有compose/Grafana。 |

Core worker可改drivers/clickhouse/*.go及unit tests、新增query/*.go等同目錄、additive migrations（既有8個readonly）；runtime worker不可寫core檔案，僅上述integration檔案／runner。整合維護spec/SDD17/ADR019/inventory/README/quickstart。新增檔案或更改範圍先checkpoint列出理由，不能自行擴權。Root 已產生本期實測，見 [inventory](../inventory.md#p1-10-clickhouse-query-and-runtime)；完整 runner 與來源凍結獨立審查須在接受前結案。

P110-D004：既有integration_test.go的TestClickHouseUnsupportedReads以P109當時未實作mandatoryreads為前提，P110不可保留該過期預期或跳過它。允許T902只更新該scenario：保留optional interfaces/capabilities absent證明，以有效租戶、時間與trace identity驗證所有mandatory empty reads及iterator Close；其他歷史scenario保持。009 receipt／logs.write_seq assertions亦屬同檔必要適配，不能弱化原8 checksum驗證。

P110-D005：GetTrace直接依tenant+trace_id讀spans，使用既有bloom index及server掃描上限，不把derived trace_index的時間extent当資料完整性前提。這可保留index缺失／lag與late／末筆span，符合SPI fulltrace契約。SDD17先讀index是未來收窄掃描的設計選項；本期不增加雙查詢或容錯協調。大trace／低selectivity仍可能因scan/result cap fail closed，未聲稱延遲或soak保證。

P110-D006：既有TestClickHouseWrites把event固定在2026-10-05，隔日後pending_links一日TTL正確清除該fixture，令原隔離斷言因牆鐘漂移失敗。允許T902只改該event來源為當前UTC的安全有效窗口；其相對時間、payload、tenant/trace錯配與readback斷言全部保留，不改TTL、不弱化結果條件。完整driver gate必須重跑。

P110-D008：完整 corpus 與 race 在多個 fixture 並行時觸發 Go 預設 10 分鐘 test timeout，保留該失敗。Runner 的 corpus 明確使用 `-timeout=20m`，外層等待 1500 秒；root 後續完整 corpus 依序執行。只延長測試等待時間，不更改 driver 查詢 deadline、server execution cap、corpus 內容或任何 exclusions。

P110-D009：root owned runner 的所有實庫測試已通過，但移除自有容器後 Docker29.1.3 回報小寫 `error: no such object: <name>`，舊 cleanup 分類僅識別大寫字首而失敗。只准在 returncode1、空白 stdout、stderr 對受檢確切 name／ID 的已知 absence 訊息完全匹配時接受已移除；未知錯誤、timeout、身分或 label 改變仍 fail closed。若 name 初查已不存在但 captured ID 已知，仍須證明該 ID 不存在；不能只依 name 回報成功，也不得盲目刪除以 ID 查到的異動容器。新增 stdlib `run_integration_test.py` 的 red-green regression，涵蓋大小寫、未知／混合訊息、mismatched name／ID、禁止誤刪與 name／ID 雙重 absence；root 再跑完整 owned runner，保留前次 cleanup failure。

P110-D010：Astra T903-F01 在凍結來源的實庫 overlay 重現 caller native context 可將既有 max_memory_usage 覆寫為0，關閉中間 join／group／sort 的 server memory cap。必要根因修正：driver options 保存不可由 caller context 覆寫的已驗證 memory 數值，所有 read SQL SETTINGS 明確指定該值；既有 defaults／ceilings／公開 SPI／依賴不變。Core 單元先 red，runtime 真庫 regression 核對有效 getSetting，即使 caller 覆寫0或更大的數字仍保留 configured cap。新完整 freeze、root 受影響 Go／實庫／核心鏈路 gates 與 Astra closure review 均必須通過；既有 freeze 與紅證據保留。

P110-D011（T903-F02 契約裁決）：SDD14 §9 草案列出 Service 非空與 Limit>0，但現有公開 SPI 沒有該前置條件，memory executable reference 對 Limit<=0 不截斷、對空 service 作精確空字串匹配，且既有 ClickHouse writer 已可保存空 service。依 owner「以現有 SPI 契約為準」、本 spec 的 executable authority 與保留空 service 行為，不新增該草案限制；ClickHouse FindTraceIDs 只要求有效 tenant，非正 Limit 不加要求的 SQL LIMIT，正 Limit 仍在完整 filter/duration/order 後按 trace 數截斷，native/client 安全上限照常 fail closed。Core focused red-green 與 runtime 真庫 memory 對照 regression 覆蓋 zero／negative／positive Limit、空 service 精確匹配、排序、tenant 與小 result cap；不改 SPI、memory、SDD14 或其他 driver。

## 驗收矩陣

1. Red-green：missing read／registration或bounds focused test先按預期失敗，保留red command/log；最小實作後green。Existing behavior test有效，fixture wiring先測試不可行處需說明。
2. Root `GOTOOLCHAIN=go1.27.1 GOFLAGS=-mod=readonly make lint test`（race／goleak／vet／format）與pkg/spi/conformance memory、真ClickHouse mandatory conformance。既有capability不適用的optional skips列明，不增KnownDeviations。
3. 原始officialfloat corpus兩driver：579 supported eval／189原有nativehist exclusions／6,296 actualenginequeries；不得以worker或P1-09歷史green代替root。Hash原始corpus／module／SPI／其他drivers守住不變。
4. C-MET05全部四種空／缺失regex cases；tenant injection、nanosecond/millisecond boundaries、跨月identity、窗口holes／expiredsample catalog、排序／duplicate／stableties、scan/rows/bytes上限且不默默truncate。
5. Iterator／connection Close一次、未讀／半讀／EOF／Scan/Next/Closeerror、cancel/deadline／backendclose、concurrent cancellation與goleak；server/client errors固定去敏、errors.Is與分類。
6. Native依賴guards＋5negativefixtures、pinnedlint2.14.0 normal/integration、security、build含CGO0、go mod verify／unchangedmodulegraph；既有real Prometheus/promtool/Vector/telemetrygen與daemon smoke，新增root ClickHouse corechain。
7. 完整來源／docs凍結manifest後Astra獨立審查；所有findings解決，再root必要受影響gates／Astra重新核對。最後commit→push→PR→必要CI/review→normalmerge→exactmergemainCI→遠端hash核對；不得跳branchprotection。

失敗／skip保留並解釋；文檔先記計畫，完成時只記實測。Logical bounds非RSS／soak／productioncapacity／durability保證；async acknowledgment與P1-09非交易寫入限制仍成立。完成本期停止，不release/deploy。
