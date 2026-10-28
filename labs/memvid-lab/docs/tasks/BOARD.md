# Memvid lab 技術任務板

## T-0001 — 官方場景實跑

來源：owner 於 2026-10-28 直接指示。Session `Memvid-20261028`；base `f16dc2bb825ab1c85e5a68416aa46e80c58902b4`；branch `agent/memvid-lab-20261028`。
主導負責整合、驗收、Git 交付；worker 負責上游研究與 SDK probe；獨立 reviewer 不修改實作。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 上游來源與場景矩陣 | AC-01 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-02 | 11 類記憶層案例 | AC-02 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-03 | 本地語意檢索 | AC-03 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-04 | 更新與審計時間線 | AC-04 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-05 | 真 PDF ingestion | AC-05 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-06 | 真 CLIP 圖片搜尋 | AC-06 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-07 | 真 Whisper 轉錄 | AC-07 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
| T-0001-08 | 離線／搬移／負例及交付 gate | AC-08 | in_progress | 2026-10-28T11:08:13Z | | 2026-10-28T11:50:42Z |
全部 runtime AC 本機通過（15 個場景、8 個 CLI 邊界）；索引修復、ask guard 及 Whisper cache patch 明示於證據。獨立審查與必要 CI 依最後 candidate 核對。
本次交付保持 Draft，等 owner 審閱／另行授權合併；全部保留 in_progress，end 留空。實際執行狀態見 [SUCCESS](../../SUCCESS.md) 與 [evidence](../evidence/README.md)。
