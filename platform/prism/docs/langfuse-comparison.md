# Prism 與 Langfuse：定位比較與後續整合參考

狀態：**研究／參考；不是新增實作規格或開發授權**。整理日期：2026-10-30（UTC+8）。
需求：[newclear #793](https://github.com/fallrising/newclear/issues/793)；文件任務 T-0793。

本次 newclear 查核基準：`a0f6b3f2200063b99b02ced53e7a893c1c467a6f`。
[固定版本 Prism](https://github.com/fallrising/newclear/tree/a0f6b3f2200063b99b02ced53e7a893c1c467a6f/platform/prism)
與 [固定版本整合規格](https://github.com/fallrising/newclear/blob/a0f6b3f2200063b99b02ced53e7a893c1c467a6f/docs/specs/llm-observability-langfuse.md)
供歷史回查；文內相對連結供日後接手導航。Langfuse 官方網頁於整理日查閱，屬可變文件；後續接入須重新固定 server、SDK、API 與功能版本。

本輪沒有執行 runtime 或部署驗收，不改變 [SUCCESS](../SUCCESS.md) 的主線與未完成項。

## 1. 結論與判斷框架

**Prism 是通用可觀測性的協議相容與儲存抽象層；Langfuse 是 LLM／Agent 執行觀測與品質改善平台。**
兩者在 traces、耗時、錯誤與分析上有交集，但不能因為都有監控畫面就視為互相替代。[P1][L1]

Prism 的價值在標準協議、統一遙測模型（UTM）、儲存 SPI 與可治理的資源邊界；Langfuse 的價值在把模型、prompt、工具步驟、用量、評分與實驗組成可操作的工作流。[P1][L1][L2]

本文件的建議是：**不把 Prism 改成另一套 Langfuse，也不讓 Langfuse 承擔完整的通用監控替代任務。**
可以借鑑「事件連回工作、失敗連回評估」的產品思路；不重做整套 prompt／eval UI、dataset 管理與 LLM 成本平台。這是建議，不是已批准的新 roadmap。

例如 Agent 修改程式後交出錯誤結果：通用遙測要回答服務是否出錯、哪個依賴變慢；LLM 分析要回答哪個工具或模型步驟偏離、輸入與 prompt 版本如何影響結果、改動後能否通過同一組案例。**HTTP 200 與低延遲都不足以證明任務正確完成。**

## 2. 既有分析與決策，不另起一套

2026-10-24 已有兩項文件里程碑；這次是補上 Prism 視角，不是首次研究 Langfuse。

| 既有工作 | 可回查入口 | 已記錄的邊界 |
| --- | --- | --- |
| T-1101：LLM 執行觀測與 Langfuse 整合 | [規格](../../../docs/specs/llm-observability-langfuse.md)、[PR #608](https://github.com/fallrising/newclear/pull/608) | 薄接入；先定義來源、ID、計量權威、隱私與有界 exporter |
| T-1102：LLM 用量正確性修正 | [規格](../../../docs/specs/llm-usage-correctness.md)、[PR #609](https://github.com/fallrising/newclear/pull/609) | 先處理終態結算、缺值、重複計量與錯誤去敏，再做可信任的匯出 |

T-1101 的文件合併 SHA 為 `fe9adc9eab6aee48a493d733311184cd58566a3c`；
T-1102 為 `23f2b7f2435f5f805d95c84ec3d112363867108f`。
[既有任務板](../../../tools/codex-usage/docs/tasks/BOARD.md)保留文件交付證據。

既有決策是 Agent Usage 管額度／活動／支出來源，thinrouter 管 admission、路由與 fallback，Langfuse 管執行 trace、用量／成本分析及後續 eval；不 fork 整套 Langfuse。
第一條設計路徑是 `thinrouter → 白名單事件 → 有界 exporter → Langfuse`。[P3]

**文件合併不是 exporter 上線。** 基準中的整合規格仍標示 exporter／接入／部署未實作。
當時對計量原碼的缺陷發現有其固定版本；後續工作須重新核對修正進度，不能把 2026-10-24 的問題清單直接當成最新未修清單。[P3]

## 3. 功能與抽象比較

以下 Prism 的「設計」不代表已交付；實作狀態以下一節為準。

| 面向 | Prism | Langfuse |
| --- | --- | --- |
| 主要問題 | 通用服務如何收、存、查遙測與評估告警 | Agent 做過什麼、成本從何而來、結果如何改善 |
| 核心資料 | metrics、logs、traces | LLM／工具等 observations、trace／session、usage、cost、scores |
| 抽象中心 | UTM、SPI、相容 API、租戶與有界資源使用 | 模型與執行上下文、prompt、評分、datasets 與 experiments |
| 呈現方向 | 標準查詢 API 接 Grafana；不自建 Grafana 替代品 | 原生 LLM 執行分析、prompt 與 eval 工作流 |
| 告警方向 | Prometheus rule／Alertmanager 語義是設計目標；完整流程未完成 | 已有 observations／scores 門檻告警與通知；自架需符合版本矩陣 |
| 儲存策略 | 公開 Go SPI 隔離具體 driver；目前有 memory 與 ClickHouse 實作 | 官方架構使用 Postgres、ClickHouse、Redis／Valkey、物件儲存；不是可替換 SPI 產品 |
| 無法單靠它解決 | 保存通用 span 不等於具備 prompt／eval 產品語意 | 顯示模型用量不等於掌握訂閱 quota，也不等於執行 hard budget |

來源：Prism 設計及實作邊界 [P1][P2]；Langfuse 功能、告警與部署架構 [L1][L2][L3][L6][L8]；quota／控制責任 [P3]。
Prism 可以接收含 LLM 屬性的通用 traces；差別在產品語意與工作流，不是「完全不能存 LLM 資料」。

## 4. Prism 現況：有實作，不等於完整 APM

截至查核基準，[README](../README.md)、[狀態摘要](STATUS.md)、[SUCCESS](../SUCCESS.md)及[任務板](tasks/BOARD.md)記錄如下：[P2]

| 分類 | 已記錄內容 | 不可推導的結論 |
| --- | --- | --- |
| 接收、儲存、查詢已有實作 | UTM／SPI、memory、正規化、限制與有界非同步 pipeline；OTLP HTTP／gRPC 三訊號、remote_write、Loki JSON／gzip push；PromQL、ClickHouse 三訊號讀寫、有界 LogQL／Loki HTTP 查詢 | 不等於完整多租戶生產平台；不保證容量或 crash durability |
| 函式庫／獨立契約已有成果 | NativeLogQuerier、規則載入與 SIGHUP reload、告警 evaluator／state | 不等於 daemon 已接 native log search 或週期告警評估 |
| 主線仍缺 | daemon 告警接線、剩餘通知／靜默／抑制、Jaeger／trace 查詢、替代 driver、agent、控制平面等 | 不因本文件或歷史局部測試而宣告全部完成 |

`mainline: incomplete`、`usable_tag: none` 保持不變。AC-01–03 是有版本範圍的歷史證據，AC-04–05 仍 pending；本次沒有重跑它們。
T-0354 已停止於 P2-07，P2-08 以後仍是 backlog；本文件不重開這些工作。

成熟度判斷：**在可直接使用的 LLM 分析工作流上，Langfuse 比目前 Prism 完整；這不否定 Prism 的通用相容層價值，也不是經效能測試所得的排名。**

## 5. 建議的分工與最小整合邊界

| 元件 | 建議維持的責任 | 不應混入的責任 |
| --- | --- | --- |
| Prism | 通用遙測、儲存抽象、相容查詢與後續通用告警 | 另造完整 prompt／dataset／eval 平台 |
| Langfuse | LLM trace、逐次用量／成本、品質評分與實驗 | 訂閱額度的權威來源、派工或預算阻斷控制 |
| Agent Usage | 來源可辨認的 quota、reset、活動與帳號支出查詢 | 把不同 scope 的數值混成一個總量 |
| thinrouter／控制層 | 原有路由、fallback、admission；受明確政策約束的控制 | 讓觀測 exporter 決定重送模型請求或擴張權限 |

後三者延續 [P3]；把 Prism 放入此分工是本次建議。

**先平行接入與關聯，不先建立 Prism → Langfuse 的強制串接。** 共用標準 trace context 和受控工作代號，可讓兩邊回查同一次工作；不表示需要共用資料表或由 Prism 代管 Langfuse schema。
兩套服務即使都使用 ClickHouse，也應維持各自 migration、權限與資料生命週期邊界；透過公開 API 整合，不能直接耦合內部表結構。

共用 OpenTelemetry 不代表零成本相容。目前 Langfuse 官方 OTLP 接入支援 HTTP/JSON 與 HTTP/protobuf，尚不支援 gRPC；屬性映射、認證與 API／SDK 版本仍需分別驗證。[L4][L8]
Prism 本身能收 OTLP，不代表它已具備轉送至 Langfuse 的 exporter。

## 6. 值得吸收的原則與接入風險

### 6.1 把事件連回工作，但不污染通用資料模型

沿用 [P3] 的 `task_id`、`run_id`、`request_id`、`attempt_id`、`trace_id`、observation 與 parent 關係，不另創第二套身份模型。
缺少關係就保留缺值；不能從 prompt 或帳號猜出跨請求關聯。
export 重試不建立新 attempt；真實上游 retry／fallback 才各自建立 attempt。指定唯一 `instrumentation_owner`，避免 gateway 與應用 SDK 重複計價。

建議將高基數 request／trace ID 放在受控的 span／log 關聯欄位，不直接升格成 Prometheus labels；跨系統跳轉仍需各自授權，ID 本身不是讀取權限。

### 6.2 從失敗案例建立改善驗證，而非只增加圖表

Langfuse 的 online／offline evaluation、datasets、experiments 與人工／自動評分，可串起「觀察失敗 → 建案例 → 修改 prompt／模型／工具 → 重跑比較」的流程。[L2]
建議把這個閉環放在 LLM 工程層，Prism 保留通用關聯與運作訊號。
評分規則、案例版本與評估成本也需要記錄；模型評分不是客觀正確性的自動保證。第一條摘要用量接入並不需要同時導入內容級 eval。

### 6.3 成本來源、缺值與重複計量

Langfuse 支援上報與推估 usage／cost，上報值優先；官方也要求 usage buckets 不重疊，inclusive provider counts 必須正規化，否則可能雙算。[L5]
因此保留 [P3] 的 `reported`／`inferred`／`missing`、coverage、單價版本及 `billing_mode`；推估值不是已對帳帳單，訂閱費也不是逐次 API 扣款。
HTTP 200 不代表串流完整成功；終態、取消、截斷、失敗中的已知用量要分開處理。

Langfuse 告警的 no-data 預設政策是把缺值當 0，也可保留前態、顯示 `NO_DATA` 或持續缺資料後通知。[L3]
**這是告警評估政策，不是所有原始資料一律把 null 改成零。** 後續必須顯式選擇政策並測試；不能因「沒有收到數據」就顯示「沒有成本／沒有錯誤」。
通知不等於支出阻斷；觀測平台不能追回已發出的上游請求。[P3]

### 6.4 傳送前去敏與故障隔離

延續 [P3]：預設僅輸出白名單摘要，不送完整 prompt／response／工具內容或原始錯誤；內容級 debug／eval 另行 opt-in，定義遮罩與保留期限。
自架不會自動完成去敏。官方 server-side masking 為 EE 功能，而且 worker 遮罩前事件可能已進物件儲存，不能代替 client-side masking。[L7]

建議在任何遠端送出或觀測暫存之前完成必要去敏。exporter 佇列、批次、重試、逾時與關閉等待必須有界；觀測端故障不重送模型請求、不無限阻塞應用。觀測丟棄與送出失敗要能被看見，但不得把敏感原文寫進錯誤紀錄。[P3]

### 6.5 自架成本、版本與授權

Langfuse 自架包含 Web、Worker 與四類儲存元件；需要評估資源、磁碟、備份、保留期限與升級，不把「開源」當成「零維運成本」。部分附加治理功能需 license key。[L6][L7]

後續接入需鎖定 server、SDK、ingestion 與讀取 API。官方 v4 相容矩陣與 legacy API 支援有差異；不能直接複製歷史範例，更不能把 Cloud 可用等同目前自架版本可用。[L8]
本文件不承諾免費額度、特定硬體容量、授權條款或部署費用；實作前再查核所選版本。

## 7. 後續順序與候選驗收（均未啟動）

建議先在既有 T-1101／T-1102 範圍重新盤點計量修正，再以假上游完成最小接入；不要為接 Langfuse 先擴張 Prism。
Prism 的告警接線與通用查詢缺口，仍依原任務順序另行授權。跨系統關聯、內容級評估及自架運維是後續獨立決策，不因新增本文自動排程。

下表是下一份實作規格可採用的測試建議，**不是已批准 AC，也沒有測試通過紀錄**。

| 候選場景 | 建議預期結果 |
| --- | --- |
| 同一 request 的成功、串流中斷與一次 fallback | root／parent／attempt 關係正確；各真實 attempt 唯一結算，終態可辨 |
| exporter retry 與雙重 instrumentation | 不重送模型請求，不增加同一 attempt 的計量；端到端去重以實測證明 |
| 已知零、未知、部分 usage、無單價、重疊 token buckets | 儲存／查詢／展示保留各自語意；不把 unknown 默認 0、不雙算 |
| 觀測端逾時／不可用／佇列滿 | 資源與等待有界，應用行為不被觀測重寫，失敗／丟棄可觀測 |
| 含敏感輸入、工具輸出與原始錯誤的 fixture | 出站事件與診斷紀錄不含禁止欄位；內容採集預設關閉 |
| 告警窗口沒有資料 | 按顯式 no-data 政策處理；不假報成本為零或服務健康 |
| 兩個觀測端的同一 trace 與未授權讀取 | 可在正確授權下關聯；跨租戶／專案查詢仍被拒絕 |

唯一下一步：後續獲准實作時，先讀既有規格、SUCCESS 與最新來源，選一個有界切片重新認領；不要把這份比較當成可直接執行的部署 runbook。

## 8. 來源

內部來源以頁首固定基準為歷史截點；以下相對入口可能隨主線演進。

- [P1] [Prism SDD 總綱](sdd/00-SDD-OVERVIEW.md)、[架構](sdd/01-ARCHITECTURE.md)、[SPI](sdd/03-STORAGE-SPI.md)、[協議映射](sdd/15-PROTOCOL-MAPPING.md)。設計主張，不是 runtime 通過證據。
- [P2] [Prism README](../README.md)、[SUCCESS](../SUCCESS.md)、[STATUS](STATUS.md)、[任務板](tasks/BOARD.md)。歷史驗收的版本與 pending 邊界以這些入口為準。
- [P3] [Langfuse 整合規格](../../../docs/specs/llm-observability-langfuse.md)、[用量正確性規格](../../../docs/specs/llm-usage-correctness.md)、[Agent Usage 任務板](../../../tools/codex-usage/docs/tasks/BOARD.md)。
- [L1] [Langfuse Observability](https://langfuse.com/docs/observability/overview)。
- [L2] [Evaluation overview](https://langfuse.com/docs/evaluation/overview)。
- [L3] [Alerts：版本、通知與 no-data 政策](https://langfuse.com/docs/observability/features/alerts)。
- [L4] [OpenTelemetry 接入與屬性映射](https://langfuse.com/integrations/native/opentelemetry)。
- [L5] [Model usage and cost tracking](https://langfuse.com/docs/observability/features/token-and-cost-tracking)。
- [L6] [Self-hosting：架構與部署責任](https://langfuse.com/self-hosting)。
- [L7] [Data masking：傳送前與接收端邊界](https://langfuse.com/self-hosting/security/data-masking)。
- [L8] [Versions and compatibility](https://langfuse.com/self-hosting/upgrade/versioning)。

[L1]–[L8] 查閱日均為 2026-10-30；屬官方產品文件，不代表本專案已完成整合或獨立驗證其部署效能。
