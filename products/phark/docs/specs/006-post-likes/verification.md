# SDD-006 驗證紀錄

> 狀態：Complete
> Branch：`agent/likes`

## Checkpoints

| Commit | 範圍 |
|--------|------|
| `1eb20d3` | Spec、design、風險與 54 項孫任務 |
| `1530d45` | V5 migration、composite uniqueness 與 like persistence |
| `7bac5ea` | Viewer-aware timeline/profile reads 與 private cache policy |
| `e8f3abb` | Authenticated idempotent PUT/DELETE like API |
| `4411017` | Frontend optimistic interaction、reconcile 與 rollback |
| `4ab9531` | 開發/營運文件、production image 與 runtime smoke evidence |
| This checkpoint | Final SDD status、task tree、roadmap 與 CI evidence |

## Required gates

| Gate | 狀態 | 證據 |
|------|------|------|
| Focused migration/repository tests | 通過 | 8 tests；0 failures、0 errors、0 skipped |
| Focused read/API/security tests | 通過 | 31 tests；0 failures、0 errors、0 skipped |
| Complete backend regression | 通過（mutation checkpoint） | 164 tests；0 failures、0 errors、0 skipped |
| Frontend lint | 通過 | oxlint；0 warnings、0 errors、22 files |
| Frontend production build | 通過 | TypeScript project build + Vite；1861 modules |
| Multi-stage Docker build | 通過 | 164 backend tests；Vite 1861 modules；non-root production image |
| Production-like runtime smoke | 通過 | Health、SPA、two-viewer like lifecycle、anonymous/CSRF/profile isolation |
| GitHub Actions delivery head | 通過 | CI run `33618930908`；Build container image job 通過（4m02s） |

完成時記錄 exact commands、test counts、image digest、runtime scenarios、workflow run/job URL
與 commit SHA；未實際執行的 gate 不標記為通過。

## Persistence checkpoint evidence

- Baseline（production change 前）：146 tests 通過。
- RED migration：3 個既有 upgrade path 皆顯示預期的 V5 缺失。
- RED repository：test compilation 因 planned `PostLikeRepository` / `LikeState` 缺失而失敗。
- GREEN focused（含 populated V4 → V5）：
  `mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest,PostLikeRepositoryTest test`
  → 8 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 150 tests 通過。
- Host 無 JDK；以上 Maven commands 在 `maven:3.9-eclipse-temurin-17` container 執行。

## Viewer-aware read checkpoint evidence

- RED：`PostLikeReadContractTest` 4 tests / 4 expected failures；缺少 private cache directive
  與兩個 like fields，既有 ordering/cursor/replyCount assertions 已通過。
- GREEN focused：
  `mvn -f backend/pom.xml -B -Dtest=PostLikeReadContractTest,PostControllerTest,ProfileContractTest,PostRepositoryTest test`
  → 48 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 154 tests 通過。
- Anonymous、liker、non-liker、profile 與 legacy post 都由真實 SQLite relation 驗證；
  timeline/profile response 皆包含 `Cache-Control: private, no-store`。

## Mutation API checkpoint evidence

- RED：`PostLikeMutationContractTest` 10 tests 中 9 個因 route 缺失而預期失敗；
  missing-CSRF scenario 已由既有 security filter 通過。
- GREEN focused：
  `mvn -f backend/pom.xml -B -Dtest=PostLikeMutationContractTest,PostLikeReadContractTest,PostLikeRepositoryTest,AuthSecurityContractTest test`
  → 31 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 164 tests 通過。
- Contract 覆蓋 PUT/DELETE 重送、兩 actor、invalid/missing/self/legacy post、actor spoof、
  anonymous/CSRF 無副作用，以及 post timestamp/timeline membership 不變。

## Frontend checkpoint evidence

- `Post`/`LikeState` typed contract 與 PUT/DELETE client 通過 TypeScript compilation。
- Pure helpers 只保存/覆寫 like fields；rollback 不會覆蓋 concurrent replyCount 或其他 post data。
- App 以 post ID functional update 三個 feeds；ProfileView 使用同一 helper；兩者都有
  per-post in-flight guard、server reconciliation、failure snapshot rollback 與 stale-load guard。
- Direct profile load 等 identity/CSRF initialization 完成後才抓 viewer-aware posts，避免把
  authenticated viewer 誤當 anonymous。
- Production frontend target：`docker build --target frontend-build -t phark-sdd006-frontend-final .`
  → lint 0 warnings/errors；TypeScript/Vite build 通過；image
  `sha256:dd6e85445a9f28cdec75430685a510c123d595b820398d3c15054f3448f18ab0`。

## Production image evidence

- `docker build -t phark:sdd006 .` → multi-stage build 通過：frontend lint/build、
  backend `mvn test package` 與 164 tests 全綠。
- 同一 build 的 migration suite 從 empty database 套用 V1–V5，並在 populated V4
  database 套用 V5；兩者都到 schema version 5 且既有資料保留。
- Image：`sha256:f32b2042c043f2e6a191aeeed902defb89b77be8c0acc3437b123d2282f3760f`；
  runtime user `10001:10001`。

## Production-like runtime evidence

Image `phark:sdd006` 以 `SPRING_PROFILES_ACTIVE=prod`、
`SESSION_COOKIE_SECURE=false` 啟動於 loopback `18086`；測試後容器已停止，含 session
與 CSRF token 的暫存檔已刪除。

- Actuator health 回 `UP`；direct `/profiles/{handle}` 回 production SPA shell。
- Alice 註冊、登入、建立文章後，重送兩次 PUT 都回 200、count 維持 1、viewer=true。
- Bob 先看到 count 1/viewer=false；like 後 count 2/viewer=true；兩次 DELETE 都回 200，
  count 維持 1/viewer=false。
- Anonymous 帶有效 CSRF 的 PUT 回 401；Bob 缺 CSRF 的 PUT 回 403；拒絕後 count
  仍為 1，證明沒有 mutation side effect。
- Alice/Bob/anonymous timeline 與 Alice profile posts 都回一致 count；viewer state 依
  session 隔離，viewer-aware GET 都有 `Cache-Control: private, no-store`。

## GitHub delivery evidence

- Delivery evidence commit：`4ab9531d3ecab9d99533d1139d6417189fb9abc9`。
- CI workflow run：
  `https://github.com/fallrising/phark/actions/runs/33618930908` → success。
- `Build container image` job：
  `https://github.com/fallrising/phark/actions/runs/33618930908/job/100211178858` → success，
  4m02s。
- Draft PR：`https://github.com/fallrising/phark/pull/6`；final documentation head 仍須以
  同一 CI workflow 通過後才轉 ready 與 merge。
