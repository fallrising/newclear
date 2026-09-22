# 開發接續紀錄 — 2026-09-22

本次停止點：**PR #18 已合併（main `f9df850`）；M2 真實 runtime 整合已實作並通過 AT-02／03／10，下一步 M3。** M2 分支為 `agent/agent-platform/m2-runtime`。操作、驗收與限制見 [M2](M2.md)，前一版見 [M1](M1.md)。

## M2 已完成

- Cocoon／OpenHands 私有 connector、固定 template 與管理員登錄的 readonly Git bundle、非 root guest checkout、真實 terminal 工具執行、持久事件及 bounded diff。
- Connector 私密 durable operation journal、generation／payload gate、不確定操作不重送；worker 四任務並行與 heartbeat。Fake／real 混用仍遵守全平台四 slot 上限。
- 四個真實 VM 並行、第五 queued、workspace 隔離；VMM／VM record／runtime directory／cgroup 均確認消失後釋放容量。
- 真實 Chromium／PostgreSQL／HTTP 的 100-event reconnect／reload／不重複執行驗收；unsupported UI／API gate 與安全文字 diff。
- `002_runtime.sql`、runtime catalog、`register-runtime`／`connector` CLI、path-scoped CI browser acceptance。證據見 [M2 evidence](evidence/m2-2026-09-22.json)。

## 下一步

1. 依 [SDD](../SDD.md) M3 完成 AT-04／05／06／07／08／11；優先處理未知 allocation／prompt、worker restart、stale generation 與 node partition 的 reconciliation。
2. **M2 仍使用固定模擬模型**：只執行 `m2-result.txt` 的驗收，不解讀自然語言任務，不呼叫付費 provider。真實 model proxy／budget／usage 尚未提供。
3. `connector.py`／`connector_journal.py` 擁有上游操作與私密 state，`runtime_worker.py` 擁有平台生命週期。沒有足夠停止證據時 reservation 必須保留，不得把 restart 當作重新配置授權。
4. 任務輸入只允許 catalog 中的 canonical repo／base SHA；目前以 8 MiB 以下固定 bundle 提供 repository，沒有任意遠端 clone／私有 GitHub credential 流程。
5. Pause／resume／cancel／approval 均尚未開啟。M0 primitive 通過不代表 M3 平台安全語意已完成；不要提供 host shell fallback。
6. 256 KiB 以下 diff 與 fixture verification 保存於 DB；M4 的 artifact store／download、explicit export、backup／GC／production 仍未完成。
7. 重跑 KVM 使用專用 zero-warm node；本機 2026-09-22 私密測試目錄 `/tmp/apm2-20260922` 保留，connector／sandboxd 已停、VM／claims 為零。不要輸出其中的 token／journal 原文。M0 registry 已移除；M2 使用既有 Cocoon cache，不能假設 `localhost:15000` 可拉取。

## 必須保留的契約差異

- `template_digest` 是 promoted snapshot export digest，不是 OCI manifest digest；目前 probe 使用 configured pool／cold OCI claim。
- OpenHands `/interrupt` 只證實 paused；sandbox release ACK 與 claim-list 消失也不能單獨證實 VM 已停止。
- 每次 WebSocket 訂閱的首幀 full_state 快照不屬於持久化 history。
- SDK 0.1.12 wheel 的 sandbox.py 與研究時 source revision 不完全相同；exec timeout 不代表 guest 程序已終止。
- Session／sandbox token 從本機環境或 secret store 提供，不提交到 repository；沒有模型 provider key 需求。

設計見 [SDD](../SDD.md)，驗證命令與證據見 [M0](M0.md)，主機安裝與遠端執行見 [KVM-HOST](KVM-HOST.md)。
