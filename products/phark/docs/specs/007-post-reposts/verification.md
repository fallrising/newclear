# SDD-007 驗證紀錄

> 狀態：Complete
> Branch：`agent/reposts`

## Checkpoints

| Commit | 範圍 |
|--------|------|
| `ddf78de` | Spec、design、風險與 54 項孫任務 |
| `0b1372c` | V6 migration、repost relation persistence 與 upgrade evidence |
| `fa828b9` | Versioned cursor、mixed timeline/profile reads 與 attribution |
| `08f2853` | Authenticated PUT/DELETE repost API 與 security boundary |
| `cecab85` | Frontend attribution、optimistic interaction 與 activity refresh |
| `85b5a27` | 開發/營運文件、production image 與 runtime smoke evidence |
| This checkpoint | Final SDD status、task tree、roadmap 與 CI evidence |

## Inherited baseline

- Base merge：`5ae6c01f085e9fd04db3a7c6ffb0a5122a6c18bb`（SDD-006 merged）。
- 同一 code state 的 final PR head `b045484` 已由 GitHub Actions CI run
  `33619421434` 通過 production container build。
- SDD-006 delivery gate：164 backend tests、frontend lint/TypeScript/Vite、V1–V5
  migrations 與 Docker runtime smoke 均通過。
- SDD-007 persistence checkpoint `0b1372c` 的 GitHub Actions run `33622106948` 已通過
  production container build。

## Required gates

| Gate | 狀態 | 證據 |
|------|------|------|
| V6 migration/repository tests | 通過 | 11 tests；0 failures、0 errors、0 skipped |
| Mixed cursor/timeline/profile tests | 通過 | 55 focused tests；0 failures、0 errors、0 skipped |
| Repost API/security tests | 通過 | 26 focused tests；0 failures、0 errors、0 skipped |
| Complete backend regression | 通過（production image） | 201 tests；0 failures、0 errors、0 skipped |
| Frontend lint | 通過 | `oxlint`；0 warnings、0 errors、23 files |
| Frontend production build | 通過 | TypeScript + Vite；1,862 modules transformed |
| Multi-stage Docker build | 通過 | 201 tests；non-root image `sha256:cd304bfc...10c56` |
| Production-like runtime smoke | 通過 | clean/populated migration、two-viewer repost、cursor/security/profile/SPA |
| GitHub Actions delivery head | 通過 | CI run `33654530427`；Build container image job 通過 |

完成時記錄 exact commands、RED failures、test counts、image digest、runtime scenarios、
workflow run/job URL 與 commit SHA；未實際執行的 gate 不標記為通過。

## Decision evidence

- 主代理盤點確認：現有 timeline/profile 都只讀 `posts`，cursor 是
  `<epoch>:<positivePostId>`；frontend render/load-more 以 post ID 去重。
- OpenCode read-only inventory 確認 V6、repository/service/controller、SecurityConfig 與
  frontend optimistic helper 是主要 extension points。
- OpenCode 建議先做 count-only relation、排除 attribution/fan-out；此建議與 ROADMAP 的
  SDD-007 明確子項衝突，因此不採用。設計改為獨立 relation/event ID + mixed UNION，
  保留原文 ID 並滿足 attribution/fan-out。
- 拒絕把 repost 寫成一般 `posts` row：那會讓公開 activity ID 可被 reply/like API 當作
  原文，造成 interaction ownership 分叉。

## Planned exact gates

```text
mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest,PostRepostRepositoryTest test
mvn -f backend/pom.xml -B -Dtest=PostCursorCodecTest,PostRepostReadContractTest,PostControllerTest,ProfileContractTest test
mvn -f backend/pom.xml -B -Dtest=PostRepostMutationContractTest,AuthSecurityContractTest test
mvn -f backend/pom.xml -B test
npm run lint
npm run build
docker build -t phark:sdd007 .
```

Host 若仍無 JDK/Node，使用 repository Dockerfile 或 pinned Maven/Node container 執行，
不得以 mock 取代 mixed SQLite query 與 production wiring evidence。

## Persistence checkpoint evidence

- 規格 baseline：draft PR #7 的 CI run `33620782252` 在 commit `ddf78de` 通過
  production container build。
- RED migration：加入最初三個 V6 contracts 後，
  `SchemaMigrationConfigTest` 8 tests 中 3 個如預期失敗；Flyway history 只有 5 rows，
  證明 V6 尚不存在。
- RED repository：focused test compilation 因 planned `RepostState` 與
  `PostRepostRepository` 缺失而失敗。
- Review refactor：把重複的 empty/legacy assertions 合併回既有 upgrade tests，修正一個
  未來會重複插入既有 like 的測試資料，並新增真實 populated V3 → V6 path。
- GREEN focused：
  `mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest,PostRepostRepositoryTest test`
  → 11 tests 通過（7 migration + 4 repository）。
- Regression：`mvn -f backend/pom.xml -B test` → 170 tests 通過。
- Migration coverage 包含 empty、populated V3/V4/V5、pre-Flyway legacy、unknown schema
  fail-closed；驗證 surrogate ID、unique relation、兩個 cascade FK 與兩個 named indexes。
- Repository coverage 包含重送不 bump timestamp、重複 unrepost、two-viewer shared count /
  isolated state，以及實際刪除 account/post 的 cascade behavior。
- Host 無 JDK；以上 Maven commands 在 `maven:3.9-eclipse-temurin-17` container 執行。

## Mixed read checkpoint evidence

- Cursor RED：`PostCursorCodecTest` test compilation 因 planned `TimelineEntryKind`、三參數
  `PostCursor` 與 `entryKind()` 缺失而產生 7 個預期 compile errors。
- Read RED：`PostRepostReadContractTest` 4 tests 全部如預期失敗；response 缺少
  `timelineEntryId`，且 timeline/profile 尚未 fan-out repost activities。
- OpenCode 依委託產生 cursor tests/model 初稿與 read contract；主代理審查後補上固定
  canonical token、嚴格 UTF-8、non-canonical Base64URL cases，並修正 seed pagination、
  legacy POST boundary 與測試 timestamp 三個 false-negative。
- GREEN 以單一 parameterized `UNION ALL` query 投影 original/repost activities，按
  `(activity_at, entry_kind, entry_id)` 做 strict keyset pagination；`TimelinePost` 保存真實
  cursor tuple，public `Post.id` 仍是原文 ID。
- Query 同時回 reply/like/repost counts 與 viewer EXISTS，沒有 per-row repository call；
  channel 繼承原文，profile filter 使用 activity actor。
- Focused：
  `mvn -f backend/pom.xml -B -Dtest=PostCursorCodecTest,PostRepostReadContractTest,PostLikeReadContractTest,PostRepositoryTest,PostControllerTest test`
  → 55 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 189 tests 通過。
- Host 無 JDK；以上 Maven commands 在 `maven:3.9-eclipse-temurin-17` container 執行。

## Mutation API checkpoint evidence

- RED：`PostRepostMutationContractTest` 可編譯並執行 12 tests；10 個因 route 不存在而以
  generic 404 如預期失敗，anonymous/authenticated missing-CSRF 兩例先由既有 filter 通過。
- Review refactor：在 GREEN 前修正 DELETE 後才查已刪 relation ID、JSON camelCase 欄位，
  並把重送 timestamp 測試固定到舊時間，避免同秒 false positive。
- GREEN：新增 transactional `PostRepostService` 與 PUT/DELETE controller；positive missing、
  non-positive、self/legacy、spoofed body 與 authoritative readback 共用既有 error boundary。
- SecurityConfig 明確要求 PUT/DELETE `/api/posts/*/repost` authenticated；actor 只取自
  `AccountPrincipal`，CSRF 仍在 controller 前拒絕且資料無副作用。
- Focused：
  `mvn -f backend/pom.xml -B -Dtest=PostRepostMutationContractTest,AuthSecurityContractTest test`
  → 26 tests 通過（12 mutation + 14 security）。
- Regression：`mvn -f backend/pom.xml -B test` → 201 tests 通過。
- Host 無 JDK；以上 Maven commands 在 `maven:3.9-eclipse-temurin-17` container 執行。

## Frontend checkpoint evidence

- OpenCode 依三個 bounded slices 實作 typed API/helpers、主時間線與 profile wiring；主代理
  逐批審查，修正 failure path 錯誤 refresh，以及 refresh 期間過早釋放 per-post guard 的
  race。
- `Post`/`RepostState` 與 PUT/DELETE client 對齊 backend camelCase contract；pure helpers
  只覆寫 repost count/viewer state、count 下限為 0，並按原文 `post.id` 更新所有 copies。
- Timeline/Profile render key 與 load-more dedup 改用 opaque `timelineEntryId`；reply、like、
  repost interaction 仍按原文 ID 同步。
- `PostCard` 保留原作者/原文時間並顯示 reposter attribution/time；like/repost 共用 per-post
  guard，兩個按鈕在任一 mutation/authoritative refresh 期間都 disabled。
- Repost failure 只 rollback repost fields；mutation success 先 reconcile authoritative state，
  再刷新三欄或 profile first page。Profile refresh failure 不會把已成功的 mutation rollback。
- `source ~/.nvm/nvm.sh && npm run lint` → 通過，0 diagnostics。
- `source ~/.nvm/nvm.sh && npm run build` → TypeScript 與 Vite production build 通過，
  1,862 modules transformed。
- Repository 沒有 frontend test runner；依規格不新增 dependency，本 checkpoint 以 pure helper
  review、lint 與 production TypeScript build 驗證，runtime behavior 留在 F.2 production-like
  smoke。
- Frontend checkpoint `cecab85` 的 GitHub Actions run `33627437512` 已通過 production
  container build。

## Production image evidence

- `docker build --progress=plain -t phark:sdd007 .` → multi-stage build 通過：frontend
  `oxlint` 23 files / 0 warnings / 0 errors、TypeScript/Vite 1,862 modules，以及完整 backend
  201 tests / 0 failures / 0 errors / 0 skipped。
- Build 內 migration suite 驗證 empty、populated V3/V4/V5 與 pre-Flyway legacy paths；
  所有支援路徑都到 V6，populated V5 只套用一筆 V6 migration。
- Image：`sha256:cd304bfca3f6e626af6c1afd116991d33ebfe12f60ad9c765ad2b18717110c56`；
  runtime user `10001:10001`，entrypoint `java -jar /app/app.jar`。

## Production-like runtime evidence

Image `phark:sdd007` 以 `SPRING_PROFILES_ACTIVE=prod`、
`SESSION_COOKIE_SECURE=false` 啟動於 loopback；驗收完成後兩個 containers、兩個暫存
database directories 與只含測試密碼的 smoke script 都已移除。

- Clean database：production image 從 empty schema 套用 V1–V6、health 回 `UP`；停止後
  `PRAGMA integrity_check=ok`、latest version 6、seed posts 9、`post_reposts` rows 0。
- Populated upgrade：先以 merged SDD-006 image 建立真實 V5 database（Alice/Bob accounts、
  Bob-owned tech post 10、Alice like），再以 SDD-007 image 原地啟動；Flyway 只套用 V6，
  health 為 healthy。停止後 integrity `ok`，history V1–V6 全 success，兩個 named V6
  indexes 存在，accounts/posts/likes 分別保持 2/10/1，最終 repost relation 為 1。
- Alice 連續 PUT 得到相同 `RepostState`、count 1 且只有一筆 activity；tech timeline
  同時包含 original/repost，兩份原文 ID/author/content/like state 相同且 activity key 不同，
  home 不包含該 tech activity。Alice profile 只有自己的 repost activity，Bob profile 不會
  收到 Alice repost。
- Bob 看到 shared count 1/viewer false；self-repost 成功後 count 2，Bob profile 包含
  original + self-repost；連續 DELETE 後 count 維持 1，Alice activity 不受影響。
- Anonymous timeline 的 count/attribution 一致、viewer false 且 `private, no-store`；帶有效
  CSRF 但無 session 的 PUT 回 401，Alice 缺 CSRF 的 DELETE 回 403，兩條拒絕路徑後
  relation/count/membership 都不變。
- Tech timeline 以 `limit=1` 逐頁讀取 5 activities，所有 `timelineEntryId` 無重複，兩筆
  目標 original/repost 都出現；新 cursor 解碼 payload 以 `2:` 開頭，canonical legacy
  cursor 仍回 200。
- Alice 連續 DELETE 後 count 0、timeline 只剩 original、Alice profile activity 消失；
  再 PUT 產生新 activity key `repost:4`，不同於第一次的 `repost:1`。
- Direct `/profiles/alice007` 回 production SPA HTML shell。

## GitHub delivery evidence

- Delivery evidence commit：`85b5a27351ed9b32c437857fa9c0e3096b313023`。
- CI workflow run：
  `https://github.com/fallrising/phark/actions/runs/33654530427` → success。
- `Build container image` job：
  `https://github.com/fallrising/phark/actions/runs/33654530427/job/100329653976` → success，
  1m05s。
- Draft PR：`https://github.com/fallrising/phark/pull/7`；final documentation head 仍須以
  同一 CI workflow 通過後才轉 ready 與 merge。
