# Fanzloud、Agent Platform 與 Office 入口能力對照

本文件只整理既有入口的責任與差距；不合併產品或建立共同執行平台。
Fanzloud 是隔離任務的 Web 意圖／呈現入口；Agent Platform（AP）是該路線
唯一 run、VM、lease、停止與清理權威；Agent Office 保留本機原生終端及互動。
原生會話不是 AP run，三者不能因都有「提交／取消／結果」按鈕便視為可互換。

## 版本與證據讀法

來源快照：`fallrising/newclear@fead565acb877453861b6895471326096b923f0b`，
2026-11-16 核對。下方全部來源連到該完整 SHA；報告內的實跑 SHA／時間才是
runtime 證據版本，本次沒有重跑歷史任務或量測目前服務狀態。

- **來源契約**：原 SDD／SUCCESS 的承諾，不因本表縮減或改狀態。
- **歷史證據**：來源報告所接受的有限實跑、native 或合成測試；不能外推其他 route。
- **現況未知／缺口**：尚無相應證據，或未在本輪重新量測。
- **整理建議**：只說明現有責任應如何保留；不是新 adapter／migration 授權。

較規劃來源 `2aa21f10b53ecaeb079279b6531bbb47a103e937`，Fanzloud／AP 未變，
Office 新增 T27 合成秘密結果投影及交付紀錄。採用其新證據，仍保留完整 AC-11
pending；Office SUCCESS 尾端的未交付文字是早期 checkpoint，後來的
[任務板結案][office-board]／[輸出契約][office-redaction]補充其後續狀態。
既有文件沒有六項行為的跨入口矩陣，本文件提供索引，原契約仍是權威。

## 六項入口對照

| 行為 | Fanzloud Web 意圖／呈現 | AP 執行後端 | Office 本機原生入口 | 比較結果與保留缺口 |
| --- | --- | --- | --- | --- |
| 建立任務 | FN-01／02：選固定 repo/base/profile，明示提交並保存意圖與唯一外部 run 引用。[SDD][fanz-sdd]；[M2][fanz-m2]有兩廠商真實修復證據。 | AT-01／INV-03：command key／payload 去重，AP admission／worker 建立 run；FN-03 的 VM 隔離由 AP 負責。[SDD][ap-sdd]；同一 [M2][fanz-m2]證明並行隔離、取消 A 不影響 B。 | AC-01–04／13：detect／plan／明示派工、固定 provider 與每工位原生 session；四 provider 各有合成任務證據，統一入口／跨 provider 完整流程仍有缺口。[SDD][office-sdd]、[SUCCESS][office-success]。 | 只對齊使用意圖，不增加第二套 dispatcher。Office 本地文字／單檔提案不是任意程式開發或 Fanzloud 隔離等價證明；不將其移到 AP 來消除本機互動。 |
| 身分與授權 | FN-06：AP 認證 session／CSRF 驗證後記錄 operator，持久意圖不存認證值；browser 不自行選 credential 或 executable。[durable contract][fanz-intent]、[U01–05][fanz-reconcile]。 | AT-07／INV-06：控制憑證不交 UI／guest，run/generation/lease 綁定工具權限；[M2][fanz-m2]有秘密 canary／越界拒絕實跑，[SUCCESS][ap-success]仍保留完整安全與 M3/M4 缺口。 | AC-11：worker token／provider route／session／世代核對，Pi T26 有原生 hook 拒絕證據；同 session 持有效 token 的偽造與其他 provider 未完整驗證。[SUCCESS][office-success]、[BOARD][office-board]。 | operator、provider 登入、worker token 與 native session ID 不是同一身分；不造共用帳號池、credential broker 或 token 轉移。Office 工作目錄限制不是 OS 沙箱，其區外讀取／整棵程序樹 egress gap 保留。 |
| session／恢復 | FN-04：持久提交意圖、AP run／成果引用與有界 observed snapshots；重開／重啟只讀回，不重送。[M3 durable evidence][fanz-durable]、[U06/U07][fanz-reconcile]。 | AT-03–05／INV-02、04：事件持久化與重播、lease／generation fence、未證實停止保留占用；不因失聯建立 replacement。[SDD][ap-sdd]；[SUCCESS][ap-success]區分已接受切片與完整 gate。 | AC-08：Pi T20／T23 明示無 prompt 重連使用新 PID、同 session、保留歷史，host restart 將 unfinished 停泊 interrupted；零追加請求是該受測情境的結果。[SUCCESS][office-success]。 | native session ≠ product run ≠ process。Office 重連不代表中斷 turn 續做；AP 恢復權威不代表 CLI 可從任意推理點恢復。Fanzloud snapshots 不是完整 event/tool transcript。 |
| 取消／停止 | FN-03／06：Web 明示取消交由 AP；[M2][fanz-m2]的 A 取消、B 完成分別有清理與資源不存在證據。舊 Cloud 路線本機停止監看不保證 provider 終止。[SUCCESS][fanz-success]。 | AT-08／INV-07：cancel 要有 backend／VM 停止證據，node unknown 不可寫 cancelled；資源清理／reservation 歸還由 AP 負責。[SDD][ap-sdd]、[M2][fanz-m2]。 | AC-06：原生中斷與 owned process 清理；OpenCode／Pi 有有限實跑，Grok／Cursor 與遠端串流仍待驗。[SUCCESS][office-success]。 | UI 收到取消 ≠ provider 停止或計費停止。Office 本機取消證據不等於 AP VM 清理，也不證明遠端服務端取消；保留 unknown，不由新入口補寫成功。 |
| 成果／交接 | FN-01／05：固定 base diff/checks/candidate；另一廠商 reviewer 綁同一 candidate hash，結果在重啟後精確讀回。[readonly review][fanz-review]、[U07][fanz-reconcile]。 | AT-09／12／INV-08、11：AP 封存成果，必要檢查與 unknown 如實保存；GitHub export 另有明示授權，不能從 review accept 推導 Done／merge。[SDD][ap-sdd]、[SUCCESS][ap-success]。 | AC-09／11：核對原產物 hash、顯示 provider/model/source；本地提案不自動套用。T27 先驗原 hash 再遮蔽合成秘密，下載核對 display hash。[SUCCESS][office-success]、[輸出契約][office-redaction]、[BOARD][office-board]。 | 檔案／hash 可供核對，並非同一成果 schema。FN05 審查只看供應的 candidate，不是完整 checkout／重跑 writer tests；返工／第二審查只有 native 證據。Office T27 不是通用秘密偵測，raw hash 與 download hash 不可混用。 |
| 維護／人工操作 | FN-07：本人登入→選 agent→提交→看進度→下載 diff→交接審查→重開；自動 U07 已接受，本人操作仍缺。[SDD][fanz-sdd]、[本人操作準備][fanz-owner]、[BOARD][fanz-board]。 | M4／AT-09、12、13：成果封存、explicit GitHub export、backup/GC、單節點操作與完整 fake E2E／opt-in live smoke。[SDD][ap-sdd]承諾不刪；[SUCCESS][ap-success]／[BOARD][ap-board]記有限切片，並未接受完整 M4。 | AC-05／08／11：保留原生終端回覆問題與明示恢復；Pi 問答是測試 slash command 子集，不是全部模型工具審批。未知 cleanup 阻擋派工，不能自動解鎖。[SDD][office-sdd]、[SUCCESS][office-success]。 | 不造共同維護控制面。Fanzloud 歷史服務已停止且無常駐 URL，本輪未確認當下 readiness；只讀本人確認也不能通過完整 FN07。AP 維護切片和 Office 本地可用性不能互相代替驗收。 |

## 回執遺失時的唯一權威

1. Fanzloud 在外部 POST 前持久記錄 intent。AP 接受而本機未保存回執時，
   結果為 unknown；同 key 或改用新 key 都不能造成第二次 start。
2. 舊 [durable contract][fanz-intent]「沒有 client-key GET」是當時限制。
   後來 [U01–06][fanz-reconcile]補上**明示對帳**：認證後唯讀精確
   operator／route／key 的 AP command receipt，符合才原子確認原 intent。
   缺少、不一致或不可達仍 unknown、阻擋 admission；refresh／restart 不自動對帳或重送。
3. 可以再明示查同一 GET，不能據此重發 task POST、猜 run 或清空舊 intent。
   確認原 cancelled/not_allocated run 只表示提交已知，並不表示修復成功。
4. AP 繼續唯一處理 Worker／lease／VM／生命週期；Fanzloud 的 SQLite 投影
   不擁有重派權。Office session history 的重連也不能拿來恢復同一 AP run。

## 保留的承諾與不採用的替代方案

- **完整 FN07／M3**：本人操作的提交、進度與交接不能由自動 journey 或只讀成果確認取代。
  原同來源、必要 CI、操作前置與本人確認均保留；不重新消耗原 M1/M2/U06/U07 窗口。
- **AP M4**：保留完整 AT-09／12／13、fake E2E 及 opt-in live smoke。
  已有 retention、stale binding cleanup、export／backup 組合與真 Fanzloud CLI 切片，
  但沒有因此補齊全平台 gate；live GitHub export、實際部署／維護與完整組合仍有缺口。
  真實計費／硬金額上限已延後，不把它重新列為單人 MVP 前置。
- **Office 本機原生互動**：保留 local-first、原生終端、人回覆問題與顯式 resume。
  統一 Web 外觀不應抹平這些能力；本表不承諾通用遠端 terminal adapter。
- **route 不變**：本次只是文件比較，不需要新 CLI qualification 研究或重做已接受 route。
  日後若改 executable／版本／協定／認證／工具邊界，仍依原 SDD 重新核對相應 receipt；
  不能將舊 route 的歷史證據當成新版本已通過。
- **不採用第三套平台／共同 DB／自動 fallback**：本表沒有需要新 consumer 的行為；
  再建 dispatcher、run writer 或 credential runtime 會增加權威衝突。保留原入口與資料，
  未來有具體不可滿足的原 AC 才另行界定工作，不把它變成本文件完成條件。

本輪只追加文件，原 SDD／既有 BOARD 狀態不改。回退可撤回本對照及其導航，
不改入口、資料、身分或 runtime；不宣稱未知外部效果已消失。
[P01 任務與檢查](tasks/P01.task.md)；[文件驗收](acceptance/P01.acceptance.md)。

[fanz-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SDD.md
[fanz-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/SUCCESS.md
[fanz-board]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/tasks/BOARD.md
[fanz-m2]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M2-two-vendors.md
[fanz-intent]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/specs/SPEC-M3-durable-intents.md
[fanz-durable]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-durable-intents.md
[fanz-review]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-readonly-review.md
[fanz-reconcile]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-reconciliation.md
[fanz-owner]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/fanzloud/docs/acceptance/M3-owner-operation.md
[ap-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/SDD.md
[ap-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/SUCCESS.md
[ap-board]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/platform/agent-platform/docs/tasks/BOARD.md
[office-sdd]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/SDD.md
[office-success]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/SUCCESS.md
[office-board]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/tasks/BOARD.md
[office-redaction]: https://github.com/fallrising/newclear/blob/fead565acb877453861b6895471326096b923f0b/labs/agent-office-lab/docs/RESULT-REDACTION.md
