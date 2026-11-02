# Edge Relay 任務板

## T-0001 — 通用反向通道 SDD（owner 直接指示）

範圍：抽取 Alma Relay 的 outbound tunnel 架構，定義 CF-first、業務協定可替換、ntfy/Bark 通知可替換的新項目；本次僅交付規格、驗收與索引，不實作、不部署。

Owner：repository owner。執行：ChatGPT。原始基準：`244c7f7b416508aedd8f5f8d4a082ae2bb17d022`。認領 commit：`802eabdae43e14536e3d735a007c3e0440810c3b`。交付：[PR #958](https://github.com/fallrising/newclear/pull/958)。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 架構抽象、範圍與既有元件邊界 | AC-001 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T11:25:38Z |
| T-0001-02 | Transport／adapter／security／recovery 契約 | AC-002 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T11:25:38Z |
| T-0001-03 | ntfy／Bark 通知與 iOS 限制 | AC-003 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T11:25:38Z |
| T-0001-04 | 可追溯來源、里程碑與 runtime 驗收計畫 | AC-004 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T11:25:38Z |
| T-0001-05 | SUCCESS、inventory、導航、驗證及 PR | AC-005 | in_progress | 2026-11-02T09:08:59Z | — | 2026-11-02T11:25:38Z |

文件 AC-001–005 已有原始候選 CI 證據，詳見 [驗證紀錄](../validation.md)。2026-11-02 owner 明確指示「合併 PR」，解除本文件里程碑先前 Draft-only／不合併停止條件；其他文件中的原始授權段落保留為歷史範圍，不授權 runtime、部署或 release。

合併前整合 main `2ec3c70043f7de0b4b347737a4bbaab1208e152e` 的並行項目與索引，保留雙方內容；候選須重新通過 CI。任務合併前保持 in_progress、end 留空，合併後另依根合約以只改任務板的 PR 補 done 與實際時間。runtime AC-006–014 仍未實作／未跑，後續里程碑須另有授權與認領。
