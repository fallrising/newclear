---
project: platform/dim-gate
purpose: 以有狀態模擬資料展示跨角色資源申請、發布與故障恢復
kind: application
mainline: complete
usable_tag: usable/dim-gate/v0.1.0
qualification: docs/project-success/qualifications/dim-gate.md
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# DimGate 成功契約

## 主線與範圍

完成線是 [SDD](SDD.md) 承諾的本機 Mock-first 展示產品：RD、Ops、Admin 共用 CMDB 與狀態機，完成目錄配置到回滾。
包含 M0–M5 與已接受 W1–W5；[STATUS](docs/STATUS.md)頂端的最終對帳優先於下方歷史待驗收 checkpoint。

真實雲 provisioning、SSO、telemetry collector、跨企業租戶與任意工作流不在本版。
角色切換及前端 RBAC 是展示模型，不能當正式後端安全邊界；沒有部署或真實雲連線。

本契約核對的是上述來源版本中的文件與程式。
`complete` 只適用明列的主線範圍；沒有延伸為部署或生產保證。

## 驗收條件

下表 `historical` 是原有逐項報告；2026-10-21 已補做 [可用版本資格驗證](../../docs/project-success/qualifications/dim-gate.md)，區分本次重跑與可沿用的歷史結果。
`pending` 保留缺少證據或尚未實作的條件；程式存在不等於通過。

| AC ID | Given / When / Then | 狀態 | 證據或缺少原因 |
| --- | --- | --- | --- |
| AC-01 | Given 三來源 baseline 與角色權限，When 從申請、審批、交付到發布，Then 共用 entity 狀態與稽核一致且拒絕分支可重演 | historical | [STATUS M0–M5](docs/STATUS.md)、[示範指南](docs/DEMO-GUIDE.md) |
| AC-02 | Given 異常發布與關聯資源，When 調查 metrics/log/trace 並回滾，Then incident 依恢復樣本解除且保留稽核 | historical | [M4 契約](docs/M4-INTEGRATION-CONTRACT.md)、[STATUS](docs/STATUS.md) |
| AC-03 | Given W1–W5 工作區，When 操作資源工作單、身份與灰度通知，Then 跨角色隔離、存檔升級與完整流程通過 | historical | [W5 契約](docs/W5-INTEGRATION-CONTRACT.md)、[STATUS](docs/STATUS.md)：426 原生、100 Chromium、12 Firefox/WebKit |
| AC-04 | Given 已合併 demo build，When 量測初始載入與查詢並測隔離，Then gzip、LCP、查詢及 mock HTTP 都在固定預算內 | historical | [STATUS](docs/STATUS.md)：616d67e 合併後 CI、297608 gzip bytes 與 1336 ms LCP |

## 現況與缺口

主線 complete 僅表示明訂的本機示範主線已有歷史驗收。
W5 產品 03c15883、後續 CI 修正 616d67e 的記錄涵蓋跨瀏覽器、效能及隔離。
SDD 舊 W5 未驗收描述已落後於 STATUS 的最終事實，本契約保留可追溯來源。
能力地圖中的後續項沒有 W6 規格，不把尚未立項的真實後端擴充列成本版失敗。

本次新增驗收入口並補做可用資格；未改變 runtime 或原有驗收 oracle。
歷史結果若與現行 source 有相關差異，必須補驗而不能直接繼承。

## 啟動與驗證

[Quickstart](docs/quickstart.md)與[示範指南](docs/DEMO-GUIDE.md)提供重置、角色切換與完整 UI 路線；需要 Node 24 與鎖定 pnpm。

已核對入口：[package scripts](package.json)與 [Guide UI](src/features/foundation/GuidePage.tsx)。
下列提供既有啟動／驗證入口；本次實際執行範圍與結果以資格紀錄為準；
需先完成連結文件中的依賴、設定及適用環境準備。

```sh
pnpm install --frozen-lockfile
pnpm build --mode demo
pnpm preview
pnpm test
pnpm test:e2e
```

執行後應保留來源 SHA、必要設定的非秘密摘要、命令與結果，
並將 runtime 證據逐項對回 AC；不得只用 health 或 exit 0 宣告全部完成。

## 可用版本

本次資格通過，預定標記 `usable/dim-gate/v0.1.0`，範圍與逐命令證據見[資格紀錄](../../docs/project-success/qualifications/dim-gate.md)。
必要 PR CI／獨立審查通過並合併後才發布；不外推 production 或原範圍以外能力。
