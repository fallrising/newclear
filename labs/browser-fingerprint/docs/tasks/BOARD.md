# Browser Fingerprint 任務板

## T-0998 — 本地主線驗收

Owner: START_DEVELOPMENT_PROMPT 直接啟動。2026-10-23 owner 已明確授權提交、push、發起 PR 並在檢查通過後合併；未授權 tag 或部署。done/end 僅在合併後填寫。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0998-1 | 五步瀏覽器旅程、CRUD/事件與失敗提示 | AC-01 | in_progress | 2026-10-22T18:05:10Z | — | 2026-10-23T12:47:49Z |
| T-0998-2 | 白名單採集與分析器回歸 | AC-02 | in_progress | 2026-10-22T18:05:10Z | — | 2026-10-23T12:47:49Z |
| T-0998-3 | 日誌目的地及 HTTP 負向隔離 | AC-03 | in_progress | 2026-10-22T18:05:10Z | — | 2026-10-23T12:47:49Z |
| T-0998-4 | 觀測限制與文件一致性 | AC-04 | in_progress | 2026-10-22T18:05:10Z | — | 2026-10-23T12:47:49Z |

本地結果：四項 AC 均 passed；三個真 Chromium 五步旅程、18 HTTP 負向、Go 13 頂層 + 17 子案例、Node 8 analyzer + 4 tutorial、vet/build 通過；獨立 T-884 接受本地實作。證據：[本次驗證](../evidence/2026-10-23-local.md)。

列保持 in_progress/end=—，依 repo 合約只有合併後才 done。Hosted component 與 project-success CI 已通過，下一步依 owner 授權合併 [PR #533](https://github.com/fallrising/newclear/pull/533)。未部署、未建立 usable tag。私人 tunnel/PIN 非本地驗收範圍。

2026-10-23 更新：GCC 14.2.0 已安裝；root 透過共用 workspace `race-after-compiler` 以 CGO_ENABLED=1 執行 Go race 全套，13 頂層與 17 子案例通過。`manual-build` 已建置供 owner 操作的執行檔，未啟動服務。剩餘必要關卡為 hosted CI 與 PR/merge。
