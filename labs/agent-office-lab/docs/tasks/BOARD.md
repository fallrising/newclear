# Agent Office Lab 任務板

本次依 owner 直接指示匯入 GitHub；無 desk 卡。AC 沿用 SDD，公開版將 A01–A11 正規化為 AC-01–AC-11。

## T-0001：公開匯入

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-01 | 匯入可重建來源、公開證據摘要、任務及索引，完成 PR／CI／回讀 | AC-12 | done | 2026-10-31T11:19:24Z | 2026-10-31T11:23:55Z | 2026-10-31T11:24:23Z |

## T-0002：後續 MVP（尚未在本輪執行）

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-01 | CLI capability／版本／缺失偵測 | AC-01 | todo | — | — | — |
| T-0002-02 | 已有 OpenCode 合成任務；移植後補完整 runtime 回歸 | AC-02 | todo | — | — | — |
| T-0002-03 | 確認 Grok 版別，再做顯式遠端任務 | AC-03 | todo | — | — | — |
| T-0002-04 | Pi + DeepSeek 顯式遠端任務 | AC-04 | todo | — | — | — |
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
| T-0004-01 | 真實權限等待、合成測試的 Allow once PTY 回覆與繼續 | AC-05（OpenCode） | in_progress | 2026-10-31T12:03:32Z | — | 2026-10-31T12:18:18Z |
| T-0004-02 | 真瀏覽器刷新不重跑，終止程序後明確恢復同一 session | AC-08（OpenCode 子集） | in_progress | 2026-10-31T12:03:32Z | — | 2026-10-31T12:18:18Z |

Owner 已同意先停止舊 demo、完成真實生命週期驗收後重新開啟；T-0004 繼續執行。

T-0004 真實驗收與 15 項離線測試通過，詳見 [生命週期證據](../evidence/lifecycle.md)。待 PR #847 合併後補 done／end；不將 OpenCode 子集當成完整 AC-05／AC-08。
