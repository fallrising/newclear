# LLM 用量正確性修正規格

- 任務：T-1102；文件 AC：UC-D01–UC-D03。
- 狀態：文件先行；下列 runtime 修正、重現與驗收尚未執行。
- 核對日期：2026-10-24（UTC）。
- 固定分析基準：`fallrising/newclear@6b444b00457591996db135e4ec6ab65b1d01ad4c`。
- 文件整合基準：`4fc5d9a7b49139115518379bf05e1cfec4fe1bce`；包含後續 thinrouter FE round2，與分析基準分開記錄。
- 主要元件：`gateways/pokercase`（thinrouter）；Agent Usage 的疑點另開元件切片。
- 文件入口：[thinrouter SUCCESS](../../gateways/pokercase/SUCCESS.md)、[任務板](../../gateways/pokercase/docs/tasks/BOARD.md)。

## 1. 目標與交付邊界

讓用量面板能區分已觀測數字、局部資料與未知值，讓串流的一次上游嘗試有可追溯的計量結果。
優先修正已能從原碼確認的計量行為；實際錯誤旅程、修復效果仍須先 RED 再 GREEN 證明。
本文件不是已修復報告，也不將既有 mock、歷史 CI 或文件檢查當成本次 runtime 驗收。

本輪只新增規格及其 SUCCESS／BOARD 認領。後續每個實作切片須先在所屬元件登記 AC、來源與測試計畫。
根 [主線與驗收規範](../project-success.md) 的既有主線、`usable_tag: none` 與未驗項保持原狀。
另一開發案為 T-1101，路徑 `docs/specs/llm-observability-langfuse.md`；本修正案可獨立審查，不依賴另一分支檔案存在。

不在本修正範圍：部署 Langfuse、擴充帳號權限、讀取真憑證／私人 DB、呼叫付費模型、加入排程或建立真正金額硬上限。
不新增登入、帳號發現、訂閱池化或非官方 quota scraping；不恢復 cc-quota 的獨立開發。

## 2. 證據與問題分類

S1–S7 均固定連到分析 commit；其他相對連結只作目前文件導航，不能據此推斷舊版本事實。
整合基準的 `proxy.rs`、`store.rs` 與 Agent Usage 原碼未變；`usage.html` 已有 FE 更新，S3 只代表分析基準，實作前須重核現版 UI。

| 證據 | 核對入口／函式 | 能證明什麼 |
| --- | --- | --- |
| S1 | [proxy.rs](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/gateways/pokercase/src/proxy.rs)：`cli_attempt`、三個協定轉送分支、`extract_usage_tokens`、`estimate_cost`、`record_failure` | 串流記帳、時間取樣、缺值處理與 error body 寫入 |
| S2 | [store.rs](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/gateways/pokercase/src/store.rs)：`log_usage`、`usage_cost_total`、`usage_by_day`、`usage_csv` | SQLite 欄位、彙總與匯出行為 |
| S3 | [usage.html](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/gateways/pokercase/templates/usage.html) | 分析基準 UI 的成本、成功、token 與延遲標示 |
| S4 | [Agent Usage 核心](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/agent_usage.py)：`claude_db`、`claude_history_rows`、`run_fixed` | snapshot／history SQLite guard 差異與程序清理路徑 |
| S5 | [Codex collector](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/codex_usage.py)：`RPC.close`、`collect` | 固定唯讀 RPC、身份驗證與 owned process group 清理 |
| S6 | [統一入口測試](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/tests/test_agent_usage.py)、[history 測試](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/tests/test_usage_history.py)、[collector 回歸](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/tests/test_regressions.py) | 已存在的合成資料／程序測試與尚須診斷的測試假設 |
| S7 | [Agent Usage SUCCESS](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/SUCCESS.md)、[交付紀錄](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/docs/evidence/2026-10-23-delivery.md)、[任務板](https://github.com/fallrising/newclear/blob/6b444b00457591996db135e4ec6ab65b1d01ad4c/tools/codex-usage/docs/tasks/BOARD.md) | 來源能力、歷史交付、FU-01–07 與當前驗收缺口 |

### 2.1 已確認的原碼行為缺陷；尚無本輪 runtime 重現

| ID | 確認事項 | 影響與修正邊界 |
| --- | --- | --- |
| D-01 | S1 的原生串流分支及 CLI 串流分支先 `log_usage`，token／cost 填 `None`，後續交出 stream | 至少這些路徑未把 terminal usage 結算到同一筆 ledger；不能概括為所有 provider 都漏計 |
| D-02 | S1 在串流開始時記 200；S2 每日 `ok` 直接依 `status=200` 計算 | HTTP headers 成功被誤當整次生成成功；須另存 terminal outcome，保留原 HTTP status |
| D-03 | S1 在讀完 body／stream 前取 `start.elapsed()`；S3 統稱 latency | 現值不能聲稱 total latency 或 TTFT；還須核對 fallback 是否沿用整體起點 |
| D-04 | S2 的 token／cost `SUM` 經 `COALESCE(...,0)`，總成本亦 `unwrap_or(0.0)` | 全未知與局部缺漏沒有 coverage，易被看成真零或完整總額 |
| D-05 | S1 `estimate_cost` 對缺 completion token 或單側價格使用 0 | 部分資料可產生看似完整金額；須保留缺值，區分已知小計與完整估算 |
| D-06 | S1 `record_failure` 與轉送錯誤分支以 `e.body.chars().take(500)` 寫入 error | 截長沒有去識別；確認的是 raw body 寫入路徑，不是已發生真憑證外洩，須以合成 canary 重現 |

上述確認指「程式確有此分支／算式」。正式缺陷驗收還要記錄實際 fixture、輸入、輸出與失敗斷言。
cache／reasoning 的完整細分不是此版本已承諾的全 provider 能力；新增映射須按 §5 的來源契約另行驗證。

### 2.2 待重現疑點與環境診斷

| ID | 目前證據 | 下一個可判定步驟 |
| --- | --- | --- |
| Q-01 | `claude_history_rows` 先拒絕 WAL／sidecar，`claude_db` snapshot 直接 `mode=ro` 連線 | 用合成 WAL 複本比較兩入口的檔案 hash、mtime、目錄清單；尚不能宣稱真 DB 已被修改 |
| Q-02 | 本次比較會話重跑回報 83 PASS／1 FAIL，涉及 descendant PID 與 `/proc` 映射；歷史交付為 84 PASS | 保存本次完整命令／環境／失敗日誌，核對 PID namespace 與實際 owned child 身份後再判定 |
| Q-03 | 目前測試與原碼不足以涵蓋全部 stream、fallback、取消及記帳競態 | 以 §6 的本機 HTTP／fake CLI 矩陣建立可重現證據，不先改 production 行為 |

Q-02 暫列環境問題待確認；不是已確認 production 遺留程序。不得為綠燈跳過該案例、吞掉失敗或放寬停止條件。
測試不能拿子程序回報的數字直接比對另一 PID namespace 的 `/proc`；需驗證 PID、PGID、啟動標記與 owned process 關係。
不得用廣域 `pkill`、掃描／終止使用者既有程序或修改主機 namespace 來完成診斷。

### 2.3 功能擴充與實機驗收缺口

| 項目 | 正確分類與處置 |
| --- | --- |
| Kith 的 trace 卡片、兩個 token 欄位、未有完整 span tree | 能力限制；屬 T-1101 開發案，不能當成本輪已承諾功能的 bug |
| Kith 未全域附加 `stream_options` | 既有相容策略；若補 usage，只能依 connection／adapter capability 啟用並測試，不全域強開 |
| Agent Platform 真金額及 `hard_money_limit_supported=false` | 既有範圍與驗收限制；保留 reservation／unknown 語意，不在本輪製造帳單硬上限 |
| Agent Usage FU-01–07 | 來源／實機驗收工作，沿用原編號，不以更多 unit tests 宣稱完成 |
| cache／reasoning／多模態／tool 計價 | 逐來源映射能力；沒有來源的欄位為 unsupported／unknown，不要求每個 provider 全部支援 |

## 3. 必須保留的串流完成語意

基準已包含 [T-0386](../../gateways/pokercase/docs/tasks/T-0386-stream-completion.md)、[T-0389](../../gateways/pokercase/docs/tasks/T-0389-buffered-responses.md)、[T-0401](../../gateways/pokercase/docs/tasks/T-0401-native-responses.md) 的程式修正。
本案增加 accounting／measurement，不把這些已修正的 protocol terminal 問題重新列為未修。
歷史任務檔內的 publication pending 是當時快照；最新合併狀態須由 commit／PR 回讀確認，不能抹掉原紀錄。

- Chat 保留既有 `finish_reason` 後 EOF 的相容性與 `[DONE]` 契約；無完成證據的 EOF 不變成成功。
- Responses 的 completed／incomplete／failed/error 仍須通過現有 terminal 一致性檢查；bare `[DONE]` 不冒充 terminal。
- Messages 保留 `message_stop`／error 判定；轉換器及 buffered collector 的 first-terminal-wins 行為不變。
- 原生 Responses 的接受 frame、未知欄位、序號、16 MiB 上限、CR/LF/CRLF 及 CR lookahead 行為不退化。
- headers 已送出後不能撤回 HTTP 200；在 protocol 層表達失敗，同時由 accounting 記錄失敗／不確定結果。
- output 已終結與 usage 已收齊分開：Chat 最後 usage chunk 可在內容 finish 之後，不能因提前 finalization 丟掉它。

計量攔截點應在上游 observation 邊界，協定轉換只投影一次；不可同時計算上游 usage 與轉換後合成 usage。
不得為讀取末尾 token 而把全部 response／prompt 緩存在記憶體，或改成無界等待 EOF。

## 4. 計量與台帳契約

### 4.1 一次請求與一次 attempt

`request_id` 表示一個 gateway 請求；`attempt_id` 表示一次實際上游 dispatch。
fallback／既有合法 retry 是不同 attempt，透過 parent request 關聯；不是覆寫前一個失敗 attempt。
識別碼由受控入口產生；不接受外部任意檔案路徑、帳號識別或 shell 內容作為記帳鍵。

每個 attempt 在 dispatch 前建立持久記錄，以唯一鍵與條件更新完成一次 finalization。
建立持久列失敗時不 dispatch；結算失敗保留未決列並回報固定錯誤碼，不藉重送上游補記帳。
terminal、取消、timeout、body drop 同時到達時，只有一個最終列；重複 callback 不新增另一筆費用。
這裡的 exactly-once 是本機 ledger 的去重與結算，不宣稱網路／上游執行恰好一次。
程序於 dispatch 後中斷，重啟將未結算列標為 interrupted／unknown，不能當未執行，也不能自動重送模型請求。
未知 attempt 留在統計分母與未確定占用中；已有 admission reservation 的系統不得因缺 token 退款。
thinrouter 本輪只補記帳，不由「未知占用」推導新增訂閱扣額或真正金額 gate。

### 4.2 最小資料欄位

| 類別 | 必須保留的語意 |
| --- | --- |
| 關聯 | schema revision、request／attempt ID、connection alias、provider／protocol、實際模型或 unknown |
| 傳輸 | HTTP status 與 terminal outcome 分開；outcome 至少區分 succeeded、incomplete、failed、cancelled、timeout、interrupted、unknown |
| 用量 | 每個數值可為 null；`usage_status` 區分 complete、partial、missing、unsupported、invalid |
| 來源 | provider-reported／CLI-reported／explicit-estimate；adapter／CLI／schema revision 與來源時間是否可得 |
| 成本 | complete estimate、known subtotal、unknown 分開；currency、price revision／basis、計價缺漏原因 |
| 時間 | UTC 記錄時間；monotonic 計算的 headers、first output、觀測到終結／本機停止的耗時 |
| 品質 | 哪些必需欄位缺漏、是否歷史資料、是否有未知 attempt；不得以純數值 0 代替 |

沒有足夠語意對齊時，不把不同 provider 的 token 總量直接合成「訂閱消耗」。
CLI 回報成本、依價格表估算成本與帳戶實際帳單是不同 basis；本輪不新增帳單對帳能力。
error 只保存固定分類碼與合成測試識別，不保存 raw stderr、upstream body、prompt、輸出全文、header 或 credential。
既有 error 列不自動上傳或複製到新 telemetry；保留必要歷史證據與存取邊界，另由授權資料清理 task 處理。

### 4.3 時間定義

- `headers_ms`：從本 attempt dispatch 到上游 headers／CLI ready 的觀測值；CLI 與 HTTP 要標明不同事件。
- `first_output_ms`：到首個有內容的輸出 delta；role、ping、空字串不算。文字與工具 delta 的適用性寫入 adapter 契約。
- `total_observed_ms`：到本機看到有效終結或停止等候；取消後 provider 是否繼續執行仍未知。
- parent request 的總耗時與每 attempt 耗時分開；fallback 不將累積耗時重複當各 attempt latency。
- 不可取得的值為 null；不以 headers latency 回填 TTFT 或 total，不以任意 sleep 當精確時間斷言。

## 5. 協定映射、價格與缺值彙總

### 5.1 上游 usage 擷取

本表是待實作映射；官方來源查閱日為 2026-10-24。實作時須釘住支援的 API／CLI／SDK 版本與 fixture。
目前 HTTP adapter 與 CLI bridge 不要求新 SDK；若改用 SDK，要記錄套件版本、stream accumulator 行為與授權依賴變更。

| 上游／適用路徑 | 來源欄位與處理 |
| --- | --- |
| Chat Completions JSON／SSE | `usage.prompt_tokens`、`completion_tokens`；SSE 最終 usage 可為空 choices chunk；累計值不可逐 chunk 相加 |
| Responses JSON／SSE | 有效 response 的 `usage.input_tokens`、`output_tokens`；completed／incomplete／failed 的用量可缺，outcome 不由 usage 有無決定 |
| Messages JSON／SSE | `message_start.message.usage` 與 `message_delta.usage` 合併；delta usage 是累計，不能將 start 與各 delta 重複加總 |
| 官方 CLI bridge | 只讀現有已驗證 terminal／usage 欄位；CLI model／version 未知要明示，不聲稱等同對應 HTTP API 的全部細分 |
| 協定轉換鏈 | 以上游 format 建一份 canonical observation，再供三個 client protocol 使用；新增 observer 不改既有 response bytes／terminal |

Chat 的 `stream_options.include_usage=true` 僅對明示支援的 connection 啟用。
不支援／未知上游維持現行 payload；不能探測失敗後自動重送同一推論來索取 usage。
未收到最後 usage 不代表 0；成功 output 可同時有 missing usage，失敗 output 也可能有可用的 partial usage。

官方參考：[Chat stream](https://developers.openai.com/api/reference/resources/chat/subresources/completions/streaming-events)、[Responses stream](https://developers.openai.com/api/reference/resources/responses/streaming-events)、[Messages stream](https://platform.claude.com/docs/en/build-with-claude/streaming)。

### 5.2 cache／reasoning 與價格

OpenAI 已核對 schema 的 `usage.prompt_tokens_details.cached_tokens`／`usage.input_tokens_details.cached_tokens` 是 input 細分。
`usage.completion_tokens_details.reasoning_tokens`／`usage.output_tokens_details.reasoning_tokens` 是 output 細分；均不能再加進 totals。
以上欄位是否出現仍依 endpoint、model 與版本能力；新增細分須另附精確 schema，不泛稱所有相容上游都支援。
Anthropic 的 `input_tokens`、`cache_read_input_tokens`、`cache_creation_input_tokens` 按其 schema 分列後計算總 input，不能套用 OpenAI 的包含關係。
參考：[OpenAI usage 說明](https://help.openai.com/en/articles/10478918-reviewing-api-usage-and-costs)、上節兩份 OpenAI stream schema、[Anthropic input 計數](https://platform.claude.com/docs/en/build-with-claude/context-windows)。

各 adapter 必須列出 bucket 名稱、單位、subset／disjoint 關係、是否累計與支援狀態；不存在欄位不憑模型名稱補 0。
只有來源明示 0 或已驗 schema 保證省略等於 0 時才可存 0；其餘保留 null 與原因。
測試以合成價格為主，完整估算採固定精度 decimal 或整數最小貨幣單位；明示 rounding，禁止靠浮點誤差過驗收。
價格記錄 provider、model、currency、service tier／計費方式、revision、適用時間及每種 bucket 費率。
缺必需 token、缺適用費率或有不支援的計費類別時，complete estimate 為 null，可另列 known subtotal 與 coverage。
後續更新價格不能覆寫已記錄的歷史估算；需要重算時另附新 revision／結果，原值可追溯。
訂閱 token 的公開 API 等值估算如要提供，須獨立標示 hypothetical，不算帳單也不推導 quota remaining。

### 5.3 彙總契約

每個 metric 回傳 `known_sum`（無已知值時 null）、`known_count`、`unknown_count`、`total_count`、coverage 與 basis。
complete total 只有在該範圍必需資料全齊時才可表示；部分已知的小計不可標為完整花費。
沒有事件用 `total_count=0 / status=no_data` 表示；不與「有事件但全部 token unknown」混為一談。
按 provider／model／currency／price basis 分組；不同貨幣或估算與帳單不可直接相加。
UI、JSON API、CSV 必須對同一列與同一 filter 得到一致結果；CSV 缺值為空並附狀態，不輸出數字 0。
每日成功數依 terminal outcome；另保留 headers-200 數、failed／incomplete／unknown 數，避免修改歷史 HTTP 事實。
可視化不得把 unknown 補零連線；顯示資料覆蓋率，不用更多圖表掩蓋來源不足。

## 6. 重現與回歸矩陣

以現有 fake upstream／fake CLI、隔離 SQLite 與受控 clock 執行；不需真帳號或付費呼叫。
主矩陣橫跨三種 client protocol：Chat Completions、Messages、Responses。
每種 protocol 至少覆蓋原生、現行支援的轉換與 buffered 路徑；不支援組合記 N/A 及既有邊界，不擴充協定能力。

| case | 合成情境 | ledger／計量期待 |
| --- | --- | --- |
| M-01 | 正常 terminal，完整 usage（串流與 JSON） | 一個 attempt、一筆 finalization；與 fixture counters 精確一致 |
| M-02 | 正常 terminal，省略 usage／只提供一側 | outcome 仍依 terminal；missing／partial 不變 0 |
| M-03 | HTTP 200，文字／工具 delta 後 EOF，或完整 frame 前斷線 | 保留既有 protocol failure；ledger 非 succeeded，未知費用保留 |
| M-04 | 明示 error／failed／incomplete，usage 有／無 | outcome 與 usage 分開；有來源的數字保留，不能因失敗抹掉 |
| M-05 | content finish 後才有最終 usage；累計 usage 重複到達 | 收齊合法尾端數據；不重加、不重複 finalization |
| M-06 | downstream 取消、body drop、上游 stall／timeout | 結束本機 owned 工作；記原因與 unknown，不推斷上游未計費 |
| M-07 | terminal 與取消競態、重複 callback、終結後雜訊 | 唯一 attempt 最終列；first-terminal 規則不退化 |
| M-08 | headers 前合法 fallback／retry：第一個失敗、第二個成功 | 兩個 attempt、一個 parent；第一筆未知成本仍在 coverage 分母 |
| M-09 | headers 後錯誤、quota／429 或 transport unknown | 保留既有不允許的 retry 邊界；observer 不新增推論或重播 |
| M-10 | reserve 後／dispatch 後／finalize 前後 SIGKILL | 持久列保留；重啟不重送、不重複金額，未決列為 interrupted／unknown |
| M-11 | 0、null、負值、非數、超界、缺價／單側價、不同 currency | 合法 0 保留；畸形拒絕／標 invalid；缺值不產生完整估算 |
| M-12 | cache/read/write/reasoning 子集及互斥 bucket、未知 provider 欄位 | 按已驗 mapping 計算；無重複 totals；未知欄位不破壞原始轉送 |
| M-13 | 空 DB、全 unknown、混合 known/unknown、舊資料 migration | API／UI／CSV 同義，coverage 可核對，歷史 null 不回填 0 |
| M-14 | headers 快但 body 慢、延後首 delta、fallback 不同等待 | headers／first output／total 各自有正確起點與界線 |
| M-15 | 合成 body／stderr／header 含識別 canary、超長錯誤、observer queue 滿或儲存失敗 | DB／UI／CSV／log 無 canary；既有 protocol 限制與背壓不變，observer 記固定碼且不無界緩衝／重播 |

parser 回歸另保留 UTF-8、任意 bytes 分片、CR/LF/CRLF、ping、空 choices、工具片段與既有 bounded frame 測試。
每個負例先保存固定基準的 RED，再保存修復 commit 的 GREEN；RED 必須是期待行為失敗，不能拿缺環境代替。
測試紀錄包含來源 SHA、fixture revision、命令／exit code、實際 dispatch 數、ledger 列數與未執行項。

## 7. Agent Usage 診斷與來源驗收

Q-01 用既有 snapshot schema 建 synthetic DB，包含 rollback、header-only WAL、WAL 複本含／不含 SHM、既有 journal。
兩入口各驗讀取前後 hash／mtime／sidecar 清單；不開真 DB、不 checkpoint／轉 journal mode／刪 sidecar。
若重現 snapshot 違反唯讀邊界，另開修復切片，優先共用已驗 preflight；拒絕策略與讀取能力改變須寫入契約。
不得以 `immutable=1` 靜默漏掉未 checkpoint 的 WAL 資料來宣稱已解決。
若未重現，保留測試環境與不支持情境；「未重現」不轉成「全環境安全」。

Q-02 保留 83 PASS／1 FAIL 與歷史 84 PASS 的不同來源，不改寫歷史證據。
以同一來源在可驗證 PID 對應的 POSIX 環境重跑 failing test，再核對 owned group 清理與 marker-based 生存證據。
若是測試觀測方法缺陷，修測試並保持實際停止要求；若是 runtime 缺陷，先重現再修 production cleanup。
未診斷清楚時該 gate 為 BLOCKED／FAIL，不新增環境偵測 skip 來冒充 PASS。

FU-01 Codex 同帳號可見窗口／reset 比對；FU-02 Claude 真來源；FU-03 Cursor Admin spend 真身份／費用比對仍保留。
FU-04 OpenCode Go、FU-05 Grok、FU-06 Grok Bot、FU-07 Antigravity 的官方 quota 來源仍需各自調查／實測。
來源不存在可結論 unsupported；人工／本機 stats 不冒充自動 quota。沒有完整 quota-cycle token 來源時 `cycle_tokens=null`。
本輪文件與純 synthetic 測試均不關閉上述 FU；實機接線、憑證與必要呼叫另依具體 task 授權處理。

## 8. 文件當前狀態與歷史證據

當前狀態以元件 SUCCESS 頂部的「核對版本／當前能力／尚缺項／最新交付」摘要為入口，README 只引用它。
BOARD 記錄本切片狀態；真 merge SHA／時間／CI 由遠端回讀後才填，不預先寫 done。
舊「未提交」「CI 未跑」「pending」保留於註明日期／commit 的歷史段落或 evidence，並附 superseded-by 指向。
不得改舊 failure 成 PASS、刪掉 RED／REWORK／受阻嘗試，或把歷史 live snapshot 當作今天重取。
最新摘要須分別列文件、offline、live、visible-status、CI、merge、deploy；不能以單一 completed 遮掉差異。
本輪先規定清理方法；後續 doc-only 切片執行逐段搬移／標示，驗證引用不斷與歷史內容可追溯。

## 9. 分期、責任與 Given／When／Then

| 階段／AC | Given／When／Then | 元件與完成證據 |
| --- | --- | --- |
| P0／UC-D01 | Given 固定來源，When 文件審查，Then D／Q／能力限制分類可逐項回查且不冒稱 runtime 重現 | 本文件；thinrouter SUCCESS／BOARD 的 T-1102 |
| P0／UC-D02 | Given 三協定與既有 terminal 契約，When 覆蓋審查，Then §4–7 有明確資料、重現與驗收矩陣 | 本文件與獨立審查；runtime 未實作 |
| P0／UC-D03 | Given 兩條獨立文件 PR，When 交接，Then 分期、migration、命令、成本與實機邊界可獨立執行 | 本文件、文件 CI／回讀；不依賴 T-1101 合併 |
| P1／UC-R01 | Given D-01–06 的合成旅程，When 在固定來源重現，Then RED 顯示實際記帳／error 保留問題且排除既有 terminal 已修範圍 | thinrouter 新 task；M-01–04、11、13–15 |
| P2／UC-R02 | Given 已登記 attempt，When terminal／取消／崩潰，Then 去重結算、unknown 保留且無新增 dispatch | thinrouter SUCCESS／BOARD；M-01–10 |
| P2／UC-R03 | Given 各 protocol usage，When 正規化，Then 可用欄位精確、unsupported 清楚且轉換不雙算 | thinrouter SUCCESS／BOARD；M-02、05、11、12 |
| P3／UC-R04 | Given 新舊混合資料，When 彙總／UI／CSV／migration，Then null、coverage、價格與時間一致 | thinrouter SUCCESS／BOARD；M-11–14 |
| P3／UC-R05 | Given 帶合成 canary 的錯誤及受限 observer，When 記錄／查詢／匯出／儲存失敗，Then 無敏感全文落地、資源有界且不新增 dispatch | thinrouter SUCCESS／BOARD；D-06、M-15，exporter 前置 gate |
| P4／UC-R06 | Given synthetic SQLite 各模式，When 比較 snapshot/history，Then 證明唯讀或保存可重現反例並修復 | Agent Usage 新 task／SUCCESS／BOARD；Q-01 |
| P4／UC-R07 | Given 同來源與可驗 PID 身份，When 重跑 cleanup gate，Then 能區分環境誤判與真缺陷且不 skip | Agent Usage 新 task／SUCCESS／BOARD；Q-02 |
| P4／UC-R08 | Given 最新交付與舊證據，When 整理當前摘要，Then 無矛盾當前狀態且歷史 failure 全可追溯 | 各被改元件獨立 doc task；§8 |

P1–P4 為待認領實作，不能因本文件 PR 通過而標 passed。P4 可獨立於 thinrouter 執行，但須先完成自身認領。
T-1101 的 thinrouter exporter 以 UC-R02–UC-R05 為前置 gate；若未完成，要保留 dependency／unknown，不能旁路重做計價或匯出 raw error。

## 10. Migration、回復與驗證入口

migration 優先新增 nullable 欄位或新版本 attempt 表，保留既有 `usage_events` 與舊 id；禁止清空 DB 重建。
舊列標 `legacy`：不推測 terminal、完整 token、TTFT 或 price revision，不把歷史 null 填 0。
保留舊 `latency_ms` 的原始值與 legacy 語意；新增明確時間欄位，不靜默把同名欄位換成另一種時間。
API／CSV 增加 schema revision；既有欄位型別若須變 nullable，提供版本化讀取與 UI 同步升級計畫，不假定舊 client 會接受。
先在 synthetic 空庫與舊 schema 複本驗 migration／重跑冪等／讀取相容；實際 DB 備份與部署須在後續 rollout task 授權。
回復方案須保留新 attempt／未知列；不能 downgrade 後靜默停止記帳。若舊 binary 不相容，停寫並由授權操作者回復已驗備份。
collector／observer 的開關只控制新功能，不取消既有 auth、cost admission、取消／隔離或 protocol validation。

文件階段由 repo root 執行：

```sh
python3 scripts/check_project_success.py
python3 scripts/check_indexes.py
git diff --check
```

後續 thinrouter 切片的既有基本命令（另加對應 RED／focused regression）：

```sh
cargo +1.99.0 test --locked --manifest-path gateways/pokercase/Cargo.toml
cargo +1.99.0 fmt --manifest-path gateways/pokercase/Cargo.toml --check
cargo +1.99.0 clippy --locked --manifest-path gateways/pokercase/Cargo.toml --all-targets -- -D warnings
```

後續 Agent Usage 切片在 `tools/codex-usage` 執行：

```sh
python3 -W error::ResourceWarning -m unittest discover -s tests -v
python3 -m py_compile codex_usage.py agent_usage.py
```

執行時記錄真實 Python／Rust／SQLite／OS 版本；缺 toolchain 或 PID 觀測條件記 BLOCKED，不安裝任意版本掩蓋差異。
新測試名稱與檔案由認領切片建立後才寫成已存在命令；必要 CI／獨立審查及來源回讀各自留下結果。
本輪預算為零 product model calls、零新增付費服務；只讀官方文件與合成資料。任何 live 驗收不得由此規格默示授權。
公開 evidence 只保存 fixture、來源 SHA、命令摘要與去敏結果；不含 email、帳號、token、私人目錄、prompt 或真 response。
修正完成的判準是逐 AC 有來源對齊的結果；文件合併、測試數量增加或新圖表都不能代替該結果。
