# CMS Scaffold

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


可重複使用的 CMS kernel：一個 Java API、三個操作面（Front / Back / Admin）。相簿、寵物診所與專案管理是驗證共用內容、發布、媒體與權限能力的三個 demo pack；本項目是通用 CMS。

權威總綱：[`docs/sdd/00-overview.md`](docs/sdd/00-overview.md)。  
實作波次：[`docs/specs/90-synthesis.md`](docs/specs/90-synthesis.md) §11。  
v2（後端 BW0～BW5、P0、前端 W0～W3／W3b 已合併；前後端 SDD 與路線圖）：[`docs/v2/`](docs/v2/README.md)。

目前已合併 **Wave E＋Back 自訂視圖＋v2 BW0／W0＋P0＋BW1a／BW1b／BW1c／W1／BW2／W2／BW3**：後端 OpenAPI／store 契約測試、前端共用套件／MSW／新殼已存在；Back 另有相簿編排、當日行程、issue 看板。後續模型與編輯器功能仍依 v2 波次開發。

BW1a 已合併並通過 [整合驗收](.team/reports/BW1a-DELIVERY.md)：類型設定／欄位 metadata、capabilities 與請求內授權快取，並同步前端契約；PR #223 已合併。完整表單與動態導覽見 W1；模型治理畫面仍依後續波次開發。

BW1b 已合併並通過 [整合驗收](.team/reports/BW1b-DELIVERY.md)：列表分頁／篩選／predicate 下推、雙 scope 索引與回填、前端完整列表相容。202＋91 後端、166 前端、17 mock E2E 通過；狀態 `VERIFIED`，PR #224 已合併。

BW1c 已合併並通過 [整合驗收](.team/reports/BW1c-DELIVERY.md)：全部欄位錯誤、PATCH 必帶版本、公開不可讀媒體為 null，並同步 client／MSW。226＋93 後端、179 前端、17 mock E2E 通過；`VERIFIED`，PR #225 已合併。W1 完整編輯器與欄位錯誤 UI 已完成本地驗收。

W1 已本地通過 [整合驗收](.team/reports/W1-DELIVERY.md)：能力導覽、分頁列表、typed editor、離開保護與欄位錯誤 UI。300 前端＋27 mock E2E、226 Java，以及 lint/typecheck/build/bundle/npm ci 與桌面／手機檢查通過；`VERIFIED`，PR #229 已合併。

BW1 三波 PR 的遠端 CI 與合併記錄見 [發布證據](.team/reports/BW1-PUBLICATION.md)；W1 見 [PR #229 發布證據](.team/reports/W1-PUBLICATION.md)。BW2 已於 [PR #235](https://github.com/fallrising/newclear/pull/235) 合併，並通過 [整合驗收](.team/reports/BW2-DELIVERY.md)：審計／請求發布／可指派使用者／原子批次更新／關聯摘要。254 Java、120 PostgreSQL（完整輪＋唯一變更測試類別重驗）、300 前端、27 mock E2E 與 lint/typecheck/build/bundle 通過；遠端完整 CI 亦通過，見 [合併驗證](.team/reports/BW2-PUBLICATION.md)。

個人正式使用狀態與門檻見 [個人使用驗收](docs/v2/03-personal-use-readiness.md)；有測試程式碼不等於本環境已通過驗收。

W2 已完成本地整合與驗收：媒體／關聯選擇器、預覽／修訂還原、請求發布、媒體庫，以及相簿與看板拖放。395前端測試、完整39 mock E2E、lint/typecheck/build/bundle與桌面／手機瀏覽器檢查通過。詳見 [W2交付證據](.team/reports/W2-DELIVERY.md)；已於[PR #245](https://github.com/fallrising/newclear/pull/245)通過遠端CI並合併，沒有部署。BW3會員API已於[PR #252](https://github.com/fallrising/newclear/pull/252)通過CI並合併，詳見 [BW3交付證據](.team/reports/BW3-DELIVERY.md)：本人資料讀取、草稿建立、限流及原子審計；279 Java／125 PostgreSQL／395前端／39 mock E2E通過，[發布證據](.team/reports/BW3-PUBLICATION.md)。BW4後端硬化已完成本地驗證：[審計保留、JDBC接線與重啟／回滾證據](.team/reports/BW4-DELIVERY.md)。293 Java／133 PostgreSQL／395前端／39 mock E2E及三次萬筆效能量測通過，已於 PR #258 通過遠端 CI 並合併。

W3 公開面與 W3b 會員區已分別於 PR #273／#281 合併；[W3b 發布證據](.team/reports/W3b-PUBLICATION.md)。W4 共用治理台已本地驗證：內容類型啟停、帳號與角色權限、審計／保留期限、媒體用量、緊急條目處理。624 前端／68 mock E2E 與必要本地閘門通過，待必要 CI 與合併；[W4 交付證據](.team/reports/W4-DELIVERY.md)。本波不含視覺化內容模型編輯器或自訂角色 CRUD，下一波為 W5 前端硬化，未部署。

## 需求

- JDK **25**（toolchain 釘死；不要用本機碰巧的 17/21 編譯）
- API 埠 **8080**
- 要起 API 時：本機 PostgreSQL 16，或（可選）Docker Compose

`./gradlew test` **不需要 Docker**，也不需要已啟動的 Postgres。

## 測試

```bash
./gradlew test
./gradlew integrationTest   # 需要 Docker（Testcontainers PostgreSQL 16）
npm test
npm run lint
npm run typecheck
npm run build
```

`./gradlew test` 會用 `openapi.yaml` 驗證每一個 MockMvc 回應；`./gradlew integrationTest` 對 PostgreSQL 跑同一組 store 契約測試（`src/test/.../contract/`）。兩者都是 CI 閘門。

前端閘門（v2 W0 起，不需要後端或 JDK）：

```bash
npm run lint && npm run typecheck && npm test && npm run build
npm run test:bundle
npx playwright install chromium   # 第一次
npm run e2e:mock
```

不接後端開發前端（MSW）：

```bash
npm run dev:mock -w @cms/web-front   # 5173
npm run dev:mock -w @cms/web-back    # 5174；網址加 ?mockUser=seed-operator-album 直接登入
npm run dev:mock -w @cms/web-admin   # 5175；?mockUser=seed-admin
```

情境：網址加 `?mock=slow`、`error500`、`empty`、`conflict`（`none` 恢復）。mock 登入接受任何非空密碼，`wrong-password` 除外。
後端改了 `openapi.yaml`：`npm run gen -w @cms/api`；改了 fixture：`npm run gen -w @cms/mocks`。
等價模組指令：`./gradlew :services:cms-api:test`。前端單元測試是 Vitest。

UI e2e（Playwright，需要已啟動的 Compose 三面 + API）：

```bash
docker compose -f compose.yaml up --wait --build
mkdir -p local
docker cp cms-scaffold-cms-api-1:/app/local/seed-passwords.txt local/seed-passwords.txt
npx playwright install chromium
npm run e2e   # 若本機缺 Chromium 系統庫，會改用 Playwright Docker 映像
```

若種子是共用密碼，可改設 `CMS_E2E_PASSWORD`。`npm test` 不含 e2e。

## 本機跑 API（擇一）

本機已有 PostgreSQL 16（資料庫/使用者/密碼預設 `cms`）：

```bash
export JAVA_HOME  # 指向 JDK 25
./gradlew :services:cms-api:bootRun
curl -fsS http://localhost:8080/actuator/health
```

前端（另開終端，API 需已在 8080）：

```bash
npm install
npm run dev -w @cms/web-front   # 5173
npm run dev -w @cms/web-back    # 5174
npm run dev -w @cms/web-admin   # 5175
```

有 Docker 時可用編排（檔名必須是 `compose.yaml`）：

```bash
docker compose -f compose.yaml up --wait --build
curl -fsS http://localhost:8080/actuator/health
docker compose -f compose.yaml down
```

手寫契約：[`services/cms-api/src/main/resources/openapi/openapi.yaml`](services/cms-api/src/main/resources/openapi/openapi.yaml)。公開 API 走 `/api/v1/public/**`。瀏覽器 session 只有一顆 `cms_session`。

種子帳號（username 在規格裡；**密碼不進 Git**）：

- 每人：`CMS_SEED_PASSWORD_<USERNAME>`（username 大寫，`-` → `_`）
- 共用：`CMS_SEED_PASSWORD`（僅非 prod）
- 若皆未設：啟動時寫入 gitignore 的 `local/seed-passwords.txt`（mode 0600）

Demo 種子（無密碼、無 demo 專用表）：

- 相簿：公開 `coast-light-2026`（6 張）、草稿 `private-studio`、已發布 unlisted `unlisted-proof`
- 診所：`clinic_profile` slug `home`；James Carter / Helen Leary 公開，Linda Douglas 草稿；飼主不可匿名讀
- 專案：公開 `cms-scaffold`、private `internal-ops`、draft `draft-lab`；issue 對匿名 403

既有資料庫升級應保留 volume 並由 Flyway 執行新增 migration；先備份 PostgreSQL 與媒體並驗證可還原。`docker compose down -v` 會刪除資料卷，只可用於明確可丟棄的 demo 資料，不能當成正式資料的升級方式。

BW5 開放問題收尾已於 PR #267 合併：帳號 404、媒體錯誤碼與既有 W2 同步、管理輸入驗證、公開關聯依已發布副本篩選、公開／會員整頁媒體解析。339 Java／140 PostgreSQL／395 前端／39 mock E2E、三輪效能與獨立審查通過；[交付證據](.team/reports/BW5-DELIVERY.md)。必要遠端 CI 與遠端結果已核對，未部署。

W3 公開面已完成本地驗收：相簿／相片燈箱、診所／獸醫、專案／里程碑，並補手機導覽、安全 Markdown、SEO 與載入／空／錯誤狀態。339 Java／473 前端／60 mock E2E 通過；Front 直接依賴宣告後另通過乾淨安裝及 119 項 API／Front 回歸。[交付與驗收證據](.team/reports/W3-DELIVERY.md)。待必要遠端 CI 與合併，未部署。
