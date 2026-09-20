# AGENTS.md

權威總綱是 `docs/sdd/00-overview.md`。不要改它的切面、技術棧、三個操作面。

## UI e2e（本波）允許寫

- `e2e/` Playwright：Front 公開相簿/診所/專案、Back 自訂視圖與登入拒絕、Admin 治理
- 指令 `npm run e2e`；不要把 e2e 塞進 `./gradlew test` 或預設 `npm test`
- 密碼只從 `CMS_E2E_PASSWORD` 或 gitignore 的 `local/seed-passwords.txt` 讀

## 自訂視圖（已完成，Back composition）允許寫

- `apps/web-back`：`album.composer` / `clinic.schedule` / `projects.board`
- 寫入只准 `PATCH` entry 與 `POST /media`；不要 `/boards`、`/albums`、`/clinic/schedule`

## Wave E（已完成，驗收）允許寫

- OpenAPI 契約與 `./gradlew test` 對齊（T-OA-01）
- 補 RBAC / Front 看不到 draft（T-RBAC-F）、軟刪後公開 404、硬刪僅 admin + audit
- 三面 `test` / `lint` / `typecheck` / `build`（Vitest，非 UI e2e）
- `README.md`、本檔

## 不要做

- GraphQL、Redis、Kafka、JWT 當正式 session
- 把 Back 與 Admin 做成一個應用
- 重寫衛星規格
- `CREATE TABLE album` 等 demo 實體表、公開靜態媒體目錄、`/albums` `/boards` 寫入 API
- 生產部署、S3、UI e2e 當閘門
- 種子明文密碼進 Git

## 釘死

- Java 25、Spring Boot 3.5+、API 埠 8080
- Session cookie：`cms_session`；公開 API：`/api/v1/public/**`
- `./gradlew test` 不需要 Docker 或已啟動的 Postgres
- 種子帳號沿用 Identity：`seed-operator-album` 等；密碼不進 Git
