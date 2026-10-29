---
project: platform/cloud-lab
purpose: 以共同契約與知識樹組合個人 Cloudflare 工具、遠端運維及代理能力
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-28
source_commit: 65bbadb7659437e8a14f029015313c6f5277ce35
---

# Cloud Lab 成功契約

## 主線與範圍

主線是 [SDD](SDD.md) 描述的單 operator 私人 Cloud Lab：共用准入、可觀察的非同步任務、具 scope 的執行 adapter、成果及看板。各應用可獨立部署，既有 host／workload／agent／工作驗收 authority 保留。

先前授權 **M0 文件先行**：知識樹、責任與介面、來源映射、遷移／封存 gate 及驗收設計。AC-01～05 屬本次文件里程碑；AC-06～08 是未實作的產品主線，不能因文件完成改成 passed。Owner 後續指示「好，繼續開發。」授權 M1 實作；範圍與獨立 AC 見 [M1 實作契約](docs/m1-implementation.md)。該開發里程碑未搬移程式、遷移資料、部署或封存。後續 owner 已批准選定目標的首輪部署；實際範圍與缺口見 [live evidence](docs/evidence/m1-first-live.md)。

frontmatter source_commit 是文件盤點的 repository 基準，不是新文件已合併或產品已驗收的宣告。

## 驗收條件

| AC ID | Given / When / Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 現有能力與來源，When 沿知識樹閱讀，Then 每個能力有責任者、契約、來源／實作與證據或明示缺口 | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源／連結及獨立審查通過 |
| AC-02 | Given UI／bot／schedule 與既有 executor，When 追蹤合成命令，Then 准入、去重、attempt、取消、未知及驗證由明確 owner 處理 | passed | [M0 文件證據](docs/evidence/m0-review.md)：合成 walkthrough 與恢復語義複核通過 |
| AC-03 | Given CF 元件及既有平台，When 分配狀態與部署責任，Then 無雙重 run／host／workload／Done 權威 | passed | [M0 文件證據](docs/evidence/m0-review.md)：唯一權威與部署邊界審查通過 |
| AC-04 | Given 每個候選來源，When 決定歸位／抽取／adapter／reference，Then 有目標與阻擋，封存必須通過接替及回退 gate | passed | [M0 文件證據](docs/evidence/m0-review.md)：來源處置、切換／回退與退役 gate 審查通過 |
| AC-05 | Given 完整文件候選，When 跑既有索引驗證與獨立審查，Then 導航一致、沒有 runtime 成功冒稱，所有未實作事項保留 | passed | [M0 文件證據](docs/evidence/m0-review.md)：本機 validators 及獨立 ACCEPT；Git 交付狀態見[任務板](docs/tasks/BOARD.md) |
| AC-06 | Given 授權 caller 與一台真實 runner，When API／排程提交固定唯讀檢查，Then 同一 command 可追蹤、去重、驗證並在看板顯示 | pending | 真實 CF＋獨立 bot API＋non-root runner 一筆閉環已通過；一般瀏覽器真人Access、排程與 Grok 整合仍待驗收；實體手機已改選測 |
| AC-07 | Given 重複投遞、失聯、取消及恢復，When 執行與回報競爭，Then 不重做未知副作用且停止／未知／驗證狀態誠實可見 | pending | [遠端三種故障與撤權子集](docs/evidence/m1-remote-recovery.md)已通過；完整 [M1 故障矩陣](docs/verification.md)仍待驗收 |
| AC-08 | Given 私人入口、受限預算與備份，When 撤權、超限或隔離還原，Then 存取被限制、成本／缺漏可見且未完成工作先對帳 | pending | Access／隔離資源／零新增付費限制已有首輪證據；[首次D1隔離還原與journal對帳](docs/evidence/m1-isolated-restore.md)已通過；[獨立環境grant／Access撤權、執行中／unknown恢復](docs/evidence/m1-remote-recovery.md)已通過；配額耗盡與完整邊界仍待驗收 |

## 現況與缺口

已有部署的 M1 Worker／D1、Python runner 與看板；一筆真實健康檢查 validated。完整 live gate 尚未完成，仍沒有可用版本。能力整合與遷移候選不代表既有產品已被接管或驗收。

[M1 OpenAPI](contracts/m1.openapi.json)、HMAC 跨語言 loopback 測試與本機 runtime 已加入；首輪部署／操作證據見 [live evidence](docs/evidence/m1-first-live.md)，其餘 live gate 保留。未知費用／配額不填零；真實 model／CLI、Workflows、Queues、變更主機與模板生成均不是本次交付。

## 啟動與驗證

[本機啟動](docs/quickstart.md)區分測試 harness 與 CF runtime；[驗收計畫](docs/verification.md)列出 repo 文件檢查與後續 gate；[文件證據](docs/evidence/m0-review.md)保存實際命令與審查結果。未來產品驗收必須保留失敗、未跑及限制，不能由本次文件檢查推導。

## 可用版本

`usable_tag: none`。M0 文件里程碑即使通過，產品仍是 `mainline: incomplete`；不建立 release／usable tag，也不將 merge 當成 owner acceptance 或部署。

## M1 本次開發驗收

| AC | 範圍 | 狀態 | 證據 |
| --- | --- | --- | --- |
| M1-I1 | 有界准入、SQL outbox、scope、CAS、對帳與結果 | passed | [M1 evidence](docs/evidence/m1-implementation.md)：控制面測試、獨立 ACCEPT |
| M1-I2 | 真實 OS 唯讀 collector、journal、HMAC、重送 | passed | [M1 evidence](docs/evidence/m1-implementation.md)：31 Python 測試及 HTTP 整合、獨立 ACCEPT |
| M1-I3 | 看板、freshness、取消意圖與權限 | passed | [本機真實瀏覽器與workerd／D1](docs/evidence/m1-dashboard.md)已通過；新版資產已部署；真人Access仍pending，實體手機依owner指示改選測 |
| M1-I4 | 整合、負向案例、索引、獨立 review | passed | [M1 evidence](docs/evidence/m1-implementation.md)：62 tests、validators、獨立 ACCEPT |

## 真實環境接入準備（T-0003）

新增離線部署bundle及有界probe，驗證與連線缺口見 [readiness evidence](docs/evidence/m1-live-readiness.md)。D1／Workers授權已更新並通過只讀查詢；網域／runner採已提出的第一組目標。私人部署計畫已準備，Access建立／service-token／身分查詢scopes已補齊，owner確認Workers Free／零新增付費；已完成actual workerd及首筆真實API→runner→validated閉環；首次D1隔離還原與已完成／未派送命令對帳已通過；真人瀏覽器與完整故障／恢復驗收仍待完成，實體手機改選測；AC-06～08維持pending，不由本機工具通過改為passed。

本輪常駐 runner 範圍及 RR-01～05 見[resident runner](docs/resident-runner.md)，本輪[98項測試與常駐實機子集](docs/evidence/m1-resident.md)通過，原主線 AC 保持 pending。

下一子里程碑[FR-01～04](docs/recovery-qualification.md)驗證真實程序中斷／回報遺失，範圍限隔離環境；[101項回歸與三個workerd場景](docs/evidence/m1-recovery.md)通過，遠端故障與完整AC仍待驗收。

本輪[RF-01～04遠端隔離故障／撤權](docs/remote-recovery.md)已通過：[115項回歸、三個遠端案例、grant403及Access停用後401](docs/evidence/m1-remote-recovery.md)。原設定／排程相等，unknown保留；完整主線狀態不變。

本輪[UI-01～04看板瀏覽器驗收](docs/dashboard-qualification.md)本機121tests及十組瀏覽器情境通過；獨立審查ACCEPT；後續新版已部署，真人Access仍pending，實體手機改選測。

本輪[DR-01～04看板部署與真實手機驗收](docs/dashboard-rollout.md)owner明確批准後已發布，新版本100%、原設定／D1資料相等、匿名302及機器200通過；一般瀏覽器真人流程待驗，實體手機已改選測。原拒絕與domain排序檢查失敗均保留，維持原grant期限，不啟用排程或付費方案。

Owner於2026-10-28取消實體手機必測要求；[客戶端範圍調整](docs/dashboard-rollout.md#owner調整客戶端驗收範圍)不改身份／grant檢查，也不等於真人Access已驗證。後續開發不以手機測試為門檻。

本輪開始[AL01–04授權生命週期](docs/authorization-lifecycle.md)：離線狀態與續期／撤銷計畫、CAS與私人資料邊界已完成；[144tests、真實CLI合成測試及獨立ACCEPT](docs/evidence/m1-authorization.md)通過。不執行雲端續權或憑證輪替，完整主線保持pending。

本輪[AS01–04授權來源採集](docs/authorization-collection.md)完成：[161tests、獨立source審查與原Lab五次唯讀請求](docs/evidence/m1-authorization-collection.md)通過。四個grant及選定Access token期限已過，active0／排程off；HMAC及runner仍unknown。沒有續權或雲端變更，完整主線保持pending。

本輪[SA01–04機器自身授權查詢](docs/self-authorization.md)source完成：[176tests、真實本機HTTP查詢與獨立複審](docs/evidence/m1-self-authorization.md)通過。具可取消總期限，無job副作用；尚未部署或續權，runner程序來源仍待實作，完整mainline不變。

本輪[RO01–04 resident程序觀測](docs/resident-observation.md)source完成：[192tests、真實隔離resident／socket／FLOCK與獨立審查](docs/evidence/m1-resident-observation.md)通過。SIGTERM／SIGKILL、漂移與保守期限驗證通過；未部署或續權，完整主線保持pending。

RO Git交付已獲owner明確push批准，恢復正常PR／CI／merge與任務板收尾；本機source與192tests／審查完成。先前自動批准審查拒絕保留於[證據](docs/evidence/m1-resident-observation.md)，實際交付結果以任務板為準。

本輪[IA01–04授權來源整合](docs/integrated-authorization.md)source完成：[214tests與獨立複審](docs/evidence/m1-integrated-authorization.md)通過，串聯AS／SA／RO並保留缺失來源為未知。未部署、續權或進行原Lab整合採集，完整主線保持pending。

本輪[RP01–04觀測部署準備](docs/observation-rollout.md)完成：[12份source候選／唯讀現況／獨立ACCEPT](docs/evidence/m1-observation-rollout-plan.md)已核對。該階段僅準備；後續owner已批准並執行OL有界接入，結果見下段。

Owner明確批准後，[OL01–04實際接入](docs/evidence/m1-observation-live.md)已完成Worker100%、bot／runner短期授權、真實AS／SA／RO與正常停止回讀；原業務資料、journal、Access policy與排程保持。未擴大scope或付費；human／scheduler仍過期，未驗自然到期或真人session，完整主線pending。

本輪開始[SR01–04常態runner服務模式](docs/service-runner.md)：獨立服務政策、啟動自身授權核對、期限與journal恢復；[236tests與實際本機程序／HTTP證據](docs/evidence/m1-service-runner.md)通過；獨立複審ACCEPT，未啟用live常態服務，完整主線pending。

本輪開始[SP01–04常態啟用準備](docs/service-activation.md)：離線proposal、用量估算、固定source與唯讀前態；[249tests、私人CLI與唯讀候選證據](docs/evidence/m1-service-activation.md)通過；T834獨立審查ACCEPT，未續權或啟用服務。

Owner確認Workers Free並批准後，[SL01–04七日服務啟用](docs/evidence/m1-service-live.md)實際完成原Access及runner-only續期、policy／unit啟動、runner self／resident來源整合與最終回讀；截至2026-10-29T07:28:20Z保持運行，固定截止2026-11-05T07:24:26Z。其他角色授權仍過期、排程off，未驗7日uptime／自然到期／帳單；完整主線pending。
