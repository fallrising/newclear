# Edge Relay 任務板

## T-0001 — 通用反向通道 SDD（owner 直接指示）

範圍：抽取 Alma Relay 的 outbound tunnel 架構，定義 CF-first、業務協定可替換、ntfy/Bark 通知可替換的新項目；本次僅交付規格、驗收與索引，不實作、不部署。

Owner：repository owner。執行：ChatGPT。原始基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022`。認領 commit：`802eabdae43e14536e3d735a007c3e0440810c3b`。交付：[PR #958](https://github.com/fallrising/newclear/pull/958)。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 架構抽象、範圍與既有元件邊界 | AC-001 | done | 2026-11-02T09:08:59Z | 2026-11-02T11:31:09Z | 2026-11-02T11:31:37Z |
| T-0001-02 | Transport／adapter／security／recovery 契約 | AC-002 | done | 2026-11-02T09:08:59Z | 2026-11-02T11:31:09Z | 2026-11-02T11:31:37Z |
| T-0001-03 | ntfy／Bark 通知與 iOS 限制 | AC-003 | done | 2026-11-02T09:08:59Z | 2026-11-02T11:31:09Z | 2026-11-02T11:31:37Z |
| T-0001-04 | 可追溯來源、里程碑與 runtime 驗收計畫 | AC-004 | done | 2026-11-02T09:08:59Z | 2026-11-02T11:31:09Z | 2026-11-02T11:31:37Z |
| T-0001-05 | SUCCESS、inventory、導航、驗證及 PR | AC-005 | done | 2026-11-02T09:08:59Z | 2026-11-02T11:31:09Z | 2026-11-02T11:31:37Z |

文件 AC-001–005 的歷史證據見 [驗證紀錄](../validation.md)。2026-11-02 owner 明確指示「合併 PR」，解除本文件里程碑先前 Draft-only／不合併停止條件；其他文件中的原始授權段落保留為歷史範圍，不授權 runtime、部署或 release。

## 合併與收尾證據

- PR #958 已於 `2026-11-02T11:31:09Z` 合併；上述 end 使用 GitHub 回讀的實際 merged_at。
- 合併 commit：`2923d799a27e0de61b63f260e03240084400a2d2`；head：`20e8cb57f8c9d4ad3308320dd0df0e6355cb388e`。
- 已處理共用索引的並行新增衝突，17 檔、696 additions、0 deletions；未刪改其他項目。
- 合併前 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/41437319219) 與 [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/41437319221) 均 success。
- PR test merge `bd8a0d4b0a8ccc4fa23f856927c42678a20255e3` 已確認包含 main `0ef596bd25fbf4ae83c57ee540e87a12817a9bdf` 與上述 head；實際 merge 後已回讀 PR 與遠端 main。
- 本次收尾 PR 只改任務板，補合併後的狀態與證據；不擴大 M0 範圍。

M0 文件里程碑完成。產品主線仍 incomplete、usable_tag 為 none；runtime AC-006–014 全部 pending／未實作／未跑，後續里程碑須另有授權與認領。沒有部署或發布。
