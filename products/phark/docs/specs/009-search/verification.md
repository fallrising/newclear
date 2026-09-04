# SDD-009 驗證紀錄

> 狀態：Complete
> Branch：`agent/search`
> Base merge：`08adeabc96ae7e29a8800fe79731cd42bf846884`

## Checkpoints

| Commit | 範圍 | 狀態 |
|--------|------|------|
| `bfe00a8` | Spec、design、風險與 54 項孫任務 | 通過文件檢查 |
| `0fbf444` | V8 migration、rebuild backfill 與 trigger sync/rollback | 通過 |
| `681b3ad` | Query compilation 與 dedicated `s1:` cursor codec | 通過 |
| `5eef421` | Search repository、viewer projection 與 keyset traversal | 通過 |
| `f6077c9` | Search service/controller、security/cache/error contract | 通過 |
| `441ece1`、`2b5ac4c` | Typed client、SearchView、route/header/popstate | 通過 |
| `566e2a2` | Search API、architecture、development、migration runbook 與 roadmap 文件 | 通過 |
| `435ce81` | Production image、V7→V8、HTTP/JDBC/browser runtime evidence | 通過，含下述單一 UI limitation |
| This checkpoint | Final SDD status、54/54 孫任務、CI evidence 與 merge gate | 通過 |

完成 6/6 stages、18/18 tasks、54/54 subtasks。

## Required gates

| Gate | 狀態 | 證據 |
|------|------|------|
| V8 migration/trigger tests | 通過 | 12 tests；0 failures、0 errors、0 skipped |
| Query compile/cursor tests | 通過 | 90 tests；0 failures、0 errors、0 skipped |
| Repository tests | 通過 | 18 tests；0 failures、0 errors、0 skipped |
| Service/API/security/error tests | 通過 | 74 tests；0 failures、0 errors、0 skipped |
| Complete backend regression | 通過（production image） | 405 tests；0 failures、0 errors、0 skipped |
| Frontend lint/build | 通過（host + production image） | oxlint 0 warnings/errors；TypeScript/Vite 1,866 modules |
| Multi-stage Docker build | 通過 | image `sha256:ade26bc0d179f46ccdd03c44c3879b652d338c394b71227868d4b9e41663c2ea` |
| Production-like runtime | 通過（見 browser limitation） | clean/populated migration、FTS/trigger、query/page/auth/cache/SPA/session/interactions |
| GitHub Actions delivery head | 通過 | `435ce81` CI run `33763313507`；job `100674757694` |
| GitHub Actions completion head | merge gate | 本 completion checkpoint push 後須通過才可 merge |
| GitHub Actions post-merge `master` | delivery gate | merge 後須通過；run/job URL 記錄於 final handoff |

## Exact gates

```text
mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest test
mvn -f backend/pom.xml -B -Dtest=SearchQueryCompilerTest,SearchCursorCodecTest test
mvn -f backend/pom.xml -B -Dtest=SearchRepositoryTest test
mvn -f backend/pom.xml -B -Dtest=SearchServiceTest,SearchControllerTest,AuthSecurityContractTest,ApiErrorContractTest test
mvn -f backend/pom.xml -B test
npm run lint
npm run build
docker build --progress=plain -t phark:sdd009 .
bash -n /tmp/phark-sdd009-runtime.sh
bash /tmp/phark-sdd009-runtime.sh
bash /tmp/phark-sdd009-runtime-finalize.sh
```

Host 無 JDK；focused/full backend commands 在 pinned `maven:3.9-eclipse-temurin-17`
container 或 production Docker build stage 執行。Node 使用既有 Node 24/npm；沒有更換 package
manager 或 lockfile。Runtime evidence 保存於 `/tmp/phark-sdd009-runtime-20260903/evidence/`，
不是 repository artifact，也不含 production data 或 secrets。

## RED/GREEN 與 implementation evidence

- Migration RED 先建立 11 個 V8 schema/backfill/trigger cases；缺少 V8 時得到預期 9 failures
  與 1 error。GREEN 後主代理另加 failed-migration rollback regression，確認 search schema 與
  Flyway history 不留下半套狀態。Focused 12/12、當時 full regression 261/261。
- Query/cursor 初版因 Java whitespace 與 Unicode White_Space 不一致而 REWORK；最終使用明確
  U+0009–000D、U+0085 與 Unicode Separator 規則，U+180E 不視為 whitespace。Cursor tests
  涵蓋 malformed UTF-8、non-canonical Base64、namespace、sign/zero/leading/overflow 與 Instant
  range。Focused 90/90、當時 full 351/351。
- Repository 使用一條 parameterized `MATCH`/keyset query，mirror 既有 Post projection，limit+1
  與 `(created_at DESC, id DESC)` 遍歷；operational exceptions 不在 repository 假裝成 query
  validation。Focused 18/18、當時 full 369/369。
- Service 是 read-only transaction，只把 compiler/cursor validation 映射為
  `INVALID_QUERY`/`INVALID_CURSOR`；controller 對 nonnumeric/out-of-range limit 統一回正確
  1–50 `INVALID_LIMIT`，保留 public GET matcher 與 `private, no-store`。Focused 74/74，full
  regression 405/405。
- Frontend 新增 typed `fetchSearch`、SearchView 與 `/search` route；第一次 lint warning 與空白
  header route 落差均經 REWORK。主代理兩片各自重跑 lint/build，最終均 0 warnings，build
  轉換 1,866 modules。

## Production image evidence

`docker build --progress=plain -t phark:sdd009 .` 通過：

- frontend `oxlint` 檢查 28 files，0 warnings、0 errors；TypeScript/Vite production build
  轉換 1,866 modules，產出 `index-1QDdHMs0.js` 與 `index-CgdsnOKg.css`。
- Maven production build 完整執行 405 tests，0 failures、0 errors、0 skipped，並套用/驗證
  8 個 immutable Flyway migrations。
- Image ID：
  `sha256:ade26bc0d179f46ccdd03c44c3879b652d338c394b71227868d4b9e41663c2ea`；runtime
  user `10001:10001`，entrypoint `java -jar /app/app.jar`，預設
  `SPRING_PROFILES_ACTIVE=prod` 與 `APP_DB_PATH=/data/deck.db`。

## Clean 與 populated V7→V8 evidence

Runtime 用真實 image、bind-mounted SQLite file、HTTP cookie/session 與 CSRF；沒有用 mock
取代 migration、transaction 或 search wiring。

- Clean：empty data directory 啟動 `phark:sdd009`，V1→V8 完成、health `UP`、direct
  `/search` 回 SPA shell；停止後用 production fat jar 內同一個 sqlite-jdbc probe，得到 SQLite
  `3.53.2`、`ENABLE_FTS5`、Flyway V8、`PRAGMA integrity_check=ok`、FTS5
  `integrity-check=ok`，seed state 為 0 accounts、9 posts、0 replies/likes/reposts/notifications。
- Populated baseline：用既有 `phark:sdd008` image
  `sha256:e5410cdd7947ab5ac37719e43138b4878a60515f1c8870750ddd9ed8383cf487`
  建立真實 V7 DB：2 accounts、16 posts（含 5 個 paging targets、Unicode/prefix targets）、
  1 like、1 repost、2 notifications。V7 `/api/search` 為 404。
- Upgrade log 明確從 `Current version ... 7` 只套用 `8 - add post search`。第一次 V8 health
  後立即停止並 probe：accounts/posts/replies/likes/reposts/notifications counts 與 V7 逐項相同，
  Flyway V8、SQLite integrity 與 FTS integrity 全部 `ok`；既有 target 已可立即搜尋，證明
  migration-time rebuild backfill。

## Runtime search/API evidence

- Anonymous `q=sdd009alpha&limit=2` 第一頁回 2 items 與 non-null `s1:` cursor；所有
  `likedByViewer`/`repostedByViewer` 是 boolean false、`timelineEntryId=post:<id>`、repost
  attribution null，header 含 `Cache-Control: private, no-store`。
- 取得第一頁 cursor 後新增一筆 matching post，再用舊 cursor 讀 `[2,2,1]` 三頁：5 個既有 ID
  依 timestamp/id 嚴格倒序、不重複、不缺漏，新 post 不穿越既有 boundary；fresh 第一頁以
  新 post 為第一筆。
- V7 已存在的 Bob like/repost 在 V8 authenticated search 都是 true/count 1；anonymous 與
  logout 後同一 query 都回 false/count 1，證明 viewer projection、restart session 與 public
  logout fallback。
- `中文` 與 `creme`（來源為 `Crème 中文`）都可配對；`sdd009foo*` 不 prefix-match
  `sdd009foobar`，精確 term 可配對；`sdd009alpha OR nonexistent` 回空 page 而不是改變 MATCH
  結構或造成 syntax error。
- Missing/blank/punctuation-only/control/>8 terms/>100 code points 分別回 RFC 9457
  `INVALID_QUERY`；limit 0/51/nonnumeric 回 `INVALID_LIMIT`；timeline、notification、malformed
  cursor 回 `INVALID_CURSOR`。所有 Problem Details 都有 `requestId`，沒有未處理 SQLite error。
- Direct `/search?q=...` 回 production SPA，bundle 同時含 search API path 與 Load more UI。

## Runtime trigger/operational evidence

- Graceful final snapshot 為 Flyway V8、SQLite 3.53.2/`ENABLE_FTS5`、SQLite/FTS integrity `ok`。
  Disposable copy 上新增 post 可搜尋、更新後舊 token 消失/新 token 可搜尋、刪除後新 token
  消失，最後 FTS integrity 仍 `ok`。
- 另一 disposable copy 刪除 `search_posts` 但保留 posts triggers；同 transaction 先新增 account
  再新增 post 時 trigger 拋 `SQLException`，rollback 後 account/post counts 都不變。
- 缺少 FTS target 的 DB 仍可啟動且 health `UP`；真實 `GET /api/search` 回
  `500 INTERNAL_ERROR` 與 request ID，而不是錯誤映射成 `INVALID_QUERY`。Server log 保留完整
  database exception，public body 不洩漏內部細節。

## Headless Chromium evidence 與限制

為避免新增 frontend dependency，Playwright 1.62 只安裝在 `/tmp`，以既有
`mcr.microsoft.com/playwright:v1.62.0-noble` 跑 production bundle。

- 三次 sequential harness 都是測試假設修正，不是產品 request failure：第一次在 reply 已顯示
  但父 card 尚未 rerender 前同步讀 count；第二次只準備 6 筆卻期待 default page size 20 出現
  Load more。最終 fixture 改為真實 API 建立 21 筆，第三次執行已依序通過其前置 assertions：
  direct route/title/query、anonymous→Bob→logout viewer refresh、like/repost toggle+restore、reply
  create/count、blank route、back/popstate、20→21 load-more dedupe，以及 slow q1 不覆蓋 fast q2。
- 最後一個 injected 500 assertion 等待 fixture 的 `detail` 文字而逾時；事後 review 發現 fixture
  少了 frontend `ApiProblem` 必填的 `instance`，client 因此正確走 generic fallback。依「同一方法
  三次失敗即停止」規則不做第四次 browser run。SearchView error DOM 的精確 runtime 文案是唯一
  未直接證實項；production build、code review、真實 backend 400/500 error path 與其餘 browser
  states 都有 evidence。這項限制不隱藏，也不誤報為通過。

## GitHub delivery checkpoint evidence

- Runtime evidence checkpoint `435ce815aff4e5bce5a9cda855a2547c1268a83f` 已 push 至
  draft PR #9，所有前置 stages 也保持獨立 commits。
- GitHub Actions CI run `33763313507` 在該 head 通過；`Build container image` job
  `100674757694` 於 1m12s 完成。詳情 URL：
  `https://github.com/fallrising/phark/actions/runs/33763313507/job/100674757694`。
- 本 completion checkpoint 只固化狀態、54/54 任務與上述已通過 evidence；push 後仍必須
  等 PR head 自身的同一 CI workflow 通過，才將 PR 轉 ready 並 merge。Merge 後也必須等待
  `master` workflow 通過；final handoff 記錄兩次 run/job URL、merge SHA、remote equality 與
  clean worktree。
