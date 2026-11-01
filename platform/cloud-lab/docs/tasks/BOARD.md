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
| T-0003-4 | 真實 CF／指定 runner／恢復驗收；首輪真實閉環通過；D1隔離還原／journal對帳通過；遠端故障／撤權子集通過；真人瀏覽器及完整故障矩陣待驗收；實體手機選測 | AC-06～08 | in_progress | 2026-10-26T18:01:36Z | — | 2026-10-30T04:33:01Z |

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

T-0003-4 本輪子範圍：[DR-01～04看板部署與手機驗收](../dashboard-rollout.md)，in_progress／真人瀏覽器待驗；實體手機已改選測；明確批准後已發布，新版本100%、原設定／D1相等、匿名302／機器200。human觀察與命令對帳待接續。

2026-10-28 owner調整：取消實體手機必測，不再等待手機測試才開發；DR04可由一般桌面瀏覽器補驗，仍不宣稱已通過。原授權已過期，本次無續權／Cron／runner變更。下一步建議常態唯讀運維（授權生命週期、runner恢復、低頻排程與保留／配額），尚未新增雲端操作授權。

## T-0004 — 授權生命週期離線管理

Owner同意從授權生命週期開始。範圍見[AL01–04](../authorization-lifecycle.md)，不以取消手機測試推導真人Access已驗證。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0004-1 | 嚴格snapshot狀態／到期原因 | AL-01 | done | 2026-10-28T14:04:41Z | 2026-10-28T14:19:50Z | 2026-10-28T14:20:54Z |
| T-0004-2 | 有界續期與撤銷計畫／SQLite guards | AL-02 | done | 2026-10-28T14:04:41Z | 2026-10-28T14:19:50Z | 2026-10-28T14:20:54Z |
| T-0004-3 | 輪替runbook與私人輸入輸出 | AL-03 | done | 2026-10-28T14:04:41Z | 2026-10-28T14:19:50Z | 2026-10-28T14:20:54Z |
| T-0004-4 | 回歸、獨立審查與交付 | AL-04 | done | 2026-10-28T14:04:41Z | 2026-10-28T14:19:50Z | 2026-10-28T14:20:54Z |

## T-0004交付與遠端回讀

[PR #713](https://github.com/fallrising/newclear/pull/713)於2026-10-28T14:19:50Z正常合併，head `686b3b75550a10aade451e3198158f74a2966efd`，merge `b8b58b34ffa717bc361e593075f0b830825c9dc6`。15個交付路徑與遠端merge逐檔相等，工作樹乾淨。

- [Cloud Lab CI](https://github.com/fallrising/newclear/actions/runs/40704636916)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/40704636968)、[llms CI](https://github.com/fallrising/newclear/actions/runs/40704636775)全數SUCCESS，未繞過檢查。
- 本機37Node＋107Python＝144tests、真實合成CLI、45專案契約／7llms／40文件／300連結／12來源、task/report及公開邊界檢查通過；[T826複審](../../../../.team/reports/T-826.md)ACCEPT。初始失敗保留在[證據](../evidence/m1-authorization.md)。
- AL01–04離線實作完成，實際Cloudflare續權、live採集、secret輪替、排程及完整mainline仍未完成；本輪沒有改雲端授權／憑證／服務。此PR僅按實際合併時間收尾任務板，不新增能力或usable tag。

## T-0005 — 授權來源唯讀採集

範圍：[AS01–04](../authorization-collection.md)。Owner要求接續開發，不擴大為續權或輪替。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0005-1 | 固定唯讀請求與target綁定 | AS-01 | done | 2026-10-28T14:39:47Z | 2026-10-28T15:01:18Z | 2026-10-28T15:01:53Z |
| T-0005-2 | 來源時間與前後漂移檢查 | AS-02 | done | 2026-10-28T14:39:47Z | 2026-10-28T15:01:18Z | 2026-10-28T15:01:53Z |
| T-0005-3 | 私人snapshot／provenance與未知層 | AS-03 | done | 2026-10-28T14:39:47Z | 2026-10-28T15:01:18Z | 2026-10-28T15:01:53Z |
| T-0005-4 | 合成測試、獨立審查與真實唯讀證據 | AS-04 | done | 2026-10-28T14:39:47Z | 2026-10-28T15:01:18Z | 2026-10-28T15:01:53Z |

## T-0005交付與遠端回讀

[PR #716](https://github.com/fallrising/newclear/pull/716)於2026-10-28T15:01:18Z合併；head `aa4c90477bd4d6748345e95961ec91fe2cbd47f9`，merge `58a383f859f2204b94a36dcf5e5a18760fd6c8a2`。15個交付路徑與遠端merge逐檔相等，工作樹乾淨。

- [Cloud Lab CI](https://github.com/fallrising/newclear/actions/runs/40711530060)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/40711530110)、[llms CI](https://github.com/fallrising/newclear/actions/runs/40711530080)全數SUCCESS，未繞過檢查。
- 本機37Node＋124Python＝161tests、45專案契約／7llms／42文件／317連結／12來源、task/report及公開邊界檢查通過；[T827 source複審](../../../../.team/reports/T-827.md)ACCEPT，原始RED保留。
- [原Lab五次唯讀採集](../evidence/m1-authorization-collection.md)由lead核對：前後投影一致、四個grant及所選token過期、active0／排程off；HMAC與runner仍unknown。沒有續權、secret輪替、部署或服務變更。
- AS01–04完成；真人Access、受控輪替、排程／配額及完整mainline保持未完成，無usable tag。此收尾僅更新任務板，end採用實際feature合併時間。

## T-0006 — 機器自身授權查詢

範圍：[SA01–04](../self-authorization.md)，不包含live部署、續權或runner程序觀測。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0006-1 | Worker自身metadata來源 | SA-01 | done | 2026-10-28T15:15:10Z | 2026-10-28T15:27:04Z | 2026-10-28T15:27:43Z |
| T-0006-2 | 獨立runner查詢CLI | SA-02 | done | 2026-10-28T15:15:10Z | 2026-10-28T15:27:04Z | 2026-10-28T15:27:43Z |
| T-0006-3 | 負向與本機HTTP整合 | SA-03 | done | 2026-10-28T15:15:10Z | 2026-10-28T15:27:04Z | 2026-10-28T15:27:43Z |
| T-0006-4 | 契約、審查與交付 | SA-04 | done | 2026-10-28T15:15:10Z | 2026-10-28T15:27:04Z | 2026-10-28T15:27:43Z |

## T-0006交付與遠端回讀

[PR #718](https://github.com/fallrising/newclear/pull/718)於2026-10-28T15:27:04Z合併；head `b9942bb08954ff2cc41fa7089cb0b5fa5c1fb3d2`，merge `2497b4637439d2f6d820927d393a9b2d075e7da0`。20個交付路徑與遠端merge逐檔相等，工作樹乾淨。

- [Cloud Lab CI](https://github.com/fallrising/newclear/actions/runs/40715939770)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/40715939744)、[llms CI](https://github.com/fallrising/newclear/actions/runs/40715939874)全數SUCCESS，未繞過檢查。
- 本機41Node＋135Python＝176tests、45專案契約／7llms／44文件／333連結／12來源、task/report與公開邊界檢查通過；[T828複審](../../../../.team/reports/T-828.md)ACCEPT。[證據](../evidence/m1-self-authorization.md)保留初始RED、slow-stream修正與SQLite warnings。
- SA01–04完成source／本機驗證；沒有雲端呼叫、部署、續權、token／secret產生、服務重啟或付費變更。新介面仍待部署，runner程序來源與AS整合仍待實作；完整mainline保持未完成，無usable tag。
- 此PR僅更新任務板，end採用實際feature合併時間。

## T-0007 — Resident程序觀測

範圍：[RO01–04](../resident-observation.md)，僅source／隔離本機程序驗證，不更動原Lab。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0007-1 | 私人socket生命週期 | RO-01 | done | 2026-10-28T15:40:48Z | 2026-10-28T17:05:54Z | 2026-10-28T17:06:44Z |
| T-0007-2 | 程序／lock／config驗證 | RO-02 | done | 2026-10-28T15:40:48Z | 2026-10-28T17:05:54Z | 2026-10-28T17:06:44Z |
| T-0007-3 | 期限與退出／漂移負向測試 | RO-03 | done | 2026-10-28T15:40:48Z | 2026-10-28T17:05:54Z | 2026-10-28T17:06:44Z |
| T-0007-4 | 回歸、審查與Git交付 | RO-04 | done | 2026-10-28T15:40:48Z | 2026-10-28T17:05:54Z | 2026-10-28T17:06:44Z |

T-0007本機feature commit `f0f06bb96ce8d74715925e2a3dc89d1869838f97`完成192tests與T829獨立審查；SSH推送未完成且PR建立422，遠端分支未見。停止該次SSH子程序後，限時重試被自動批准審查拒絕；待owner明確批准此分支的正常push／PR／CI／merge與任務板收尾。未合併，因此各列維持in_progress，沒有end。未改原Lab。

2026-10-28T17:04:03Z owner已明確批准推送，恢復本分支正常Git交付。原拒絕保留為歷史；合併前維持in_progress。

## T-0007交付與遠端回讀

Owner明確批准推送後，[PR #722](https://github.com/fallrising/newclear/pull/722)於2026-10-28T17:05:54Z合併；head `6a7ec5d0f9cfcd5a12d76522632d16aa50c87d8e`，merge `07ffe875f76a8b413004d0a1f693714e6533795b`。17個交付路徑與遠端merge逐檔相等，工作樹乾淨。

- [Cloud Lab CI](https://github.com/fallrising/newclear/actions/runs/40732186001)、[Project contracts](https://github.com/fallrising/newclear/actions/runs/40732186020)、[llms CI](https://github.com/fallrising/newclear/actions/runs/40732186031)全數SUCCESS，未繞過檢查。
- 本機41Node＋151Python＝192tests、45專案契約／7llms／46文件／353連結／12來源、task/report與公開邊界檢查通過；[T829初審及相容性複審](../../../../.team/reports/T-829.md)ACCEPT。批准恢復只改文件，已審查runtime／tests保持相同。
- 初始SSH等待、PR422與自動批准拒絕均保留；批准後限時SSH推送成功，沒有改用替代寫入路徑或繞過CI。此前「待owner」為歷史，Git批准阻擋已解除。
- RO01–04 source／本機程序驗證完成；[證據](../evidence/m1-resident-observation.md)保留RED、SQLite warnings與Python3.11未實測限制。未安裝到原Lab、未部署或續權，沒有新付費方案。完整mainline保持未完成，無usable tag。
- 此PR僅按實際feature合併時間收尾任務板，不新增功能或雲端操作。

## T-0008 — 授權來源整合

範圍：[IA01–04](../integrated-authorization.md)，source與隔離本機驗證。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0008-1 | 前後AS與self grant關聯 | IA-01 | done | 2026-10-28T17:18:26Z | 2026-10-28T17:35:45Z | 2026-10-28T17:36:53Z |
| T-0008-2 | Worker／Access／resident來源綁定 | IA-02 | done | 2026-10-28T17:18:26Z | 2026-10-28T17:35:45Z | 2026-10-28T17:36:53Z |
| T-0008-3 | 新鮮度與未知／漂移處理 | IA-03 | done | 2026-10-28T17:18:26Z | 2026-10-28T17:35:45Z | 2026-10-28T17:36:53Z |
| T-0008-4 | 私人輸出、整合、審查與交付 | IA-04 | done | 2026-10-28T17:18:26Z | 2026-10-28T17:35:45Z | 2026-10-28T17:36:53Z |

- Feature [PR #724](https://github.com/fallrising/newclear/pull/724) merged `554742ae68ce87f9dc147f93efd3a2a6ba1f8762` at `2026-10-28T17:35:45Z`，feature head `f77fa595b62df47240e93cd9da181340d6d2514f`。
- 三項CI全過：Cloud Lab `40737097237`、Project success `40737097392`、llms `40737097540`；16個交付檔案與遠端逐檔相等，共用PLAN的IA段落相等。全檔PLAN比較因同期其他項目記錄而不同，已檢查並保留差異，沒有覆寫。
- [214tests及T830複審ACCEPT](../evidence/m1-integrated-authorization.md)完成；初始stub、fixture HTTPS映射及未綁定Access層的RED保留。
- 本輪只交付source與隔離本機驗證，未部署、續權、重啟原服務或新增付費；完整主線pending，無usable tag。此收尾PR只改任務板。

## T-0009 — 觀測部署準備

範圍：[RP01–04](../observation-rollout.md)，準備完成不表示部署完成。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0009-1 | 來源固定與候選完整性 | RP-01 | done | 2026-10-28T17:49:23Z | 2026-10-28T17:57:45Z | 2026-10-28T17:58:31Z |
| T-0009-2 | 唯讀部署／授權／服務盤點 | RP-02 | done | 2026-10-28T17:49:23Z | 2026-10-28T17:57:45Z | 2026-10-28T17:58:31Z |
| T-0009-3 | 有界更新與回退方案 | RP-03 | done | 2026-10-28T17:49:23Z | 2026-10-28T17:57:45Z | 2026-10-28T17:58:31Z |
| T-0009-4 | 文件／獨立審查與交付 | RP-04 | done | 2026-10-28T17:49:23Z | 2026-10-28T17:57:45Z | 2026-10-28T17:58:31Z |

- Preparation [PR #728](https://github.com/fallrising/newclear/pull/728) merged `15de86f952b83424424e880e15079ddab481a831` at `2026-10-28T17:57:45Z`；head `66fec86b7ccce25f2384dc9b12b73a6bdc57a98f`。12份交付文件與遠端逐檔相等。
- CI全過：Cloud Lab `40740444463`、Project success `40740444266`、llms `40740444453`；[T831 ACCEPT與候選／唯讀盤點證據](../evidence/m1-observation-rollout-plan.md)已保存。
- 完成的是準備：原服務仍inactive、授權期限未改；固定runtime候選、前版回退request與unit模板均未套用。具體機器窗口與部署／補償方案等待owner明確批准，不能把RP done當成live gate通過。
- 本PR只收尾任務板，沒有runtime、雲端、憑證、服務或付費變更；完整主線pending。

## T-0010 — 觀測功能有界接入

Owner已批准RP方案；完整產品主線不因此通過。

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0010-1 | fresh前態與窗口固定 | OL-01 | done | 2026-10-29T03:20:36Z | 2026-10-29T03:39:58Z | 2026-10-29T03:41:07Z |
| T-0010-2 | Worker／機器授權有界更新 | OL-02 | done | 2026-10-29T03:20:36Z | 2026-10-29T03:39:58Z | 2026-10-29T03:41:07Z |
| T-0010-3 | resident與IA觀測／正常停止 | OL-03 | done | 2026-10-29T03:20:36Z | 2026-10-29T03:39:58Z | 2026-10-29T03:41:07Z |
| T-0010-4 | 回讀／補償／審查及交付 | OL-04 | done | 2026-10-29T03:20:36Z | 2026-10-29T03:39:58Z | 2026-10-29T03:41:07Z |

- Evidence [PR #736](https://github.com/fallrising/newclear/pull/736) merged `96d7a9d55d6c8f547df3052c96fe843bb01b4974` at `2026-10-29T03:39:58Z`；head `5db9ec7bb23588358ff48cdc0774cdfdb0ee7ec6`。
- CI全過：Cloud Lab `40813231171`、Project success `40813231192`、llms `40813231180`。遠端13份檔案逐檔相等，兩份根索引的Cloud Lab條目相等；其他專案同期新增條目保留。
- [OL實際證據與T832 ACCEPT](../evidence/m1-observation-live.md)：批准窗口內完成Worker／機器授權、AS／SA／RO觀測及提前停止；journal／業務資料／Access policy與排程保留。
- 原human／scheduler仍過期，未新增付費，未驗自然到期／回退或真人Access，完整主線pending。此PR只按實際合併時間收尾任務板。

## T-0011 — 常態 runner 服務模式

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0011-1 | 私人服務政策與設定綁定 | SR-01 | done | 2026-10-29T05:03:15Z | 2026-10-29T05:15:14Z | 2026-10-29T05:15:14Z |
| T-0011-2 | 啟動授權及不可延長期限 | SR-02 | done | 2026-10-29T05:03:15Z | 2026-10-29T05:15:14Z | 2026-10-29T05:15:14Z |
| T-0011-3 | 截止／斷線／journal恢復 | SR-03 | done | 2026-10-29T05:03:15Z | 2026-10-29T05:15:14Z | 2026-10-29T05:15:14Z |
| T-0011-4 | 回歸、審查與Git交付 | SR-04 | done | 2026-10-29T05:03:15Z | 2026-10-29T05:15:14Z | 2026-10-29T05:15:14Z |

## T-0011交付與遠端回讀

- [Feature PR738](https://github.com/fallrising/newclear/pull/738) head `e97199a6482b8693334ec68e3a25b34a7a1666be`，merge `35399b9ba83d9f86365ab0b672040d59c3680efd`，合併時間2026-10-29T05:15:14Z。遠端回讀17份交付檔案逐byte相等、feature為main祖先、工作樹乾淨。
- Cloud Lab CI `40822224377`、Project success `40822224342`、llms CI `40822224343` 全數success；本機42Node／194Python共236tests、systemd模板驗證、文件／範圍／task／report檢查通過。
- T833初審發現server-ahead未限制本機政策期限；四個RED subcases重現後修正，獨立複審ACCEPT。過程及先前fixture／sandbox限制見[SR證據](../evidence/m1-service-runner.md)。
- SR01–04 source／local完成；無live部署、續權、服務安裝、Cron或付費變更。Python3.11未實測，真人Access與完整主線pending，無usable tag。此收尾僅更新任務板。

## T-0012 — 常態服務啟用準備

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0012-1 | 來源綁定及離線proposal | SP-01 | done | 2026-10-29T06:45:00Z | 2026-10-29T07:02:28Z | 2026-10-29T07:02:28Z |
| T-0012-2 | 期限與請求量估算 | SP-02 | done | 2026-10-29T06:45:00Z | 2026-10-29T07:02:28Z | 2026-10-29T07:02:28Z |
| T-0012-3 | 私人候選與具體啟停方案 | SP-03 | done | 2026-10-29T06:45:00Z | 2026-10-29T07:02:28Z | 2026-10-29T07:02:28Z |
| T-0012-4 | 測試、獨立審查與交付 | SP-04 | done | 2026-10-29T06:45:00Z | 2026-10-29T07:02:28Z | 2026-10-29T07:02:28Z |

## T-0012交付與遠端回讀

- [Feature PR744](https://github.com/fallrising/newclear/pull/744) head `50f12c8b9118df671bd1a42b9b7aaa609bd7e400`，merge `6ea6667c849063f6d851ea8ee74f7972ce0fc265`，合併時間2026-10-29T07:02:28Z。遠端14份檔案逐byte相等、feature為main祖先、工作樹乾淨；同期其他專案變更保留。
- CI全過：Cloud Lab `40832716727`、Project success `40832716762`、llms `40832716696`；本機249tests、私人CLI／unit驗證、索引／範圍／task／report檢查與T834 ACCEPT。初始RED及mode修正留在[SP證據](../evidence/m1-service-activation.md)。
- 六份已合併SR source候選與原Lab五次唯讀metadata準備完成，原服務inactive、journal保留。7日／60秒及runner-only續權為待批方案，並非已啟用；D1／帳單未知，完整mainline pending，無usable tag。本收尾只更新任務板。

## T-0013 — 常態服務實際啟用

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0013-1 | fresh資源／用量與Free確認 | SL-01 | done | 2026-10-29T07:09:17Z | 2026-10-29T07:36:50Z | 2026-10-29T07:37:35Z |
| T-0013-2 | 有界runner授權更新 | SL-02 | done | 2026-10-29T07:09:17Z | 2026-10-29T07:36:50Z | 2026-10-29T07:37:35Z |
| T-0013-3 | resident啟動與來源回讀 | SL-03 | done | 2026-10-29T07:09:17Z | 2026-10-29T07:36:50Z | 2026-10-29T07:37:35Z |
| T-0013-4 | 證據、審查與交付 | SL-04 | done | 2026-10-29T07:09:17Z | 2026-10-29T07:36:50Z | 2026-10-29T07:37:35Z |

## T-0013交付與遠端回讀

- [Feature PR746](https://github.com/fallrising/newclear/pull/746) head `f9c457a74ac6736f0e420bdc7e44b574491b42bf`，merge `0fbc008c4e5914a2303b379566a1c33670eb6b95`，合併時間2026-10-29T07:36:50Z。遠端12份檔案逐byte相等、feature為main祖先、工作樹乾淨。
- CI全過：Cloud Lab `40836330005`、Project success `40836329958`、llms `40836329985`；本機文件／task／report檢查及T835獨立公開證據審查ACCEPT。實際操作、失敗／對帳及私人mode修正保留於[SL證據](../evidence/m1-service-live.md)。GitHub create／merge首次參數名稱錯誤在binding階段拒絕，核對工具schema後成功，無未知寫入或繞過CI。
- 已批准的原runner七日服務在07:28:20Z回讀active/running、NRestarts0，policy上限2026-11-05T07:24:26Z。僅runner授權延長，原共用Access有界更新，其餘角色過期、排程off；資料及journal保留。沒有自然到期／7日uptime／帳單驗收，完整主線pending。本收尾只改任務板，不再次變更服務。

## T-0014 — 低頻健康檢查與看板

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0014-1 | 有界低頻排程與dispatch護欄 | HS-01 | done | 2026-10-29T08:06:27Z | 2026-10-29T08:33:41Z | 2026-10-29T08:34:33Z |
| T-0014-2 | 授權排程狀態及結果API | HS-02 | done | 2026-10-29T08:06:27Z | 2026-10-29T08:33:41Z | 2026-10-29T08:34:33Z |
| T-0014-3 | 看板排程／過期／session展示 | HS-03 | done | 2026-10-29T08:06:27Z | 2026-10-29T08:33:41Z | 2026-10-29T08:34:33Z |
| T-0014-4 | 整合、審查與交付 | HS-04 | done | 2026-10-29T08:06:27Z | 2026-10-29T08:33:41Z | 2026-10-29T08:34:33Z |

## T-0014交付與遠端回讀

- [Feature PR750](https://github.com/fallrising/newclear/pull/750) head `1c7bbb0d186a7584777f58a8c46cc5b3feec57e5`，merge `89ead9636c5e732b8a5a367c3f02ca5eca0bf2da`，合併時間2026-10-29T08:33:41Z。24份交付檔案與遠端逐byte相等、feature為main祖先、工作樹乾淨；既有其他專案變更保留。
- CI全過：Cloud Lab `40842886920`、Project success `40842886813`、llms `40842886941`。本機完整265tests、fixture分鐘邊界修正後5項整合再通過；真實Chromium／workerd的12組檢查、95次API請求、T836獨立審查ACCEPT。初始RED與harness失敗保留在[HS證據](../evidence/m1-health-schedule.md)。
- 已固定六份Worker／看板候選及hash。這是HS01–04 source／local交付；[具體15分鐘啟用與停用方案](../health-schedule.md)備妥，未部署、續scheduler授權、啟用Cron、改runner或新增付費。既有runner期限不變；Python3.11、真人Access及完整主線pending，無usable tag。本收尾只改任務板。

## T-0015 — 低頻健康排程實際啟用

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0015-1 | fresh資源／來源／runner核對 | HL-01 | done | 2026-10-29T10:09:24Z | 2026-10-30T04:37:59Z | 2026-10-30T04:38:47Z |
| T-0015-2 | 有界scheduler與Worker／Cron更新（修正版revision4已啟用） | HL-02 | done | 2026-10-29T10:09:24Z | 2026-10-30T04:37:59Z | 2026-10-30T04:38:47Z |
| T-0015-3 | 首次真實觸發及runner結果（修正版validated） | HL-03 | done | 2026-10-29T10:09:24Z | 2026-10-30T04:37:59Z | 2026-10-30T04:38:47Z |
| T-0015-4 | 保留／回讀／審查與交付 | HL-04 | done | 2026-10-29T10:09:24Z | 2026-10-30T04:37:59Z | 2026-10-30T04:38:47Z |

- [HL首輪部分執行證據](../evidence/m1-health-schedule-live.md)：資產session兩次500，未發布／續權／開Cron。2026-10-29T10:15:50Z回讀原資源／授權／業務／journal保留，runner運行中；原批准持續有效但受2026-11-05T07:24:26Z上限約束。等待provider恢復，並非等owner；所有列暫留in_progress，不以證據PR合併冒充啟用完成。

2026-10-30接續：本次資產session200，原scheduler-only續期、revision2 Worker與15分鐘Cron已啟用；起點03:45Z、截止2026-11-05T07:24:25Z。首次03:45Z命令派送前過期；已停用schedule revision3、移除Cron、還原原BT版本與scheduler過期policy revision3，03:51:05Z保全通過。HL未完成，HW修正中；原500及新失敗紀錄保留。


### Git交付／收尾（HL）

- 修正source [PR809](https://github.com/fallrising/newclear/pull/809)與實際證據[PR815](https://github.com/fallrising/newclear/pull/815)已合併；後者head `10c521ac368ba3ef706ea3ec540d66b2181eb195`、merge `fe889fb095412d53726d8f5b4cd6b5fcb603d72b`，合併時間2026-10-30T04:37:59Z。全tree比較差異僅同期其他專案任務板，該更新完整保留；限定本機與遠端13份變更逐檔相同、source固定候選六檔相符。
- 證據PR必要CI全過：CloudLab `41003830530`、Project success `41003830415`、llms `41003830703`。Source362tests與T848ACCEPT，實際新窗口及T849證據審查ACCEPT；T847的初輪PARTIAL與原失敗／補償永久保留。
- [新revision4真實閉環](../evidence/m1-health-schedule-window-live.md)：due04:30、admit04:30:29、原runner完成04:31:06 validated/healthy，04:31:44最終同鏈與保全通過；原六commands／四journal、首筆expired command／firing及其他角色／Access／bot state保留。15分鐘Cron保持啟用，policy截止2026-11-05T07:24:25Z，其他原期限不延長，無新增付費。
- HL01–04完成；T-0003-4／AC-06～08與完整mainline仍pending。真人Access、模型對話、完整故障／配額、自然到期、未來uptime與帳單未驗，沒有usable tag。本收尾只改任務板，不再次操作雲端或重跑collector。

## T-0016 — 固定 bot 健康檢查入口

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0016-1 | 嚴格JSON與可信提交開關 | BC-01 | done | 2026-10-29T11:49:12Z | 2026-10-29T12:08:12Z | 2026-10-29T12:09:20Z |
| T-0016-2 | 私人durable請求與同ID恢復 | BC-02 | done | 2026-10-29T11:49:12Z | 2026-10-29T12:08:12Z | 2026-10-29T12:09:20Z |
| T-0016-3 | 唯讀查詢與未知／過期投影 | BC-03 | done | 2026-10-29T11:49:12Z | 2026-10-29T12:08:12Z | 2026-10-29T12:09:20Z |
| T-0016-4 | HTTP閉環、回歸與審查交付 | BC-04 | done | 2026-10-29T11:49:12Z | 2026-10-29T12:08:12Z | 2026-10-29T12:09:20Z |

## T-0016交付與遠端回讀

- [Feature PR755](https://github.com/fallrising/newclear/pull/755) head `26501d9867ca763b5a4df90a60df444b46193221`，merge `adf9707a38ff72f9881e83895e9db4474a1ac073`，合併時間2026-10-29T12:08:12Z。22份交付檔案與遠端逐byte相等、remote feature為main祖先、工作樹乾淨；同期其他專案變更保留。
- CI全過：Cloud Lab `40870633012`、Project success `40870633013`、llms `40870633071`。本機283tests（61Node222Python）、JSON／文件／task／report／diff檢查及T838 focusedACCEPT；初審HTML401/403分類問題、RED及修正保留在[BC證據](../evidence/m1-bot-bridge.md)。
- SSH推送／查詢逾時，診斷停在publickey認證；改用既有GitHub connector交付及匿名HTTPS回讀，未改憑證／SSH設定。Remote tree `58289d4fc00fcc3817e13224b3c9cc7e4f70703c`與已測本地commit `2f4ed89011a0a363910a95f10b3c9472b9f0eb5f`完全相同；兩個commit身份不同，不把本地commit誤稱remote ancestor。
- BC01–04 source／local完成；沒有部署、續權、模型呼叫或付費變更，實際Grok接線與完整主線pending，無usabletag。T-0015的HL資產API500仍未完成；本收尾只改任務板並只關閉BC。

## T-0017 — 本機 MCP 工具入口

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0017-1 | 協議生命週期與嚴格frame | MT-01 | done | 2026-10-29T14:31:25Z | 2026-10-29T14:45:42Z | 2026-10-29T14:46:32Z |
| T-0017-2 | 固定工具及可信host邊界 | MT-02 | done | 2026-10-29T14:31:25Z | 2026-10-29T14:45:42Z | 2026-10-29T14:46:32Z |
| T-0017-3 | 有界子程序與恢復語義 | MT-03 | done | 2026-10-29T14:31:25Z | 2026-10-29T14:45:42Z | 2026-10-29T14:46:32Z |
| T-0017-4 | stdio閉環、回歸與審查交付 | MT-04 | done | 2026-10-29T14:31:25Z | 2026-10-29T14:45:42Z | 2026-10-29T14:46:32Z |

## T-0017交付與遠端回讀

- [Feature PR762](https://github.com/fallrising/newclear/pull/762) head `0233684cd63703a771985f6541793a91c65fc83a`，merge `bb1faea3820149351b75715da9211e39dc1d5fbf`，合併時間2026-10-29T14:45:42Z。19份檔案與遠端main逐byte相等、remote feature為main祖先、工作樹乾淨；保留同期其他專案變更。
- CI全過：Cloud Lab `40894457006`、Project success `40894456965`、llms `40894457104`。本機300tests（62Node238Python）及六項文件／索引／task／report／diff檢查通過；T839獨立ACCEPT。[MT證據](../evidence/m1-mcp-stdio.md)保留RED、真實stdio／HTTP已收POST後timeout、重啟同ID恢復且只有一筆命令、實際collector及撤權驗證。
- 既有GitHub connector交付與匿名HTTPS回讀；remote tree `4f55ca9caf3bccc29f3fc77ca17db8a150c980c1`與已測local commit `6e8a39d5451a984eab6631cd7de83089dc1340a3`完全相同，commit身份不同。fetch_pr兩次internal error，改用get_pr_info核對head／mergeable及合併時間成功，無憑證修改或繞過CI。
- MT01–04 source／local完成；未安裝實際工具host、呼叫Grok、續權、改Kith或Cloudflare部署，無新增付費。實際client／live及完整主線仍pending，無usabletag；HL資產API500獨立保持T-0015未完成。本收尾只改任務板、只關閉MT。

## T-0018 — 獨立 Grok 工具接線

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0018-1 | 固定source與私人前態 | GC-01 | done | 2026-10-29T14:58:38Z | 2026-10-29T15:10:04Z | 2026-10-29T15:10:43Z |
| T-0018-2 | Grok唯讀註冊與原生doctor | GC-02 | done | 2026-10-29T14:58:38Z | 2026-10-29T15:10:04Z | 2026-10-29T15:10:43Z |
| T-0018-3 | status與真實授權診斷 | GC-03 | done | 2026-10-29T14:58:38Z | 2026-10-29T15:10:04Z | 2026-10-29T15:10:43Z |
| T-0018-4 | 證據、審查與交付 | GC-04 | done | 2026-10-29T14:58:38Z | 2026-10-29T15:10:04Z | 2026-10-29T15:10:43Z |

## T-0018交付與遠端回讀

- [Feature PR766](https://github.com/fallrising/newclear/pull/766) head `22ba8e319033eef17f1e3d96cc9e7e8f6d794389`，merge `e1fa24b71fbeb1904267ef1b592adb8a2249347d`，合併時間2026-10-29T15:10:04Z。14份檔案與遠端main逐byte相等、remote feature為main祖先、工作樹乾淨。
- CI全過：Cloud Lab `40898525593`、Project success `40898525727`、llms `40898525844`。本機原生Grok doctor、registered argv status／禁止check、設定／四source／state保全、六項文件／task／report檢查與T840獨立ACCEPT；[GC證據](../evidence/m1-grok-connection.md)保留self授權exit1及fresh grant過期診斷。本輪runtime未改，沒有聲稱舊300項本機測試重新執行。
- GitHub connector交付與匿名HTTPS回讀；remote tree `9189d111689489a0f3729746b8e7bc27afb1d602`與local commit `50c4b7dfd67fcae3cc079a7a9990b0bd67294522`相同，commit身份不同。私人Grok原設定備份、固定runtime及durable state保留。
- GC01–04只驗收獨立client的status-only接線與診斷；bot grant已過期，live bot/check及模型自然語言仍未驗。沒有續權、模型呼叫、雲端設定／業務命令或新增付費。HL部署T-0015仍open、完整主線pending；本收尾只關閉GC、不更動實際client或雲端。

## T-0019 — Bot 有界續權與真實檢查

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0019-1 | 原資源與實際runner前態 | BL-01 | done | 2026-10-29T16:27:23Z | 2026-10-29T16:40:16Z | 2026-10-29T16:40:51Z |
| T-0019-2 | bot-only有界續權及CAS | BL-02 | done | 2026-10-29T16:27:23Z | 2026-10-29T16:40:16Z | 2026-10-29T16:40:51Z |
| T-0019-3 | MCP一筆真實提交與結果 | BL-03 | done | 2026-10-29T16:27:23Z | 2026-10-29T16:40:16Z | 2026-10-29T16:40:51Z |
| T-0019-4 | 恢復、保全、審查及交付 | BL-04 | done | 2026-10-29T16:27:23Z | 2026-10-29T16:40:16Z | 2026-10-29T16:40:51Z |

## T-0019交付與遠端回讀

- [Feature PR770](https://github.com/fallrising/newclear/pull/770) head `d4b82a59fc19143ffe5f0aabf628c7a9c5dd7082`，merge `c23a0fa47d236313e6b0e50343f7ca32b096dbf4`，合併時間2026-10-29T16:40:16Z。14份檔案與遠端main逐byte相等、remote feature為main祖先、工作樹乾淨。
- CI全過：Cloud Lab `40913579795`、Project success `40913579818`、llms `40913579724`。六項本機文件／task／report／diff檢查與T841獨立公開證據ACCEPT；[BL實際證據](../evidence/m1-bot-live.md)保存bot-only CAS、MCP一筆提交／10次status、原runner fresh validated/healthy及保全。相對journal回讀錯誤及report格式首次拒絕均修正且保留原始紀錄，沒有重送命令。
- GitHub connector交付與匿名HTTPS回讀；remote tree `2bde2a741f324100b79c440d66445867f1b91514`與local commit `6ef867e196cc9610100c20740a2aa057c6e625d7`相同，commit身份不同。Runtime source未改，舊300tests不冒稱本輪本機重跑；私人原始操作回執及持久state保留。
- BL01–04具體live子集完成：bot窗口至2026-10-29T16:59:16Z、該次healthy觀測16:31:08Z，最終16:33:43Z原資料／角色／程式／Access／runner保持，Grok已恢復status-only。未驗自然到期／模型對話或常態bot服務，沒有新增付費；HL T-0015與完整主線仍pending，無usabletag。本收尾只改任務板，不再操作live。

## T-0020 — 持久 bot 政策

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0020-1 | 私人期限及離線初始化 | BP-01 | done | 2026-10-29T16:51:30Z | 2026-10-29T17:03:08Z | 2026-10-29T17:04:36Z |
| T-0020-2 | 持久配額與同ID恢復 | BP-02 | done | 2026-10-29T16:51:30Z | 2026-10-29T17:03:08Z | 2026-10-29T17:04:36Z |
| T-0020-3 | MCP可信政策與拒絕 | BP-03 | done | 2026-10-29T16:51:30Z | 2026-10-29T17:03:08Z | 2026-10-29T17:04:36Z |
| T-0020-4 | 回歸、審查及交付 | BP-04 | done | 2026-10-29T16:51:30Z | 2026-10-29T17:03:08Z | 2026-10-29T17:04:36Z |

## T-0020交付與遠端回讀

- [Feature PR774](https://github.com/fallrising/newclear/pull/774) head `64588f4ac31f8baec4e8e89af31f36c718fc9628`，merge `ea496aac7ff7669140341c11e00545d7ff6fb291`，合併時間2026-10-29T17:03:08Z。19份交付檔案與遠端main逐byte相等；根README／llms的Cloud Lab條目相等，其他行逐byte對照merge第一parent，確認同期memvid索引更新保留。首次整檔README相等斷言失敗已記錄並查明原因，非runtime漂移；remote feature為main祖先。
- CI全過：Cloud Lab `40917260006`、Project success `40917260269`、llms `40917260387`。本機319tests（63Node256Python）及六項文件／task／report／diff檢查、T842 focusedACCEPT；[BP證據](../evidence/m1-bot-policy.md)保留初始RED、reviewREWORK及expiry後時鐘回退的兩個RED修正，沒有忽略失敗。
- GitHub connector交付，匿名HTTPS回讀；remote tree `2fb69b4e8bb970d1ab06e8e8b393805cbf6dec91`與local commit `06896604e0d1547afb154cb193f064220df9c264`相同，commit身份不同。政策有界24小時、24新ID／240call，原state持久配額及同ID恢復；實際本機HTTP／多程序並行／collector閉環與額度耗盡拒絕通過。
- BP01–04 source／local完成，未更新live安裝／Grok／Cloudflare／授權／付費；明確續期與實際啟用、Python3.11及完整主線仍pending，無usabletag。原HL T-0015仍open；本收尾僅改任務板並只關閉BP。

## T-0021 — 顯式 bot 政策續租

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0021-1 | 離線預覽與可信候選 | BR-01 | done | 2026-10-29T17:09:18Z | 2026-10-29T17:21:04Z | 2026-10-29T17:21:37Z |
| T-0021-2 | 原子續租與歷史保留 | BR-02 | done | 2026-10-29T17:09:18Z | 2026-10-29T17:21:04Z | 2026-10-29T17:21:37Z |
| T-0021-3 | 重試／併發／跨期恢復 | BR-03 | done | 2026-10-29T17:09:18Z | 2026-10-29T17:21:04Z | 2026-10-29T17:21:37Z |
| T-0021-4 | 回歸、審查及交付 | BR-04 | done | 2026-10-29T17:09:18Z | 2026-10-29T17:21:04Z | 2026-10-29T17:21:37Z |

## T-0021交付與遠端回讀

- [Feature PR779](https://github.com/fallrising/newclear/pull/779) head `f09bfe659dad9c86f25d6fbdae8c600e83924d2d`，merge `07a54193a9708f9e4e262d559cbb2eada749ef80`，合併時間2026-10-29T17:21:04Z。20份交付檔案與遠端逐byte相等、remote feature為main祖先、工作樹乾淨；同期其他專案變更保留。
- CI全過：Cloud Lab `40920207069`、Project success `40920207309`、llms `40920207279`。本機336tests（64Node272Python）、六項文件／task／report／diff檢查及T843 focusedACCEPT；[BR證據](../evidence/m1-bot-policy-renewal.md)保留初始RED、strictJSON浮點archive修正及review重播時鐘缺口RED／修正。
- GitHub connector交付與匿名HTTPS回讀；remote tree `51b0ffe9a9c2ac59461e0c644b909a2bbff086c1`與local commit `5a079e4fc4c994b7ec6814cd4c83bab29b77d184`相同，commit身份不同。離線preview、到期後CAS／同交易archive與活動quota切換、同指令重播不補額度、原requests／跨期間隔／時鐘保留均本機驗證；實際MCP／HTTP跨期同ID恢復保持一筆command。
- BR01–04 source／local完成；未安裝、改Grok、續live權限、呼叫模型或新增付費。Python3.11、本機候選實際接入／原bot有界續權及完整主線仍pending，無usabletag。原HL T-0015仍open；本收尾只改任務板並只關閉BR。

## T-0022 — Bot有界啟用準備

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0022-1 | 固定候選與原client/state | BA-01 | done | 2026-10-29T17:31:43Z | 2026-10-29T17:46:43Z | 2026-10-29T17:47:32Z |
| T-0022-2 | fresh授權／runner／管理面核對 | BA-02 | done | 2026-10-29T17:31:43Z | 2026-10-29T17:46:43Z | 2026-10-29T17:47:32Z |
| T-0022-3 | 私人proposal與協議檢查 | BA-03 | done | 2026-10-29T17:31:43Z | 2026-10-29T17:46:43Z | 2026-10-29T17:47:32Z |
| T-0022-4 | 啟用補償方案、審查交付 | BA-04 | done | 2026-10-29T17:31:43Z | 2026-10-29T17:46:43Z | 2026-10-29T17:47:32Z |

## T-0022交付與遠端回讀

- [Feature PR787](https://github.com/fallrising/newclear/pull/787) head `8ecb3a55bf534749e9cdde57f826d2f4948b78e4`，merge `85fa65310b886f1acdc0dc40a245075f896eb893`，合併時間2026-10-29T17:46:43Z。14份交付檔案與遠端逐byte相等、remote feature為main祖先、工作樹乾淨；同期其他專案變更保留。
- CI全過：Cloud Lab `40924306220`、Project success `40924305935`、llms `40924305944`。六項本機文件／task／report／diff檢查、private literals檢查及T844公開準備證據ACCEPT；[BA證據](../evidence/m1-bot-activation.md)保留bot self失敗與private builder3capability假設錯誤／v2修正。Runtime未改，前次336tests不冒稱本輪本機重跑。
- GitHub connector交付及匿名HTTPS回讀；remote tree `8b33e92c35d686105f428b32edac0b9618f9b3ac`與local commit `b47afa2b86455cdd9a74735af5d57c86a5a755b4`相同，commit身份不同。11次管理唯讀、實際runner self／resident、原native1tool／候選stdio2tools零call、原state1筆／config／client保全及不可執行proposal均通過；bot grant已過期，未將candidate HMAC metadata稱為fresh成功self。
- BA01–04準備完成：固定BR/BP候選、<=24h bot-only窗口及原外層期限減120秒、24新ID／240call、具體切換／驗證／補償。未安裝候選、初始化policy、改client／Cloudflare／授權、提交命令、呼叫模型或新增付費；實際新bot期限需owner另批並fresh回讀。原HL T-0015與完整主線仍open，無usabletag；本收尾僅改任務板並只關閉準備。

## T-0023 — 首個 bot 有界啟用

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0023-1 | fresh來源與唯一窗口 | BT-01 | done | 2026-10-29T17:58:50Z | 2026-10-29T18:08:47Z | 2026-10-29T18:09:48Z |
| T-0023-2 | bot-only續權與self驗證 | BT-02 | done | 2026-10-29T17:58:50Z | 2026-10-29T18:08:47Z | 2026-10-29T18:09:48Z |
| T-0023-3 | 政策初始化與真實MCP檢查 | BT-03 | done | 2026-10-29T17:58:50Z | 2026-10-29T18:08:47Z | 2026-10-29T18:09:48Z |
| T-0023-4 | 保全、獨立審查與交付 | BT-04 | done | 2026-10-29T17:58:50Z | 2026-10-29T18:08:47Z | 2026-10-29T18:09:48Z |

## T-0023交付與遠端回讀

- [Feature PR795](https://github.com/fallrising/newclear/pull/795)最終head `5d9a12607dbdcc7c17512399fbd2a3a83ddc65c7`，merge `1a00b899f855dffc7e23cc3a85a257cb157b0556`，合併時間2026-10-29T18:08:47Z。14份交付檔案與遠端逐byte相等、remote feature為main祖先、工作樹乾淨；同期PLAN附加內容衝突已保留雙方、正常merge解決，未force push。
- 最終head CI全過：Cloud Lab `40927743495`、Project success `40927743829`、llms `40927743529`。六項本機文件／task／report／diff檢查、合併後索引／diff及10個private literals檢查通過；T845公開證據ACCEPT。Runtime未改，前次336tests不冒稱本輪本機重跑。
- GitHub connector交付及匿名HTTPS回讀；remote tree `9aabd0ee12e57f47a31996766a6775b413ab648a`與local merge commit `28615c0664186513900cab9cece68565ff9c4707`相同，commit身份不同。原bot-only期限固定2026-10-29T18:00:27Z至2026-10-30T18:00:27Z，實際self／一次初始化／native2tools及一筆validated/healthy通過；quota4call／1新ID，保留新entry及原歷史，原runner／Access／其他角色不延期。
- [BT證據](../evidence/m1-bot-activation-live.md)保留初始journal BLOB收據失敗與首次self拒絕；前者在寫入前修正，後者唯讀對帳及self成功，未重放mutation或重算窗口。自然到期、模型對話、帳單、未來uptime與完整主線仍未驗，無usabletag；HL T-0015仍open。本收尾僅改任務板、只關閉BT。

## T-0024 — Bot租期與額度唯讀查詢

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0024-1 | 既有狀態唯讀與安全開啟 | BI-01 | done | 2026-10-29T18:14:17Z | 2026-10-29T18:24:52Z | 2026-10-29T18:25:29Z |
| T-0024-2 | 期限／額度／本機准入投影 | BI-02 | done | 2026-10-29T18:14:17Z | 2026-10-29T18:24:52Z | 2026-10-29T18:25:29Z |
| T-0024-3 | 待對帳ID與有界輸出 | BI-03 | done | 2026-10-29T18:14:17Z | 2026-10-29T18:24:52Z | 2026-10-29T18:25:29Z |
| T-0024-4 | 回歸、獨立審查與交付 | BI-04 | done | 2026-10-29T18:14:17Z | 2026-10-29T18:24:52Z | 2026-10-29T18:25:29Z |

## T-0024交付與遠端回讀

- [Feature PR801](https://github.com/fallrising/newclear/pull/801) head `4cd59fb1cdd7ccf5537d91619e57308404b8d827`，merge `2776dcf4962f345641736b00ae5ff2e04d0abd30`，合併時間2026-10-29T18:24:52Z。16份交付檔案與遠端逐byte相等、remote feature為main祖先、工作樹乾淨；同期其他project的PLAN新增內容保留，append衝突正常merge解決。
- CI全過：Cloud Lab `40930348445`、Project success `40930348354`、llms `40930348378`。本機23focused及359fulltests（64Node／295Python）、六項文件／task／report／diff檢查、合併後索引／diff與private-literal檢查通過；T846 focusedACCEPT。[BI證據](../evidence/m1-bot-inspection.md)保留初始RED、socket沙箱失敗、CLI fixture argv及deepJSON斷言修正、review malformed-schema兩個RED與修復。
- GitHub connector交付及匿名HTTPS回讀；remote tree `956e6cf991be915eb198efa561b1681f69634614`與local merge `ede980e266c6285926b8322084b501f46980c14b`相同，commit身份不同。原state真正CLI唯讀查詢18:17:42Z為active、calls4/240、新ID1/24、2ACK且無pending；DB／lock／config／policy／Grok client hash和mtime相同。這是本機快照，不是新的遠端授權／健康證據。
- BI01–04 source/local完成，未安裝新runtime、變更MCP catalog、呼叫cloud／model、續權或新增command／付費。Python3.11本機未跑；自然到期／模型／帳單／完整主線仍pending，無usabletag。HL T-0015仍open；本收尾只改任務板、只關閉BI。

## T-0025 — 延遲 Cron 派送窗口修正

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0025-1 | handler時間計算派送窗口 | HW-01 | done | 2026-10-30T03:52:20Z | 2026-10-30T04:00:13Z | 2026-10-30T04:05:03Z |
| T-0025-2 | due去重與錯過不補跑 | HW-02 | done | 2026-10-30T03:52:20Z | 2026-10-30T04:00:13Z | 2026-10-30T04:05:03Z |
| T-0025-3 | policy／grant截止護欄 | HW-03 | done | 2026-10-30T03:52:20Z | 2026-10-30T04:00:13Z | 2026-10-30T04:05:03Z |
| T-0025-4 | 回歸／審查／固定候選交付 | HW-04 | done | 2026-10-30T03:52:20Z | 2026-10-30T04:00:13Z | 2026-10-30T04:05:03Z |

[修正契約](../schedule-window.md)；HL實際接入仍由T-0015驗收，不以source修正冒充真實成功。

### T-0025 Git交付／收尾

- [PR809](https://github.com/fallrising/newclear/pull/809) head `40e30aeabf9b6e5801208350ae3de4bd68fb22de`，merge `f3d08f90d2018115c296fc3e09375dda5c3e6df1`，合併時間2026-10-30T04:00:13Z；本機source/tree與遠端及六份候選逐檔相符。
- CI CloudLab `41000282432`、Project success `41000282387`、llms `41000282500`全過；本機362tests、T848sourceACCEPT。T847只接受前次HL partial failure／補償。
- HW01–04 source/local完成；原HL實際閉環仍由T-0015驗收。此收尾不把原派送過期改寫為成功、不改原服務或授權截止。

2026-10-30T04:31:44Z：HW修正版HL真實閉環與最終保全通過，due04:30、實際admit04:30:29、原runner完成04:31:06 validated/healthy；失敗歷史保留。[最新證據](../evidence/m1-health-schedule-window-live.md)；HL待審查／Git合併後關閉，T-0003-4／完整mainline仍open。

## T-0026 — 應用配額隔離驗收

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0026-1 | API最後一格與拒絕保全 | QV-01 | done | 2026-10-30T10:09:33Z | 2026-10-30T10:19:03Z | 2026-10-30T10:19:35Z |
| T-0026-2 | 窗口恢復與重送／讀取 | QV-02 | done | 2026-10-30T10:09:33Z | 2026-10-30T10:19:03Z | 2026-10-30T10:19:35Z |
| T-0026-3 | Cron終局與交錯競爭 | QV-03 | done | 2026-10-30T10:09:33Z | 2026-10-30T10:19:03Z | 2026-10-30T10:19:35Z |
| T-0026-4 | 回歸／獨立審查／交付 | QV-04 | done | 2026-10-30T10:09:33Z | 2026-10-30T10:19:03Z | 2026-10-30T10:19:35Z |

[範圍與驗收](../quota-qualification.md)；fullmainline及provider額度不在此輪完成宣告內。

### T-0026 Git交付／收尾

- [PR820](https://github.com/fallrising/newclear/pull/820) head `ee7635e36422c16daf240e3aac5501b970a7f123`，merge `7a2e602d36d8830a188273ce65baf6edbe926c62`，合併時間2026-10-30T10:19:03Z；remote tree `5b1e1dd3b9cf39c7abcf3b4dd79a974859ab8951`等於本機候選，head為main祖先，回讀工作樹乾淨。
- exact-head CI全過：Cloud Lab `41039656961`、Project success `41039656790`、llms `41039656651`。本機8focused／370fulltests、三組副本mutation、索引／task／report／diff與T850獨立ACCEPT；原fixture失敗及早期mutation仍留存。
- QV01–04隔離應用驗收完成。無runtime部署、live請求、歷史清理、授權延長或付費變更；provider耗盡／用量／帳單、retention、完整故障與human／model仍pending。完整mainline保持incomplete、無usable tag。本收尾只關閉QV，不將本機SQLite或一次交錯當成遠端D1並行證據。

## T-0027 — 應用用量觀測

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0027-1 | 唯讀聚合API | UO-01 | done | 2026-10-30T10:49:43Z | 2026-10-30T11:06:42Z | 2026-10-30T11:07:31Z |
| T-0027-2 | scope／邊界與未知來源 | UO-02 | done | 2026-10-30T10:49:43Z | 2026-10-30T11:06:42Z | 2026-10-30T11:07:31Z |
| T-0027-3 | 手動看板與session保全 | UO-03 | done | 2026-10-30T10:49:43Z | 2026-10-30T11:06:42Z | 2026-10-30T11:07:31Z |
| T-0027-4 | 回歸／瀏覽器／審查／交付 | UO-04 | done | 2026-10-30T10:49:43Z | 2026-10-30T11:06:42Z | 2026-10-30T11:07:31Z |

[範圍與驗收](../usage-observation.md)；不新增雲端資源／管理token或自動清理。

### T-0027 Git交付／收尾

- [PR827](https://github.com/fallrising/newclear/pull/827) head `98a0692e1883fdbac3b0a6f026c0223c05620461`，merge `f92aaa38055cc3972a1f5d834ceb2d57d87a3962`，合併時間2026-10-30T11:06:42Z。Cloud Lab與T851檔案逐byte等於remote main，feature head為main祖先；六份固定候選亦與remote相等。其他專案並行更新保留，沒有用全樹相等掩蓋無關變更。
- exact-head CI全過：Cloud Lab `41045528224`、Project success `41045528263`、llms `41045528168`。本機最終92Node＋295Python＝387tests、UO3實際本機workerd/D1／Chromium14情境／103API／無JS或gateway error；三份資產hash與最後source相符。文件／索引／task／report／diff及公開邊界通過，T851初審REWORK後複審ACCEPT。
- 原UO2跨秒時間失敗、fixture錯誤與clockRED保留；修正有界bootstrap耗時＋整秒容差，超限時間拒絕，非重跑掩蓋。UO01–04 source/local完成；候選在共享workspace的UO-candidate保存source pin／六份hash，尚未發布新版。
- 完整mainline／AC08仍pending，無usable tag。沒有live管理請求、續權、D1資料清理、Cron變更或付費方案；provider analytics／帳單尚未接線、真人Access／模型及retention／完整故障仍待驗。本收尾只改任務板、只關閉UO。

## T-0028 — 應用用量觀測部署

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0028-1 | 固定候選與fresh前態 | UL-01 | done | 2026-10-31T10:01:16Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0028-2 | 既有Worker與資產更新 | UL-02 | done | 2026-10-31T10:01:16Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0028-3 | 保全與有界live核驗 | UL-03 | done | 2026-10-31T10:01:16Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0028-4 | 公開證據／審查／交付 | UL-04 | done | 2026-10-31T10:01:16Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |

[範圍與驗收](../usage-rollout.md)；正向usage200／真人登入另列pending，不以403代替。

### T-0028 部分執行

2026-10-31T10:08:42Z：原Worker100%更新、module管理bytes及設定／歷史保全通過；UL03 partial，等owner準備好後批准human-only30分鐘窗口及登入。原09:15 unknown保留且後續Cron skipped_overlap。UL01／02證據已備，所有列保持in_progress／end空白；本輪PR只保存部分結果，不關閉任務。[證據](../evidence/m1-usage-live.md)。

2026-10-31T12:08:11Z：owner批准原human-only1800秒窗口；10項隔離SQLite guard cases及T853操作審查ACCEPT。只續原human grant revision1→2，截止12:38:10Z（開始12:08:10Z），scope/capabilities與其他三roles不變，unknown／排程保留。通用authorization.py仍要求全域靜止；此次已批准的特定operator用精確human CAS及同grant active/schedule guard，原其他role在途不被清除。真人登入／asset／usage驗證仍等owner回報，T0028保持open，實際續期／回讀收據留私人目錄。

2026-10-31T12:18:35Z：owner以Safari完成真人登入與手動用量讀取，122／84／1與主導唯讀D1窗口聚合相符。依owner加快流程的指示，不再要求Console資產hash；該項未執行，不冒稱已驗。UL真人功能讀取接受，原unknown未修復；待文件Git交付後依規則收尾，保持end空白。owner目前不需再操作。

## T-0029 — 未知結果結案

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0029-1 | 離線證據與計畫 | UR-01 | done | 2026-10-31T12:28:56Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0029-2 | 精確CAS與歷史保全 | UR-02 | done | 2026-10-31T12:28:56Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0029-3 | Worker／看板／bot未知終局 | UR-03 | done | 2026-10-31T12:28:56Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |
| T-0029-4 | 隔離回歸／審查／交付 | UR-04 | done | 2026-10-31T12:28:56Z | 2026-10-31T12:41:57Z | 2026-10-31T12:42:52Z |

### T-0028／T-0029 Git交付與收尾

- [PR850](https://github.com/fallrising/newclear/pull/850) head `d84934526c75029c74ba93b09057dd6f9c17871f`，merge `8bdc5666f6e1efea3c40d54240fec8db8a809a03`，合併時間2026-10-31T12:41:57Z；本機與遠端fulltree相同，head為main祖先，11份固定候選逐byte等於remote，readback工作樹乾淨。並行PLAN append與他專案修改正常merge保留，無force。
- exact-head CI全過：CloudLab `41202122647`、Project success `41202122685`、llms `41202122675`；本機400tests（96Node/304Python），跨Python／真SQLite結案→新Cron→validated及真result先到CAS0保全；T854 source／隔離ACCEPT。RED、fixture祖先拒絕及同步spawn timeout皆保留。
- T0028依owner調整驗收範圍收尾：Safari真人登入／手動用量122/84/1與D1同窗口相符；Console asset hash取消且未執行，不冒稱逐byte瀏覽器驗證。T853接受human-only1800秒操作，原窗口固定12:08:10Z–12:38:10Z，不自動延長。T852原REWORK及其修文歷史保留；不要求owner新增手動驗收。
- T0029僅關閉UR01–04 source／local，尚未部署新Worker或處置原unknown；私人原命令／journal已唯讀採集並由真CLI生成未applied計畫。實際原09:15UTC命令結案與短暫runnerpause/drain仍需具體批准，保留原結果unknown、journal與授權／服務截止、免費方案。完整主線仍incomplete，無usable tag。本收尾只改任務板。

## T-0030 — 已批准的未知任務線上結案

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0030-1 | 固定候選與原資源前態 | ULR-01 | done | 2026-10-31T17:57:09Z | 2026-10-31T18:06:34Z | 2026-10-31T18:06:58Z |
| T-0030-2 | 相容部署與原unknown單筆結案 | ULR-02 | done | 2026-10-31T17:57:09Z | 2026-10-31T18:06:34Z | 2026-10-31T18:06:58Z |
| T-0030-3 | 恢復原runner與新Cron驗證 | ULR-03 | done | 2026-10-31T17:57:09Z | 2026-10-31T18:06:34Z | 2026-10-31T18:06:58Z |
| T-0030-4 | 保全、證據與交付 | ULR-04 | done | 2026-10-31T17:57:09Z | 2026-10-31T18:06:34Z | 2026-10-31T18:06:58Z |

ULR01–04線上操作及保全已通過，T855獨立公開證據ACCEPT；實際PR合併後依規則關閉本列。[操作證據](../evidence/m1-unknown-resolution-live.md)保留初始parser失敗、原unknown與全部期限限制。

### T-0030 Git交付與收尾

- [PR858](https://github.com/fallrising/newclear/pull/858) head `c79b6346616ee5c78ebe99fc299de9bab0c96e78`，merge `6f6b416612b9e13ea0e6eb22a46f1d6c826cc60c`，2026-10-31T18:06:34Z合併。本機與remote fulltree相等、head為main祖先、工作樹乾淨；並行PLAN追加正常merge保留。
- exact-head CI全過：CloudLab `41227642659`、Project success `41227642639`、llms `41227642637`。T855獨立公開證據ACCEPT；本機50project／8llms／task-report／diff檢查及11候選source保全通過。私人raw由主導核對，不冒稱reviewer獨立接觸憑證或線上資料。
- 原unknown以未知結果結案，單次CAS changes1；原runner約7秒後恢復，新18:00Cron在18:00:55Z validated/healthy。最終123commands／152firings／119journal／active0，原121terminal／151firings／118journal保全，4grants／Access／secrets／Cron／期限與免費方案不變。原multipart parser失敗與修正保留；無舊命令重跑、續權或新瀏覽器測試。
- 本卡僅關閉已批准ULR01–04，完整mainline仍incomplete／無usable tag；原unknown根因、未來uptime、完整AC07／08及provider用量／保留策略仍見剩餘工作。本收尾只改任務板。

## T-0031 — 故障矩陣與保留邊界

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0031-1 | 逐列證據與缺口 | FQ-01 | done | 2026-10-31T18:39:23Z | 2026-10-31T18:49:16Z | 2026-10-31T18:49:38Z |
| T-0031-2 | 競爭與到期隔離驗證 | FQ-02 | done | 2026-10-31T18:39:23Z | 2026-10-31T18:49:16Z | 2026-10-31T18:49:38Z |
| T-0031-3 | 保留／恢復方案 | FQ-03 | done | 2026-10-31T18:39:23Z | 2026-10-31T18:49:16Z | 2026-10-31T18:49:38Z |
| T-0031-4 | 回歸審查與交付 | FQ-04 | done | 2026-10-31T18:39:23Z | 2026-10-31T18:49:16Z | 2026-10-31T18:49:38Z |

### T-0031 Git交付與收尾

- [PR870](https://github.com/fallrising/newclear/pull/870) head `1069df552fabd00a39aaf3ead9c1cf70a46a0021`，merge `95ae2ea0769a66c52c0a4c38c1d22180690da621`，2026-10-31T18:49:16Z合併；正常merge保留並行工作，本機／remote fulltree相同、head為main祖先、工作樹乾淨，61個已測input逐hash保持。
- exact-head CI全過：CloudLab `41231130035`、Project success `41231130103`、llms `41231130059`。本機107Node＋304Python＝411tests，focused／final baseline11通過；五種source副本mutation在預期assertion產生3／1／1／1／1fail且原Worker不變。T856獨立最終ACCEPT；50project／8llms、task/report、400相對連結與diff檢查通過，最後exit狀態另有結構化收據。
- 初次file-only結果不冒稱11tests；sandbox35Python socket errors與Node native assertion保留，准許loopback後完整重跑成功，未跳過或改runtime。十四列矩陣保留實際層級／缺口，七天artifact禁止下載不代表刪資料；無自動歸檔／tombstone／DELETE機制。
- 本卡僅關閉FQ01–04 local qualification與retention設計；沒有本輪部署、cloud操作、續權或付費。完整AC07／08與mainline仍pending、無usable tag。後續優先成果下載完整性，再處理稽核／隔離還原等實際缺口。本收尾只改任務板。

## T-0032 — 成果下載完整性

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- |
| T-0032-1 | 有界原bytes讀取 | DI-01 | done | 2026-10-31T19:06:07Z | 2026-10-31T19:16:12Z | 2026-10-31T19:17:39Z |
| T-0032-2 | SHA-256核對 | DI-02 | done | 2026-10-31T19:06:07Z | 2026-10-31T19:16:12Z | 2026-10-31T19:17:39Z |
| T-0032-3 | 下載與session競爭 | DI-03 | done | 2026-10-31T19:06:07Z | 2026-10-31T19:16:12Z | 2026-10-31T19:17:39Z |
| T-0032-4 | 回歸瀏覽器審查與交付 | DI-04 | done | 2026-10-31T19:06:07Z | 2026-10-31T19:16:12Z | 2026-10-31T19:17:39Z |

### T-0032 Git交付、原看板更新與收尾

- [PR883](https://github.com/fallrising/newclear/pull/883) head `bd4625fd7cdb9020525662c5842a3961a500f1a8`，merge `74d8c0f15274a59ca9d6d8b64aa99a6ba5bfd52c`，2026-10-31T19:16:12Z合併；正常merge保留並行工作，本機／remote fulltree相等、head為main祖先，6份部署候選逐byte符合remote main。
- exact-head CI全過：CloudLab `41233248118`、Project success `41233248227`、llms `41233248181`。RED11→GREEN42→完整121Node＋304Python＝425tests；DI1真Chromium/workerd15checks／104API／errors空，原bytes/digest下載與空白篡改拒絕通過。T857最終source/local ACCEPT，61inputs保全；50project／8llms／task-report／diff／378links通過，原socket路徑失敗保留。
- 沿用owner先前對原Worker看板更新的明確批准，合併／CI／固定候選回讀後實際發布三資產manifest；2026-10-31T19:16:49Z最終確認新active version100%、3個Worker modules逐byte未變、原settings（除provider部署annotations）／secret bindings／D1 binding／Access／Cron／4grants／期限保持。沒有暫停runner、續權或新增付費。
- 主導實際私人前後receipt核對：原127commands整列相同、156firings及123journal rows保留；最終128commands／157firings／124journal、active0，原closed_unknown與result null保持。原unit/config/policy/client/ledger及journal identity保持，runner同PID無restart，保守截止仍2026-11-05T07:24:25Z。新增排程活動沒有被部署清除或重播。
- Live部分是管理介面發布／版本／來源與設定歷史保全；未續human窗口，未執行新真人下載或live asset HTTP bytes驗收，未要求owner重測Safari。真正下載完整性行為由本輪local Chromium/workerd驗證支持。T857未接觸私人收據，live保全由主導核對；公開不放domain/account/command IDs/secrets。
- 本卡關閉DI01–04及此次已授權原看板更新，完整產品仍mainline incomplete／無usable tag；下一項是拒絕稽核與其他矩陣缺口。本收尾只改任務板。

## T-0033 — 有界拒絕稽核

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0033-1 | 最小拒絕metadata | RA-01 | done | 2026-11-01T04:27:29Z | 2026-11-01T04:35:30Z | 2026-11-01T04:35:59Z |
| T-0033-2 | 隱私與可信邊界 | RA-02 | done | 2026-11-01T04:27:29Z | 2026-11-01T04:35:30Z | 2026-11-01T04:35:59Z |
| T-0033-3 | 容量與失敗可觀測 | RA-03 | done | 2026-11-01T04:27:29Z | 2026-11-01T04:35:30Z | 2026-11-01T04:35:59Z |
| T-0033-4 | 隔離驗證審查交付 | RA-04 | done | 2026-11-01T04:27:29Z | 2026-11-01T04:35:30Z | 2026-11-01T04:35:59Z |

### T-0033 Git交付與source/local收尾

- [PR889](https://github.com/fallrising/newclear/pull/889) head `b0f8190494177cd2fa7b79a5f804e74112dc4d80`，merge `1c2fee2d90b0435a521a7bf81934c41945924bb0`，2026-11-01T04:35:30Z合併。exact-head CI全過：CloudLab `41273576845`、Project success `41273576837`、llms `41273576850`。
- 真RED7→GREEN51；完整130Node＋304Python＝434tests，無fail/skip；最終關閉所有SQLite連線再重開的test-only加強另有7/7。真本機RA2 workerd/D1九checks，最後容量並發只有一筆保存、原業務／稽核列保持、缺表保留401並明示unavailable；六個來源hash與公開receipt逐byte核對。T858最終獨立source/local ACCEPT。
- 初次fixture漏scope的兩項失敗、RA1把volatile D1 metadata當業務列的assertion失敗及既有SQLite ResourceWarning均保留；沒有放寬原業務列比較或跳測。50contracts／8llms／task-report／diff、222相對連結與三個qualifier語法檢查通過，API JSON確認只加header契約。
- 正常main merge保留並行工作；PLAN尾段衝突保留雙方段落。最終本機／remote fulltree相等、工作樹乾淨、head為main祖先；64份runtime/test/tool input及七份固定部署候選均與remote main相符。未測的本輪真人／Safari／手機沒有補記通過。
- 本卡完成RA01–04 source/local；尚未在原D1套用0002、未發布新版Worker，線上稽核未啟用。已固定原服務候選及「先新增表後Worker、回退保留表與歷史」步驟。原grant／Access／secrets／runner／Cron／授權期限與免費方案沒有本輪變動。完整mainline incomplete／usable_tag none；接續具體原服務部署及unknown/in-flight隔離還原，無需owner重測瀏覽器。本收尾只改任務板。

## T-0034 — 原服務拒絕稽核接入

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0034-1 | 原狀態與固定候選 | RAL-01 | done | 2026-11-01T04:48:04Z | 2026-11-01T04:56:26Z | 2026-11-01T04:56:57Z |
| T-0034-2 | 新增稽核schema | RAL-02 | done | 2026-11-01T04:48:04Z | 2026-11-01T04:56:26Z | 2026-11-01T04:56:57Z |
| T-0034-3 | 原Worker更新與設定保全 | RAL-03 | done | 2026-11-01T04:48:04Z | 2026-11-01T04:56:26Z | 2026-11-01T04:56:57Z |
| T-0034-4 | 真拒絕對帳及交付 | RAL-04 | done | 2026-11-01T04:48:04Z | 2026-11-01T04:56:26Z | 2026-11-01T04:56:57Z |

### T-0034 Git交付與實際接入收尾

- [PR893](https://github.com/fallrising/newclear/pull/893) head `7b0fcfdb234f87c3f20c9205125ae8e5747f0169`，merge `12c0913595c0fde1f7a3beb6b03e2f41215d01e6`，2026-11-01T04:56:26Z合併。exact-head CI全過：CloudLab `41274900572`、Project success `41274900537`、llms `41274900602`。
- 使用已合併PR889的固定七份候選。2026-11-01T04:49:29Z原D1只新增rejection_audit／rejection_observed，原10schema objects保留；原部署無migration ledger，沿既有direct SQL及私人收據登記，沒有重跑0001或新建第二套ledger。04:49:45Z原Worker新版本100%，三modules與候選相同、三assets原manifest，原設定與secret bindings保持。
- 真probe共兩個GET／一次診斷重試；初次非JSON且原raw/status未保留，原因unknown，D1對帳0列。對齊原runner User-Agent並先保存raw後，04:51:13Z取得403 SCOPE_DENIED／persisted，request_id唯一對應D1列、authenticated1。沒有新增健康命令、修改auth或重做部署。原失敗／缺失證據保留，不宣稱首次成功或具體WAF原因。
- 04:51:37Z最終核對原166commands整列相同、195firings／160journal保持、active0；原unit/config/policy/Grok/bot ledger hash及journal identity相同。runner同PID／NRestarts，4grants／Access／Cron／期限保持，保守停止仍2026-11-05T07:24:25Z；沒有續權、新真人窗口或付費升級，billing仍unknown。可回退前一compatibleWorker但保留稽核表／歷史；回退未執行。
- Lead檢查實際私人收據；T859獨立公開證據ACCEPT，未讀private或重跑live。50contracts／8llms／task-report／diff、226links、64runtimeinputs未變與173private-literal公開diff掃描通過。正常main merge保留並行工作，PLAN尾端保留雙方段落；remote fulltree相等、工作樹乾淨、head為main祖先。未要求owner重測Safari／手機。
- RAL01–04完成；完整mainline仍incomplete／無usable tag。後續unknown/in-flight隔離恢復，不中斷原runner、不自動續權。本收尾只改任務板。

## T-0035 — 未知與執行中隔離還原

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0035-1 | 獨立快照與還原 | XR-01 | done | 2026-11-01T05:22:43Z | 2026-11-01T05:35:57Z | 2026-11-01T05:36:29Z |
| T-0035-2 | 未知及原結果對帳 | XR-02 | done | 2026-11-01T05:22:43Z | 2026-11-01T05:35:57Z | 2026-11-01T05:36:29Z |
| T-0035-3 | 錯位缺失拒絕重做 | XR-03 | done | 2026-11-01T05:22:43Z | 2026-11-01T05:35:57Z | 2026-11-01T05:36:29Z |
| T-0035-4 | 隔離驗證審查交付 | XR-04 | done | 2026-11-01T05:22:43Z | 2026-11-01T05:35:57Z | 2026-11-01T05:36:29Z |

### T-0035 Git交付與source/local收尾

- [PR900](https://github.com/fallrising/newclear/pull/900) head `61c78bba4e188900c20c987a47f91cc705b62e1f`，merge `20d8352392a75ce1cf37f290c82336f1c9364a18`，2026-11-01T05:35:57Z合併。exact-head CI全過：CloudLab `41277463559`、Project success `41277463658`、llms `41277463755`。
- XR01–04：六種真本機workerd/D1＋Python runner＋SQLite online backup跨快照恢復全過，source每案1次採集、restore均0次；原source schema/rows/journal保持。started及unknown保守active，completed回報原bytes與時間；缺journal只unknown、identity mismatch拒絕、舊accepted控制面缺dispatch權限拒絕。先精確還原再目的地quarantine，舊fence409不改命令。
- RED4→GREEN4，完整130Node＋308Python＝438tests，零fail/skip；XM1去模式保護與XM2去identity核對均被oracle偵測，原runtime未改。XR1平台metadata誤計數失敗保留，只明示排除_cf_METADATA及既有_cf_KV；初次索引因新文件未stage報錯，stage後通過；既有SQLite warnings保留。T860首輪REWORK後集中複審ACCEPT。
- 50contracts／8indexes／task-report／syntax／diff／397links通過；九份workerd來源hash與公開原摘要相符。正常main merge保留並行工作；合併回讀本機與remote fulltree相等、工作樹乾淨、head為main祖先，67份runtime/test/tool input與remote main相同。
- 原Worker／auth／protocol／migrations／runner／看板未改；沒有原服務或private state操作、授權續期、付費升級或真人重測。此為local logical restore，官方遠端unknown/in-flight export/import與正式failover仍pending；完整mainline incomplete／usable_tag none。接續對齊事件seq／通知原契約與M1輪詢範圍；本結案只改任務板。

## T-0036 — 輪詢快照順序與恢復

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0036-1 | 協定範圍對齊 | PS-01 | done | 2026-11-01T11:02:36Z | 2026-11-01T11:11:21Z | 2026-11-01T11:12:00Z |
| T-0036-2 | 看板版本防倒退 | PS-02 | done | 2026-11-01T11:02:36Z | 2026-11-01T11:11:21Z | 2026-11-01T11:12:00Z |
| T-0036-3 | 持久outbox恢復 | PS-03 | done | 2026-11-01T11:02:36Z | 2026-11-01T11:11:21Z | 2026-11-01T11:12:00Z |
| T-0036-4 | 驗證審查交付 | PS-04 | done | 2026-11-01T11:02:36Z | 2026-11-01T11:11:21Z | 2026-11-01T11:12:00Z |

### T-0036 Git交付與source/local收尾

- [PR905](https://github.com/fallrising/newclear/pull/905) head `2c4a112351d77d40a2201044d3872fbaef7e7c22`，merge `b184ada9957cd2b97aa3566458c42c12509d51cb`，2026-11-01T11:11:21Z合併。exact-head CI全過：CloudLab `41300651110`、Project success `41300651083`、llms `41300651067`。
- PS01–04：沿已授權ADR-08，持久outbox在commit後ACK遺失及SQLite重開仍可領取原command；同key重送與完成後重開保持原結果、無第二個assignment。看板拒絕低revision／同版衝突整批更新，保留上次資料且停操作，fresh polling恢復；scope改變清除舊view，lease到期衍生投影不偽造DB revision，最多20筆比較基準。
- 真RED6fail／1existingpass，GREEN52dashboard；完整138Node＋308Python＝446tests，零fail/skip；PS1真Chromium/workerd/D1/Python16checks／114API／零browser errors，三asset hash與公開原receipt相同。兩種快照GET注入均拒絕、原D1列不變；HTTP ACK遺失及原artifact精確下載回歸保持。T861最終獨立ACCEPT。
- 初次default-isolation只有file級失敗，不算行為RED；sandbox full的Node native assertion／35Python socket EPERM保留，正常escalation後同套測試全過，無跳測。既有SQLite warnings保留。50contracts／8indexes初驗，正常合併並行main後51contracts／9indexes通過；task/report／syntax／diff／437links與67inputs固定。回讀local/remote fulltree相等、clean、head為main祖先，67inputs皆相符。
- 本輪只改dashboard source及驗證／文件；Worker／runner／D1 schema未改，原看板尚未部署。M0 Event/source_seq/cursor未實作，不以完整snapshot跳版冒充漏seq恢復；原要求與source/local/live差別保留，完整mainline incomplete／usable_tag none。沒有private/live操作、續權、付費升級或owner重測。後續按既有流程接入已驗證看板修正；本結案只改任務板。

## T-0037 — 原看板快照順序修正接入

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0037-1 | 固定候選與現況 | PSL-01 | done | 2026-11-01T11:42:24Z | 2026-11-01T11:50:59Z | 2026-11-01T11:51:32Z |
| T-0037-2 | 原看板更新 | PSL-02 | done | 2026-11-01T11:42:24Z | 2026-11-01T11:50:59Z | 2026-11-01T11:51:32Z |
| T-0037-3 | 歷史與權限回讀 | PSL-03 | done | 2026-11-01T11:42:24Z | 2026-11-01T11:50:59Z | 2026-11-01T11:51:32Z |
| T-0037-4 | 審查及交付 | PSL-04 | done | 2026-11-01T11:42:24Z | 2026-11-01T11:50:59Z | 2026-11-01T11:51:32Z |

### T-0037 Git交付與原看板接入收尾

- [PR915](https://github.com/fallrising/newclear/pull/915) head `c311f54d35206100a3a7575c489c0c9d421ccf00`，merge `39a3bab0ea45b6a7a38a270e32e35618481f4f85`，2026-11-01T11:50:59Z合併。exact-head CI全過：CloudLab `41303587929`、Project success `41303587975`、llms `41303587963`。
- PSL01–04：固定PR905六份候選；11:44:40Z原Worker新版100%，三modules逐byte不變，只有dashboard.mjs內容改變。一次asset session、一個bucket／一份上傳、一次publish，無失敗／重播。manifest三條、實際上傳一份分列；舊helper assets_uploaded3欄位計的是manifest，原收據保留、最終按bucket證據修正解讀。
- 11:45:00Z final snapshot／11:45:28Z保全驗證：原193commands整列、222firings／186journal及稽核歷史／應用schema保留，最終193commands／active0；4grants、Access、Cron、settings、secret bindings及授權期限相同。runner同PID／NRestarts，本機config/policy/client ledger hash與journal identity保持。沒有額外job／重啟／續權／付費升級；resident保守截止仍2026-11-05T07:24:25Z。
- Lead核對實際private receipts；T862初審要求四份入口把「未部署」改為歷史狀態，修正後集中複審ACCEPT。51contracts初驗／合併並行main後52contracts、9indexes、task-report／diff／402links、67inputs未變與8private-literals掃描通過；公開receipt與實際final欄位一致。正常merge保留並行工作，local/remote fulltree相等、clean、head為main祖先、67remote inputs相符。
- 歷史PR905的446tests／16browserchecks支持source候選，不冒充本輪真人asset下載。未續human窗口或要求Console／Safari／手機；secret採繼承且metadata保持，無逐值讀回。回退request已保存未執行，原D1／歷史保留；provider用量／帳單unknown，完整mainline incomplete／無usable tag。後續遠端unknown/in-flight隔離還原及provider用量缺口；本結案只改任務板。

## T-0038 — 遠端D1隔離還原對帳

| ID | 任務 | 對應 AC | 狀態 | start | end | last_activity |
| --- | --- | --- | --- | --- | --- | --- |
| T-0038-1 | 有界純對帳器 | RX-01 | done | 2026-11-01T14:31:46Z | 2026-11-01T14:44:33Z | 2026-11-01T14:45:19Z |
| T-0038-2 | 官方遠端還原（等 owner 批准完整備份） | RX-02 | in_progress | 2026-11-01T14:31:46Z | — | 2026-11-01T14:45:19Z |
| T-0038-3 | 遠端原結果及未知保留（等 owner） | RX-03 | in_progress | 2026-11-01T14:31:46Z | — | 2026-11-01T14:45:19Z |
| T-0038-4 | 驗證審查交付 | RX-04 | in_progress | 2026-11-01T14:31:46Z | — | 2026-11-01T14:45:19Z |

RX目前partial：純對帳器與來源唯讀核對已完成；自動審批拒絕完整敏感export下載，未執行遠端匯出／新D1／import。等待owner批准具體payload與私人保存位置，不宣稱RX02／03通過。

RX01 source交付PR[925](https://github.com/fallrising/newclear/pull/925)於2026-11-01T14:44:33Z合併（head8b41f8b934044ce3c66044624ab233db761a186c、mergef216f48192342d491e6561b960515d48ec2db6ef）。三項exact-head CI通過：CloudLab41317523620、project41317523633、llms41317523637；本機463tests、17auditcases、T863ACCEPT、52contracts／9indexes／432links／8private-literals無命中。回讀fulltree相等、clean、69inputs相同、head為main祖先。僅RX01結案；RX02／03仍等owner批准，RX04的remote驗證與整輪交付未完成。未export／create／import／backup／部署／續權／付費升級；source-only2completed／1unknown不冒充restore。
