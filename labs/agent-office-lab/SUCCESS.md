---

project: labs/agent-office-lab
purpose: 驗證本地優先的 OpenCode、Grok、Pi、Cursor 四工位 Agent Office
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-11-07
source_commit: 0529e812171c0fb2dbce9b25edcce21d92e984a4
---

# Agent Office Lab 驗收

四個 provider 的合成任務已實測通過：OpenCode、Grok、Pi + DeepSeek、Cursor。各次獨立付費授權已使用，沒有自動重跑；歷史失敗及修正見 [HANDOFF](HANDOFF.md) 和 [任務板](docs/tasks/BOARD.md)。完整 MVP 保持 incomplete。

## 主線與範圍

T-0025：Pi 原生問答／確認互動。維持 Claude Opus 5.5 技術指導、Pi agent 實作、主導 agent 審查與交付。以真實 Pi 的測試專用 slash command 與原生確認視窗驗證 needs_input、拒絕及接受後繼續；只執行固定合成動作，沒有模型 prompt、遠端費用或產品 grant。

驗證計畫：固定獨立 check 模式、與遠端／retry／其他模式互斥；原生 authenticated question hooks、同 session、拒絕無產物、接受後固定 marker、零模型請求、完整程序清理與操作台結果分類。此為 AC-05／09／11 子集，不把測試指令當成真實模型工具權限，也不標完整跨 provider AC 通過。

T-0024：[指導與委託契約](docs/T24-TECHNICAL-GUIDANCE.md)。依 owner 指示，由 Claude Opus 5.5 提供技術指導，Pi agent 在獨立工作區平行實作下一步遠端操作台派工。優先範圍為固定 Pi／DeepSeek 任務的一次性操作員授權、頁面明確確認、派工／停止／結果整合；預設仍不允許遠端執行。

驗證計畫：Claude 指導先固定 API 與檔案分工，Pi 後端與介面工作分離；主導 agent 審查整合、離線授權／競態／失敗回歸及瀏覽器驗收。開發委託的模型呼叫與產品遠端實測分開記錄；沒有產品付費任務批准前，只跑本機故障／測試替身，不能宣稱遠端模型端到端驗收。原限制、共用執行鎖及完整清理要求保留。

T-0023：Pi Office host 重啟與明確同 session 重新連接。以本機 429 建立真實 Pi 的未完成歷史，核對所屬 Office 主程序後注入 SIGKILL；新 host 將工位停泊為 interrupted，重複重啟及瀏覽器刷新均不自動派工。明確一次性無 prompt resume 接回相同 session，保留歷史且不追加模型請求。

驗證計畫：離線恢復政策／一次性 gate／模式互斥／結果分類，真實 Pi 與三代 Office 主程序、歷史 hash、Chrome 中斷提示／刷新、零外部請求及完整程序清理。完成 AC-08／09／11 子集；不宣稱中斷任務續做、遠端服務或其他 provider 通過。

T-0022：本地單檔修改提案。從已登記文字專案選擇既有檔案，輸入修改需求，由 OpenCode／Strata 在獨立副本產生完整替代內容；核對原始快照及產物 hash，顯示原檔／提案差異並下載替代檔案。原目錄不寫回，不執行生成程式、不新增 shell 或遠端模型權限。

驗證計畫：檔案清單授權、目標必須存在於快照、模式及舊計畫變更拒絕、先讀目標才可寫提案、原檔與提案 hash／diff 重算及純文字顯示；真實 Strata 單檔修正、Chrome 選檔／差異／下載／刷新、來源保留與完整清理。這是 AC-01／09／11 子集，任意程式測試、多檔修改及安全套用仍待驗。

T-0021：本地文字任務入口。操作台以啟動參數明確登記工作目錄，選擇專案並輸入任務；核對有界文字快照後，用 OpenCode／Strata 在獨立副本讀取來源並產生 output.md。可查看／下載純文字結果與 hash，不寫回原目錄、不執行 shell 或遠端模型。Claude 額度等待期間推進此本地流程。

驗證計畫：目錄／符號連結／大小／變更後舊計畫拒絕、一次性派工、工具讀寫範圍與結果校驗；真實本地模型加 Chrome 自訂任務、原目錄不變、結果下載、刷新及程序清理。完成 AC-01／09／11 子集；一般程式修改、遠端工位、完整隔離與 MVP 仍待驗。

T-0020：Pi 已持久化 session 的原生明確重新連接。先以無 owner key 的本機 429 建立失敗歷史，核對 session 檔與錯誤事件後停止所屬 CLI；只允許該 worker／session 一次無 prompt 的原生 resume，確認新程序、同 session、歷史保留、不自動請求或重跑。

驗證計畫：離線單次恢復 gate、固定模式與互斥、結果分類；真實 Pi 的錯誤／退出／明確 resume、session 歷史與零追加請求、完整程序清理及操作台結果。這是 AC-08／09／11 子集，不代表 Office host crash 恢復或中斷任務續做成功，零模型推論。

T-0019：操作台跨入口／重啟後的共用執行狀態。唯讀辨識可派工、其他程序持鎖、清理未確認與無法檢查；頁面提示阻擋原因，API 在啟動 runner 前重新檢查。保留 dispatcher 的最終互斥，不接管未知程序、不自動解除鎖或重跑。

驗證計畫：真實多程序持鎖／crash／重啟、損壞／符號連結／權限邊界、狀態讀取不改日誌；Chrome 驗證阻擋提示、舊計畫拒絕及明確核對清理後恢復。這是 AC-08／11 子集，使用無模型 helper 程序，不冒充原生 provider 恢復。

T-0018：Pi 真實執行中的原生取消與操作台入口。第一個請求留在無憑證的本機 relay；確認原生 working／同 session 後走 Office worker.kill，核對 worker.remove、所屬程序退出、不自動重跑及結果 cancelled。這是 AC-06／08／09／11 子集，不驗證遠端服務端取消或計費停止。

驗證計畫：離線授權／模式互斥、取消結果與重試拒絕；真實 Pi CLI＋本機 relay，原生取消時間與外層程序樹追蹤、操作台明確派工／刷新／結果；保留失敗、零模型推論與付費呼叫。

T-0017：本機操作台接通偵測、計畫、明確執行、狀態與產物。四 provider 可偵測／計畫；頁面可執行本地 OpenCode 合成任務（含保留原生終端）及 Pi 本機故障／重試，遠端付費執行保持 CLI 明確授權流程。loopback＋隨機登入 token、同 origin 寫入、一次性計畫、防重複提交、既有全局執行鎖；只顯示白名單結果。瀏覽器刷新不重跑，停止只送給本操作台擁有的 runner。

驗證計畫：離線 HTTP／授權／Host／Origin／body 邊界、固定命令與一次性計畫、併發互斥、退出碼與任務結果區分；真實 Chrome 點擊 Pi 故障及本地 OpenCode／Strata 任務，驗證原生終端、產物、刷新、重複拒絕、停止與完整清理。零付費呼叫；完整四工位產品及 AC-01／06／08／09／11 仍 pending。

T-0016：Pi 固定任務與本機故障模式的有界顯式重試。新 run 保存 root／parent／attempt，同一任務最多兩次重試；只接受最新且已失敗、完整清理的 run，使用原 fixture、新 workspace／session，保留所有失敗。預設只顯示計畫；遠端每次均需明示授權，不沿用額度。跨 provider 重試仍待接入。

驗證計畫：離線涵蓋次數、分支／重複請求、成功或中斷拒絕、路徑／符號連結、損壞 ledger、模式及來源不一致、exec 鎖繼承。以真實 Pi 的本機錯誤執行初次加兩次明確重試，確認第三次被擋、舊紀錄不改、新 session／相同 fixture、零外部模型請求與結果頁關聯。完整 AC-07／08／09／11 及 MVP 保持 pending。

T-0015：真實 Pi 執行中 CLI crash 與清理後明確重新啟動驗收。用無 owner key、零上游請求的本機 relay 留住第一個請求，僅對本 run 的原生 Pi PID 注入 SIGKILL；核對原生 exited／非成功、不自動重跑、程序樹與執行鎖清理。再以明確命令啟動全新無 prompt session；不宣稱原 session 恢復或付費任務成功。

驗證計畫：離線測試 crash mode 的授權互斥、relay 零外部連線、PID 歸屬與結果分類；真實 CLI crash 後核對同 session 原生退出與無自動派工、完整清理；明確重新啟動並核對新 session／零請求及結果頁。完整 AC-07／08 保持 pending，至多兩次顯式任務重試另行實作。

T-0014：以真實原生 Office／Pi 工位驗證本機注入的 401／429，區分故障驗收通過與任務成功；停止自動重試、保留失敗、核對同 session 錯誤事件及清理。測試端點不得持有 owner API key 或建立外部 HTTPS 連線，worker 保持 OS 外網拒絕；不把錯誤測試算成 DeepSeek 推論成功。

驗證計畫：離線測試注入／授權／budget 邊界與錯誤狀態；兩個真實 Pi CLI 故障 run，核對一次本機請求、零外部請求、原生失敗而非成功、無產物、所屬程序與執行鎖清理，再回讀結果入口。完整 AC-07 與跨 provider MVP 保持 pending。

T-0013：以新派工入口實測本地 OpenCode／Strata 合成任務，加入明確的本地原生取消驗收選項；核對互斥、同 session 原生取消、產物與結果查詢、清理及執行鎖釋放。再驗證 runner 收到中斷時的保守結果與清理；保留失敗，不自動重試。沿用既有 Q2_0／32K／資源 guard，不新增遠端付費呼叫。

驗證計畫：離線 gate 回歸；macOS arm64 真實本地模型任務與取消；原生事件、精確產物 hash、所屬程序退出、結果入口與 journal 狀態交叉核對。完整跨 provider AC 仍須各 provider 的實測，不能以本地子集代替。

T-0012：統一四 provider 的 detect／plan／run CLI，預設不執行任務；遠端執行須同時明示 execute 與 allow-remote。共用持續到清理完成的執行鎖，直接 runner 也納入；異常退出留下未確認紀錄，禁止自動重跑。只支援既有合成任務與預設限額，沒有任意 shell、prompt、模型 fallback 或自動排程。

驗證計畫：四 CLI 在 OS 拒絕網路下檢查真實版本／help；離線測試授權 gate、固定 argv、互斥、exec 繼承、異常中斷與清理紀錄。驗證不發新模型請求、不啟動 Strata，完整派工到模型結果與跨 provider 生命週期保留待驗。

依 [SDD](docs/SDD.md) 完成單專案、單執行佇列、四 provider 的本機 Office。原 AC 條件不縮減；AC-10 是獨立研究，AC-12 是公開匯入，AC-13 是 owner 要求的 Cursor 擴充。

T-0011：整合四 provider 的唯讀結果入口，列出來源、模型、任務狀態與合成產物；重新核對檔案內容及原紀錄 hash，產生可離線開啟的互動 HTML。只讀明確選擇的 runs 根目錄，不讀取登入檔、不執行 agent、不新增模型呼叫。拒絕符號連結、路徑逃逸、超大／損壞報告；啟動檢查、失敗、未完成及驗證不足不能顯示成功。輸出採白名單，不含原始日誌、session、私人路徑或憑證。

驗證計畫：離線回歸涵蓋四種 schema、錯誤分類、篡改／連結／輸出注入；以既有四 provider 真實 run 回讀產物，再測瀏覽器篩選及詳細結果、無外部請求。這是 AC-09 結果入口與 AC-11 讀取邊界子集；統一派工、原生終端互動及完整生命週期仍待完成，不以結果頁標記完整 AC 通過。

不包含部署、發布套件、模型權重、私人專案或雲端自動 fallback。`source_commit` 為本輪基準。

## 驗收條件

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 四種 CLI，When detect，Then 正確識別版本／能力，缺失或不相容不啟動。 | pending | [Grok／Pi 固定套件與實際 version/help 已通過](docs/evidence/remote-preflight-2026-11-01.json)；[統一 CLI 偵測與 launch gate](docs/DISPATCH.md) 及四 CLI 真實斷網預檢通過；[本地新入口任務／取消已通過](docs/evidence/local-dispatch-2026-11-01.json)，遠端新入口任務仍待驗。 |
| AC-02 | Given fixture workspace，When OpenCode 執行指定任務，Then 原生事件、session 與檔案 hash 證明成功。 | passed | [本輪實測](docs/evidence/lifecycle.md) 再驗證原生檔案任務；[原歷史摘要](docs/evidence/2026-10-31.json) 保留。 |
| AC-03 | Given 確認版 Grok，When 執行同等任務，Then CLI 身分、session 與產物可核對。 | passed | [Grok 原生真實任務](docs/evidence/grok-completed-2026-11-01.json)：同 session／模型、兩讀一改、end_turn、產物 hash 與清理通過。 |
| AC-04 | Given Pi + DeepSeek，When 執行同等任務，Then provider/model、settled 事件及檔案正確。 | passed | [Pi 原生工位實測](docs/evidence/pi-live-2026-11-01.json)：3 次 DeepSeek 請求、agent_settled、同 session/model、read/write、產物 hash 及清理通過。 |
| AC-05 | Given 原生權限或使用者問題，When 等待與回覆，Then waiting_input 後繼續。 | pending | [OpenCode edit 權限子集通過](docs/evidence/lifecycle.md)；[Pi 測試指令原生拒絕／接受／逾時子集通過](docs/evidence/pi-question-2026-11-07.json)，模型驅動權限及 Grok／Cursor 等互動待驗。 |
| AC-06 | Given 執行中任務，When 取消，Then 10 秒 grace 後所屬程序全部退出。 | pending | [OpenCode 新入口原生取消與 Ctrl+C](docs/evidence/local-dispatch-2026-11-01.json) 通過；[Pi 原生取消](docs/evidence/pi-cancel-2026-11-02.json) 及完整清理通過；Grok／Cursor 與遠端串流待驗。 |
| AC-07 | Given crash／401／429，When 失敗，Then 不顯示成功且最多兩次顯式重試。 | pending | [Pi 401／429 本機注入＋原生錯誤與清理已通過](docs/FAILURES.md)；[Pi CLI crash／新 session 啟動通過](docs/CRASH.md)；[Pi 明確重試限制](docs/RETRY.md) 已加入；其他 provider 的故障／重試與整合流程仍待驗。 |
| AC-08 | Given browser refresh 或 host 重啟，When 恢復，Then 不重跑、unfinished 標 interrupted。 | pending | [OpenCode 新程序／同 session 與瀏覽器刷新通過](docs/evidence/lifecycle.md)；[host restart 與手動恢復通過](docs/evidence/restart.md)；[Pi CLI 同 session 重新連接子集](docs/PI-RESUME.md) 通過，[Pi host crash／無 prompt 重連子集](docs/PI-HOST-RESTART.md) 通過；遠端串流續做及 Grok／Cursor 待驗。 |
| AC-09 | Given 四 provider 真實 run，When 開啟結果，Then 產物、模型與來源可分辨。 | pending | [唯讀結果入口](docs/RESULTS.md) 已回讀四 provider 真實產物；[本地文字派工到下載](docs/LOCAL-TEXT-TASK.md) 及[單檔提案](docs/LOCAL-FILE-PROPOSAL.md) 通過，尚缺遠端工位整合流程。 |
| AC-10 | Given 本地 Strata，When 執行公開 GitHub tool loop，Then 真實 tool_call、API 結果與後續回答完成。 | pending | 獨立研究未通過，非 MVP 阻塞。 |
| AC-11 | Given 路徑逃逸、偽造 hook 或金鑰輸出，When 操作，Then 阻擋或遮蔽。 | pending | [OpenCode sandbox probe](docs/evidence/2026-10-31.json) 僅驗證網路／寫入子集；[結果入口讀取／顯示邊界](docs/evidence/results-console-2026-11-01.json) 通過，完整邊界仍待驗。 |
| AC-12 | Given 公開匯入來源，When 執行 publication、policy 與 repo gates，Then 無 runtime 私人資料、導航正確且檢查通過。 | passed | [匯入驗證](docs/evidence/publication.md)；CI／交付另見任務板。 |
| AC-13 | Given 官方 Cursor Agent 與明確登入，When 執行同等合成任務，Then 原生 session、模型來源、完成事件與產物 hash 可核對。 | passed | [Cursor 真實任務](docs/evidence/cursor-completed-2026-11-01.json)：同 session／模型、三次工具、completed stop、用量、產物 hash 與清理全部通過。 |

歷史結果：T-0023：完成 [Pi Office host 重啟驗收](docs/PI-HOST-RESTART.md)。真實 Pi 本機 429／六筆歷史後，對已追蹤 Office 主程序注入 SIGKILL；新 host 停泊工位為 interrupted，再次重啟與 Chrome 刷新不自動派工。明確一次性無 prompt 重新連接使用新 PID／同 session、保留六筆歷史，沒有追加請求或產物。195 tests、操作台及 63 筆結果回歸通過；首輪 runner 41.06 秒、三代 host、外層 83 個程序全退出、鎖釋放。正常關閉後兩個已追蹤背景程序經身分核對送 SIGTERM，再確認全退出。一次本機 429、零模型推論／外部請求。完成 AC-08／09／11 子集；不代表進行中的遠端串流恢復、任務續做或完整 MVP／安全驗收。[證據](docs/evidence/pi-host-restart-2026-11-06.json)，交付見[任務板](docs/tasks/BOARD.md)。

T-0022：完成[本地單檔修改提案](docs/LOCAL-FILE-PROPOSAL.md)。可選擇已登記專案中的檔案、輸入修改需求，先讀取目標後產生完整替代內容；結果重新核對原文／提案 hash、計算差異並以原檔名下載。190 tests、真實 Strata 修正與 Chrome 選檔／差異／下載、62 筆結果回歸通過。測試將 add 的減法修正為加法，獨立 AST 核對通過、未執行生成程式；原目錄及快照保留。runner 42.92 秒、外層 73 個程序全退出、鎖釋放、swap 增量 44.19 MiB，guard 未觸發。離線命名衝突及測試暫存路徑問題於實測前修正，原限制未放寬；零遠端模型呼叫。提案仍需人工審閱，沒有自動套用或一般程式測試；完整 MVP／安全邊界仍 pending。[證據](docs/evidence/local-file-proposal-2026-11-03.json)，交付見[任務板](docs/tasks/BOARD.md)。

T-0021：完成[本地文字任務](docs/LOCAL-TEXT-TASK.md)。可登記工作目錄、輸入要求，以 OpenCode／Strata 讀取有界文字快照並產生 output.md，在頁面查看及下載；原目錄不變。184 tests、真實本地推論及 61 筆結果回歸通過。最終獨立 HOME 任務 43.12 秒，Chrome 關閉／重開仍為同一工作，產物與下載 hash 一致，外層 71 個程序全部退出、鎖釋放、swap 增量 0。首次完整流程亦通過；中間兩次 swap guard 停止保留且全部清理，未放寬模型或資源限制。另保留啟動前路徑／選單測試失敗與唯讀文字換行斷言修正。僅完成本地文字流程；一般程式修改、遠端工位與完整安全驗收仍 pending。沒有使用 Claude 或遠端付費模型。[證據](docs/evidence/local-text-task-2026-11-02.json)，交付見[任務板](docs/tasks/BOARD.md)。

T-0020：完成 [Pi 同 session 重新連接](docs/PI-RESUME.md)。真實 Pi 保存本機 429 的六筆歷史後，核對所屬 CLI 身分並停止；一次性原生 resume 以新 PID 接回相同 session、更新 hook token，保留原始歷史且無追加請求。177 tests、Chrome 操作台及 57 筆結果回歸通過；最終 runner 17.72 秒、外層 30 個程序全部退出、鎖釋放。首輪瀏覽器欄位筆誤失敗保留，修正後通過；兩輪原生檢查皆通過、零模型推論與付費呼叫。任務保持 stopped，原任務未完成；這是既有 Office host 內 CLI 重新連接子集，host crash／任務續做及完整 MVP 仍待驗。[證據](docs/evidence/pi-resume-2026-11-02.json)，交付見[任務板](docs/tasks/BOARD.md)。

T-0019：完成[操作台跨入口與重啟狀態](docs/CONSOLE.md)。同一 checkout 的共用鎖區分 available／busy／cleanup_unconfirmed／unavailable；頁面提示阻擋原因，API 在啟動 runner 前重查，dispatcher 保留最終互斥。新增唯讀 `office_dispatch.py status`。171 tests 與 Chrome／真實 helper 程序驗收通過：另一入口持鎖、SIGKILL 後中斷、兩次操作台啟動、刷新與舊計畫拒絕、journal 位元組／修改時間不變、明確核對後歸檔及損壞狀態阻擋。所有 helper 全退出；沒有執行 provider、模型或付費請求。[證據](docs/evidence/console-restart-2026-11-02.json)，交付見[任務板](docs/tasks/BOARD.md)。這是控制層 AC-08／11 子集，不代表原生 provider crash／session 恢復通過；不接管、不自動解鎖或重跑。

T-0018：完成 [Pi 原生取消與操作台驗收](docs/CANCEL.md)。真實 Pi 的第一個請求留在本機，確認 working／同 session 後走原生 worker.kill；worker.remove／原生 PID 退出 102 ms，整體取消清理 3.521 秒。最終外層追蹤 29 個程序全退出、執行鎖釋放；163 tests、55 筆結果及操作台／唯讀頁的取消分類、刷新、防重複與拒絕重試通過。任務為 cancelled，零本地／遠端模型推論或付費呼叫。首輪清理約 20.09 秒、第二輪背景子程序殘留均保留；修正後只對本次已追蹤且身分相符的後代送 SIGTERM，完整清理才解鎖。[證據](docs/evidence/pi-cancel-2026-11-02.json)，交付見[任務板](docs/tasks/BOARD.md)。Grok／Cursor 取消、Pi 權限／恢復、遠端端到端與完整安全驗收仍待完成。

T-0017：完成[本機操作台](docs/CONSOLE.md)，接通四 provider 偵測／計畫、本地明確派工、原生終端與結果；遠端付費執行保持 CLI 流程。Chrome 實測 Pi 本機 429（任務仍 failed）及本地 OpenCode／Strata，終端開啟／刷新／再次開啟、重複提交拒絕、停止與產物 hash 通過。最終本地 runner 50.75 秒，外層追蹤 107 個程序全部退出、執行鎖釋放；159 tests、52 筆結果回讀通過，零遠端模型請求。首輪瀏覽器表單等待失敗、第二輪 swap guard 停止均保留；原限制未調整，最終重驗通過。[證據](docs/evidence/console-2026-11-02.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。一般任務、完整四 provider UI／生命週期與安全驗收仍 pending，沒有 usable tag。

歷史結果：T-0011：新增[統一結果入口](docs/RESULTS.md)，以白名單回讀四 provider 原生紀錄、重新核對合成產物內容與 SHA-256，提供離線篩選與詳細頁。96 項離線測試通過，既有 33 筆 run 回讀保留成功／失敗／啟動檢查／未完成區別，四 provider 各有成功產物通過重驗；Chrome 篩選、詳細內容、刷新通過，零外部請求。沒有新增模型呼叫或重啟 Strata。[本輪證據](docs/evidence/results-console-2026-11-01.json)。完整 AC-09／AC-11 保持 pending；下一步仍是統一偵測／派工與跨 provider 生命週期。交付狀態見[任務板](docs/tasks/BOARD.md)。

T-0012：新增[統一偵測與派工入口](docs/DISPATCH.md)。四個固定 CLI 的實際斷網版本／help 檢查通過；run 預設只顯示計畫，遠端執行須明示 execute 與 allow-remote。四個直接 runner 共用執行鎖，跨 exec 保留，清理未確認或強制中斷會阻擋下一次派工；不自動重試。117 項離線測試通過。本輪沒有新模型呼叫或啟動 Strata，完整派工到產物與跨 provider 生命週期尚未重驗。[證據](docs/evidence/dispatch-2026-11-01.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。

T-0013：新派工入口的 OpenCode／Strata 真實本地任務與原生取消通過。最終 runner 整輪任務／取消驗收 54.95 秒、產物 hash 正確；原生取消與所屬程序退出 202 ms，全程追蹤 60 個程序，最後全部退出。另一次原生 working 後 Ctrl+C 正確顯示 cancelled／exit 130，10.399 秒後追蹤到的 23 個程序（含 runner）全部退出；這包含模型關閉，不是工位取消耗時。三次實測均拒絕重複派工、釋放執行鎖，資源 guard 未觸發，沒有遠端模型呼叫。122 tests 與 36 筆結果的瀏覽器篩選／產物／刷新通過。[證據](docs/evidence/local-dispatch-2026-11-01.json)，[操作](docs/DISPATCH.md)，交付狀態見[任務板](docs/tasks/BOARD.md)。遠端 provider 的新入口與取消／恢復仍待驗，完整 MVP 保持 incomplete。

T-0014：完成[Pi 原生 401／429 故障驗收](docs/FAILURES.md)。本機注入錯誤，真實 Pi 呈現 needs_input／error 且從未 done；各一次本機請求、零外部模型請求、無產物或推論成功。發現並修正 Pi 過早判定清理：最終兩次 runner 與外層觀察均確認所屬程序全退出、鎖釋放；原兩次清理證據不足紀錄保留。結果頁標示注入來源，任務仍為失敗。135 tests 與 40 筆結果的瀏覽器核對通過。[證據](docs/evidence/pi-failures-2026-11-01.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。完整 AC-07、其他 provider 及 MVP 仍 pending。

T-0015：完成 [Pi CLI crash 與明確重新啟動](docs/CRASH.md)。真實 Pi working 時將第一個請求留在本機，對核對歸屬的 CLI 注入 SIGKILL，原生狀態轉 exited 而非 done；任務保持 failed。最終 crash／新 session 啟動各追蹤 40／38 個程序，全部退出後釋放執行鎖；重複派工拒絕，觀察期沒有自動重跑。明確新 session 到 idle、零請求，與原 session 不同。上游 PTY 在 SIGKILL 後回 exit code 0，沒有據此判成功。141 tests、43 筆結果瀏覽器驗證通過，零遠端模型請求、未載入 owner key 或 Strata。[證據](docs/evidence/pi-crash-2026-11-01.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。原 session 續做、其他 provider、顯式重試與完整 MVP 仍待驗。

T-0016：完成 [Pi 有界明確重試](docs/RETRY.md)。統一入口 retry 預設只顯示計畫；執行時重新核對最新失敗、完整清理、固定模式／fixture 與來源，同一任務最多兩次重試。真實 Pi 本機 429 的初次＋兩次重試通過：三個獨立 session 使用相同 input，原報告／事件不變，第三次及舊 parent 的六項請求全部拒絕且不新增 run。三次分別追蹤 41／35／46 個程序，全部退出、鎖釋放；各一次本機請求、零模型推論或外部請求。152 tests 與 46 筆結果瀏覽器關聯／分類／刷新通過。[證據](docs/evidence/pi-retry-2026-11-02.json)，交付狀態見[任務板](docs/tasks/BOARD.md)。其他 provider、原 session 恢復、UI 派工與完整 MVP 仍待驗。

## 現況與缺口

本輪結果：T-0025：完成 [Pi 原生問答確認檢查](docs/PI-QUESTION.md)。維持 Claude Opus 5.5 技術指導、兩個 Pi CLI（OpenAI GPT-5.5）平行實作；兩者到達 24 次請求上限後，由主導 agent 完成審查與整合。真實 Pi 同 session 的拒絕、接受、原生逾時與重複指令拒絕通過；只在接受後寫一次私有測試 marker，沒有模型產物。248 tests、兩輪 Chrome 原生驗收及 67 筆結果回歸通過；外層分別追蹤 43／35 個程序，全部退出、鎖釋放。結果保持 stopped，模型推論及 relay／遠端請求皆為零，未啟動 Strata 或建立付費 grant。開發委託用量另計，回報估算合計 2.98099 美元，非帳單。完成 AC-05／09／11 子集；模型驅動工具權限、其他 provider、遠端端到端與完整 MVP 仍 pending。[證據](docs/evidence/pi-question-2026-11-07.json)，交付見[任務板](docs/tasks/BOARD.md)。
T-0024：完成 [Pi 遠端操作台一次性授權](docs/REMOTE-GRANT.md)。實際由 Claude Opus 5.5 指導，兩個 Pi CLI worker（OpenAI GPT-5.5）在獨立工作區平行實作；後端達 24 次請求上限後停止，主導 agent 補齊審查與整合。授權先由 CLI 建立、操作台明示接受，綁定固定任務與來源，消耗後不退還；重啟不重置、遠端重試保持 CLI。218 tests、五組 Chrome 測試替身流程、真實 Pi 本機 429／取消及 65 筆結果回歸通過。取消清理 3.521 秒；測試替身／429／取消分別追蹤 94／46／29 個程序，全部退出、鎖釋放。開發 agent 有遠端 API 用量；產品驗收零模型推論、零遠端請求、未建立真實付費 grant。遠端 UI 到 DeepSeek 產物仍待另次批准驗收，完整 MVP／安全驗收保持 pending。[證據](docs/evidence/remote-grant-2026-11-07.json)，交付見[任務板](docs/tasks/BOARD.md)。

MVP 的 11 項必要 AC（01–09、11、13）中，02／03／04／13 的四 provider 合成任務已有原受測版本成功證據；其餘 7 項仍 pending，已有多項子集通過。這不是工時百分比，也不表示最新版完整流程已驗收。主要剩餘工作為遠端 UI 派工／原生終端／結果整合、跨 provider 權限／取消／session 恢復與重試、遠端新入口端到端實測，以及完整路徑／hooks／憑證／網路邊界。本地文字任務已支援自訂要求與工作目錄快照；單檔修改提案已可審閱／下載，多檔修改、自動測試、安全套用與完整日常工作流程仍待完成。

四種原生 runner 各有原受測版本的真實成功證據；已提供統一 CLI，預設 plan；OpenCode 新入口真實任務與取消已重驗，遠端仍待驗。AC-01 的統一偵測／派工、AC-05–AC-08 的跨 provider 權限／取消／錯誤／恢復、AC-09 完整四工位流程仍待驗。OpenCode 的生命週期與 host 重啟子集已通過，不能代替其他 provider。

OpenCode sandbox 仍允許區外讀取；Office／Strata 整棵程序樹尚未做 egress audit。維持 `strict_network_isolation_verified=false`，僅使用合成資料。614 個上游測試不能代替四 provider 整合。

## 啟動與驗證

[安裝與重跑](docs/SETUP.md)、[README](README.md)、[公開證據說明](docs/evidence/README.md)。
元件檢查：`python3 scripts/check_publication.py`、`node --test scripts/local_office_policy.test.mjs`。
Repo 檢查：`python3 scripts/check_indexes.py`。runtime 另需 macOS arm64／Metal／本機模型；Linux CI 不測推論。

## 可用版本

`usable_tag: none`。主線未完成，沒有發布 tag 或部署。
