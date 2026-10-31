# Virtual Office 任務板

## T-0007 — 瀏覽器文字狀態頁

範圍：唯讀 HTML 文字 fallback、15 秒 jitter 單一請求輪詢／隱藏暫停／失敗退避、斷線與最後成功時間、安全文字節點、限定靜態根的本機 preview。預定 Node/Chrome/review/CI。不部署、不冒充 Three.js 或完整 AC-06。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0007-1 | 51 Node tests、真 Chrome、索引通過；[證據](../DASHBOARD.md) | AC-06 | in_progress | 2026-10-31T19:08:22Z | — | 2026-10-31T19:11:21Z |


## T-0006 — 前端共用呈現規則

Owner 指示繼續。範圍：純函式呈現模型，八狀態、stale/alert 優先序、雙向協作與固定座位、預設關閉夜間 overlay。測試輸入不變、順序穩定與邊界時間；Claude 唯讀 review。不是 renderer、路徑規劃或完整 M2；Three.js／瀏覽器／真實宿主與部署驗收仍保留。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0006-1 | 呈現模型、48 tests、Opus review 與索引通過；[證據](../PRESENTATION.md) | AC-06 | done | 2026-10-31T19:02:39Z | 2026-10-31T19:06:15Z | 2026-10-31T19:06:15Z |

收據：[PR #877](https://github.com/fallrising/newclear/pull/877)，merge SHA `220252da3ad2f9c9e56764f1e2d3ceb2c104659a` 已 fetch 回讀。候選 `b4b7e7c` 的 contracts（含真 workerd）／validate 均通過後正常合併。程式／測試模型 review PASS，非阻擋建議的後續防禦修改以測試驗證；未冒稱修改後另有一輪模型 review。此收尾僅改 BOARD；完整 AC-06、renderer 與瀏覽器驗收仍 pending。


## T-0005 — 長命令 heartbeat

Owner 指示繼續開發並可用 Claude review。範圍：每 5 分鐘 terminal heartbeat、單一 in-flight、結尾等待 heartbeat 後才上報、失敗可見且不重試命令。預定 Node 回歸、真 workerd、索引與唯讀模型 review。沒有 provider 原生 hook 或 UI 驗收聲明。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0005-1 | 43 tests、workerd、Opus 5.5 review 通過；PR #873 已合併 | AC-07 | done | 2026-10-31T18:54:29Z | 2026-10-31T18:58:16Z | 2026-10-31T18:58:16Z |

合併收據：[PR #873](https://github.com/fallrising/newclear/pull/873)，merge `a8c621e43d7226c7c5b3c76e827ab2d8640ae12e` 已 fetch 回讀。候選 `035eeff` 的 contracts／validate 均通過；程式與測試經 Opus 5.5 二輪唯讀 review 後無 blockers，文件主導自檢。AC-07 整體仍 pending，沒有 deploy/release。此最終收尾僅改 BOARD。


## T-0004 — 命令取消生命週期

Owner 最新指示：每個里程碑 commit → PR → 必要檢查通過且無阻擋後合併，取代先前 Draft-only。不延伸至部署、release 或付費。
範圍：SIGINT/SIGTERM 轉送子程序、有限時間終止、取消不回報 done；以實際 subprocess 回歸。AC-07 整體仍 pending。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0004-1 | 取消與真程序回歸已合併；[39 tests/workerd/索引證據](../evidence/m1-cancellation.md) | AC-07 | done | 2026-10-31T18:39:26Z | 2026-10-31T18:42:16Z | 2026-10-31T18:42:16Z |

T-0004 收據：[PR #866](https://github.com/fallrising/newclear/pull/866) 正常合併，merge SHA `2997e63aff00b51836669d343ee95154c4706b64` 已 fetch 回讀。候選 `21b392f3e67a325d31b85e4c5b82a359e988dfe8` 的 contracts／validate CI 通過，無衝突；沒有獨立 review 紀錄。此完成狀態不代表完整 AC-07、產品、部署或 release 完成。此收尾 PR 僅更新 BOARD。

PR #863 已於 2026-10-31T18:39:26Z 合併；merge SHA `2665c0886ba7e99ac1cbfdafc8daf7bf2ec53d8d` 已 fetch 回讀。必要 contracts/validate CI 通過，無獨立人工 review 紀錄。T-0002/3 完成僅指有界交付，非完整 M1。


## T-0002 — M1 持久化驗證補強（進行中）

來源：owner 直接指示開發 virtual-office-lab。保持 Draft-only、不部署、不付費、不宣稱完整 M1 或產品完成。
本次範圍：實際 local workerd 重啟後保留去重與每分鐘配額；相同事件變更拒絕、拒絕與重試不改公開狀態。
預定驗證：Node check/tests、真 local workerd smoke、全倉索引與 success contracts。真 Agent hook 與前端仍是後續缺口。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-1 | SQLite 重啟去重／限流回歸本機通過，Draft-only；[證據](../evidence/m1-persistence.md) | AC-03 | done | 2026-10-31T18:29:44Z | 2026-10-31T18:39:26Z | 2026-10-31T18:31:13Z |


## T-0003 — 命令生命週期上報 adapter

來源：owner 指示「好，繼續」。範圍為明確授權命令的開始／完成／失敗上報，不讀命令輸出，不新增模型呼叫或部署。延續同一 Draft PR；不是各宿主原生 hooks 或完整 AC-07 驗收。
預定驗證：實際子程序成功／失敗、憑證隔離、上報故障不冒充成功、既有 Node 與全倉檢查。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-1 | office-run、35 測試與真 workerd 命令上報通過；[證據](../evidence/m1-lifecycle.md)，Draft PR #863 | AC-07 | done | 2026-10-31T18:36:35Z | 2026-10-31T18:39:26Z | 2026-10-31T18:38:12Z |

## T-0001 — 虛擬辦公室設計、CLI 與 Workers 骨架

來源：owner 2026-10-31 直接指示。認領者：本次 ChatGPT agent。
基準：`8bf48551f524086d81fa66d946c984f8052152ff`；認領 commit：`31c891ae0190e8673a9b3212f1f200530a82f824`。
交付：SDD、office-report、Workers 骨架、Grok Bot 提示詞、測試、索引與 PR。
最初停在 Draft PR；owner 於 2026-10-31 後續明確指示「合併PR」，本次合併與必要收尾沿用該授權，不延伸至 release、公開部署、付費呼叫、全功能 Three.js 前端或真實 provider 驗收。
專案完整主線保留 3D 辦公室與真實 Agent 接入，不以骨架冒充完成。
驗證與限制：[M0 證據](../evidence/m0.md)、[SUCCESS](../../SUCCESS.md)、[PR #837 最終驗證收據](https://github.com/fallrising/newclear/pull/837)。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-1 | SDD、狀態與公開邊界；文件自檢通過並已合併 | AC-01 | done | 2026-10-30T16:55:00Z | 2026-10-31T03:13:31Z | 2026-10-31T03:14:24Z |
| T-0001-2 | 安全上報 CLI；28 項測試通過並已合併 | AC-02 | done | 2026-10-30T16:55:00Z | 2026-10-31T03:13:31Z | 2026-10-31T03:14:24Z |
| T-0001-3 | Workers/DO 骨架；真 workerd 併發 CAS／程序重啟 smoke 通過，完整 AC-03 缺口保留 | AC-03 | done | 2026-10-30T16:55:00Z | 2026-10-31T03:13:31Z | 2026-10-31T03:14:24Z |
| T-0001-4 | 完整 Grok Bot 提示詞、配置與部署驗收手冊已合併 | AC-04 | done | 2026-10-30T16:55:00Z | 2026-10-31T03:13:31Z | 2026-10-31T03:14:24Z |
| T-0001-5 | 索引與必要 CI 通過；PR #837 已依 owner 指示合併並回讀 | AC-05 | done | 2026-10-30T16:55:00Z | 2026-10-31T03:13:31Z | 2026-10-31T03:14:24Z |

### 2026-10-31 合併與回讀收據

- 原 PR：[837](https://github.com/fallrising/newclear/pull/837)，`merged: true`；實際合併時間 `2026-10-31T03:13:31Z`。
- 核對候選：`b1400eef07117bdffafc7e2ffe1150da440a42d0`；合併前 main：`c896f0618256255216400e45cef9f87f9aef4b7d`。
- 合併 commit：[`3ec429ebd10b9d167f2b0b2a21b618efb4245022`](https://github.com/fallrising/newclear/commit/3ec429ebd10b9d167f2b0b2a21b618efb4245022)。GitHub app 回讀 main、PR 與 commit；整個 tree 為 `341373552734ba27d82da7d4c89ce99dd347d5c2`，與已測候選一致；本任務板原 blob `1a9c9f1717dca261c6732dca96a5a1898f895228` 亦已回讀。
- [Virtual Office Lab CI](https://github.com/fallrising/newclear/actions/runs/41098262046)：completed/success；28 項 Node 測試、語法、全倉索引與真 local workerd／SQLite DO smoke 通過。
- [Project success contracts](https://github.com/fallrising/newclear/actions/runs/41098262133) 及 [Workflow static validation](https://github.com/fallrising/newclear/actions/runs/41098261836)：completed/success。
- 合併前無衝突，使用 expected HEAD 保護的正常 merge；沒有 force push、改寫歷史或更動 CI／保護規則。PR 審查紀錄為空，不宣稱獨立審查通過或完整產品已獲驗收。

本收尾依根 AGENTS 的最終任務板規則，只修改此 BOARD，不修改 runtime、SUCCESS 驗收條件或索引。後續收尾 PR 仍須通過必要 CI，並回讀提交及合併結果；不以原 PR 的通過結果冒充收尾 PR 已通過。

### 保留缺口與交接

`done` 僅指 T-0001 的 M0 設計／CLI／骨架交付已合併。AC-03 的真 workerd 證據涵蓋上報、同版本併發寫入衝突及程序重啟後的 revision／status／lastSeen；跨重啟限流與去重的完整產品驗收仍 pending，不能由 Node 契約測試代替。

AC-06（3D 前端）、AC-07（真實 Agent）、AC-08（公開部署與恢復）仍未完成；`mainline: incomplete`、`usable_tag: none` 不變。沒有 release、deploy、模型 API 呼叫或建立 usable tag。

下一階段沿既定主線先驗證真實 Agent 上報，再接入 Three.js 狀態展示；本次未啟動該階段。需要執行時重新確認該階段的宿主、授權與驗收範圍。
