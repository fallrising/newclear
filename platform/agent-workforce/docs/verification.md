# 驗收與證據分層

- 狀態：M1 選定 FAKE 離線部分已實作／驗證；有界 M2 native 切片的結果見 [M2 契約](m2.md)；完整停止／resume gate 受阻，API/live/soak 仍 Proposed/NotRun。
- 設計日期：2026-10-11。
- 對應：[主 SDD](../SDD.md)、[第一場景](first-scenario.md)。

## 1. 驗收原則與狀態

每個驗收結果必須能回答：哪一版程式、哪個 route／帳號 entitlement、哪種環境、哪個輸入與候選成果、做了什麼、看到什麼，以及哪些部分仍未知。源碼中有 adapter、官方文件描述能力、CLI help 成功、假測試、真實呼叫、完整工作交付及長時間運作各是不同證據。

歷史 DOC 層結果記於 §4.1。M1 選定 FAKE 離線部分的實作、測試／DB觀察與延期範圍見 [M1 契約](m1.md)；FAKE-06/09/11/14/15、完整FAKE-16仍為 `NotRun`。M2 逐 route NATIVE 結果在 [M2 契約](m2.md) 另列，不能提升完整 M2、API、LIVE 或 SOAK。文件 QA 或開發模型工具的使用不提升產品 runtime 層結果。既有相鄰產品的歷史測試只可標為 source/reference evidence，不直接繼承成新整合的通過證明。

| 狀態 | 意義 |
| --- | --- |
| `NotRun` | 尚未執行；可能已有計畫或測試程式 |
| `Blocked` | 某必需前置缺失；記錄具體原因與受影響範圍 |
| `Unsupported` | 指定版本／route 已有證據不支援該能力；不能以未找到文件推定 |
| `Unknown` | 呼叫、用量、外部副作用或停止結果無法確認；不能當成功、零費用或可重試 |
| `Failed` | 已執行且觀測違反指定 oracle |
| `Passed` | 在完整 evidence tuple 上滿足該案例；不外推其他版本、帳號或產品 |

本文件的 AC 是本項目要求；runtime 的返回碼、模型自述和第三方 receipt 都只是觀測輸入。只有符合相應 oracle 與獨立驗收規則，才能形成完成結論。

## 2. 驗收條件追溯

Test IDs 是完整設計的案例識別。M1 離線部分已對應 tests/test_m1.py、domain/admission、Store/fault 和 demo 測試；具名 scope 見 M1 契約，未實作部分不因同名案例而提升。

| AC | 可驗證條件 | 第一場景對應 | 必要案例／層 |
| --- | --- | --- | --- |
| WF-AC-01 | Worker、Product、Account、Entitlement、Route、Resource、Session、Run 身份分離；一產品多帳號、一帳號多資源且配額共用 | §2–3 | WF-T-DOC-01；WF-T-FAKE-01 |
| WF-AC-02 | Route 固定 harness/model/profile/auth 與使用規則；未知／不匹配 evidence 不 dispatch，不以產品名猜能力 | §2、SC-03、§8 | WF-T-DOC-02；WF-T-FAKE-02；WF-T-NATIVE-01；WF-T-API-01 |
| WF-AC-03 | Inbox/outbox 先落盤再回 receipt，重送／ACK 丟失保持一份邏輯訊息與一份 WorkCommand | SC-01–02 | WF-T-FAKE-03；WF-T-LIVE-01 |
| WF-AC-04 | WorkCommand admission 來自可信 job grant；agent 訊息、grant_ref 和 caller 自報不能擴權 | SC-GRANT-01–04 | WF-T-DOC-03；WF-T-FAKE-04；WF-T-NATIVE-02 |
| WF-AC-05 | 發送／spawn 邊界不明時保留 operation 與 Unknown；不換 ID、account 或 route 盲目重做 | SC-03、§7 | WF-T-FAKE-05；WF-T-NATIVE-03；WF-T-LIVE-02 |
| WF-AC-06 | Native resume 只對匹配 SessionBinding；reconstruct 新 session 有 lineage，不接續無關對話 | §6 | WF-T-FAKE-06；WF-T-NATIVE-04 |
| WF-AC-07 | Account、session、workspace 併發與 lease fence 生效；lease 到期不代表舊 process 已停或容量可釋放 | SC-03、§7 | WF-T-FAKE-07；WF-T-NATIVE-03；WF-T-SOAK-01 |
| WF-AC-08 | Writer 範圍與 reviewer 只讀成果隔離；共享檔案／跨工作 overlap 需命中 owner／claim，不互覆 | SC-04–05 | WF-T-FAKE-08；WF-T-NATIVE-02；WF-T-LIVE-01 |
| WF-AC-09 | Exit 0 僅為觀測；candidate、AC、review、verification 對同一 digest，過期證據不放行 | SC-04–06 | WF-T-FAKE-09；WF-T-LIVE-01 |
| WF-AC-10 | Credential/grant 在送出前重查；到期、撤權、輪替不放大 grant，不泄漏秘密、不假稱 in-flight 已撤銷 | SC-GRANT、§6–7 | WF-T-FAKE-10；WF-T-NATIVE-05；WF-T-API-02 |
| WF-AC-11 | Artifact 以 ACL、大小、hash、版本／expiry 核對，缺失或腐敗不被當作完成成果 | SC-02、04–06 | WF-T-FAKE-11；WF-T-LIVE-01；WF-T-SOAK-02 |
| WF-AC-12 | Kith INV-13 保持，bot 不冒充 operator；channel replay 只建 projection，零新增工作 dispatch | SC-GRANT-03、SC-06、§7 | WF-T-DOC-03；WF-T-FAKE-12；WF-T-LIVE-03 |
| WF-AC-13 | API class agent→agent 對話有有限 recipient/hop/message/turn/時間預算；未知用量不視為零 | SC-GRANT-04、§8 | WF-T-FAKE-13；WF-T-API-03；WF-T-SOAK-01 |
| WF-AC-14 | 遠端交付綁定 grant、target/base/candidate，先意圖後操作；重放、base drift、receipt 丟失不重複寫入 | SC-06、§7 | WF-T-FAKE-14；WF-T-LIVE-04 |
| WF-AC-15 | ContextPack、觀測與 evidence 有來源與缺口，換入口可接續；未知項不被摘要成已完成 | §6、§9 | WF-T-DOC-01；WF-T-FAKE-15；WF-T-LIVE-02 |
| WF-AC-16 | 重啟、停止、備份還原與長時間等待保持 inbox／命令／成果，恢復不重發已開始操作 | §6–7 | WF-T-FAKE-16；WF-T-SOAK-01–02 |

## 3. 證據層與 promotion gate

| 層 | 要證明的事情 | 不能證明的事情 | 前置／結果 |
| --- | --- | --- | --- |
| DOC | SDD、AC、狀態機、來源、相對連結和責任邊界一致；公開內容無私人配置 | Adapter 已實現、登入可用、合約許可、部署成功 | 本次可執行文件 QA；逐項記錄實際結果 |
| FAKE | 合成 provider／clock／transport／process adapter 下的狀態轉移、去重、授權、故障 oracle | OS 隔離、真 CLI 格式、真訂閱/API、實際帳單 | 後續實作測試；無 provider credential |
| NATIVE | 指定 Codex／Claude 等 route 的非互動、原生事件、工具、權限、session、停止語意 | 其他帳號／版本／父 runner 自動可用；完整協作已部署 | 使用與正式呼叫匹配的環境及授權；結果逐能力記錄 |
| API | 真實模型 API 或官方 SIWC 訂閱授權 API 的 endpoint、模型、auth、事件、用量／限流與截止 | 任意 CLI 訂閱可轉 API；其他 auth/billing route 自動可用；未知帳單為零 | 明確有界 opt-in；核對各自 eligibility／scope／billing source，預算及敏感值由可信配置提供 |
| LIVE | 第一場景跨 controller／workers／產物／review 的真實完整往返，並包含有限故障 | 24 小時可靠性、任意六產品相容、生產 SLA | Writer/reviewer route 已驗證；外部變更需要既有有效授權 |
| SOAK | 有界長時間等待、週期喚醒、服務重啟與恢復後狀態連續 | 模型永不失敗、24/7 無人運作、任何負載容量 | 時長、故障計畫、資源／成本上限與成功判定事先固定 |

Promotion 必須綁定實際 route tuple：產品／調用方式、帳號與 entitlement revision、harness 版本、精確 model、profile/config digest、OS／執行身份別名、父 runner、來源 commit、測試時間與 evidence digest。不匹配的變更進入 needs-revalidation。公開文件只展示合成 tuple 與必要版本，真實 account／環境對照留受控 evidence。

Native 與 API 的 verification 分開，auth／entitlement 也分開。一次 API-key 成功不能提升同廠商 SIWC 或 CLI subscription route；SIWC API 的成功也不提升 legacy app-server authentication。一次 Codex CLI 成功不能提升 Claude、Cursor、Grok Bot、Antigravity 或 OpenCode。

## 4. 文件層案例

| Test ID | 方法 | Oracle |
| --- | --- | --- |
| WF-T-DOC-01 | 逐表核對身份 cardinality、SessionBinding、ContextPack、狀態與來源引用 | 每個變更狀態有唯一 authority；沒有把 model/account/runtime/workspace 混為一個 ID；關聯 AC 無孤兒 |
| WF-T-DOC-02 | 核對 provider 能力／使用規則的官方來源、日期和 unknown 註記 | 每項 route claim 有來源或明確待驗證；CLI、API、native server 和 UI/channel 分開 |
| WF-T-DOC-03 | 對照 Kith 固定版本 INV-13／INV-19，審查 first-scenario 的 grant 與作者身份 | 無冒充 operator、無取消既有 quota gate、無 replay 觸發；不修改相鄰元件非目標 |
| WF-T-DOC-04 | 檢查相對連結、Mermaid 結構、AC/test IDs、範圍、公開／私人資料界限 | 沒有私有 repo／帳號／host／credential path；無虛構可執行命令、已通過 runtime 或已上線聲稱 |

DOC 層尚未實際執行的檢查不能打勾。M0 Pure-SDD 未建立 runtime；M1 現在已有獨立合成 oracles、SQLite/fake call observations 和明示的延期部分。

### 4.1 M0 文件核對結果：2026-10-11

以下對應 WF-T-DOC-01～04。基準為 newclear `82ee784c3329acdf640c9f4867afe64cbf8b1b8a` 加本次文件變更；實際提交版本、原生檢查輸出與審查結論由本次 PR 關聯。審查主 SDD 的 SHA-256 為 `19116380982283ee9514a903b96dff5f5c7bfafd5ed6f99f2f0d18de9498c548`。

| 案例 | 結果 | 實際方法與限制 |
| --- | --- | --- |
| DOC-01 | Passed | 主 SDD 經獨立架構審查；核對 authority、command/attempt identity、狀態出口、session 與 context。16 個 AC 與 34 個唯一 test ID 均有定義且具名引用無缺漏。這是設計一致性證據。 |
| DOC-02 | Passed | 官方來源研究與 provider/admission 審查；訂閱、CLI、SDK、SIWC/API、原生完成與外部驗收分開。來源日期及無法直接擷取的查核限制在能力表保留；各實際帳號 entitlement 與 runtime 仍未知。 |
| DOC-03 | Passed | 對照 Kith 的固定來源及整合基準，確認 INV-13、INV-19、ephemeral runner 與可選 M3 接線邊界；未改 Kith、Agent Platform 或 HAI 的實作。 |
| DOC-04 | Passed | 以完整 Git tree 路徑清單核對本次 11 份變更文件的 104 個相對連結；4 張項目 Mermaid 圖解析及 SVG 渲染成功；native llms validator 的 5 份索引零錯誤，diff whitespace、改動範圍及新增公開文字檢查通過。相對連結檢查不涵蓋遠端 URL 可用性或 fragment。 |

主 SDD 的架構及 provider/admission 檢查有獨立 reviewer；場景／verification 草稿另經整合核對，沒有將同一撰稿人的自查算作該稿的獨立 review。上述結果不表示 schema、adapter、provider/tool 呼叫、SaaS 操作或部署已執行。

## 5. 假測與故障注入矩陣

Fake 控制 clock、transport、native acceptance、spawn journal、lease、credential revision、artifact store 及外部 publisher。故障只對隔離 fixture，不能以 kill 既有主機服務或使用真實秘密來模擬。

| Test ID | 注入點／反例 | 必須觀察到的狀態與副作用計數 |
| --- | --- | --- |
| WF-T-FAKE-01 | 同產品兩帳號；一帳號兩 worker／多 resource；角色換 route | 身份各自穩定；共享 account cap 正確；不把每個 worker 當成獨立配額 |
| WF-T-FAKE-02 | 能力未知、版本漂移、使用規則未核對、錯 profile/evidence | 零新增 dispatch；該 route unavailable/needs-revalidation，未放寬其他 gate |
| WF-T-FAKE-03 | outbox commit 前後、send 前後、receiver 落盤後 ACK 丟失、重複投遞、同 step 的 grant 續期／輸入變更 | commit 前不受理；同訊息 ID 可恢復；同 job/step 同輸入返回原 command、不同輸入拒絕；續期不 duplicate，unknown attempt 阻擋第二個 attempt |
| WF-T-FAKE-04 | 偽造 caller、grant_ref、agent 回覆要求提權／換 account／擴 scope | admission 拒絕；零未授權模型／工具／外部 mutation；原授權不變 |
| WF-T-FAKE-05 | runtime 已接受未回 ACK；CLI 已 spawn 但 process receipt 未寫；串流已有內容後斷線 | operation 保留 Unknown；有證據才對帳接續；零 replacement／新 ID 重送 |
| WF-T-FAKE-06 | 正確 session resume、錯 account/role/workspace、原生 resume 不支援、原 turn 仍 unknown | 僅匹配且已驗證能力可 resume；reconstruct 用新 ID 與 lineage；unknown 時不重建執行 |
| WF-T-FAKE-07 | lease 失聯、舊 epoch 遲到、同 account/session 併發、stop receipt 遺失 | stale publication 拒絕；資源不提前釋放；未知 process 阻止 replacement |
| WF-T-FAKE-08 | 同檔案／prefix 重疊 writer；reviewer 寫 workspace；base/AC 更新 | overlap 拒絕或交給指定 owner；reviewer 寫入拒絕；舊輸入候選不被當作 current |
| WF-T-FAKE-09 | exit0 但工具被拒、空產物、假測試成功文字、candidate 換 hash、舊 review | 仍 awaiting_review／Failed／Unknown；不產生完成紀錄；不竄改歷史證據 |
| WF-T-FAKE-10 | credential／grant 排隊過期、送出前撤權、in-flight 輪替、audit 不可寫 | 新 admission 拒絕；已發生與 unknown 分開；不向 agent 交付 secret；audit 失败不 dispatch |
| WF-T-FAKE-11 | artifact 缺失、大小超限、hash 不符、ACL 錯、expiry 過期 | 不提供錯誤 bytes、不放行 review/完成；保留可恢復缺口 |
| WF-T-FAKE-12 | channel duplicate/replay、agent mention personal route、recipient 反射 loop | projection 去重；零新增 personal dispatch；sender 保持 agent；Kith gate 不變 |
| WF-T-FAKE-13 | API agents 互相 reply、超 hop/turn/message/deadline、quota 未知或耗盡 | 達 cap 停止新 turn；無自動改 account；unknown usage 保持 null/unknown；idle 不呼叫模型 |
| WF-T-FAKE-14 | publisher intent 前後、遠端寫成功 receipt 丟、base drift、重放 publication | 未授權零寫；uncertain 只讀查核；沒有 force 更新／重複 PR；新 candidate 需重新核對 grant |
| WF-T-FAKE-15 | ContextPack 漏來源、引用舊 candidate、摘要把 unknown 改成 done | 包被拒或顯示缺口；恢復不依賴全對話；未知不被隱藏 |
| WF-T-FAKE-16 | 各非終態 controller 重啟、backup restore、保存中斷、停止訊號遺失 | 持久意圖／receipt 可對帳；replay 不執行；未確認 stop 保留 reservation／unknown |

Fault oracle 同時檢查 DB/日誌中的狀態與受控 adapter 的 observed calls。只看「最後畫面正常」不能證明沒有重複模型呼叫、工具副作用或外部寫入。

## 6. 原生 CLI／server route 驗收

每個產品以自己的官方接口建立獨立 evidence。先有 version/help/config 的無模型 preflight，再做有界真實任務；preflight 不得自行登入、安裝、更新、採用隱含預設 model 或讀取 credential 值。

| Test ID | 測試 | Oracle |
| --- | --- | --- |
| WF-T-NATIVE-01 | 固定 Codex／Claude 路徑，以匹配環境取得 bounded native 輸入／輸出 | 真實產品／版本／model／profile 可追溯；結構化事件依原生 dialect 解析；不把 JSON 可解析當完成 |
| WF-T-NATIVE-02 | Writer 只改已授權 scratch 成果、Reviewer 讀固定副本，測必要工具及拒絕 | 指定修改／驗證如實完成；禁止 scope 無新增效果；required tool denial 不被藏在 exit0 |
| WF-T-NATIVE-03 | 本次建立的 CLI 於 spawn receipt gap、lease 失聯、timeout/cancel 中停止或對帳 | 有 ownership 與完整 process／native stop evidence 才放 slot；未確認子程序／遠端效果保持 unknown |
| WF-T-NATIVE-04 | 原生明確 session ID 接續；另測 fresh-session reconstruct | resume 只在匹配 binding；新 session 有 lineage 與 context pack；不能 continue unrelated session |
| WF-T-NATIVE-05 | 合成 secret 防漏＋真實 route 受控 auth 失效／過期處理 | 不輸出秘密；auth_failed 有原生證據；不搜索其他登入態補救、不換 account 重試 |

外層 process group 停止、provider 原生 cancel 和外部工具副作用是三種觀測；只殺父程序不能宣称全部已停止。若產品無法提供某項可靠語意，必須把 capability 標成 unknown／unsupported，採更保守的恢復策略。

## 7. API 與第三 route

| Test ID | 測試 | Oracle |
| --- | --- | --- |
| WF-T-API-01 | OpenCode 指定 harness／profile 接 DeepSeek 真 API 的有界工作 | 分別識別 harness 與 API provider；固定 model/endpoint/auth class；有實際產物與工具觀測 |
| WF-T-API-02 | Auth 過期／撤權、429、timeout、串流回應不完整、usage 缺漏 | 錯誤依證據分類；未知 billing 與 effect 不當零；不可自動轉用其他帳號或 subscription |
| WF-T-API-03 | 有效 job grant 內的 API-class agent→agent 兩輪往返與超限反例 | 明確 recipient／reply_to／job/candidate 綁定；cap 生效；沒有無限互叫或跨 grant 觸發 |

成本證據分成 provider 回報 token、平台估算、訂閱 bucket 和已確認帳單；沒有可信來源就記 unknown。Agent turn／CLI invocation 與其內部 provider model requests 分開計數。硬金額、逐請求或 token 上限只有在該 route 的 request admission、並行預留、結算與未知費用保留都驗收後才可宣稱；不透明 CLI 只使用已驗證的 invocation／併發／工具 scope／wall-time 限制，並標示費用觀測缺口。

## 8. 真實端到端與長時間驗收

| Test ID | 場景 | Oracle |
| --- | --- | --- |
| WF-T-LIVE-01 | 第一場景 Codex writer→Claude reviewer→有界 rework→固定 candidate | 同一 job/AC/candidate 可追溯，獨立 review 和真實 verify 匹配；只有授權工作被執行 |
| WF-T-LIVE-02 | 控制入口關閉／controller 或 worker 重啟後從新 session 接續 | 已落盤工作不丟失；native resume 或 reconstruct 如實標示；unknown 不重發；context pack 足以定位下一步 |
| WF-T-LIVE-03 | 可選 Kith 真實 channel 投影、斷線 replay 與 personal mention 反例 | 真實 agent 署名；Kith INV-13 不變；replay 零新增 work dispatch；channel 不可用不破壞 job authority |
| WF-T-LIVE-04 | 在已授權測試 target 建立 branch／Draft PR，包含 receipt 丟失與 base drift | 固定 candidate 對到唯一 remote receipt；未授權／stale 拒絕；不 force、不 merge/deploy |
| WF-T-SOAK-01 | 事先固定時長的等待＋有限真實 turn＋重啟／失聯計畫 | 每次等待／喚醒、deadline、quota 和 lease 可對帳；無無界 queue／推理 loop；未知未被垃圾回收 |
| WF-T-SOAK-02 | 同一 evidence 窗口內 backup、空環境 restore、artifact 完整性與 reconcile | 恢復後不重播 side effects；未決 inbox／commands／candidate 一致；缺失 bytes 阻擋完成 |

第一輪 SOAK 可先採有界兩小時演練，後續是否做 24 小時由 release gate 與資源／費用授權決定；時長是待實測計畫，不是已取得可靠性。等待階段以普通服務維持 durable state，不能用持續模型 turn 冒充「長時間執行」。若主 SDD 另定時長，實際 evidence 記錄其 revision 及測得時長。

完整第一場景可在 Kith 接線前驗證訊息與工作協作；未做 Kith live integration 時，WF-T-LIVE-03 維持 NotRun，不能宣稱已接上聊天室。其他五／六產品的個別候選 route 未驗證時亦不能被一次 LIVE 結果提升。

## 9. Evidence record 的最低欄位

每一筆執行 evidence 至少保存：

- `test_id`、AC IDs、evidence layer、status、實際開始／結束時間。
- 實作來源 commit、spec/AC revision、adapter/profile/config digest。
- 公開可用的產品／harness version/model/auth class；受控 account/entitlement/environment reference。
- job、command、operation、message、session、lease epoch 及 candidate digest 的關聯。
- 輸入 fixture／context pack／verify recipe hash、實際命令或 API 操作的安全摘要。
- 預期 oracle、實際 observations、dispatch／process／remote effect 計數、退出／停止結果。
- artifact 與 log 的受控引用及 hash；redaction 結果；成本／token coverage 與 unknown。
- 獨立 reviewer、review 結論、限制、未執行項及 needs-revalidation 條件。

Raw transcript、provider events 與 private config 不直接公開。公開摘要只含必要的來源、方法、結果和證據 hash／允許分享的 artifact 引用；secret、account identifiers、真實 host/path 不放入 repository。Hash 用於完整性，不證明來源可信，也不是隱藏低熵秘密的方法。

## 10. 交付 gate

**文件交付**：DOC checks 有實際紀錄，主 SDD／場景／provider matrix／AC 一致；未執行的 runtime 狀態保持 NotRun。M0 歷史文件證據不覆蓋本次 M1 source changes。

**Fake 實作交付**：所有本切片適用 FAKE 案例有重現資料，未涵蓋的 case 明列；不能宣稱真產品可用。

**第一條真實協作交付**：必要 NATIVE 與 LIVE 項通過，API 擴展另有 API evidence；candidate 驗證與獨立 review 同 subject，未知副作用已被解決或明確阻擋交付；route 限制公開說明。

**長時間運作交付**：固定 SOAK／restore gate 通過，另行記錄真實部署環境、運維與 rollback 證據。單次 smoke、CI 綠燈、歷史相鄰元件的 KVM 結果都不能代替。

必要檢查的 Failed、Blocked、NotRun 或 Unknown 保持可見。不可修改 oracle、刪除失敗紀錄、清空去重狀態或放寬 scope／profile 來得到通過。

## 11. M1 離線交付

Python3.11.16 實際執行完整 component unittest suite；root獨立整合測試使用SQLite持久狀態、單獨reader、backend呼叫歷史及受控fault/clock。範圍為FAKE-01/02/03/04/05/07/08/10/12/13及FAKE-16普通重啟部分；對應API／oracles與延期清單在[M1契約](m1.md)。不同完整AC仍須通過本表要求的其餘層，不能把離線部分標為完整AC完成。候選source/test內容摘要保存在[m1-evidence.json](m1-evidence.json)；實際PR／CI固定合併來源，獨立審查及原始執行證據由交付流程保存。公開摘要只包含合成測試、必要版本／hash，不包含私有工作環境或帳號資料。
