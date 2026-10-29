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

## T-0436 — 狀態收尾與繁中筆記評估

需求：[desk T-0436](https://github.com/fallrising/desk/tree/main/tasks/T-0436-memvid-notes-usability)，認領 PR #293 已合併。Owner 於 2026-10-29 批准兩個里程碑及逐項正常合併；[規格](../notes-usability.md)，主導 codex-gpt6-pilot。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0436-M1 | 同步已合併狀態及固定評估規格 | NU-01 | done | 2026-10-29T16:55:00Z | 2026-10-29T17:02:27Z | 2026-10-29T17:02:27Z |
| T-0436-M2-01 | 固定繁中筆記、查詢與品質評估 | NU-02 | done | 2026-10-29T16:59:00Z | 2026-10-29T17:25:19Z | 2026-10-29T17:25:19Z |
| T-0436-M2-02 | 更新／刪除／重開一致性 | NU-03 | done | 2026-10-29T16:59:00Z | 2026-10-29T17:25:19Z | 2026-10-29T17:25:19Z |
| T-0436-M2-03 | 100／1000 筆成本實測 | NU-04 | done | 2026-10-29T16:59:00Z | 2026-10-29T17:25:19Z | 2026-10-29T17:25:19Z |
| T-0436-M2-04 | 回歸、採用結論及交付 | NU-05 | done | 2026-10-29T16:59:00Z | 2026-10-29T17:25:19Z | 2026-10-29T17:25:19Z |

M1 [#773](https://github.com/fallrising/newclear/pull/773) 已合併，merge `da6d735d98ffa77b363cab7cffd4715b2a864dd6`；三項 candidate CI success，獨立審查 ACCEPT。M2 已啟動；固定 corpus SHA `a91ec99c3329ddafdf856aa74a193dcfd5f62e32273ccd4c62d9154855c1f970`。首輪來源 renderer 核對失敗與修正見 [開發紀錄](../evidence/notes-development.md)。


M2 本機驗證：`make check` 16 passed；`make notes RUN_DIR=work/notes-final-002` 所有預定 jobs 完成／0 errors。原生 Recall/MRR 0.25、二字組 0.4583，兩者均不建議直接採用，詳見 [結果](../notes-usability-results.md)。NU-02–05 實驗證據及正常 Git 交付均完成；四列依實際 merged_at 結案。


### T-0436 最終 Git 交付

M2 [PR #777](https://github.com/fallrising/newclear/pull/777) 於 `2026-10-29T17:25:19Z` 正常合併，merge SHA `af412068b8fa065daa7f936b63d7c5474c2e5ba3`，驗證 head `45d5483b13d51c543e7bd6277dc6fee761441686`。

合併前四個 head workflows success：[Memvid lab CI](https://github.com/fallrising/newclear/actions/runs/40919594865)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/40919595145)、[llms navigation](https://github.com/fallrising/newclear/actions/runs/40919595563)、[Workflow lint](https://github.com/fallrising/newclear/actions/runs/40919595572)。Memvid CI 的16項 regression、固定筆記評估、原生工具／模型準備、既有15場景與artifact上傳均 success。

獨立 M2 審查 [T-003](../../.team/reports/T-003.md) ACCEPT；合併後再次回讀 merged=true、實際 SHA／時間。遠端 evaluator、corpus與final JSON的Git blobs均與已驗證候選相同。此最後任務板PR只同步事實，不修改 runtime、資料、門檻或既有失敗證據；候選時點文件中的待CI／合併記錄由本節交付事實更新。

本次完成的是評估實驗，兩種策略的自然語句檢索均不建議直接採用。沒有產品整合、release、usable tag或部署；desk正式done與owner驗收仍依owner決定。

## T-0436 M3 — 中文語意檢索

Owner 於上一輪結果後回覆「好，繼續開發。」範圍承接 [desk #305](https://github.com/fallrising/desk/pull/305)，[固定規格](../notes-semantic.md)，主導 codex-gpt6-pilot。M1/M2 完成與低分結論保留。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0436-M3-01 | 固定模型與離線真embedding | NS-01 | in_progress | 2026-10-29T17:57:27Z | | 2026-10-29T18:22:31Z |
| T-0436-M3-02 | 開發校準與獨立保留集比較 | NS-02 | in_progress | 2026-10-29T17:57:27Z | | 2026-10-29T18:22:31Z |
| T-0436-M3-03 | 向量更新／刪除／重開 | NS-03 | in_progress | 2026-10-29T17:57:27Z | | 2026-10-29T18:22:31Z |
| T-0436-M3-04 | 規模成本與CLI邊界 | NS-04 | in_progress | 2026-10-29T17:57:27Z | | 2026-10-29T18:22:31Z |
| T-0436-M3-05 | 審查、結果與Git交付 | NS-05 | in_progress | 2026-10-29T17:57:27Z | | 2026-10-29T18:22:31Z |

M3 checkpoint：模型準備與禁網推論通過；SDK批次向量持久化控制失敗，詳見 [結果／重現](../notes-semantic-results.md)。五列維持in_progress，未以部分交付冒稱M3結案；NS-02–04未完成，等owner決定是否先開SDK持久化修復範圍。保留題尚未執行。
