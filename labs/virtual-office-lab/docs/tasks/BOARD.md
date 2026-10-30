# Virtual Office 任務板

## T-0001 — 虛擬辦公室設計、CLI 與 Workers 骨架

來源：owner 2026-10-31 直接指示。認領者：本次 ChatGPT agent。
基準：`8bf48551f524086d81fa66d946c984f8052152ff`。
交付：SDD、office-report、Cloudflare Workers 骨架、完整 Grok Bot 實作提示詞、測試、索引與 Draft PR。
不包含本次公開部署、merge、付費呼叫、全功能 Three.js 前端或真實 provider 驗收。
專案完整主線仍保留 3D 辦公室與真實 Agent 接入，不以骨架冒充完成。
預定驗證：Node 原生測試（輸入、鑑權、隱私、限流、重送、持久化契約）、CLI 本機 HTTP 整合；repo indexes CI；Workers 真 runtime/瀏覽器/公開部署未跑須明示。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-1 | SDD、狀態與公開邊界 | AC-01 | in_progress | 2026-10-30T16:55:00Z | — | 2026-10-30T16:55:00Z |
| T-0001-2 | 安全上報 CLI 與本機 HTTP 驗證 | AC-02 | in_progress | 2026-10-30T16:55:00Z | — | 2026-10-30T16:55:00Z |
| T-0001-3 | Workers/DO 骨架與安全契約測試 | AC-03 | in_progress | 2026-10-30T16:55:00Z | — | 2026-10-30T16:55:00Z |
| T-0001-4 | Grok Bot 提示詞、配置與部署驗收手冊 | AC-04 | in_progress | 2026-10-30T16:55:00Z | — | 2026-10-30T16:55:00Z |
| T-0001-5 | 索引、證據與 Draft PR；等 owner 審閱 | AC-05 | in_progress | 2026-10-30T16:55:00Z | — | 2026-10-30T16:55:00Z |

AC-06（3D 前端）、AC-07（真實 Agent）、AC-08（公開部署與恢復）保留為下一階段，不宣稱完成。
依根 AGENTS 合約：只有 PR 合併後才改 done 並記錄 end；本次維持 in_progress。
