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
| AC-04 | Given 正式日常帳號與維護操作，When 初始化及執行 Q25 治理，Then 權限、自身保護與恢復路徑可用。 | pending | [PP1b本輪實測](.team/resume-20261101/RUNTIME-REPORT.md)已通過本地fresh/Q25；交付待CI／合併，host recover仍依PP1c，AC-04整體保持pending。 |
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

## FE review Round 2 — 2026-10-24（本機 M1/M2 gates 通過）

本次僅實作 [DESIGN M1/M2](fe-review/DESIGN.md)：既有三 app 的 MSW 合成環境、loopback CLI 啟動覆寫、現行 §7 路由 targets 與逐頁 HTTP／final URL／已載入內容證據。六個前端波次 W1/W2/W3/W3b/W4/W5 已由 PR229/245/273/281/289/300 合併及必要 CI 成功滿足前置條件。

驗收計畫：共用 capture 的 dry-run／--start、三尺寸 light 擷取、component-only final URL／fixture／身份與載入斷言、focused guard regression、原生前端 gates、獨立 review 和 owned cleanup。實跑前 targets 保持 false；只有全部 M2 gates 通過才改 true。本節不改 PP1 缺口、mainline incomplete 或 usable_tag none；完整 R3、real API 與正式操作驗收未執行。結果將記錄於 [Round 2 report](fe-review/tasks/round2/report.md)。

本機結果：648 workspace＋66既有PP1 unit tests及lint/types/build/bundle通過；153有效擷取（原144＋明列補抓9）和51逐頁HTTP200／final URL／身份／載入檢查通過，所有owned listeners與容器清理有證據。原9次selector timeout保留，沒有重跑144綠圖。targets verified=true僅指本次R2；24console與27request/HTTP事件如實留存，axe/fullR3未跑。獨立review與當前PR的CI／合併由root收尾，並未代行owner acceptance。

## 2026-11-01 PP1b／PP1c PR續作

Owner要求接續最舊PR333/334；T-0351已認領。PP1b本輪依已合併DOC_READY施工圖補AC-04（對應PP1-AC02/06、FM04–07/15）的真實fresh-init、initialized SQL與rollback-only語義負例、剩餘guard live negatives、可信TLS帳號旅程及最終同來源native/CI/獨立review。原斷言、no-demo與秘密／private network邊界保留；不以歷史部分通過代替本輪驗收。

PP1c僅修正舊DRAFT與14項審查缺口，與PP1b分支隔離；未批准新規格不施工或合併。完整AC-05／正式host／offsite／upgrade／ops仍pending。本輪不部署或建立usable tag。

計畫與邊界見[續作計畫](.team/resume-20261101/PLAN.md)，進度見[任務板](docs/tasks/BOARD.md)。初始pure helper suite在正常主機執行117passed/0failed/0skipped；sandbox首次僅回報8file wrappers、6failed，屬不可用執行環境結果而非產品已驗收。本輪517Java unit、201PostgreSQL integration、672workspace與117helper、lint/types/build/bundle已通過；E01收尾lint修正已重驗。Owner已批准工具例外；真TTY初始化、七項SQL rollback語義負例、真guard負例與可信TLS E01現已通過。首次Java整合201/202（public p95=134ms>100ms）保留；停止其他負載後原suite隔離202/202、p95=52ms通過，mock93/93通過。最終review／CI／合併仍待完成。詳見[本輪runtime報告](.team/resume-20261101/RUNTIME-REPORT.md)，原[前置證據表](.team/resume-20261101/EVIDENCE.md)保留歷史失敗。
