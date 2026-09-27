# CMS Scaffold

> **Portfolio doc tier: A (active)** — Runnable entry: [docs/quickstart.md](docs/quickstart.md). Policy: [docs/portfolio-doc-tiers.md](../../docs/portfolio-doc-tiers.md). Investment notes: [PORTFOLIO.md](../../PORTFOLIO.md).


可重複使用的 CMS kernel：一個 Java API、三個操作面（Front / Back / Admin）、三個 demo pack。

權威總綱：[`docs/sdd/00-overview.md`](docs/sdd/00-overview.md)。  
實作波次：[`docs/specs/90-synthesis.md`](docs/specs/90-synthesis.md) §11。  
v2（設計階段，前後端 SDD 與路線圖）：[`docs/v2/`](docs/v2/README.md)。

目前實作到 **Wave E + Back 自訂視圖**：kernel 與三面已驗收；Back 另有相簿編排、當日行程、issue 看板（寫入仍走 entry API）。

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

Compose 若沿用舊 Postgres volume、缺少新欄位或種子，先 `docker compose down -v` 再 `up --wait --build`。
