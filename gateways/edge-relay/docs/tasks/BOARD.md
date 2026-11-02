# Edge Relay 任務板

## T-0001 — 通用反向通道 SDD（owner 直接指示）

範圍：抽取 Alma Relay 的 outbound tunnel 架構，定義 CF-first、業務協定可替換、ntfy/Bark 通知可替換的新項目；本次僅交付規格、驗收與索引，不實作、不部署、不合併。

Owner：repository owner。執行：ChatGPT。基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022`。認領 commit：`802eabdae43e14536e3d735a007c3e0440810c3b`。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 架構抽象、範圍與既有元件邊界 | AC-001 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T09:20:40Z |
| T-0001-02 | Transport／adapter／security／recovery 契約 | AC-002 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T09:20:40Z |
| T-0001-03 | ntfy／Bark 通知與 iOS 限制 | AC-003 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T09:20:40Z |
| T-0001-04 | 可追溯來源、里程碑與 runtime 驗收計畫 | AC-004 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T09:20:40Z |
| T-0001-05 | SUCCESS、inventory、導航、驗證及 Draft PR | AC-005 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T09:20:40Z |

文件 AC-001–004 已寫入並自查，AC-005 待完整候選 CI／回讀。實際驗證見 PR 與 [驗證紀錄](../validation.md)。認領先於規格實作；runtime AC-006–014 未實作／未跑，不以文件驗證冒充。

任務在 Draft PR 合併前保持 in_progress，end 留空；下一步等 owner 審閱 SDD／授權合併。後續 runtime 里程碑須另有授權及每個 AC 的任務列。
