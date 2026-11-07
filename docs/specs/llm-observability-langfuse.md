# LLM 執行觀測與 Langfuse 整合規格

Status: **文件先行／Draft；尚未實作 exporter、接入服務或部署**。核對日期：2026-10-24。
工作：T-1101；文件驗收 LD-D01–03；入口為 [Agent Usage SUCCESS](../../tools/codex-usage/SUCCESS.md#t-1101--langfuse-整合文件先行)。
本輪授權限規格、文件檢查與 Draft PR；以下 runtime 設計是後續工作的驗收契約，不代表已授權執行。

## 1. 問題與決策

目前「用量」包含訂閱剩餘窗口、本機活動、API 支出和每次模型呼叫，來源與時間範圍不同。
只增加圖表無法解決來源混用、串流尚未完成就記成功、估算被當帳單或多層重複計價。
本規格保留現有採集與控制責任，由 Langfuse 承接執行 trace、逐次用量／成本分析與後續品質評估。

- Agent Usage 繼續負責唯讀 quota／活動／支出查詢；不建立第三個 quota 專案。
- thinrouter 保留 admission、route、fallback、憑證與上游生命週期；觀測 exporter 不介入路由決策。
- Langfuse 使用官方服務與介面，做薄接入；不 fork 整套 UI、資料庫、prompt 或 eval 平台。
- 先修正計量，再建立第一條最小接入；圖表可見不等於數據正確或產品主線完成。

## 2. 固定核對基準與現況

| 來源 | 完整來源 SHA／版本 | 本次核對範圍 |
| --- | --- | --- |
| [fallrising/newclear](https://github.com/fallrising/newclear/tree/6b444b00457591996db135e4ec6ab65b1d01ad4c) | `6b444b00457591996db135e4ec6ab65b1d01ad4c` | Agent Usage 契約、thinrouter 的 proxy／store 與完成狀態 |
| [langfuse/langfuse](https://github.com/langfuse/langfuse/tree/ad8d5641486176f9fef4e399bdd85a7b1ecf3842) | `ad8d5641486176f9fef4e399bdd85a7b1ecf3842`，release `v4.70.0` | observation schema、計量優先序、Compose、授權與官方整合文件 |

最新整合基準為 newclear `4fc5d9a7b49139115518379bf05e1cfec4fe1bce`；相對分析 baseline，
相關 `proxy.rs`／`store.rs` 與 Agent Usage 計量原碼未變。此來源差異核對不取代後續 runtime 驗收。

newclear 的已讀入口是 [quota-signal](quota-signal.md)、[使用指南](../../tools/codex-usage/docs/agent-usage.md)、
[thinrouter SUCCESS](../../gateways/pokercase/SUCCESS.md)、[proxy.rs](../../gateways/pokercase/src/proxy.rs)、
[store.rs](../../gateways/pokercase/src/store.rs) 與 [cost-safety](../../gateways/pokercase/docs/cost-safety.md)。
本節是來源盤點，沒有重跑歷史真帳號驗收；實作前須記錄新 baseline 與其後差異。

- Agent Usage 已有統一 JSON／table、Codex collector、Claude DB／statusline、OpenCode stats、Cursor spend 與 manual。
  原 Codex AC-04 可見狀態對照、FU-01–07 來源工作及其他 live 限制沿用 SUCCESS，不由本規格消除。
- `gateways/pokercase` 的 binary 是 `thinrouter`；目前是 flat SQLite usage rows，沒有本規格的 task/run/attempt 關聯。
  部分串流路徑在開始回應時寫入 200、tokens／cost 為空；日彙總有 `COALESCE(SUM(...), 0)`。
  這些讀碼發現須由獨立修正工作驗證與修復，不能直接匯成可信任的完整帳目。
- thinrouter 仍為 Tier C／dormant、mainline incomplete；選作未來接入點不等於恢復全部開發。
- Langfuse 的 observations 分開保存 provided／computed usage 與 cost；支援 trace、session、model、tags、eval。
  官方 Codex／Claude Code hook 讀 transcript，不能據此宣稱它提供訂閱 quota／reset 採集。[L1] [L2] [L3]

## 3. 目標與非目標

### 目標

1. 一次真實上游 attempt 對應一筆可信任的計量事件，能區分成功、失敗、取消、截斷與未知。
2. 對接 Langfuse 後可回答某個任務／run 的模型、耗時、可知 tokens、成本依據及資料缺口。
3. 配額、帳單／支出、推估值各自保留來源、scope 與時間，不因儀表板整合而混算。
4. 預設只輸出白名單摘要；不依賴完整 prompt、response 或工具內容才能做用量分析。
5. 觀測服務失效時，原有模型請求不因 exporter 被重送、改寫或無限等待。

### 非目標

本輪不新增 runtime、SDK 依賴、服務、憑證、模型請求、全域 hook、排程、歷史搬遷、帳號掃描或告警發送。
不恢復 cc-quota；不改 Agent Usage 的只讀／無模型邊界；不承諾全 provider、全協定接入。
不以 Langfuse 取代 hard budget、quota admission、任務排隊或取消已發出的工作。
不交付多租戶計費、HA 或集中身份平台；Langfuse 的原生 gateway 不作本切片前置依賴。

## 4. 責任邊界

| 層 | 保留責任 | 與其他層的介面 |
| --- | --- | --- |
| Agent Usage／既有 collector | 訂閱窗口、reset、freshness、來源與身份可驗性 | 原 JSON 契約；不把 quota snapshot 偽裝成 generation |
| 任務／控制層 | 派工、併發、政策、hard budget；決定如何使用可用訊號 | 讀 quota 的明確 scope／stale；讀 trace 作分析，不能用未知數據冒充授權 |
| thinrouter | admission、route／fallback、上游請求與可信任 attempt 事件 | 從原始上游回報產生最小事件；不讓 exporter 持有 provider credential |
| Langfuse | trace、token／cost 分析、dashboard、後續 eval | 非同步接收白名單事件；不是推論成功的依賴 |

未知／過期 quota 不得被 exporter 解讀為零，也不得因此中止現有工作。
任何新的 fail-open／fail-closed 派工政策須在控制層另行定義；現有 admission 的拒絕條件不被觀測功能放寬。
監控通知不等於阻斷支出：關閉 gateway key 也不能追回已送出的 provider 請求。

## 5. 第一條接入與修正依賴

第一條路徑選 `thinrouter → 白名單事件 → 有界 exporter → Langfuse`。
先驗 generic OpenAI-compatible HTTP 上游的 Chat Completions，包含非串流、串流、錯誤、取消與一次 fallback。
第一輪使用腳本化假上游；其他協定、CLI bridge、訂閱 hook 與多 agent 全鏈路是後續明示擴充。

接入之前須通過修正工作 T-1102：`docs/specs/llm-usage-correctness.md` 的 UC-R02–05。
該規格在另一條獨立 PR；本文件可獨立審查，runtime 工作不能跳過下列依賴：

- UC-R02：完成／失敗／取消依 attempt 終態唯一結算，HTTP 200 與收到 headers 不代表生成成功。
- UC-R03：協定 usage／price buckets 正規化且不雙算；重試／fallback 不漏記，也不重記同一 attempt。
- UC-R04：缺 tokens、缺單價、部分資料不被默認零，coverage 與價格時間在儲存／API／UI／CSV 一致。
- UC-R05：原始錯誤不進公開觀測；observer 有界。失敗時仍保留可知 usage，不能一律計成免費。

既有 SQLite rows 不足以推導 task/run 或可靠的終態；第一階段只接新事件，不回填猜測的歷史 trace。
完成修正後才設計 additive event／store 調整；不先依賴目前 flat row 當新契約。

## 6. 資料種類、來源與狀態

| `metric_scope` | 內容與來源 | 匯總限制 |
| --- | --- | --- |
| `subscription_quota` | collector 的窗口百分比、reset | 不跨窗口加總，不從 tokens／金額換算 |
| `local_activity` | CLI／本機觀測統計 | 不冒充帳號總量、quota cycle 或 provider 帳單 |
| `llm_attempt` | 一次實際送出的模型呼叫及其上游回報 | 只有可關聯的不同 attempts 可相加 |
| `account_spend` | 官方支出 API／帳單的已知區間 | 與涵蓋同區間的逐次估值對照，不直接相加 |
| `subscription_fee` | 明確記錄的固定訂閱費與期間 | 不由每次 token 生成「實際扣款」 |

新增事件的每個 usage／cost 欄位均有 `provenance: reported | inferred | missing`：
`reported` 表示來源明確回報，不保證它已與帳單對帳；`inferred` 必須記算法／單價版本；`missing` 的值為 null。
另記 `quality: exact | approximate | invalid | unknown`，將 CLI 縮寫近似值與權威整數區分。
人工或 fixture 以 `source_kind`／`evidence_kind` 明示，不能因格式合法被提升成真實來源。

`source_kind`、`source_version`、`schema_version`、`metric_scope`、`billing_mode` 是來源契約的一部分。
`billing_mode = api_metered | subscription | local | unknown`，由可信任設定指定，不從模型名稱猜測。
資料狀態 `complete | partial | missing | invalid` 與執行結果分開；一次成功請求也可能沒有 usage。
不輸出 raw upstream body 來「保留 provenance」；使用已審核的 parser／配置版本及缺值原因碼。

## 7. 最小事件與關聯 ID（新增提案）

這些欄位尚未存在於 thinrouter 的現有 usage schema；實作 PR 必須明確列出新增位置與相容策略。

| 欄位 | v1 規則 |
| --- | --- |
| `schema_version`、`source_version` | 固定版本；未知 major 不猜解析 |
| `task_id` | 可選、受控的非敏感任務代號；缺值保留 null |
| `run_id` | 一次任務執行的內部 ID；裸 gateway 請求可獨立產生，不假造跨請求關係 |
| `request_id` | 一次邏輯 gateway 請求；fallback 沿用 |
| `attempt_id`、`attempt_index` | 每次真正上游派送各一組；重試／fallback 新建，export retry 不變 |
| `trace_id` | 一個邏輯 gateway request 一個 trace；其 request span 與所有 attempts 共用，不從內容或帳號推導 |
| `observation_id` | request root span 與每個 attempt 各一個隨機且固定 ID；export retry 沿用 |
| `parent_observation_id` | attempt 指向已建立的 request root span ID；root 為 null，不獨立亂造 parent |
| `instrumentation_owner` | 唯一計量權威，例如 `thinrouter`；其他觀察者只記無計量 span |
| `model`、`route_label`、`provider_kind` | 已審核的模型／列舉與本地安全別名，不送 connection ID／名稱 |
| `started_at`、`ended_at`、`exported_at` | UTC RFC3339；未知來源時間為 null；觀測與匯出時間不互相代替 |
| `first_output_ms`、`total_observed_ms` | 沿用 T-1102 的單調時鐘差；未知為 null，不能用 headers latency 冒充首 token |
| `outcome`、`error_code` | 沿用 succeeded／incomplete／failed／cancelled／timeout／interrupted／unknown；不附原始錯誤文字 |
| `usage`、`cost`、`completeness` | 按本文件規則校驗的白名單數值、來源與缺值原因 |

`task_id/run_id` 只接受可信任內部呼叫方的受限格式；不把任意 HTTP header 直接寫入 metadata。
未具可信任上下文時 gateway 自建關聯，`task_id=null`；Langfuse session 可用內部 `run_id`，不用 provider session ID。
task/run 可有多個 request／trace；request 下每個實際 attempt 各一個 generation，root 不附 model／usage／cost。
canonical outcome 完整保留於白名單 metadata；Langfuse 的 level／status 顯示不能吃掉 timeout／interrupted。
`first_output_ms` 指首個有內容的輸出 delta，排除 role／ping／空字串；文字／工具 delta 依 adapter 契約。
它不直接填 Langfuse time-to-first-token；只有可證明首 token 的 adapter 才另外提供該指標。
`total_observed_ms` 到本機終結或停止等候，不能推斷取消後 provider 已停止或未計費。
被 admission 拒絕而沒有上游呼叫的請求只產生 event／span，不能算一個模型 generation。

### 去重與重試

- 同一次 LLM 派送只允許一個 cost authority；gateway 與 SDK／hook 同時存在時，非權威 span 不送 model／usage／cost。
- 不能證明相同 attempt 的跨來源資料不靠時間／模型近似合併；標 `unlinked`，排除跨來源合計並列出缺口。
- 權威事件在 attempt 終結時產生一次；解析中的重複 cumulative usage 取可信任終值，不逐 chunk 相加。
- Export retry 沿用相同 observation ID／payload；模型重試一定有新的 attempt ID，兩者不可共用計數器。
- 不假設 SDK／後端天然 exactly-once：須對固定 Langfuse 版本驗重送與 metrics 結果，才允許不確定 ACK 後重送。
- 若後端去重未驗，僅重試確定未送出 bytes 的連線失敗；ACK 不明記 `delivery_unknown`，不盲重送。
  第一階段沒有跨重啟 replay；process crash 的未送事件算可能遺失，不宣稱已完整入庫。

## 8. Token 與成本的計量規則

### Token 不重複計數

1. provider 明確回報值優先；沒有可靠 usage 時保留 null，不用 prompt 字數／bytes 推算官方 token。
2. `input_total` 若已含 cache，`input_uncached = input_total - cache_read - cache_write` 只在該 provider 明確定義下成立。
   cache read/write 的子類也必須互斥；未知包含關係只保留原欄位，不捏造可相加總數。
3. `output_total` 若已含 reasoning，總 output 不再加 reasoning；需要細分時才求有證據的互斥差額。
4. `total = input_total + output_total` 只在兩者同 scope、互斥且完整時推得，並標 inferred。
5. 拒絕負數、布林值、非有限數、溢位或不可能的 subset；局部有效資料保留，但不由無效欄位生成成本。
6. 累計 account/session usage 不當成本 attempt usage；沒有可驗證差分邊界就不做減法。

fixture 例：input 100（含 cache 40）、output 30（含 reasoning 10），總 token 為 130；
互斥細分是 input uncached 60、cache 40、output non-reasoning 20、reasoning 10，不能得到 180。
缺 output 時 total 與完整成本仍未知；明確回報 output=0 才是已知零。

### 金額的三種主要用途

| 類別／`cost_basis` | 可聲稱的含義 | 不可混用 |
| --- | --- | --- |
| `provider_reported` | provider 回報的實際 API 支出／當期 spend，附區間與 currency；對帳狀態另列 | 不與覆蓋相同區間的逐次估值再加一次 |
| `subscription_fixed` | 某訂閱期間的固定費用 | 不能以 token × API 單價冒充每次扣款 |
| `api_equivalent_estimate` | 訂閱／本地工作量按指定 API 牌價的比較估值 | 不是帳單、剩餘額度或可兌換金額 |

API 請求只有 tokens＋price table 時，另標 `api_price_estimate`，仍不能列為已核對的實際支出。
估算必須帶 `price_version`、`currency`、`priced_at`、單價單位與已知 coverage；缺某個必要單價時完整成本為 null。
可列 known partial cost，但必須與完整合計分欄，附缺值筆數；不能顯示「總花費 0」掩蓋未定價呼叫。
同一報表不合計不同 currency／期間／重疊 scope；金額內部用十進位或明確固定精度，不逐項浮點四捨五入。

Langfuse 可依 model 自動推價，metadata 的 `cost_basis` 不會自動禁止此行為。[L1]
因此第一條接入只接 `api_metered`，其預設 cost 看板標示「觀測成本／估值」；實際 spend 保留獨立資料與對帳。
訂閱接入後續須證明其 views／filters 或獨立 project 不會混入 API 實際支出報表，才可開啟；不能填 cost=0 來壓掉估算。
選擇 Langfuse 推價或 exporter 提供估值時，每條 route 固定一個估價 authority；保留來源與價格版本，不兩邊累加。

## 9. 隱私與資料最小化

Export 先依白名單建立新物件，再序列化；不能把 raw event 放進 metadata 後用黑名單刪幾個欄位。
允許的資料限第 7 節關聯與安全標籤、固定結果碼、時間、usage、cost 及 provenance。

預設禁止 prompts、responses、reasoning text、tool arguments/results、system prompt、圖片、附件、檔案路徑、
email、帳號／workspace／provider request 或 session 原始 ID、cookie、token、Authorization、connection 名稱及 raw errors。
本輪不新增 provider raw ID 欄位；必要的本地關聯使用新產生的隨機 ID，不直接 hash email 當匿名身份。
資料範例與測試只用 synthetic 值；錯誤碼採白名單，未知錯誤只記一般分類，不附 exception 字串。

官方 Codex／Claude Code hook 可傳送完整 transcript；尤其 Codex 文件明示內容不截斷。[L2] [L3]
它們不作本規格的預設接入，也不自動改全域設定；未來需要內容級偵錯／eval 時另定 opt-in、遮罩與保存期限。
Langfuse 自架不是自動完成遮罩；Cloud／自架都須在送出之前完成相同白名單驗證。

## 10. 有界匯出、失敗與時間

以下是第一階段的提案預設值，實作可在 review 提供量測後調整；上限必須有限且可驗證。

| 項目 | v1 約束 |
| --- | --- |
| 開關 | 預設 off；啟用需明確指定允許的 endpoint 與 Langfuse 專用 secret 引用 |
| 單事件 | 序列化後最多 8 KiB；metadata 最多 32 欄；越界拒絕而不截斷成語意錯誤的事件 |
| 等待佇列 | 最多 256 events 且 1 MiB；先達上限即丟棄新事件並記 counter，不等待模型請求 |
| 批次 | 最多 32 events 且 256 KiB；最多一個在途 batch，含 retries 計入記憶體預算 |
| HTTP／重試 | 每次最長 1 秒；單事件最多 2 次 export retry、總壽命 30 秒；遵守前節 ACK 規則 |
| 關閉 flush | 全局 deadline 2 秒，包含當前請求與重試；到期即停止並記未送筆數 |
| 本地持久化 | 第一階段不建 raw spool／新 DB，不掃描舊 SQLite 自動回補 |

熱路徑只做有界摘要與 `try_enqueue`；網路、退避、批次序列化由背景 worker 完成，不能 await exporter 才回模型輸出。
exporter timeout／429／503／無效設定不觸發 provider fallback、OAuth refresh 或第二次模型請求。
驗證 endpoint、TLS、redirect 行為；Langfuse 專用 credential 只給 exporter，不轉送給 provider，也不記錄到診斷。

本地健康摘要至少有 accepted／exported／dropped／invalid／delivery_unknown counters、最後成功時間與 queue depth。
不把 `accepted` 計成 `exported`；batch partial failure 依逐項結果處理，不能整批默認成功。
沒有 durable queue 就不保證 crash 後完整；Langfuse 暫時空白不等於沒有模型活動。
報表附 missing／partial／dropped coverage，採樣後不得宣稱精確總量或暗中放大帳單。

source time、event time、export time 分開；duration 使用單調時鐘，不用 UTC 時鐘跳動算負延遲。
晚到事件按事件時間歸屬，重送不得更新事件發生時間；時鐘不可信時標 quality，不能猜跨程序先後順序。
原 quota freshness／reset 判斷維持來源契約，不能因成功送到 Langfuse 就重新變 fresh。

## 11. 里程碑與停止條件

| 里程碑 | 可交付內容 | 進入／退出條件 |
| --- | --- | --- |
| M0 文件 | 本規格、修正規格、各自 Draft PR | LD-D01–03 文件證據；不新增 runtime、不變更主線完成度 |
| M1 correctness | T-1102 對應計量與隱私修正 | 另開實作任務；相關回歸與審查通過，薄接入不得跳過 |
| M2 最小接入 | thinrouter 的事件 contract、預設 off exporter、假上游與本地接收端 | 另行授權；LF-R01–10 本地證據；ACK unknown 保守不重送 |
| M3 Langfuse 驗證 | 對固定服務／SDK 版本查回 trace、計量、後端去重與停用 | LF-R11–12；後端去重仍 pending，不能以 fake receiver 代替 |
| M4 可選擴充 | 其他協定／CLI、訂閱觀測、內容級 eval | 各自有新範圍與 AC；不自動納入本輪承諾 |

M2/M3 不需要以真模型產生測試資料；實際服務寫入、機器資源或 Cloud 帳號仍須依當次授權執行。
真 provider／訂閱資料驗收另列，不以 synthetic trace 或歷史 screenshot 代替。
未能證明去重、數據來源或白名單時停在預設 off；不為展示先繞過 correctness gate。

## 12. 驗收矩陣

### 本輪文件驗收

| ID | Given／When／Then | 本輪證據要求 |
| --- | --- | --- |
| LD-D01 | Given 固定 baseline 與現有契約，When 審查範圍，Then quota／控制／觀測職責、首條接入與非目標一致。 | 完整 SHA、可回讀來源、SUCCESS／任務板引用及獨立文件審查 |
| LD-D02 | Given 可能缺值、重複、敏感與失敗資料，When 審查事件設計，Then provenance、計量、去重、privacy 與有界匯出均有可測規則。 | 第 6–10 節及 LF-R01–10；不以文字 PASS 代替未執行測試 |
| LD-D03 | Given 兩條獨立文件 PR，When 檢查交接，Then 依賴、里程碑、驗收／停用流程可獨立閱讀。 | 文件／連結／索引檢查，實際 commit／PR／CI 與回讀結果由交付紀錄保存 |

### 未來 runtime 驗收（全部 pending／本輪未實作、未執行）

| ID | Given／When／Then | 必要證據 |
| --- | --- | --- |
| LF-R01 | Given stream／non-stream 相同 usage，When 結束或中斷，Then 終態與欄位完整度正確且不以 headers 200 當完成。 | 腳本化 HTTP upstream；成功、失敗、取消、截斷與 usage 缺漏矩陣 |
| LF-R02 | Given cache／reasoning subsets、缺值、零與非法數字，When normalize，Then 不重算 subsets、不補零或產生無依據成本。 | 第 8 節數值 fixture 與 malformed cases |
| LF-R03 | Given 一 request 兩次真 attempt，When fallback，Then 兩個 attempt IDs；同一 attempt 重複 chunk 只有一筆權威計量。 | 上游呼叫次數＋local event＋receiver 的一致對照 |
| LF-R04 | Given gateway 與 SDK／hook 觀察同一呼叫，When 匯出，Then 僅一個 authority 有 model／usage／cost；不明關聯不得硬合。 | 重複來源、缺 ID、衝突 ownership fixtures |
| LF-R05 | Given API estimate、provider spend 與訂閱估值，When 查詢總額，Then currency／basis／scope 不混加且標 missing coverage。 | 報表查詢條件與已知／未知金額對照 |
| LF-R06 | Given 含秘密與 transcript 的原事件，When export，Then 僅白名單摘要送出；拒絕資料的 log 也沒有原文。 | 對實際序列化 bytes 與 diagnostic log 的 canary 檢查 |
| LF-R07 | Given receiver 慢、斷線、429／503 或 queue 滿，When 模型正常結束，Then 原回應不等待網路／不重送模型，記憶體與重試有界。 | 固定負載與 process／queue／upstream-call counters |
| LF-R08 | Given shutdown 與未送 batch，When flush，Then 2 秒 deadline 內返回並列未送／不確定筆數。 | fake clock／受控 receiver；不以無界 sleep 驗證 |
| LF-R09 | Given known-unsent／timeout-after-accept／partial ACK，When 本地 exporter 處理，Then 僅確定未送出的事件可有界重試，ACK unknown 不重送。 | 受控 receiver／transport 狀態機，固定 ID 與逐項結果；不宣稱後端已去重 |
| LF-R10 | Given late event、時鐘跳動或過期 quota，When 查詢，Then event/export/source time 分清，freshness 不被刷新。 | 時間 fixture 與原 quota regression |
| LF-R11 | Given 固定 Langfuse／SDK 版本及 synthetic trace，When 寫入、同 ID 重送並回讀，Then hierarchy、tokens、cost basis、缺值與唯一計價一致。 | API／UI／metrics、fixture hash 與去識別結果；通過後才可設計開啟 ACK unknown 重送 |
| LF-R12 | Given exporter 已啟用，When 停用／移除 secret，Then 無新 export、原 gateway 與 collector 行為不變；舊資料不自動刪除。 | 前後 receiver 計數、既有 regression 與回讀 |

## 13. Rollout、停用與交付證據

實作後順序：correctness gate → default-off 本機 fake receiver → 獲授權的 Langfuse synthetic project → 單一路徑 opt-in。
每步記錄版本、設定摘要、case 結果、coverage、額外模型呼叫數（應為零）及可回讀的 trace/query 證據。
擴大到真實工作前，核對 whitelist、成本顯示語意、bounded failure、停用回歸與既有 pending AC。

停用只關閉 export 並在既定 deadline 丟棄未送佇列；不刪舊 trace、資料庫、憑證或修改 provider 設定。
問題定位使用內容無關的 reason codes／counters；不為排錯臨時開完整 transcript 上傳。
後續實作若新增 SQLite 欄位，須 additive 相容，rollback 不以 DROP TABLE 或搬移舊檔為必要步驟。

文件 PR 收尾須執行 `git diff --check`、本文件相對連結檢查與 `python3 scripts/check_indexes.py`。
新增檔需由交付者加入 index 後再跑共用檢查；它驗文件結構，不驗 runtime 或 staged bytes。
由交付者在 SUCCESS／任務板保存文件驗收命令與結果；最終 commit、Draft PR、head 對應 CI 與遠端回讀記於 PR 描述及 Checks。
文件 AC 通過後任務仍保持 in_progress、end 留空；合併後才依技術任務合約收尾，不自指尚未產生的最終 HEAD。
本規格不預填尚未取得的 PASS、merge、usable tag、production 或部署證據。

## 14. 運行方式與待定選擇

Langfuse 核心可 MIT 自架，EE 附加治理能力另有授權；Cloud 依 trace／observation／score units 計費，並非 tokens。[L4] [L5]
自架需 Web、Worker、PostgreSQL、ClickHouse、Redis/Valkey 與 object storage；Compose 本身不提供 HA／backup。[L4]
個人使用先衡量運維與資料量，不為一條 quota 查詢引入完整叢集；Cloud 也必須遵守相同最小化邊界。
本輪不選 Cloud 或自架、不重抄變動價格；實作前才確認部署環境、版本相容、額度與實際維護成本。
其餘未決項是 Rust OTel／直接 OTLP 的最小依賴、後端重送語意、可接受負載下的延遲與丟棄率。
這些是 M2/M3 的驗證輸入，不是容許省略去重／privacy／成本 basis 的空白授權。

## 官方依據（2026-10-24 核對）

[L1]: https://langfuse.com/docs/observability/features/token-and-cost-tracking
[L2]: https://langfuse.com/integrations/developer-tools/codex
[L3]: https://langfuse.com/integrations/developer-tools/claude-code
[L4]: https://langfuse.com/self-hosting
[L5]: https://langfuse.com/docs/administration/billable-units

- [Observation schema（固定 SHA）](https://github.com/langfuse/langfuse/blob/ad8d5641486176f9fef4e399bdd85a7b1ecf3842/packages/shared/src/domain/observations.ts)
- [Usage／cost 計算（固定 SHA）](https://github.com/langfuse/langfuse/blob/ad8d5641486176f9fef4e399bdd85a7b1ecf3842/worker/src/services/IngestionService/index.ts)
- [OpenTelemetry 接入](https://langfuse.com/integrations/native/opentelemetry)：原生 OTLP；實作須固定 SDK／server 相容版本與 ingestion 選項。
- [Enterprise 邊界](https://langfuse.com/self-hosting/license-key)；[當期價格](https://langfuse.com/pricing)。
