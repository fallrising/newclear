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
| T-0014-1 | 有界低頻排程與dispatch護欄 | HS-01 | in_progress | 2026-10-29T08:06:27Z | — | 2026-10-29T08:27:43Z |
| T-0014-2 | 授權排程狀態及結果API | HS-02 | in_progress | 2026-10-29T08:06:27Z | — | 2026-10-29T08:27:43Z |
| T-0014-3 | 看板排程／過期／session展示 | HS-03 | in_progress | 2026-10-29T08:06:27Z | — | 2026-10-29T08:27:43Z |
| T-0014-4 | 整合、審查與交付 | HS-04 | in_progress | 2026-10-29T08:06:27Z | — | 2026-10-29T08:27:43Z |
