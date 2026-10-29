# Cloud Lab

個人 Cloudflare 工具與遠端運維的共同框架：以知識樹導航能力，以版本化契約連接 API、排程、bot、執行器及看板。

**M1 已部署受 Access 保護的 Workers/D1 與看板，並完成一筆真實 non-root runner 健康檢查閉環；完整人機操作、故障與恢復驗收仍未完成。** [成功契約](SUCCESS.md)區分文件里程碑與產品主線；既有專案仍在原路徑、沿用原資料及權限。

文檔檔位：**未分級**。本次 owner 指示授權繼續開發 M1；長期投入及實作節奏另按里程碑決定。[文件政策](../../docs/portfolio-doc-tiers.md)／[Portfolio](../../PORTFOLIO.md)。

## 閱讀順序

1. [知識樹與能力目錄](docs/knowledge-tree.md)：我要做什麼、由誰負責、實作在哪、證據到哪。
2. [SDD](SDD.md)：使用情境、範圍、設計決策與第一條可驗收流程。
3. [架構與責任](docs/architecture.md)：狀態權威、部署與資料邊界、CF 技術對照。
4. [介面契約](contracts/README.md)：身分、命令／執行、事件／成果、Recipe；M0 為提案，M1 實作範圍另有明列。
5. [遷移與封存計畫](docs/migration.md)：來源到目標映射、重複判定、切換與回退。
6. [驗收及里程碑](docs/verification.md)：文件檢查與未來 runtime gate。

[來源](docs/sources.md)固定本次盤點版本；[本機啟動](docs/quickstart.md)提供測試閉環；[任務板](docs/tasks/BOARD.md)與[文件證據](docs/evidence/m0-review.md)記錄本次交付。

## 第一個實作使用情境

在手機或授權 bot 提交指定節點的唯讀檢查，取得命令 ID；runner 向外領取工作，回報具版本與時間的結果；看板呈現成功、失敗、失聯或未知，保留驗證與成果連結。API、排程與 bot 共用准入契約。

M0 不會移動 Kith／Edge Ops 程式、不合併資料庫、不啟用排程或 agent、不封存任何來源。公開框架不包含私人環境設定；通用程式的公開遷入另須來源與授權審閱。

## M1 開發入口

- [實作契約與取捨](docs/m1-implementation.md)／[OpenAPI](contracts/m1.openapi.json)
- [控制面](apps/control/worker/index.mjs)／[runner](adapters/node-health/README.md)／[看板](apps/control/public/index.html)
- [本機啟動與測試](docs/quickstart.md)／[部署前設定與 gate](docs/deployment.md)／[實作證據](docs/evidence/m1-implementation.md)

接入真實環境前可使用 [private bundle產生器](docs/deployment-bundle.md) 與 [live probe](docs/live-probe.md)。目前 [連線前檢查](docs/evidence/m1-live-readiness.md) 已選定首組目標，Access scopes 已補齊，owner 確認 Workers Free／零新增付費；[首輪真實閉環](docs/evidence/m1-first-live.md)已通過，後續驗收仍進行中。無桌面登入與故障分流見 [OAuth 操作紀錄](docs/headless-oauth.md)，部署／接手順序見 [操作紀錄](docs/live-operations.md)。

[首次隔離還原](docs/evidence/m1-isolated-restore.md)已核對六張應用表及journal；未派送命令完整保留，沒有切換正式DB或重跑工作。

[常駐runner](docs/resident-runner.md)提供有界輪詢、單一實例、期限與停止／重啟契約；[自動拾取與重啟對帳](docs/evidence/m1-resident.md)已通過，完整故障恢復及手機驗收仍待完成。

[隔離中斷／回報遺失驗證](docs/recovery-qualification.md)涵蓋真實程序與實際workerd／D1 binding；[證據](docs/evidence/m1-recovery.md)保留unknown容量占用，未操作live服務。

[遠端隔離故障／撤權](docs/remote-recovery.md)已完成真實CF三個恢復案例、grant撤銷及Access token停用；[證據](docs/evidence/m1-remote-recovery.md)核對原資源設定不變，保留一筆unknown，完整主線仍未完成。

[看板瀏覽器驗收](docs/dashboard-qualification.md)補上Access失效清除／停止輪詢、原提交身份保留與舊回應隔離；[本機證據](docs/evidence/m1-dashboard.md)涵蓋真正Chromium／workerd／D1及320／390px。新版資產已完成部署及自動核對，一般瀏覽器真人Access仍待驗收，實體手機依owner指示改為選測。

[新版看板部署記錄](docs/dashboard-rollout.md)：owner明確批准後已發布；保留原設定與期限，記錄匿名302／機器200，一般瀏覽器真人流程待驗，實體手機選測。

[授權生命週期工具](docs/authorization-lifecycle.md)提供離線期限盤點與保留scope的續期／撤銷計畫；[本機證據](docs/evidence/m1-authorization.md)涵蓋144tests、SQLite CAS及合成CLI。計畫不會自動續權或輪替憑證。

[授權來源採集](docs/authorization-collection.md)已接入既有Cloudflare MCP唯讀操作端；[161tests與原Lab實證](docs/evidence/m1-authorization-collection.md)記錄來源時間、前後漂移檢查與未知層。只採集metadata，不自動續權或輪替。

[機器自身授權查詢](docs/self-authorization.md)提供Worker自身HMAC metadata來源與runner `--authorization-status`命令；已在原Lab有界窗口部署並通過self查詢；查詢不啟動工作，完整來源由IA整合。

[Resident程序觀測](docs/resident-observation.md)以私人Unix socket、kernel peer／process／FLOCK及已載入設定digest取得實際stop-at；限Linux及明確啟用。已在原Lab完成一次實際觀測；驗證後resident正常停止，不將舊快照當成目前liveness。

[整合授權觀測](docs/integrated-authorization.md)將管理面、機器self與resident來源對齊；前後漂移或身份衝突拒絕，缺失來源保留未知。私人快照由manifest驗證完整性；[本機整合證據](docs/evidence/m1-integrated-authorization.md)區分實際HTTP／kernel驗證與合成管理資料；後續原Lab實際接入見下方OL證據。

[觀測部署準備](docs/observation-rollout.md)固定程式候選、過期授權現況、短期接入與回退順序；原準備記錄保留；owner後續明確批准並執行短期接入。

[實際觀測接入](docs/evidence/m1-observation-live.md)已完成固定Worker／runner更新、兩個機器的短期期限、真實AS／SA／RO整合及驗證後停止；原D1業務資料、journal、Access policy與排程保留。human／scheduler仍過期，常態服務與完整主線未完成。

[常態runner服務模式](docs/service-runner.md)新增獨立私人政策、啟動自身授權核對與最早期限停止；重啟保留journal，未知工作不重做。SR階段先在本機驗證；後續live啟用結果見下段。

[常態啟用準備](docs/service-activation.md)提供私人離線proposal、7日／60秒方案與請求量估算；固定SR候選及原Lab唯讀盤點完成。Owner批准後，[七日服務實際啟用](docs/evidence/m1-service-live.md)已完成runner-only續期及來源回讀，觀察時保持運行；固定截止2026-11-05T07:24:26Z，不自動續權。

[低頻健康檢查與看板](docs/health-schedule.md)支援具期限的15／60／1440分鐘政策、授權排程snapshot與觸發／觀測展示；[HS本機驗證](docs/evidence/m1-health-schedule.md)含265tests及12組真實瀏覽器情境。Owner已批准後，[實際接入](docs/evidence/m1-health-schedule-live.md)在資產session連續500時停止；原runner及授權保留，新版／Cron仍未啟用。

[固定bot bridge](docs/bot-bridge.md)提供health.check／health.status JSON入口、持久請求及同ID恢復；[283tests與實際HTTP／Python collector](docs/evidence/m1-bot-bridge.md)本機通過。可供Grok等工具host適配，尚未實際接線／續權，不呼叫模型或新增費用。

[本機MCP入口](docs/mcp-stdio.md)將固定bot bridge暴露為check／status工具，預設僅查詢；具有有界子程序、同ID恢復與去敏結果。[本機證據](docs/evidence/m1-mcp-stdio.md)區分協議閉環與尚未進行的實際Grok／live接線。

[獨立Grok接線](docs/grok-connection.md)已完成現有client原生MCP握手／工具發現及唯讀status檢查；[實際證據](docs/evidence/m1-grok-connection.md)確認bot grant已過期、Access仍有效，未開提交／續權或呼叫模型。

[Bot有界真實驗證](docs/bot-live.md)已完成bot-only30分鐘續權、一筆MCP→原runner→validated/healthy及保全回讀；[證據](docs/evidence/m1-bot-live.md)記錄實際觀測與操作端相對journal路徑修正。Grok已恢復status-only，未執行模型或延長其他角色。

[持久bot政策](docs/bot-policy.md)新增最多24小時租期、24新ID／240call持久上限、明確離線初始化及MCP可信接入；重新連線不重置，未知保留同ID。[319tests及獨立審查](docs/evidence/m1-bot-policy.md)通過；只交付source／local，未改實際Grok設定或續權。

[顯式bot續租](docs/bot-policy-renewal.md)提供離線預覽、舊期到期後CAS切換、原請求／歷史保留及同指令重試不補額度；[336tests及獨立審查](docs/evidence/m1-bot-policy-renewal.md)通過；仍為source／local交付，未安裝或續live權限。

[Bot首個有界啟用準備](docs/bot-activation.md)已固定BR/BP候選、原state及<=24h方案；[唯讀證據](docs/evidence/m1-bot-activation.md)確認bot過期、runner仍可驗證。該準備階段未安裝／續權／初始化政策；後續批准的實際啟用見下段。

[首個bot有界啟用](docs/bot-activation-live.md)已獲批准並執行：原bot續期至2026-10-30T18:00:27Z，首次持久政策24新ID／240call，新版Grok工具保留啟用；[一筆真實validated/healthy](docs/evidence/m1-bot-activation-live.md)使用1新ID／4call。原runner／Access不延期，不呼叫模型或新增付費。
