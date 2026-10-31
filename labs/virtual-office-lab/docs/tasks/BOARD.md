# Virtual Office 任務板

## T-0002 — M1 持久化驗證補強（進行中）

來源：owner 直接指示開發 virtual-office-lab。保持 Draft-only、不部署、不付費、不宣稱完整 M1 或產品完成。
本次範圍：實際 local workerd 重啟後保留去重與每分鐘配額；相同事件變更拒絕、拒絕與重試不改公開狀態。
預定驗證：Node check/tests、真 local workerd smoke、全倉索引與 success contracts。真 Agent hook 與前端仍是後續缺口。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-1 | SQLite 重啟去重／限流回歸本機通過，Draft-only；[證據](../evidence/m1-persistence.md) | AC-03 | in_progress | 2026-10-31T18:29:44Z | — | 2026-10-31T18:31:13Z |


## T-0003 — 命令生命週期上報 adapter

來源：owner 指示「好，繼續」。範圍為明確授權命令的開始／完成／失敗上報，不讀命令輸出，不新增模型呼叫或部署。延續同一 Draft PR；不是各宿主原生 hooks 或完整 AC-07 驗收。
預定驗證：實際子程序成功／失敗、憑證隔離、上報故障不冒充成功、既有 Node 與全倉檢查。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-1 | office-run、35 測試與真 workerd 命令上報通過；[證據](../evidence/m1-lifecycle.md)，Draft PR #863 | AC-07 | in_progress | 2026-10-31T18:36:35Z | — | 2026-10-31T18:38:12Z |

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
