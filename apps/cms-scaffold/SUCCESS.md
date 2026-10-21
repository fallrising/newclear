---
project: apps/cms-scaffold
purpose: 提供共用 CMS kernel 與 Front／Back／Admin 三個操作面
kind: application
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# cms-scaffold 成功契約

## 主線與範圍

[凍結總綱](docs/sdd/00-overview.md) 定義一個 Java API、三個獨立操作面，
相簿／診所／專案是驗證共用內容、媒體、發布與權限的 demo packs。
[v2 路線圖](docs/v2/README.md) 的 BW0–BW5、W0–W5 已有交付；
[個人使用主線](docs/v2/03-personal-use-readiness.md) 另外要求 PP1 持續運行與恢復能力。
不合併 Back/Admin、不新增 demo 專屬資料表；GraphQL、外掛市場、S3 生產部署不在此波。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 有權限編輯者與三個 demo，When 編輯、發布及公開讀取，Then 共用 API／三面流程及草稿拒絕符合契約。 | historical | [W5 交付](.team/reports/W5-DELIVERY.md)：2026-10-06 real API 14/14；648 前端及 93 mock 等歷史檢查。 |
| AC-02 | Given 版本衝突或無權限內容操作，When 寫入／讀取，Then 原子版本檢查與 RBAC 拒絕不漏資料。 | historical | [BW1c](.team/reports/BW1c-DELIVERY.md)、[BW5](.team/reports/BW5-DELIVERY.md) 與 [P0](docs/v2/waves/P0.md)。 |
| AC-03 | Given 本地隔離環境，When 啟動 PP1a，Then HTTPS、prod 設定、DB 不對外且不植入 demo。 | historical | [PP1a](docs/v2/waves/PP1a.md)、[狀態表](docs/v2/README.md)：PR327 VERIFIED local scope。 |
| AC-04 | Given 正式日常帳號與維護操作，When 初始化及執行 Q25 治理，Then 權限、自身保護與恢復路徑可用。 | pending | [PP1b](docs/v2/waves/PP1b.md) 為施工圖；不能把 DOC_READY 視為實作完成。 |
| AC-05 | Given DB 與媒體持續使用，When 備份還原、升級失敗回復與例行維運，Then 資料一致且符合 RPO24h／RTO4h。 | pending | [PP1](docs/v2/waves/PP1.md) 與 [恢復契約](docs/v2/contracts/PP1-recovery.md)；完整操作驗收尚缺。 |

## 現況與缺口

CMS 核心已超過 mock scaffold，W5 有隔離真實 API 旅程與清理紀錄。
README 的較早 LOCAL_VERIFIED 段落不是最新整體狀態，v2 表及發布紀錄保留先後。
PP1a 只關閉本地環境子波，沒有關閉 PP1、BW6 或 W6。
正式帳號、DB＋媒體一致備份、升級回復與基本運維仍是 owner 指定的使用門檻。
BW6/W6 功能擴充依原波次管理，不拿全部願望無限加碼當前 PP1。

## 啟動與驗證

從本目錄依 [quickstart](docs/quickstart.md) 準備 JDK25、Node24、PostgreSQL16。
API：`./gradlew :services:cms-api:bootRun`；前端：`npm ci` 後分別執行
`npm run dev -w @cms/web-front`、`@cms/web-back`、`@cms/web-admin`。
原生閘門：`./gradlew test`、`./gradlew integrationTest`，以及
`npm test`、`npm run lint`、`npm run typecheck`、`npm run build`、`npm run test:bundle`。
[package.json](package.json) 與 [PP1a](docs/v2/waves/PP1a.md) 是本地 HTTPS 路徑依據。
mock E2E 與 real API 驗收分別記錄；保留資料時不能使用刪除 volumes 的清理方式。

本次只核對文件、入口與證據連結；未執行產品建置、服務或外部整合。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
已有可運行的 CMS 核心切片，但本契約不宣稱整體正式可用。
須補 PP1 帳號／治理、完整備份還原、升級回復與運維證據，再按確定環境核對設定及版本。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。
