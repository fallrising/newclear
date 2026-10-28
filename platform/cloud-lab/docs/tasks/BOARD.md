# Cloud Lab 任務板

## T-0001 — M0 文件與契約設計

元件內任務 ID；輸入為 owner 本次直接指示「文檔先行，開始」。範圍依 [SDD](../../SDD.md)／[SUCCESS](../../SUCCESS.md)，只交付文件與導航。主導負責整合、審查與 accept/rework。本機文件 AC-01～05 與獨立審查已通過；owner 明確批准 Git 交付後，[PR #669](https://github.com/fallrising/newclear/pull/669) 已於 2026-10-26T15:41:57Z 正常合併。合併 commit：`b6bb31bf3284fd755e4ca58492ac494fb9908a1e`。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0001-1 | 知識樹、能力及來源映射 | AC-01 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-2 | 身分、任務、事件、成果及 Recipe 契約 | AC-02 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-3 | 狀態、部署與跨元件責任 | AC-03 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-4 | 遷移、接替、回退與封存條件 | AC-04 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |
| T-0001-5 | 導航、驗證、獨立審查與 evidence gate | AC-05 | done | 2026-10-26T13:53:40Z | 2026-10-26T15:41:57Z | 2026-10-26T15:42:43Z |

M1／M2／M3 是[後續計畫](../verification.md)，沒有因本次文件工作自動開始。產品 AC-06～08 保持 pending。

## M0 交付與回讀

- PR head：`b16fe916e1662f75225ab04f2f0722797c6ebc9d`；獨立 review ACCEPT 見 [T-811](../../../../.team/reports/T-811.md)，先前 REWORK 與修正歷史保留。
- 必要 CI：[Project success contracts](https://github.com/fallrising/newclear/actions/runs/40351726014) 與 [llms.txt CI](https://github.com/fallrising/newclear/actions/runs/40351725548) 均 SUCCESS；合併前 head 未變、無衝突，正常 merge，未繞過檢查。
- 本機交付前：44 個專案契約、7 份 llms.txt、18 份 Cloud Lab 文件、135 個連結、12 個固定來源、scope／diff 檢查通過。原始輸出保存在 shared-workspace project `cloud-lab`／task `M0-publish-check-20261026` 的 `preserve/evidence/`。
- 合併後 fetch main，逐一比較本次 29 個交付路徑的 Git 內容與已驗證 head，無差異；PR API 回讀 merged=true、合併 SHA 與上述時間相符。
- 本次收尾只更新任務板。M0 文件交付完成；產品主線仍 incomplete、沒有 usable tag；尚無 runtime／Cloudflare live 驗收，未搬程式、封存或部署。

## T-0002 — M1 唯讀閉環實作

Owner 直接指示「好，繼續開發。」。範圍見 [M1 實作契約](../m1-implementation.md)；live gate 獨立保留。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0002-1 | 控制面、准入與恢復 | M1-I1 | done | 2026-10-26T15:52:01Z | 2026-10-26T16:21:19Z | 2026-10-26T16:22:13Z |
| T-0002-2 | 固定 collector runner 與 journal | M1-I2 | done | 2026-10-26T15:52:01Z | 2026-10-26T16:21:19Z | 2026-10-26T16:22:13Z |
| T-0002-3 | 看板與人機入口 | M1-I3 | done | 2026-10-26T15:52:01Z | 2026-10-26T16:21:19Z | 2026-10-26T16:22:13Z |
| T-0002-4 | 整合、故障驗證與獨立審查 | M1-I4 | done | 2026-10-26T15:52:01Z | 2026-10-26T16:21:19Z | 2026-10-26T16:22:13Z |

## M1 本機實作交付與回讀

[PR #673](https://github.com/fallrising/newclear/pull/673) 已於 **2026-10-26T16:21:19Z** 正常合併，merge SHA `1c2e66f6ee17064e59813e9d08f76066ac7695fe`；已驗證 head `99bb1818dcbd0f505e761e743c40ab4de41ca84a`。

- [Cloud Lab local implementation](https://github.com/fallrising/newclear/actions/runs/40358151064)、[Project success contracts](https://github.com/fallrising/newclear/actions/runs/40358150707)、[Workflow static validation](https://github.com/fallrising/newclear/actions/runs/40358150819)、[llms.txt CI](https://github.com/fallrising/newclear/actions/runs/40358150733) 全數 SUCCESS；合併前 CLEAN／無衝突，head 未改變，未繞過檢查。
- 本機 31 Node＋31 Python 測試、44 專案契約、7 llms、22 文件／173連結／12固定來源及scope／diff檢查通過；[獨立審查 T-814](../../../../.team/reports/T-814.md) ACCEPT，原 REWORK／修正歷史保留。
- 合併後 fetch main，逐一比對49個交付路徑與已驗證head，Git內容無差異；PR API回讀 merged=true、SHA與時間相符。
- M1-I1～I4 本機實作完成。完整M1-LIVE與產品AC-06～08仍pending：真實CF／target runner／手機／bot、入口撤權、備份與預算；沒有部署、封存、既有程式搬移或usable tag。

此收尾PR只改任務板，end使用上述實際合併時間。

## T-0003 — M1 真實環境接入與驗收

Owner 指示「好，繼續吧。」。先完成可審閱的部署 bundle、入口／API 驗收工具；當時真實環境等待 D1／Workers Scripts OAuth scopes 與私人目標；現已補齊並完成[首輪真實閉環](../evidence/m1-first-live.md)。缺權限是實際 API401／連線403，不以本機測試取代 live。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0003-1 | 私人設定／grant／部署 bundle 產生器 | AC-06、AC-08 | done | 2026-10-26T16:43:03Z | 2026-10-26T17:07:24Z | 2026-10-26T17:07:38Z |
| T-0003-2 | 有界入口及 API 驗收工具 | AC-06、AC-07 | done | 2026-10-26T16:43:03Z | 2026-10-26T17:07:24Z | 2026-10-26T17:07:38Z |
| T-0003-3 | 獨立審查與部署前證據 | AC-08 | done | 2026-10-26T16:43:03Z | 2026-10-26T17:07:24Z | 2026-10-26T17:07:38Z |
| T-0003-4 | 真實 CF／指定 runner／恢復驗收；首輪真實閉環通過；D1隔離還原／journal對帳通過；遠端故障／撤權子集通過；human/mobile及完整故障矩陣待驗收 | AC-06～08 | in_progress | 2026-10-26T18:01:36Z | — | 2026-10-28T10:05:51Z |

## M1 接入準備交付與回讀

[PR #676](https://github.com/fallrising/newclear/pull/676) 已於 **2026-10-26T17:07:24Z** 正常合併，merge SHA `57515ce4a2676150c383af8a6d58cd2781f20f35`；已驗證 head `47d419ff726e089920a1fa9920b4582eb7d96017`。

- [Cloud Lab local implementation](https://github.com/fallrising/newclear/actions/runs/40365508313) 與 [Project success contracts](https://github.com/fallrising/newclear/actions/runs/40365508668) 均 SUCCESS；合併前 CLEAN／無衝突、head未變，未繞過檢查。
- 主導及[獨立審查T-816](../../../../.team/reports/T-816.md)均跑過31 Node＋58 Python＝89 tests；三項P2已修正，原始失敗／RED證據保留。44專案契約、7 llms、25文件／191連結／12固定來源、task/report及scope／diff檢查通過，詳見[readiness evidence](../evidence/m1-live-readiness.md)。
- 合併後fetch main，逐一比對17個交付路徑與已驗證head，Git內容相同；PR API回讀merged=true，SHA與時間相符。
- T-0003-1～3準備工作完成；T-0003-4、M1-LIVE與AC-06～08保持pending。尚需D1／Workers Scripts連線scopes、私人網域／runner目標，以及真實Access、D1、手機／bot、恢復與成本驗收。沒有Cloudflare寫入、部署、排程啟用、封存或usable tag。

此收尾只更新任務板，end為實際準備PR合併時間，不代表完整M1已驗收。

T-0003-4 本輪子範圍：[RR-01～05常駐runner](../resident-runner.md)，本輪測試／審查／實機子集通過，完整列仍in_progress；不新增排程或延長grant。

T-0003-4 下一子範圍：[FR-01～04隔離恢復驗證](../recovery-qualification.md)，101tests／實際workerd三案例／獨立審查通過，完整列仍in_progress；live服務維持既有版本與授權窗口。

T-0003-4 本輪子範圍：[RF-01～04遠端隔離故障／撤權](../remote-recovery.md)，本輪[115tests／三個真實CF案例／grant及Access撤權](../evidence/m1-remote-recovery.md)通過；完整列仍in_progress。僅新建一組短期隔離資源，測試token已停用，原live服務保持不變。

T-0003-4 本輪子範圍：[UI-01～04看板瀏覽器驗收](../dashboard-qualification.md)，本機121tests／十組瀏覽器情境／獨立審查通過；整列仍in_progress；新版資產部署已由後續DR範圍完成，真正Access及實體手機仍待接續。

T-0003-4 本輪子範圍：[DR-01～04看板部署與手機驗收](../dashboard-rollout.md)，in_progress／等owner手機操作；明確批准後已發布，新版本100%、原設定／D1相等、匿名302／機器200。human觀察與命令對帳待接續。
