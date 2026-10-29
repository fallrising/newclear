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
| T-0003-4 | 真實 CF／指定 runner／恢復驗收；首輪真實閉環通過；D1隔離還原／journal對帳通過；遠端故障／撤權子集通過；真人瀏覽器及完整故障矩陣待驗收；實體手機選測 | AC-06～08 | in_progress | 2026-10-26T18:01:36Z | — | 2026-10-28T13:49:05Z |

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
| T-0015-1 | fresh資源／來源／runner核對 | HL-01 | in_progress | 2026-10-29T10:09:24Z | — | 2026-10-29T10:21:43Z |
| T-0015-2 | 有界scheduler與Worker／Cron更新（等provider：資產session500） | HL-02 | in_progress | 2026-10-29T10:09:24Z | — | 2026-10-29T10:21:43Z |
| T-0015-3 | 首次真實觸發及runner結果（依賴HL02恢復） | HL-03 | in_progress | 2026-10-29T10:09:24Z | — | 2026-10-29T10:21:43Z |
| T-0015-4 | 保留／回讀／審查與交付 | HL-04 | in_progress | 2026-10-29T10:09:24Z | — | 2026-10-29T10:21:43Z |

- [HL部分執行證據](../evidence/m1-health-schedule-live.md)：資產session兩次500，未發布／續權／開Cron。2026-10-29T10:15:50Z回讀原資源／授權／業務／journal保留，runner運行中；原批准持續有效但受2026-11-05T07:24:26Z上限約束。等待provider恢復，並非等owner；所有列暫留in_progress，不以證據PR合併冒充啟用完成。

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
| T-0021-1 | 離線預覽與可信候選 | BR-01 | in_progress | 2026-10-29T17:09:18Z | — | 2026-10-29T17:18:48Z |
| T-0021-2 | 原子續租與歷史保留 | BR-02 | in_progress | 2026-10-29T17:09:18Z | — | 2026-10-29T17:18:48Z |
| T-0021-3 | 重試／併發／跨期恢復 | BR-03 | in_progress | 2026-10-29T17:09:18Z | — | 2026-10-29T17:18:48Z |
| T-0021-4 | 回歸、審查及交付 | BR-04 | in_progress | 2026-10-29T17:09:18Z | — | 2026-10-29T17:18:48Z |
