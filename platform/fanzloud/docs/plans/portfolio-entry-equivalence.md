# Fanzloud／Agent Platform／Office 入口等價與能力保留

日期：2026-11-16。範圍：FZ-ENTRY-MAP／[T046](../tasks/T046.task.md)／
[issue1046](https://github.com/fallrising/newclear/issues/1046)。這是文件盤點與後續提案；
沒有實作共同入口、搬移狀態、停用舊入口或改寫產品驗收。

## 結論與來源規則

先統一「去哪裡操作、去哪裡讀成果」的導航，再考慮功能搬移。
目前不能把三者視為可互換的操作台：Fanzloud 的 isolated 入口委託 AP 執行，
AP 有自己的命令／lease／VM／成果權威，Office 則保有本機原生終端與 session。
Office 的本機 runner 不會因這份計畫變成 AP run；AP 的唯一權威限於它管理的執行，
不能解讀為接管 Office 或舊 Codex Cloud provider。

所有下列來源標籤固定於 newclear `fead565acb877453861b6895471326096b923f0b`；它是盤點 checkout，
不是全部實測共同使用的版本。每份歷史驗收內自己的 source／日期／環境才是實測邊界。
原 portfolio 基準為 `2aa21f10b53ecaeb079279b6531bbb47a103e937`；刷新後 Fanzloud／AP
沒有差異，Office 新增 T-0027 結果遮蔽。以新版具體證據補充舊摘要，不改寫歷史失敗或 pending。

證據等級：**D**＝設計／來源存在；**N**＝原生程式、離線或測試替身驗證；
**H**＝來源報告記錄的歷史真實系統／瀏覽器觀測（仍須看模型是否真實）；
**P**＝待驗。本次只核對文件與來源，沒有重新執行 H 或產品驗收。
表內「只讀足夠」只判斷是否可用導航保留取得能力的路徑，不表示只讀頁能代做該操作。

## 六個 journey 的保留矩陣（EM-01／02）

### 1. 建立任務

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud isolated Web → Rust → AP task admission | [F1]、[F2]、[F3]；H：兩家 agent、固定 base、隔離與 automated journey | 選已登錄 project／profile，明示提交；本地 durable intent 綁唯一 AP run；AP Worker/lease/Connector 執行 | 不是任意 repo、CLI 或通用 DAG；FN07 本人提交未確認 | 可導回原 Web，不能代提交；fallback：[F2] 私人入口前置與 [F4] owner 操作說明 |
| AP Web／tasks API → SQL queue／Worker | [A1]、[A2]；D＋H：正常 Worker 的固定 mock KVM；訂閱另有 Fanzloud 切片 | 固定 repository/base/profile、獨立 run、容量 reservation；原 AP 工作台 | OpenHands/mock 與 subscription 的能力不同；完整 M3/M4 未通過 | 可導回工作台；不得由新入口另開 queue/worker；fallback：[A1] 快速開始／單節點手冊 |
| Office console／dispatch CLI → 本機 runner／共用鎖 | [O1]、[O2]；H：OpenCode 本地新入口；四 provider 原生成功不等於同一新入口驗收 | 預設 plan、明示 execute；本地文字快照與單檔提案；原生工位 | Pi 遠端 grant 控制層有 N/H 本機證據，新 UI→DeepSeek 產物仍 P；Grok/Cursor 等新入口未等價 | 只能導向原 console/CLI；fallback：[O1] 原生 runner 與 [O2] 本機操作台；不得自動轉雲端 |

### 2. 身分與授權

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud isolated Rust 精確路由 → AP operator session；Cloud 模式另有私人 bootstrap | [F5]、[F6]、[F9]；D＋N，H：成果未登入 401 | 私人單 operator、既有登入／登出、auth/CSRF；不攜帶憑證穿越新入口 | isolated 與舊 Cloud 模式不等同；無共同 SSO／多人授權 | 可連到既有登入說明；fallback：[F2]；不複製 token/cookie 或私人啟動 URL |
| AP API 的 authenticated session／CSRF／command identity | [A2]、[A3]；D＋N，歷史登入/還原證據見 [A1] | session 撤銷、物件歸屬、command key 與版本條件；provider credential 與 UI 分離 | run ID／artifact ID 不是授權；不推出租戶隔離 | 可連到 AP 正常登入入口；fallback：[A1]；新導航不代理登入或權限 |
| Office loopback console token、native worker hook token／session、CLI provider 登入 | [O2]、[O3]；D＋H：真 HTTP hook 錯配拒絕；一般安全仍 P | 精確 Host、同來源寫入、每次啟動 token、原生 hooks；明示一次性遠端 grant | 不是 AP session；原生登入連結私有；整棵程序樹隔離未驗收 | 只導向說明；fallback：[O2] 本機生成入口，不能將 token fragment／原生登入連結發布 |

### 3. Session 與互動

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud isolated 任務觀測與本地 intent；agent execution 屬 AP | [F3]、[F7]；H：重啟後原 run 與成果回讀 | 相同提交／run 的關聯、unknown lock、不因刷新重送 | observation history 不是完整 AP event/tool transcript；不是原生 CLI reasoning resume | 觀測可導回原 Web；互動不等價；fallback：[F2]，不捏造統一 session |
| AP run／attempt／backend conversation 與 durable events | [A2]、[A4]；H：同 VM/conversation 的固定 mock recovery | 事件 cursor、generation/lease fence、capability 對應的審批／pause 控制 | browser session ≠ conversation；AP 不提供 Office 的可寫原生 PTY；訂閱未知 CLI 不重啟 | 只讀可查狀態，不能代審批或終端輸入；fallback：AP 原工作台／[A4] 恢復說明 |
| Office 原生 lite/PTY／worker session | [O2]、[O3]、[O4]；H：OpenCode 互動、Pi 原生問答與無 prompt 重連子集 | 原生 terminal、needs_input、所選 worker 當前 session、local-first 與不同 provider 協定 | console 不代理 keystroke；不能用結果頁或 AP event view 取代 PTY；完整跨 provider 仍 P | **不足以替代互動**；只能導向原生 Office；fallback：[O2] 原終端入口及 [O4] 固定 resume 流程 |

### 4. 取消與停止

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud isolated Web cancel → AP actions；舊 Cloud cancel 是另一種語義 | [F2]、[F3]、[F9]；H：isolated 取消／清理；Cloud live P | AP 版本化 command 與真正 cleanup 狀態；Cloud 只保證停止本機工作／監看 | 不能把 Cloud monitor stop 顯示為 provider task 終止；受理不等於停止 | 不足以執行取消；fallback：原模式既有取消入口；新導航不可帶自動 action |
| AP actions → cancel worker／Connector | [A5]；N＋H：真 KVM 長命令取消、停止證據 | cancelling/unknown、reservation 保留、完整 VM 停止證據；finalizing/terminal 拒絕規則 | API command receipt completed 不是 VM 已停止；失聯不能猜 cancelled | 只讀可查看，操作回原 AP；fallback：[A5] 工作台／API，不增加第二 stop writer |
| Office console stop／Ctrl+C／native worker kill/remove | [O2]、[O5]；H：OpenCode/Pi 本機所屬程序清理子集 | 只停止所屬 runner/程序樹；cleanup 未確認仍阻擋；保留產物且不宣稱回滾 | 關分頁不等於停止；Grok/Cursor、Pi 真遠端串流取消仍 P | 不足以停止；fallback：原 console/CLI/native 入口，不能從共同頁按名稱 kill |

### 5. 恢復與重試

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud explicit reconcile → AP 精確 command GET → 本地 confirmation | [F3]、[F7]；H：原安裝 unknown 正面對帳、重啟回讀 | 同 operator/route/key 證據，缺證仍 unknown；refresh 不對帳、不重送；AP 仍管執行 | 對帳雖對 AP 只讀，**會寫本地 confirmation**，不屬新只讀頁範圍；無任意 abandon/retry/續做 | 只讀只能顯示待核對；fallback：[F3] 原明示對帳；不得推斷 cancelled=工作成功 |
| AP recovery queue／同 VM 對帳／lease fence | [A4]、[A7]；N＋H：固定 mock 的 SIGKILL／ACK 遺失場景 | 原 binding/conversation、unknown 不重派、停止證據才釋容量；subscription 不重啟不確定 CLI | 不是 VM snapshot 或通用推理續做；無證據不得 replacement | 只能導向原觀測與管理流程；fallback：[A4] 原 worker／管理命令，不能建新 recovery daemon |
| Office interrupted／明示 session resume／有界 retry | [O4]、[O6]、[O9]；H：Pi 429 後 host crash、同 session 無 prompt 重連 | interrupted 保留、共用鎖、一次性 resume；retry 新 run/session 保留失敗，最多兩次明示重試 | Pi 受測時點為 429 後，非遠端串流續做；其他 provider 與一般 session 選擇未等價 | 只讀只能提示；fallback：原 native/dispatch 流程；不自動解鎖、resume、retry 或消耗 grant |

### 6. 成果查看、下載與交接

| 現行入口／權威 | 固定來源／證據 | 必須保留 | 等價缺口 | 只讀導航是否足夠／fallback |
| --- | --- | --- | --- | --- |
| Fanzloud Web → AP immutable archive／candidate／review | [F3]、[F5]、[F8]；H：固定候選與首輪 accept、重啟下載一致 | base、diff/checks、candidate/verdict 的精確 hash／來源；明示交接 | candidate 不是完整 checkout；reviewer 不重跑 writer tests；rework/第二輪僅 N；checks 在 JSON `result.verification`，無獨立下載按鈕 | **足以導向既有成果**，不代交接；fallback：原 Web archive/diff；失效不可合成成果 |
| AP 工作台／artifacts API | [A6]、[A1]；N＋H 瀏覽器/SQL，runtime 為合成邊界 | immutable bytes/hash、run/task/attempt/base/profile，verification 與 cleanup 分開；既有授權/過期檢查 | archive-ready 不表示 tests passed；legacy 無封存不回填；GitHub export 是另行授權 mutation | 可導向既有唯讀檢視/下載；fallback：原 AP；不新增 export/GC/修復寫入 |
| Office results CLI／離線 HTML／console 白名單結果 | [O7]、[O8]；H：四 provider 歷史產物回讀；N＋H：11/16 合成遮蔽 HTTP/Chrome/Blob，零產品推論 | 原生來源與狀態、原 bytes 先驗 hash；顯示/下載投影 hash 分開；本機原始資料不變 | 有限 sentinel ≠ 一般秘密偵測；ref 可字典猜測、依 roots 順序，非全域永久 ID/授權；完整 AC-09/11 P | 可導向本機結果；fallback：原 results CLI/離線頁；不匯出任意 log/session/path 或私人快照 |

## 最小可選後續切片（EM-03；尚未實作）

第一個候選只做**靜態入口導航**：在既有說明頁呈現三個入口的用途、適用環境、
目前證據與回原入口步驟。公開版本只連到 repo 操作文件，不收集私人 host、run/session ID、
token、檔案系統路徑或帶憑證 URL。沒有背景掃描、跨站 API、共用登入或狀態資料庫。
這足以降低「選錯入口」的重複說明成本，尚不能移除任何功能介面。

成果引用是再後一個候選，需另定契約與驗收後才實作。只在原授權範圍內選擇已存在成果，
保留來源產品／來源版本／觀測時間／原始狀態及 verification／cleanup 區別；
只讀不是免授權。原產品負責物件查詢與下載，Office ref 不轉為 AP ID 或能力 token，
不以 hash 或 ID 授予讀寫權。取得失敗、過期或來源不明均保留 unavailable/unknown，
提供原入口，不回填、推測成功或自動重跑。

後續驗收至少證明：無憑證不讀成果、過期/不存在不偽造、名稱碰撞不選錯、
來源不同的相同 ID 不混淆、刷新不產生 start/cancel/reconcile/retry/review/export，
Office 原生入口仍可到達。這些是未來條件，不是本次已執行測試。
導航可獨立撤回；成果引用不可成為新 run registry／scheduler／lease writer。

## 保留缺口與退出條件（EM-02／04）

- Fanzloud：FN07 本人操作仍 pending；歷史 automated journey 不代替 owner。
  舊 Cloud AC-04、完整 P1 AC-05、完整 FN04/M3 不因矩陣完成而通過。
  原服務已停、無常駐 URL；11/02 舊 TLS 已過期，不能拿歷史 readiness 直接開窗。
  現有 read-only gate 只到 pre-live；新窗口需核對當時來源、本人在場及有限授權。[F4]、[F9]
- AP：保留原工作台、execution/stop/reconcile/result authority 及 private Connector。
  M3/M4 全體、完整 live gate 與部署仍未完成；本次不重排或接管它們。[A1]
- Office：保留原生 PTY/hooks/session、local-first、不自動 cloud fallback。
  四 provider 曾各有成功合成任務，不等於跨 provider 生命週期或完整安全驗收。
  T-0027 只處理指定合成秘密，完整 AC-11/MVP 仍 pending。[O1]、[O8]
- 本次退出條件只有 EM-01–04 文件交付。必要 CI／獨立審查／合併回讀見
  [任務](../tasks/T046.task.md)與[任務板](../tasks/BOARD.md)。
  不用「入口整合完成」替代大需求驗收；大需求驗收仍由 owner 決定。

## 固定來源索引

下列每個來源皆固定於上述 SHA；它們的內部歷史連結與驗收 source 不提升為本次新實測。

[F1]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SDD.md "Fanzloud SDD"

[F2]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/isolated-operator.md "isolated operator"

[F3]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-reconciliation.md "原安裝 reconciliation / automated U07"

[F4]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-owner-operation.md "owner operation / pre-live 限制"

[F5]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-fixed-candidate.md "fixed candidate"

[F6]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/apps/control-plane/src/isolated.rs "現行 route allowlist"

[F7]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-durable-intents.md "durable intent 最小切片"

[F8]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-readonly-review.md "實際 readonly review 與條件分支"

[A1]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/README.md "AP README / 既有入口與缺口"

[A2]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/SDD.md "AP SDD / 執行權責"

[A3]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/src/agent_platform/api.py "AP authenticated API"

[A4]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/M3-RECOVERY.md "AP recovery / 同 VM 與未知狀態"

[A5]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/M3-CANCEL.md "AP cancel / receipt 與停止證據"

[A6]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/RESULT-ARCHIVE.md "AP immutable archive"

[O1]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/README.md "Office README / 原生入口"

[O2]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/CONSOLE.md "Office console / 授權與共用鎖"

[O3]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-HOOK-BOUNDARY.md "Pi hook boundary"

[O4]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-RESUME.md "Pi same-session resume"

[O5]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/CANCEL.md "Pi cancel 限定驗收"

[O6]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/PI-HOST-RESTART.md "Pi host restart"

[O7]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RESULTS.md "Office results"

[O8]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/evidence/result-redaction-2026-11-16.json "11/16 synthetic result redaction 證據"

[F9]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SUCCESS.md "Fanzloud 原 Cloud/P1 與完整 FN 缺口"

[A7]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/EXTERNAL-WORKSPACE.md "AP subscription authority/recovery"

[O9]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RETRY.md "Office 明示有界 retry"
