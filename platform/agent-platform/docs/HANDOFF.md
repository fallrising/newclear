# 開發接續紀錄 — 2026-09-22

本次停止點：**M3 recovery PR #22、cancel PR #24、approval PR #25 已合併；安全 pause／resume 切片已實作並驗收。M3 尚未整體完成。** 本次分支 `agent/agent-platform/m3-pause`，基於 main `24b11e1`；未修改其他平台。最新行為見 [M3 pause](M3-PAUSE.md)。

## M3 pause／resume 已完成

- `006_pause.sql`、pausing／paused／resuming、CAS／命令收據、generation 撤權、舊審批失效與完成 audit。
- AlwaysConfirm 關閉 terminal admission；初始 message `run=False` 初始化工具後收集 root-owned guest 程序基準。持鎖的 live WebSocket full_state、工具邊界、boot／PID identity 全部確認後才 paused。
- **REST ConversationInfo 在固定版本讀 autosaved state，可能落後控制 mutation。** 控制之後改用新訂閱 full_state，只選取控制欄位，不把 private snapshot 保存為 history／SSE。
- 恢復保持原 VM／prompt，還原原政策；需審批者產生新 generation grant，不因 resume 自動核准。未知 run ACK 不重送；完成收據可對帳。
- Paused 保留資源與原期限，定期核對，支援取消與到期直接回收。恢復成功交回普通 queue，控制執行緒持續可用。
- 新增 18 項後端與四項 UI 測試；六個真實 KVM 暫停案例及 recovery／cancel／approval 回歸，見 [證據](evidence/m3-pause-2026-09-22.json)。

## M3 approval 已完成

- `005_approvals.sql`、OpenHands profile `require_approval` opt-in、AlwaysConfirm、完整批次 digest／generation／五分鐘 expiry／live lease／CAS 決策。
- Connector 核對原 VM 與同一批 pending terminal actions 後才放行；持久 intent 與收據，未知回覆不重送、容量保留。
- 已完成 connector 收據可補登 applied／audit；worker 接管或參數改變須重新審批，不重建 VM／prompt。
- 工作台完整參數、核准／拒絕、原決策重試；拒絕走安全取消。當時一般 pause／resume 維持 capability gate；目前已由下一切片啟用。
- 16 項新增後端審批測試、三項 UI 測試、真實 KVM 核准／拒絕與取消回歸；證據見 [M3 approval](M3-APPROVAL.md)。

## M3 cancel 已完成

- `004_cancel.sql`、原子取消命令／冪等收據／state version、generation 撤權、取消請求與完成時間、完成 audit。
- 專用取消處理執行緒；四個普通 worker 卡住時仍可取消。Queued 直接取消，已配置任務必須確認原 VM 停止；未知狀態保持 cancelling 並保留容量。
- Connector 取消 tombstone、bounded interrupt＋VM release；完整停止證據才完成取消，未知 allocation ownership 不猜測成功。
- OpenHands 工作台取消／pending／重試流程；暫停／繼續／審批維持 capability gate。
- 新增 15 項後端取消驗收、兩項 UI 互動測試、真實 VM 配置中及 120 秒 terminal 命令取消、三個同 VM recovery 回歸案例；見 [M3 cancel](M3-CANCEL.md)。

## M3 recovery 已完成

- `003_recovery.sql`、原 binding／reservation 的 recovery queue、接管 generation、`interrupted_from`／`reconciled_at` 與接管 audit。
- Connector 獨立持久 lease fence；核對原 claim／VMM identity／固定 Agent Server／conversation 後接續事件，不重複 VM／prompt。
- 未知 upstream mutation／partition 保留容量；已確認原 VM 完全消失後才回收。無 ownership 證據的未知 allocation 仍須管理員對帳。
- 新增 19 項 recovery 測試：九個 SIGKILL 時點、未知 ACK、重啟、stale generation、partition、PID 重用、競爭及到期鎖等待。
- 三個真實 VM 恢復案例與原四 VM／第五排隊回歸通過；證據與限制見 [M3 recovery](M3-RECOVERY.md)。

## M2 已完成

- Cocoon／OpenHands 私有 connector、固定 template 與管理員登錄的 readonly Git bundle、非 root guest checkout、真實 terminal 工具執行、持久事件及 bounded diff。
- Connector 私密 durable operation journal、generation／payload gate、不確定操作不重送；worker 四任務並行與 heartbeat。Fake／real 混用仍遵守全平台四 slot 上限。
- 四個真實 VM 並行、第五 queued、workspace 隔離；VMM／VM record／runtime directory／cgroup 均確認消失後釋放容量。
- 真實 Chromium／PostgreSQL／HTTP 的 100-event reconnect／reload／不重複執行驗收；unsupported UI／API gate 與安全文字 diff。
- `002_runtime.sql`、runtime catalog、`register-runtime`／`connector` CLI、path-scoped CI browser acceptance。證據見 [M2 evidence](evidence/m2-2026-09-22.json)。

## 下一步

1. 依 [SDD](../SDD.md) 接續 M3 的 AT-07 egress／secret 與 AT-11 model proxy／budget／usage。AT-04／05 recovery、AT-06 approval 與 AT-08 cancel 的固定模式能力和保守邊界已記錄，不把它當成完整 M3。
2. **M2 仍使用固定模擬模型**：只執行 `m2-result.txt` 的驗收，不解讀自然語言任務，不呼叫付費 provider。真實 model proxy／budget／usage 尚未提供。
3. `connector.py`／`connector_journal.py` 擁有上游操作與私密 state，`runtime_worker.py` 擁有平台生命週期。沒有足夠停止證據時 reservation 必須保留，不得把 restart 當作重新配置授權。
4. 任務輸入只允許 catalog 中的 canonical repo／base SHA；目前以 8 MiB 以下固定 bundle 提供 repository，沒有任意遠端 clone／私有 GitHub credential 流程。
5. OpenHands cancel、pause／resume 已開啟；approval 由 profile opt-in。M0 primitive 通過不代表 M3 平台安全語意已完成；不要提供 host shell fallback。
6. 256 KiB 以下 diff 與 fixture verification 保存於 DB；M4 的 artifact store／download、explicit export、backup／GC／production 仍未完成。
7. 重跑 KVM 使用專用 zero-warm node；本機私密測試目錄 `/tmp/apm3-pause-20260922`（本次）、`/tmp/apm3-approval-20260922`（approval）、`/tmp/apm3-cancel-20260922`（cancel）、`/tmp/apm3-20260922`（recovery）與 `/tmp/apm2-20260922`（cache／runtime）保留。測試結束 connector／sandboxd 已停、VM／claims 為零。不要輸出 token／journal 原文。M0 registry 已移除；使用既有 Cocoon cache，不能假設 `localhost:15000` 可拉取。
8. API／worker／connector／web 須一起更新；先 drain，再套用 `006_pause.sql`。舊 journal 沒有 pre-tool 程序基準不能安全 pause。不要刪 journal／fences 或降低 DB generation；先 drain 再 migrate。已進入 guest 的工具不會因 worker lease 到期而自動停止。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
