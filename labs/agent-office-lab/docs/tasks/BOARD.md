# Agent Office Lab 任務板

本次依 owner 直接指示匯入 GitHub；無 desk 卡。AC 沿用 SDD，公開版將 A01–A11 正規化為 AC-01–AC-11。

## T-0001：公開匯入

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 匯入可重建來源、公開證據摘要、任務及索引，完成 PR／CI／回讀 | AC-12 | done | 2026-10-31T11:19:24Z | 2026-10-31T11:23:55Z | 2026-10-31T11:24:23Z |

## T-0002：後續 MVP（持續追蹤）

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-01 | CLI capability／版本／缺失偵測 | AC-01 | todo | — | — | — |
| T-0002-02 | 已有 OpenCode 合成任務；移植後補完整 runtime 回歸 | AC-02 | todo | — | — | — |
| T-0002-03 | 確認 Grok 版別，再做顯式遠端任務 | AC-03 | todo | — | — | — |
| T-0002-04 | Pi + DeepSeek 顯式遠端任務 | AC-04 | done | 2026-10-31T18:03:31Z | 2026-10-31T18:19:17Z | 2026-10-31T18:19:51Z |
| T-0002-05 | 原生權限等待、終端回覆及繼續 | AC-05 | todo | — | — | — |
| T-0002-06 | 補 Grok／Pi 取消與所屬程序清理 | AC-06 | todo | — | — | — |
| T-0002-07 | crash、401／429、有界重試與失敗狀態 | AC-07 | todo | — | — | — |
| T-0002-08 | 真正 session resume、刷新及 host 重啟 | AC-08 | todo | — | — | — |
| T-0002-09 | 三工位入口、產物與模型來源辨識 | AC-09 | todo | — | — | — |
| T-0002-11 | 路徑／symlink、hook 偽造及金鑰遮蔽測試 | AC-11 | todo | — | — | — |

## T-0003：獨立研究

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-01 | 本地模型完成公開 GitHub tool loop（非 MVP 阻塞） | AC-10 | todo | — | — | — |

匯入交付：[PR #841](https://github.com/fallrising/newclear/pull/841) 已合併，
`02f9139219c502763359ff95b9f2b5d5152e8c77`，四項 CI checks 全部 success（元件離線、project contracts、llms、workflow lint）。
已回讀主線 README 與 merge tree；tree `7862a2a246cd3e0074940ba71d6c9f3d0dda311a` 與本機驗證內容一致。
此結案只完成 AC-12 匯入；主線仍 incomplete，後續 MVP 任務保留 todo，沒有 release／deploy。

## T-0004：OpenCode 生命週期子集

Owner 指示「試試下一步」。本輪不擴大為 Grok／Pi 或完整 host restart 驗收。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0004-01 | 真實權限等待、合成測試的 Allow once PTY 回覆與繼續 | AC-05（OpenCode） | done | 2026-10-31T12:03:32Z | 2026-10-31T12:20:19Z | 2026-10-31T12:20:55Z |
| T-0004-02 | 真瀏覽器刷新不重跑，終止程序後明確恢復同一 session | AC-08（OpenCode 子集） | done | 2026-10-31T12:03:32Z | 2026-10-31T12:20:19Z | 2026-10-31T12:20:55Z |

Owner 已同意先停止舊 demo、完成真實生命週期驗收後重新開啟；T-0004 繼續執行。

T-0004 真實驗收與 15 項離線測試通過，詳見 [生命週期證據](../evidence/lifecycle.md)。[PR #847](https://github.com/fallrising/newclear/pull/847) 已合併並回讀主線 evidence；不將 OpenCode 子集當成完整 AC-05／AC-08。

T-0004 合併 commit：`37ec57999d547ce6b40819ae3758573a7f4d328f`。元件 offline、project contracts 與 workflow lint 三項 CI success。
主線的生命週期摘要已回讀：completed、permission_wait_verified=true、resume_verified=true；原 runtime source hash 與受測 bytes 一致。

## T-0005：Office host 中斷與手動恢復

Owner 指示繼續開發；沿用停止現有合成 demo、驗收後重新開啟的安排。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0005-01 | 持久 interrupted、停止舊 PTY、防止自動喚醒與明確恢復 | AC-08（OpenCode host） | done | 2026-10-31T12:29:42Z | 2026-10-31T12:52:39Z | 2026-10-31T12:52:59Z |
| T-0005-02 | 真實 host crash／重啟、瀏覽器狀態與同 session 恢復驗收 | AC-08（OpenCode host） | done | 2026-10-31T12:29:42Z | 2026-10-31T12:52:39Z | 2026-10-31T12:52:59Z |

T-0005 的四個 host 真實恢復驗收、既有生命週期回歸及 26 項離線測試通過，詳見[重啟證據](../evidence/restart.md)。[PR #852](https://github.com/fallrising/newclear/pull/852) 已合併，commit `843eaf97e77962df75d0b8f7618b01945e2d2b3e`。元件 offline 與 project contracts validate 兩項 CI 全部 success；已回讀主線摘要，host recovery 與 lifecycle regression 均為 completed，manual_resume_verified=true。完整 AC-08 與三 provider MVP 仍待驗收，沒有 release／deploy／usable tag。

## T-0006：遠端 CLI 接入前置

Owner 指示繼續，並提供需要其執行的命令；本輪不發出付費模型請求。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0006-01 | 固定官方 Grok／Pi，實測版本、身分與必要能力，缺失時拒絕 | AC-01（接入前置） | done | 2026-10-31T17:47:08Z | 2026-10-31T17:53:36Z | 2026-10-31T17:54:03Z |
| T-0006-02 | 隔離登入設定與無秘密診斷，提供 owner 可執行命令 | AC-01（接入前置） | done | 2026-10-31T17:47:08Z | 2026-10-31T17:53:36Z | 2026-10-31T17:54:03Z |

T-0006 真實 Grok／Pi help/version 與 Pi 隔離設定格式檢查通過，全程 OS 阻擋網路；35 項離線測試通過。遠端任務等 owner 登入／設定，見[命令與範圍](../REMOTE-SETUP.md)。[PR #856](https://github.com/fallrising/newclear/pull/856) 已合併，commit `5c5afa06aec8a40df86c89f0a9913772772d77b1`。offline／validate 兩項 CI success；回讀主線證據，Pi 1.4.0 與官方 Grok 1.0.70 compatible=true、remote_requests_sent=false。這是 CLI 前置結案，AC-01 整體、AC-03／AC-04 與三 provider MVP 仍 pending；等待 owner 設定後才繼續遠端任務。

## T-0007：Pi + DeepSeek 原生工位驗收

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0007-01 | 有界 Pi runner、原生啟動與 owner 授權的一次付費任務通過 | AC-04 | done | 2026-10-31T18:03:31Z | 2026-10-31T18:19:17Z | 2026-10-31T18:19:51Z |

T-0007：owner 已確認一次付費驗收；3 次 DeepSeek 請求、原生 agent_settled、產物及清理通過。[真實證據](../evidence/pi-live-2026-11-01.json)。此次授權已用完，未追加重跑；[PR #861](https://github.com/fallrising/newclear/pull/861) 已合併，commit `55c0c6d68c055aab6613ce6293a4d8ba7b8e2f39`。offline／validate 兩項 CI success；已回讀主線 evidence：completed、model_inference_verified=true、3 次請求、204 output tokens。AC-04 與其 T-0002-04 待辦一併結案，完整 MVP 仍 incomplete。

## T-0008：Grok 原生啟動與隔離

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0008-01 | 原生登入等待、隔離與清理已驗證；待 PR 交付 | AC-01、AC-03（前置） | in_progress | 2026-10-31T18:31:19Z | — | 2026-10-31T18:36:04Z |

本輪先驗證固定官方 CLI 的原生啟動，OS 阻擋外部網路、不載入 owner 登入檔、不接受 prompt；AC-03 真實任務保持 pending。

T-0008：47 項離線測試及原生啟動驗收通過，詳見[證據](../evidence/grok-startup-2026-11-01.json)。未載入 owner auth、未送 prompt，登入後 session hook／真實任務仍未驗收。
