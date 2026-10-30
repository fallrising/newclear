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
| T-0436-M3-01 | 固定模型與離線真embedding | NS-01 | done | 2026-10-29T17:57:27Z | 2026-10-30T04:25:13Z | 2026-10-30T04:25:13Z |
| T-0436-M3-02 | 開發校準與獨立保留集比較 | NS-02 | done | 2026-10-29T17:57:27Z | 2026-10-30T04:25:13Z | 2026-10-30T04:25:13Z |
| T-0436-M3-03 | 向量更新／刪除／重開 | NS-03 | done | 2026-10-29T17:57:27Z | 2026-10-30T04:25:13Z | 2026-10-30T04:25:13Z |
| T-0436-M3-04 | 規模成本與CLI邊界 | NS-04 | done | 2026-10-29T17:57:27Z | 2026-10-30T04:25:13Z | 2026-10-30T04:25:13Z |
| T-0436-M3-05 | 審查、結果與Git交付 | NS-05 | done | 2026-10-29T17:57:27Z | 2026-10-30T04:25:13Z | 2026-10-30T04:25:13Z |

2026-10-30 owner批准修復，[desk #315](https://github.com/fallrising/desk/pull/315)已合併。固定SDK/core/HNSW明示source patch及真24／1000向量控制通過；原frozen M3全job實跑完成，0errors，詳見[結果](../notes-semantic-results.md)。兩模型未達採用門檻，結論不直接採用；不是評估未跑或放寬標準。必要完整回歸／獨立審查／CI已通過，PR#800於下述時間正常合併，五列按實際merged_at結案；原失敗保留。

### M3 Git交付與驗收界線

[PR#800](https://github.com/fallrising/newclear/pull/800)於2026-10-30T04:25:13Z正常squash合併；merge SHA `358870095984174d3bdb45aae94a7c21a23781b7`，已驗證head `bbf79adb906269e206a3a34c7dc58d4cc8fb66ed`。回讀確認merged=true、實際時間／SHA，遠端main包含merge；整個labs/memvid-lab與Memvid workflow的Git內容和已驗證候選完全相同。

三項必要head workflows均success：[Memvid lab CI](https://github.com/fallrising/newclear/actions/runs/41001833973)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/41001834005)、[Workflow static validation](https://github.com/fallrising/newclear/actions/runs/41001833957)。Memvid兩jobs涵蓋37tests、既有筆記評估／15真模型場景、明示patch重建、24與1000持久化控制、固定dev校準／heldout／更新小場景，artifacts上傳成功。本機另有兩模型100／1000完整成本實測，沒有把CI跳過項當passed。

[T-012](../../.team/reports/T-012.md)獨立審查ACCEPT implementation/local evidence；必要CI已解除其剩餘條件。GitHub沒有另外的review submission，不能冒稱外部人員approval。Patch最後只有文字格式改變，prepared源碼／native binary相同，[等價證據](../evidence/semantic-build-equivalence.json)保存評估時原patch bytes及hash，舊失敗與JSON未改寫。

NS-01–05完成的是固定實驗與工程交付。BGE／E5兩者未達採用要求，均不建議直接採用，詳見[結果](../notes-semantic-results.md)。本次最後PR只補任務板的合併事實，不修改runtime、語料、規格、門檻或證據；必要CI仍照常執行。desk task維持in_progress，正式done／owner驗收保留給owner；沒有新milestone、產品整合、release、tag或部署。

## T-0436 M4：查詢級拒答

Owner於M3交付後指示繼續開發；desk[#325](https://github.com/fallrising/desk/pull/325)已合併。範圍依[固定規格](../notes-rejection.md)，原M1–M3結果不變。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0436-M4-01 | 新資料及規格事前凍結 | NR-01 | in_progress | 2026-10-30T10:13:22Z | | 2026-10-30T10:13:22Z |
| T-0436-M4-02 | 有來源才接受的查詢決策 | NR-02 | in_progress | 2026-10-30T10:13:22Z | | 2026-10-30T10:13:22Z |
| T-0436-M4-03 | 開發校準與primary事前選擇 | NR-03 | in_progress | 2026-10-30T10:13:22Z | | 2026-10-30T10:13:22Z |
| T-0436-M4-04 | 新保留題、來源與成本實測 | NR-04 | in_progress | 2026-10-30T10:13:22Z | | 2026-10-30T10:13:22Z |
| T-0436-M4-05 | 審查、CI及Git交付 | NR-05 | in_progress | 2026-10-30T10:13:22Z | | 2026-10-30T10:13:22Z |

尚未執行M4模型評估；新corpus由隔離worker撰寫，root先完成manualoracle與hashfreeze後才實跑。品質未達標可完成實驗但不可宣稱可採用。
