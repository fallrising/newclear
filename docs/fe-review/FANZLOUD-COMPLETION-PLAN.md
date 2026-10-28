# Fanzloud：完成通知與取消問題的後續計劃

> 2026-10-28 owner決定：依已交付18項結案，Fanzloud暫緩且未完成（8/27、007FAIL/consumed、PR604Draft）。停止延伸Chromium調查；下方舊「下一步」僅為歷史提案，不是待執行工作。唯一恢復入口：[issue706](https://github.com/fallrising/newclear/issues/706)；[結案範圍](https://github.com/fallrising/newclear/blob/main/docs/fe-review/ROUND2-CLOSEOUT.md)。沒有新runtime/build/model授權。

> Latest 2026-10-28 checkpoint: the [bounded existing-environment check](fanzloud-completion-regression/ENVIRONMENT-FEASIBILITY.md) found no compatible Blink test route in the inspected scope. Patch compilation/execution remain NOT_RUN; exclusions and access gaps are explicit. The next recommendation is one bounded read-only upstream fix/history lookup, not a build or browser retry. Earlier preparation/environment recommendations below describe completed milestones.

> 2026-10-28 earlier artifact checkpoint: owner continuation produced the [upstream test-patch artifact](fanzloud-completion-regression/README.md): nine cases, source/helper mapping and explicit gaps. Static apply/reverse passed; compilation and execution remain NOT_RUN. The preparation task below is now represented by that artifact; the next recommendation is its bounded read-only check for a compatible real Blink test environment. No browser or engine/application fix was started.

需求：T-0380，R2-AC-14／R2-AC-E。2026-10-27 owner 要求先把計劃及問題交給 Claude，核對建議後更新文檔，再依文檔繼續。

本次交付是諮詢與計劃文件。沒有實作引擎／產品修正、執行新測試案例或啟動瀏覽器。原 [Round2 SDD](ROUND2-SDD.md) 與驗收條件不變。[PR604](https://github.com/fallrising/newclear/pull/604) 保持 Draft，交付18/19、canonical矩陣8/27；recovery007為FAIL，單次授權已消耗。本文的後續步驟不是新瀏覽器授權。

## 已知問題與證據界線

007初始401的正文與原健康判準通過；認證POST201也有精確正文與成功完成。後續自動session GET200出現`ERR_ABORTED`，觀測者正文取得拒絕；再後續login GET200通過。依應用既有控制流程，發出login前必須完成session串流讀取、JSON解析與嚴格驗證。這支持應用端讀取成功，不能取代觀測者缺少的正文證據。伺服器正常finish／close也不等於瀏覽器收到完整正文。

固定來源的調查找到條件式取消路徑：底層consumer已關閉，delegate仍為loading；delegate先通知BodyStreamBuffer，後者關閉JS串流再清理consumer。清理重入Cancel，搶先標記cancelled，使稍後的done處理失效，最後可產生`ERR_ABORTED`。若delegate的BeginRead／EndRead已先標記done，Cancel則無效。

這是已獨立審查的靜態條件路徑，**不是007的已證實根因、執行重現或修正**。觸發頻率與實際時序未知；不能因路徑看似常見就推論普遍發生。已執行套件／瀏覽器二進位及下游patch的對應尚未完整證實；007該請求的CDP canceled欄位與正文拒絕階段也未留存。

Playwright的`loadingFailed`會解除response終止等待並發出`requestfailed`，但`body()`仍走獨立CDP／scope取得路徑，並非直接重拋`failureText`。`BODY_START`早於`REQUEST_FAILED`不能證明CDP正文命令造成取消。缺Content-Length對fallback的限制只是條件式來源推論，不能用來歸因007。

## 固定來源與可複用的鏈路

Chromium153.0.8010.12：`971a7443b0c9b0a9b2860529b33331b76077ec62`；Playwright1.63：`1b025d7e20a026371cd5f98ba0cdce48892737c8`。已保存16個Chromium及7個Playwright檔案，Git blob與SHA256一致；這不證明執行二進位相同。下表`VERIFIED_SOURCE`只表示固定來源支持該條件，不是執行結果。

| 鏈路／限制 | 固定來源 | 狀態 |
| --- | --- | --- |
| 串流fetch、no-store直接consumer分支；其他buffering分支可能不同 | [FetchManager](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/fetch/fetch_manager.cc#L816)，另見739、1166、1220；RawResource247–279、ThreadableLoader323–329、placeholder59–109 | VERIFIED_SOURCE |
| 必須同時pipe耗盡與完成訊號，才關閉並通知已保存的client | [DataPipeBytesConsumer](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/data_pipe_bytes_consumer.cc#L179)，另見255–291 | VERIFIED_SOURCE |
| 本體未完成時，ResourceLoader暫緩最終完成並通知consumer | [ResourceLoader](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/resource_loader.cc#L1105) | VERIFIED_SOURCE |
| client通知先於HandleResult；重入Cancel可使後續done／error不再改狀態 | [DelegatingBytesConsumer](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/response_body_loader.cc#L127)，另見169–245、268–291 | VERIFIED_SOURCE |
| 正常關閉JS串流後CancelConsumer；GetError也會清理consumer | [BodyStreamBuffer](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/fetch/body_stream_buffer.cc#L384)，另見502–555 | VERIFIED_SOURCE |
| cancellation向ResourceLoader轉送，建立ERR_ABORTED | [ResourceLoader](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/resource_loader.cc#L378)，另見490–493；[ResourceError](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/resource_error.cc#L48) | VERIFIED_SOURCE |
| error經fetcher及frame observer到inspector；canceled依IsCancellation計算 | [ResourceFetcher](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/resource_fetcher.cc#L2690)、[frame observer](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/loader/resource_load_observer_for_frame.cc#L343)、[inspector](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/core/inspector/inspector_network_agent.cc#L1820) | VERIFIED_SOURCE |
| Playwright終止事件與正文取得分開 | [network manager](https://github.com/microsoft/playwright/blob/1b025d7e20a026371cd5f98ba0cdce48892737c8/packages/playwright-core/src/server/chromium/crNetworkManager.ts#L491)，另見589–630；[response body](https://github.com/microsoft/playwright/blob/1b025d7e20a026371cd5f98ba0cdce48892737c8/packages/playwright-core/src/server/network.ts#L647) | VERIFIED_SOURCE |
| 實際套件／binary／patch對應、007實際分支、canceled與body拒絕階段 | 尚無足夠執行證據 | UNVERIFIED |

取消鏈路已在前次完整調查與獨立審查中核對；Claude只收到部分片段，因此它所說的「缺少鏈路」是輸入限制，不是需要重做整份調查。沿用既有來源與證據，只針對新增疑點補查。

## 採納與修正Claude建議

一次Opus5.5文字諮詢完成；模型未讀專案原始碼、未執行命令。採納：先準備上游測試補丁、增加error被轉成cancel的對照、區分NOT_RUN／SLICE／真實Blink執行／產品驗收、保留頻率與binary歸因缺口。

兩項建議經來源核對後修正：

- 不能對所有案例要求「剛好一個終止回呼」。ResponseBodyLoader445–490在aborted時不轉送，在suspended時暫存；應區分活躍且已完整驅動的終止案例、尚在等待／暫停、以及abort後被抑制的通知。
- 沒有client、context被銷毀與CloseStream拋例外是不同情境。BodyStreamBuffer403–407在ContextDestroyed明確CancelConsumer；502–520捕獲例外後則不執行該次清理。不能把它們統一寫成正常Finish。loader假client也不能證明V8／GC／context行為。

不預先選定「把HandleResult移到通知前」。它是待比較候選，仍須檢查lookahead、等待、abort／suspend／drain、生命週期及error優先順序。此文件未提交任何引擎或應用patch。

## 回歸矩陣草案

全部狀態為 **NOT_RUN**。原始結果欄是源碼推導的預期，必須由真正執行確認，不能記成RED。終止事件以外部loader client的finish／fail／cancel次數及先後為oracle，另記底層Cancel；不只驗內部enum。

| ID | 前提與驅動 | 原始來源預期／擬議判準 | 覆蓋層級 |
| --- | --- | --- | --- |
| R1 | live client、delegate仍loading；耗盡後才通知closed；client見closed即Cancel | 可能Cancel一次；擬議修正後Finish一次且無Cancel／Fail | loader gtest；觸發RED候選 |
| R2 | 同樣live條件，底層通知errored，client報錯後Cancel | 可能Cancel一次；擬議修正後保留Fail一次而非改報Cancel | loader gtest；error類比，非007觀測事實 |
| R3 | delegate BeginRead／EndRead已先取得done，再清理 | Finish一次，後續Cancel不新增終止；前後一致 | loader gtest；既有ReadingClient對照 |
| R4 | 非空資料及完成訊號不同排列，包含lookahead／等待後續read | 未耗盡不得提早完成；明確驅動讀完及task queue後Finish一次，資料順序完整 | loader gtest；不能只設定lookahead數值當成真實場景 |
| R5 | 還可讀時真正取消 | 完整驅動後Cancel一次，無Finish；不得被修法吞掉 | loader gtest |
| R6 | 明確loader Abort先發生，再到達遲來通知 | 遵守aborted guard，不新增被抑制的client通知；不能強制Finish或剛好一個callback | loader gtest；與BodyStreamBuffer signal abort分開 |
| R7 | 非BFCache暫停後恢復；另列BFCache路徑 | 暫停中按該分支契約不轉送；恢復且完成驅動後通知，不重複；不混用兩種suspend | loader gtest；精確fixture前提待補丁對照 |
| R8 | 未註冊client，但loader仍live、未abort／suspend，底層完成 | 直接核對無client分支的完成通知；與context銷毀拆開 | loader gtest |
| R9 | 真正BodyStreamBuffer context被銷毀／signal abort | 按既有取消與生命週期契約，不要求成功讀完；不得重複通知或存取失效context | BodyStreamBuffer／Blink整合，不能由loader替身宣稱覆蓋 |
| R10 | 真正CloseStream拋出並被捕獲 | 該次Close不執行CancelConsumer；其他loader及page結果依實際fixture觀察，不保證正常Finish | V8／BodyStreamBuffer整合；可能缺少可用fixture |

R1／R2的完整前提、預期原始結果與期望修正語義，先由補丁的測試名稱／assertions及來源契約審查確認。凡無可實作fixture或oracle未定的列，明示GAP；不得補造通過結果。

## 證據層級

| 產物 | 可以支持 | 不可以支持 |
| --- | --- | --- |
| 固定來源及靜態鏈路 | 條件式控制流程與反例 | 執行重現、頻率、007歸因 |
| 上游風格gtest補丁，NOT_RUN | 可審查、可被未來執行推翻的測試規格 | RED／GREEN、可編譯或已修復 |
| 可選機械擷取source slice，SLICE | 在明列shim假設下的局部控制流程 | 真Blink生命週期／GC／排程、實際二進位或瀏覽器重現 |
| 真正固定來源Blink測試 | 該測試與build中觀察到的原始RED／候選GREEN及控制案例 | 自動證明007原因或產品驗收 |
| 另行批准的實際瀏覽器驗證 | 該來源、配置及單次請求的觀測 | 回溯改判舊FAIL或自動接受其餘viewport |

若日後選slice：必須機械擷取並記原blob、變換diff與shim契約；不手抄狀態模型作引擎證據。必要控制與mutation check必須區分局部模型靈敏度和真正engine RED。slice與推導不符時先檢查擷取／shim／前提，再評估是否推翻源碼推理；不能直接外推Chromium。預設下一步不建立slice。

## 唯一下一個工作單位：準備NOT_RUN上游測試補丁

**輸入**：本文、已固定的23份來源、前次獨立審查、[response_body_loader_test.cc](https://github.com/chromium/chromium/blob/971a7443b0c9b0a9b2860529b33331b76077ec62/third_party/blink/renderer/platform/loader/fetch/response_body_loader_test.cc#L1128)與BodyStreamBuffer測試來源。不重跑來源未變的綠色產品測試，不重做已完成模型／clock分析。

**產物**：對固定commit的測試補丁、README、來源／helper對照表及逐列狀態。先用真正既有測試helpers與可見API表達R1–R8；R9–R10另外標出所需的V8／context fixture與缺口。若既有helpers不足，明確指出缺少哪個公開契約，不自造API或偽裝完整覆蓋。

**範圍與預算**：下一工作單位提案為至多30分鐘本機補丁準備，20分鐘檢查一次可行性，另留至多10分鐘獨立審查。只做測試補丁與必要說明，不改引擎／應用／依賴、不下載SDK或完整Chromium、不啟動瀏覽器、不呼叫新模型。這些時間是該後續任務的建議邊界，不是本次已發生的執行時間。

**交付門檻**：補丁可對固定檔案做靜態適用性檢查；每個實作案例有前提、可見行為oracle、預期原始結果與來源引用；未執行／未編譯／未覆蓋明列。即使靜態apply成功，也保持NOT_RUN。獨立審查只接受補丁／規格品質，不接受引擎或產品完成。

**停止條件**：出現來源反證，先保留並修正文檔；helper／fixture不足、需要大型下載或建置、無法在預算內保持測試忠實性時，交付具體缺口及部分NOT_RUN補丁，不擴張成自製引擎。不得為填滿矩陣而寫只鏡像實作的測試。

**單一重估點**：補丁審查後，再選一條具體可行路徑：取得合適且獲准的真Blink測試環境；針對精確版本查已有上游修正；或設計另行批准的單次安全瀏覽器觀測。不得同時展開三條路線，也不因改名稱重置007已消耗的限制。沒有真實執行路徑時，保留NOT_RUN及可交接補丁就是該步的實際結果。

引擎修正必須等原始來源的預期RED得到真Blink執行確認後才選定；再要求修正GREEN、正常完成／真正取消／錯誤／生命週期對照不退化及獨立審查。產品仍須原來的正文、健康、identity、cardinality與cleanup判準，不能由上游測試替代。

日後若獲准觀測，只記既有讀取的有限bool／enum／本地ordinal：讀取完成、signal-aborted、同一請求CDP terminal／canceled、body拒絕階段。禁止憑證、原始headers／body／IDs、任意reason與全量CDP／netlog；不得增加請求、重讀正文或用跨時鐘排序宣稱因果。

## 本文件的驗證與交接

諮詢內容經主控逐項對照來源，已修正上列生命週期與證據層級問題。文件交付須通過scoped project-success、連結／差異檢查、獨立文件審查、必要CI、正常合併與遠端回讀。執行證據留在對應PR與journal；文件合併不代表上述後續測試已執行。整輪FE與PR604的未完成狀態保留。
