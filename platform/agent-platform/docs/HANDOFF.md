# 開發接續紀錄 — 2026-09-22

本次停止點：**M2 PR #21 已合併（main `75d9c08`）；M3 的 worker 恢復／fencing 切片已實作，M3 尚未整體完成。** 本次分支 `agent/agent-platform/m3-recovery`。恢復契約與驗收見 [M3 recovery](M3-RECOVERY.md)，原 runtime 啟動見 [M2](M2.md)。

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

1. 依 [SDD](../SDD.md) 接續 M3 的 AT-06／08：approval 與安全取消／暫停／恢復；再完成 AT-07 egress／secret 與 AT-11 model proxy／budget／usage。AT-04／05 recovery 切片的能力與保守邊界已記錄，不把它當成完整 M3。
2. **M2 仍使用固定模擬模型**：只執行 `m2-result.txt` 的驗收，不解讀自然語言任務，不呼叫付費 provider。真實 model proxy／budget／usage 尚未提供。
3. `connector.py`／`connector_journal.py` 擁有上游操作與私密 state，`runtime_worker.py` 擁有平台生命週期。沒有足夠停止證據時 reservation 必須保留，不得把 restart 當作重新配置授權。
4. 任務輸入只允許 catalog 中的 canonical repo／base SHA；目前以 8 MiB 以下固定 bundle 提供 repository，沒有任意遠端 clone／私有 GitHub credential 流程。
5. Pause／resume／cancel／approval 均尚未開啟。M0 primitive 通過不代表 M3 平台安全語意已完成；不要提供 host shell fallback。
6. 256 KiB 以下 diff 與 fixture verification 保存於 DB；M4 的 artifact store／download、explicit export、backup／GC／production 仍未完成。
7. 重跑 KVM 使用專用 zero-warm node；本機私密測試目錄 `/tmp/apm3-20260922`（本次）與 `/tmp/apm2-20260922`（cache／runtime）保留。測試結束 connector／sandboxd 已停、VM／claims 為零。不要輸出 token／journal 原文。M0 registry 已移除；使用既有 Cocoon cache，不能假設 `localhost:15000` 可拉取。
8. Worker／connector 須一起更新；connector 新增有期限的 lease grant。不要刪 journal／fences 或降低 DB generation；先 drain 再 migrate。已進入 guest 的工具不會因 worker lease 到期而自動停止。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
