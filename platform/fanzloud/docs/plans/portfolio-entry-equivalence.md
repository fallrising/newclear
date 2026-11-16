# Fanzloud／AP／Office 入口與能力等價清單

本次結論：保留 **Fanzloud 的隔離 coding Web 入口、AP 的執行／維護權威、Office 的本地原生操作入口**。
重複的「看任務／看成果」可以先評估只讀導航；目前沒有足夠等價證據刪除任何入口、搬 run 或合併資料庫。
這是 [#1047](https://github.com/fallrising/newclear/issues/1047) 的文件比較，沒有實作新 UI、API 或採用契約。
[任務／E01–E05](../tasks/FZ-ENTRY-MAP.task.md)；[本輪驗證與交付](../acceptance/FZ-ENTRY-MAP.acceptance.md)。

## 固定來源與判讀方式

- 盤點來源：`2aa21f10b53ecaeb079279b6531bbb47a103e937`。
- 本輪來源：`fead565acb877453861b6895471326096b923f0b`，2026-11-16 UTC 回讀 main。
- 兩版間 Fanzloud/AP 路徑沒有變更；Office 新增 T27 合成秘密輸出投影、ref lookup、下載 hash 與證據，已納入下表。
- 以下引用均固定本輪 SHA。來源報告內保留各自實測 SHA、命令及歷史失敗；本輪閱讀不把歷史實測升格成最新版 runtime 複驗。
- 「設計」是承諾；「歷史實測」只涵蓋報告指明的 fake/native/live 條件；「提案」尚未採用。
  PR 合併、版本號或某個 CLI exit 0 都不是產品驗收。

| 來源 | 契約與證據定位 | 本次用途 |
| --- | --- | --- |
| Fanzloud | [SDD][fz-sdd]、[SUCCESS][fz-success]、[board][fz-board] | FN01–07、唯一執行權威及目前缺口 |
| Fanzloud 兩廠商 | [M2][fz-m2] | 受限真實雙廠商／並行隔離／取消與清理歷史，不是常駐部署 |
| Fanzloud 成果與恢復 | [durable intent][fz-durable]、[fixed candidate][fz-candidate]、[readonly review][fz-review]、[原安裝對帳][fz-reconcile] | 保存意圖、固定成果、可信對帳與已有自動 journey |
| Fanzloud 本人操作 | [owner operation][fz-owner] | 完整 FN07 與只讀窗口的差異；沒有新窗口授權 |
| AP | [SDD][ap-sdd]、[SUCCESS][ap-success]、[README][ap-readme]、[result archive][ap-archive] | Run/Cocoon/lease、維護／恢復、成果權威及原未完成 AT |
| Office | [SDD][office-sdd]、[SUCCESS][office-success]、[board][office-board] | 四 provider、本地優先、單佇列與未完成 MVP |
| Office 操作 | [console][office-console]、[Pi cancel][office-cancel]、[retry][office-retry]、[Pi resume][office-resume]、[host restart][office-restart]、[question][office-question] | 原生終端、明示重試／重連／問答與清理邊界 |
| Office 成果 | [results][office-results]、[local file proposal][office-file]、[T27 contract][office-redaction]、[T27 evidence][office-redaction-evidence] | 本地成果核對、提案下載、原始／顯示 bytes 差異 |

## 原 AC 索引與維護承諾

下表是既有旅程的原 AC 索引，不建立新驗收權威。證據仍只涵蓋來源報告的受測範圍。

| 行為 | Fanzloud 原 AC／證據 | AP 原 AC／證據 | Office 原 AC／證據 |
| --- | --- | --- | --- |
| 建立 | FN01／02：[SDD][fz-sdd]、[M2 真實兩廠商][fz-m2] | AT01：[SDD][ap-sdd]、[已接受切片與缺口][ap-success] | AC01–04／13：[SDD][office-sdd]、[各 provider 受限歷史][office-success] |
| 身分 | FN06：[SDD][fz-sdd]、[原安裝對帳][fz-reconcile] | AT07：[SDD][ap-sdd]、[M2 隔離／秘密拒絕][fz-m2] | AC11：[SDD][office-sdd]、[hook／session 子集][office-success] |
| session／恢復 | FN04：[SDD][fz-sdd]、[持久意圖][fz-durable]、[原安裝恢復][fz-reconcile] | AT03–05：[SDD][ap-sdd]、[既有恢復切片][ap-success] | AC08：[SDD][office-sdd]、[Pi 無 prompt 同 session][office-resume]、[host restart][office-restart] |
| 取消 | FN03／06：[SDD][fz-sdd]、[M2 A 取消／B 完成][fz-m2] | AT08：[SDD][ap-sdd]、[M2 清理與資源不存在][fz-m2] | AC06：[SDD][office-sdd]、[Pi 本機取消][office-cancel]；遠端停止仍非此證據 |
| 成果 | FN01／05：[SDD][fz-sdd]、[固定成果唯讀審查][fz-review] | AT09／12：[SDD][ap-sdd]、[成果封存][ap-archive]、[export 切片與缺口][ap-success] | AC09／11：[SDD][office-sdd]、[結果入口][office-results]、[T27 合成遮蔽][office-redaction-evidence] |
| 維護／本人操作 | FN07：[SDD][fz-sdd]、[本人操作仍缺][fz-owner] | M4／AT09／12／13：[SDD][ap-sdd]、[維護／backup／GC 的有限切片][ap-success] | AC05／08／11：[SDD][office-sdd]、[原生問答子集][office-question]、[host restart][office-restart]、[完整邊界仍待驗][office-success] |

完整 AP M4 保留成果封存、explicit GitHub export、backup/GC、單節點操作、
AT09／12／13、完整 fake E2E＋opt-in live smoke。已有 retention、stale binding
cleanup、export／backup 組合及 Fanzloud 真 CLI 切片，不代表完整 M4 通過。
原 [SDD][ap-sdd] 與 [SUCCESS][ap-success] 的承諾／缺口不縮減；真實計費／
硬金額上限依原決策延後，不重新當成單人 MVP 前置。

## 六類使用者旅程

### 1. 建立工作

| 入口／權威 | 已有能力與證據層 | 必須保留／等價缺口 |
| --- | --- | --- |
| Fanzloud → AP | SDD 的固定 repo/base/agent 與單次提交；M2 真實兩廠商及並行隔離歷史；AP 擁有實際 run、VM、lease 與清理 | Fanzloud 保存自身意圖與外部 run 引用，不能成第二 executor。兩廠商已驗不代表任意 CLI/模型/專案可准入。 |
| AP 原入口 | AP 契約及受限已交付切片保留執行、維護、停止及恢復操作 | Fanzloud 沒有證明完整覆蓋 AP 維護／故障操作，不能先刪原入口或把 AT 的缺口當已完成。 |
| Office console／CLI | 原生 runner、單工作佇列、plan 預設、本地文字及單檔提案已有受限實測；遠端 grant／本機注入驗證不等於遠端端到端 | 保留原生終端與本地工作目錄／快照；沒有 AP VM 等價證據。不能直接拿 Fanzloud 提交按鈕啟動 Office。 |

只做導向：可在將來經核准的私人導航列區分「隔離 coding」與「本地 Office」，由各入口重新核對自己的權限。
不預填／轉交 credential、grant、可執行指令或提交 body；不得自動 fallback 到另一個 executor。
回退：保留原 Fanzloud operator、AP 維護入口及 Office console/CLI；移除導航不影響原工作。
依據：[Fanzloud SDD][fz-sdd]、[M2][fz-m2]、[AP][ap-readme]、[Office console][office-console]。

### 2. 身分、授權與引用

Fanzloud operator session、AP run/attempt/lease、Office job/native session/ref 是不同種類的識別。
ID 或 hash 只定位來源，不授予執行、重試、取消或讀取私人內容的權限。

Office T27 `ref` 依 roots 順序與原 run 名稱生成；顯示 ID 可遮蔽同名，ref 用於既有受限 lookup。
它不是永久跨工具 ID、授權 token，也不防字典猜測；不能把它當「已匿名」公開 alias。
沒有現成全域 ID/generation mapping；需要關聯時先保存 producer、native kind/value 與固定來源，
缺值標 unknown，不把 AP lease generation、Office hook/session 身分或 Fanzloud intent 當同一數字。

只做導向：入口本身可以顯示；私人結果深連結只在該入口已支援且完成自己的存取檢查時考慮。
尚未支援的 locator 先留人工查詢提示，不能擅增 API 或把 token/session 放 URL。
回退：各自原生查詢與登入；沒有新身份服務、token 交換或公共投影。
依據：[Fanzloud SDD][fz-sdd]、[AP SDD][ap-sdd]、[Office results][office-results]、[T27][office-redaction]。

### 3. 會話、互動與終端

Fanzloud 的頁面 session/任務歷史不是 agent 的原生 PTY 或「任意推理中斷點續做」。
Office 保留原生 terminal、Pi 同 session 無 prompt 重連及原生問答的有界歷史證據。
Pi 本機 429、無模型問答與固定 marker 的驗證不能改稱成功 coding，也不能代表 Grok/Cursor 等其他 provider 全部通過。

只做導向：回到 Office 原終端入口，不把 terminal input、approval/question answer 複製到 Fanzloud 的結果面板。
沒有共同 session 協定或等價互動證據前，不接管終端，不將 session reopened 當 task resumed/completed。
回退：Office 原生 host/CLI；Fanzloud 原任務頁與 AP 所有的 run 查詢各自保留。
依據：[Office console][office-console]、[Pi resume][office-resume]、[question][office-question]、[Fanzloud FN04][fz-sdd]。

### 4. 取消、失敗與重試

AP route 由 AP 依原 lease/停止/清理契約負責；Fanzloud 顯示實際停止或待對帳，不用「停止觀察」宣稱停止執行。
M2 的 A/B 相互隔離與取消有真實歷史證據，但不代表任何 route 都具備相同清理能力。
舊 Cloud 路線取消的是本機監看／工作，不保證 provider task 終止。

Office 的 Pi/OpenCode 原生取消、受追蹤程序退出與清理是特定子集；其他 provider 原缺口保留。
Pi 明確 retry 依 eligibility、固定 parent/root、原執行鎖及次數上限重新判斷；不是全域自動重送。
Fanzloud unknown intent 零自動重送的契約不被此 Office retry 入口替代，Office 原已允許的有界重試也不被抹掉。

只做導向：結果頁顯示來源 status/unknown 及返回原入口的指引；不代理 cancel/retry/rework、排隊新工作或產生成功結論。
回退：各自受授權的原取消／重試／清理流程；保留原失敗與已消耗 intent，不重設舊窗口。
依據：[M2][fz-m2]、[Fanzloud durable intent][fz-durable]、[AP SDD][ap-sdd]、[Office cancel][office-cancel]、[retry][office-retry]。

### 5. 恢復與對帳

Fanzloud 已有持久意圖、唯一 AP run/result 引用、Rust/AP restart 與原安裝可信對帳的受限實測；
unknown 只有可信證據與原明示流程能解決。這不是完整原 P1 actor/store/runtime 或所有 FN04 情境都已完成。
明示對帳經認證後，唯讀取得精確 operator／route／key 的 AP command receipt，
匹配才原子確認原 intent；缺失／不一致／不可達仍為 unknown，並阻擋新 admission。
refresh／restart 不自動對帳或重送；後續明示操作可重複 GET，不能以同 key 或新 key
造成第二次 start。確認 cancelled/not_allocated run 只表示提交已知，不是 coding 成功。
這是 [原安裝對帳][fz-reconcile] 的既有流程，不增加新對帳 writer。
AP 的 VM/lease/控制恢復仍由 AP 負責；Fanzloud 不寫 AP 狀態或自行接管 VM。

Office host restart 將未完成工作停泊 interrupted；重新整理不自動派工。
Pi 明示無 prompt 同 session 重連是有界子集，不等於任務續做或遠端串流／全部 provider 恢復。
Fanzloud restart 的 run、Office restart 的 job/session 與恢復程序不能互相替代驗收。

只做導向：列出最後觀察的來源與 freshness/unknown，回到來源執行原恢復流程。
不能在讀取失敗後偷偷寫 reconcile、解鎖、重建缺失成果或產生新 run。
回退：原 Fanzloud/ AP 對帳及 Office host/CLI；不移轉資料庫或舊紀錄。
依據：[原安裝對帳][fz-reconcile]、[durable intent][fz-durable]、[AP][ap-sdd]、[Office host restart][office-restart]。

### 6. 成果、下載與審查

Fanzloud/AP 的 fixed candidate 含 run/base/profile/diff 及檢查；readonly reviewer 判定綁定同一 candidate hash，
review accepted 不自動等於 task Done。checks 在 candidate 的 `result.verification` 中，沒有獨立 checks 下載按鈕。
原安裝自動 journey 通過仍不等於 FN07 owner 本人完成登入、提交、看進度與明示交接。

Office 結果頁保留 completed/failed/stopped/cancelled/startup_only/incomplete/unverified/invalid 的原生區別；
job 程序退出不等於產物完成。原本只接受 allowlisted 本地報告與有界合成產物，不能用任意檔案代替或擴大掃描。
本地單檔提案是供人工審閱的替代內容，不自動套用或證明一般程式測試已通過。

T27 先核對原始 bytes/hash 再投影：`artifact.sha256`/`before_sha256` 仍指原始 bytes；
`display_sha256` 等欄位指實際 UTF-8 下載內容。secret-only change 可有 `changed=true`、
`display_changed=false`；原 diff 與投影重算 diff 不可互換。hash 不符禁用下載，原失敗不能升格成功。
T27 只證指定合成 sentinel 的遮蔽與 loopback HTTP/Chrome Blob 子集，不是一般秘密偵測、公共資料去識別或完整 AC11。

只做導向：優先回原結果頁或已支援的只讀下載；不先建統一 artifact store、重寫 hash、合成 reviewer verdict 或公開私人 ref。
若未來需自動 join，先由該 consumer 定義來源型別、證據層與 raw/display hash 的分別，再驗證；現行 wire contract 不變。
回退：原 AP candidate/review 下載及 Office results/原生產物流程，原來源資料保留。
依據：[fixed candidate][fz-candidate]、[readonly review][fz-review]、[owner operation][fz-owner]、[AP archive][ap-archive]、[Office results][office-results]、[T27][office-redaction]。

## 最小下一切片與退出條件

**推薦先保留雙操作入口，只選一個具體使用者旅程做私人、只讀導航。** 此處仍是提案，沒有修改已批准 SDD。
替代方案是完全維持分開導航，成本為重複尋找入口；現在直接統一控制台會犧牲原生 terminal/本地模型/維護恢復能力，沒有等價證據。

將來實作入口需先固定該 repo 的正式任務、可寫路徑、原入口是否實際存在及授權；不以本文件啟動服務。
只讀成果 consumer 的必要條件是來源自己的存取檢查、可追溯引用、原生 status/unknown/freshness、正確 bytes/hash 語義及可撤回導航。
不得要求所有 Cost、credential、Workforce、HAI、OneFleet 或全域 ID 平台先完成。
若消費者沒有既有可用深連結，先保留手動定位；新增查詢 adapter 另定 scope，不假裝現在可用。

驗收負例：刷新／重開／缺資料／跨來源同名／unknown／原 hash 與 display hash 不同時，
只讀消費者不得發起 create/start/retry/cancel/reconcile、改來源狀態、洩漏私人 locator 或把失敗變成功。
這些是未來具名 consumer 的條件，不是已跑的產品測試，也不增加原 MVP 的必做前置。
本次原 route 不變，不要求新 CLI qualification 研究；日後若變更 executable／版本／
協定／認證或工具邊界，仍依原 SDD 核對相應 receipt，不把歷史證據套用到新 route。

入口退役／切換必須先證明自己的六類等價、原 AC、必要審查與回退，並有明確切換範圍。
**當前退出結論：沒有入口可以據本文件退役。** AP 維護、Office 原生能力與 Fanzloud FN07 均保留。
本輪 rollback 只撤回文件／導航連結，不動 route、DB、run、資料或任何 live 服務。

[fz-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SDD.md
[fz-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SUCCESS.md
[fz-board]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/tasks/BOARD.md
[fz-m2]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M2-two-vendors.md
[fz-durable]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-durable-intents.md
[fz-candidate]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-fixed-candidate.md
[fz-review]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-readonly-review.md
[fz-reconcile]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-reconciliation.md
[fz-owner]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-owner-operation.md
[ap-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/SDD.md
[ap-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/SUCCESS.md
[ap-readme]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/README.md
[ap-archive]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/RESULT-ARCHIVE.md
[office-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/SDD.md
[office-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/SUCCESS.md
[office-board]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/tasks/BOARD.md
[office-console]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/CONSOLE.md
[office-cancel]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/CANCEL.md
[office-retry]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RETRY.md
[office-resume]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-RESUME.md
[office-restart]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-HOST-RESTART.md
[office-question]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-QUESTION.md
[office-results]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RESULTS.md
[office-file]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/LOCAL-FILE-PROPOSAL.md
[office-redaction]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RESULT-REDACTION.md
[office-redaction-evidence]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/evidence/result-redaction-2026-11-16.json
