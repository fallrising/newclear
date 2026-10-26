# Cloud Lab

個人 Cloudflare 工具與遠端運維的共同框架：以知識樹導航能力，以版本化契約連接 API、排程、bot、執行器及看板。

**M1 已有 Workers/D1 控制面、Python OS 健康檢查 runner 與看板的本機實作候選；尚未部署或通過真實 Cloudflare 驗收。** [成功契約](SUCCESS.md)區分文件里程碑與產品主線；既有專案仍在原路徑、沿用原資料及權限。

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

接入真實環境前可使用 [private bundle產生器](docs/deployment-bundle.md) 與 [live probe](docs/live-probe.md)。目前 [連線前檢查](docs/evidence/m1-live-readiness.md) 已選定首組目標，仍有Access權限／方案缺口，沒有因工具完成而宣稱已部署。
