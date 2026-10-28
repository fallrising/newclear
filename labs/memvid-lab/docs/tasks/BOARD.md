# Memvid lab 技術任務板

## T-0001 — 官方場景實跑

來源：owner 於 2026-10-28 直接指示。Session `Memvid-20261028`；base `f16dc2bb825ab1c85e5a68416aa46e80c58902b4`；branch `agent/memvid-lab-20261028`。
主導負責整合、驗收、Git 交付；worker 負責上游研究與 SDK probe；獨立 reviewer 不修改實作。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 上游來源與場景矩陣 | AC-01 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-02 | 11 類記憶層案例 | AC-02 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-03 | 本地語意檢索 | AC-03 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-04 | 更新與審計時間線 | AC-04 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-05 | 真 PDF ingestion | AC-05 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-06 | 真 CLIP 圖片搜尋 | AC-06 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-07 | 真 Whisper 轉錄 | AC-07 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |
| T-0001-08 | 離線／搬移／負例及交付 gate | AC-08 | done | 2026-10-28T11:08:13Z | 2026-10-28T18:05:42Z | 2026-10-28T18:07:02Z |

## 合併結案

Owner 已另行明確授權合併。[PR #709](https://github.com/fallrising/newclear/pull/709) 於 `2026-10-28T18:05:42Z` 正常合併至 `main`；八列任務依實際合併時間結案，保留原始認領與 AC。

- 合併提交：`8c7d6a4df064ad9b1bc6a93186acf4da946e2764`。
- 已驗證的 PR head：`67132cd45bcd4e53fb61d4a1f6b650408f34e2e8`；合併同時保留當時最新 main `cef2b3f0f0f408171429fe4abb95f1a8b2799168`，兩者均為合併提交的 parents。
- 合併前已回讀四項 CI success、兩份既有獨立審查 ACCEPT，沒有未解 review thread；[Memvid CI](https://github.com/fallrising/newclear/actions/runs/40683218666) 記錄 15 個場景與 8 個 CLI 邊界測試通過。此處沿用相同實作版本的證據，不宣稱重新執行測試或新增 GitHub reviewer approval。
- 合併後已回讀 PR 的 `merged: true`、合併 SHA／時間及 `main` ref。此次後續 PR 只更新任務板，不修改實作、依賴、驗收條件或既有失敗證據。

索引修復、ask guard、Whisper cache patch 及中文／圖片限制仍保留於 [SUCCESS](../../SUCCESS.md) 與 [evidence](../evidence/README.md)。這是本次場景實跑任務的 Git 交付結案，不是 production 驗收、release、部署或 usable tag 授權；其他文件中的 Draft 敘述屬合併前快照。
