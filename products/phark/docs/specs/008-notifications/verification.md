# SDD-008 驗證紀錄

> 狀態：Complete
> Branch：`agent/notifications`

## Checkpoints

| Commit | 範圍 |
|--------|------|
| `f805560` | Spec、design、風險與 54 項孫任務 |
| `7a93d19` | V7 migration、notification persistence/page projection 與 500-row retention |
| `4472573` | Transactional reply/like/repost event emission 與 idempotency |
| `7f6df3a` | Strict notification cursor、read-through、HTTP API 與 security/cache contract |
| `d6cfeb0` | Typed notification client、badge/session state、route、page 與 interactions |
| `30690c8` | Notification API、architecture、migration runbook 與 roadmap 文件 |
| `e37d97f` | Production image、V6→V7 migration 與 full runtime delivery evidence |
| This checkpoint | Final SDD status、54/54 孫任務、CI evidence 與 merge gate |

## Inherited baseline

- Base merge：`62f470c319d772649f27a330f2f4fa73b96f894b`（SDD-007 merged）。
- SDD-007 final documentation head `4a63b03` 的 GitHub Actions run `33655201659` 通過。
- SDD-007 delivery gate：201 backend tests、frontend lint/TypeScript/Vite、V1–V6 migrations、
  Docker build 與 clean/populated runtime smoke 均通過。

## Required gates

| Gate | 狀態 | 證據 |
|------|------|------|
| V7 migration/repository tests | 通過 | 11 tests；0 failures、0 errors、0 skipped |
| Transactional event emission tests | 通過 | 57 focused tests；0 failures、0 errors、0 skipped |
| Notification cursor/read API/security tests | 通過 | 65 tests；0 failures、0 errors、0 skipped |
| Complete backend regression | 通過（production image） | 257 tests；0 failures、0 errors、0 skipped |
| Frontend lint/build | 通過（production image） | oxlint 0 diagnostics、TypeScript/Vite；1,864 modules |
| Multi-stage Docker build | 通過 | 257 backend tests、frontend lint/build、non-root image `sha256:e5410cdd...cf487` |
| Production-like runtime smoke | 通過 | clean/populated migration、two-viewer events、500-row retention、read/security/cache/SPA |
| GitHub Actions delivery head | 通過 | `e37d97f` CI run `33668734684`；job `100376785263` |

完成時記錄 exact commands、RED failures、test counts、image digest、runtime scenarios、workflow
run/job URL 與 commit SHA；未實際執行的 gate 不標記為通過。

## Decision evidence

- 主代理盤點確認：owned reply/like/repost actor 都來自 authenticated principal；post owner 是
  nullable internal account ID，legacy owner null。
- Like/repost repository 已使用 `ON CONFLICT DO NOTHING`，但目前回 `void`；最小改動是回
  affected-row boolean，讓 transaction 只在真正 insert 時產生事件。
- Reply service 尚無 transaction，like/repost service 已有；REPLY 需要補 transactional boundary。
- 現有 public `GET /**` security matcher 先匹配所有 GET；notification GET 的 authenticated
  matcher 必須排在它之前。
- 選擇保存事件而非讀取時動態 UNION：取消 interaction 不應刪歷史通知，且 unread high-water
  需要 immutable event ID。
- 選擇 recipient-scoped synchronous 500-row prune：現階段不引入 scheduler/queue，並讓讀取、
  分頁與未讀成本有 hard bound。
- OpenCode 的 DeepSeek V4 Flash model ID 已確認為 `opencode-go/deepseek-v4-flash`；初次實測
  被中國託管 opt-in gate 擋下。使用者完成 workspace opt-in 後，以精確 `run -m` 形式成功
  執行 B.2 RED 與 B.3 GREEN 任務。
- OpenCode 唯讀 inventory 確認 V7、三個 service mutation points、獨立 cursor codec、header /
  App route 與 migration/contract test locations；其四個建議經主代理審查後未採用：通知不按
  unread-first 排序（會破壞穩定 ID keyset）、read endpoint 使用 monotonic PUT 而非 PATCH、
  actor/content 讀 current joined data 而不新增 snapshot duplication，且 LIKE/REPOST 不加永久
  `(post, actor, type)` unique（否則取消後重做無法產生新事件）。冪等性由 active relation 的
  affected-row signal 保證。

## Planned exact gates

```text
mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest,NotificationRepositoryTest test
mvn -f backend/pom.xml -B -Dtest=NotificationEventContractTest,PostLikeMutationContractTest,PostRepostMutationContractTest,ReplyControllerTest test
mvn -f backend/pom.xml -B -Dtest=NotificationCursorCodecTest,NotificationRepositoryTest,NotificationReadRepositoryTest,NotificationControllerTest,AuthSecurityContractTest test
mvn -f backend/pom.xml -B test
npm run lint
npm run build
docker build -t phark:sdd008 .
bash -n /tmp/phark-sdd008-runtime.sh && /tmp/phark-sdd008-runtime.sh
```

Host 若仍無 JDK，使用 repository Dockerfile 或 pinned Maven container；Node 沿用 repository
已使用的 nvm/npm。不得以 mock 取代 SQLite migration/transaction 與 production wiring evidence。

## Persistence checkpoint evidence

- Migration RED 經主代理把 OpenCode 初稿的重複 scenarios 合併回既有 upgrade contracts；
  `SchemaMigrationConfigTest` 8 tests 中 7 個如預期只因 history 停在 V6 而失敗，unknown schema
  fail-closed test 保持通過。
- Repository RED：新增 `NotificationRepositoryTest` 後 test compilation 產生 39 個預期
  `cannot find symbol`，只指向尚不存在的 `NotificationRepository`、`NotificationType` 與
  `NotificationItem`。
- GREEN migration 新增 immutable V7 tables、三 type/reply-shape checks、reply uniqueness、五個
  cascade FKs 與 recipient/ID index；empty、V3/V4/V5/V6、兩種 pre-Flyway legacy paths 都到
  V7，既有資料與 IDs 保留且不回填通知。
- Repository `insertAndPrune` 回 generated event ID，保留每個 recipient 最新 500 rows；
  `findPage` 以單一 parameterized JOIN 回 current actor/post/reply content、read flag 與 strict
  ID-desc/before page。另一 recipient 不受 prune 影響。
- 初次 GREEN 暴露 sqlite-jdbc nullable `reply_id` mapping 問題；改用 `getLong` 並立即保存
  `wasNull()`，避免後續 getter 覆寫 JDBC null state。
- Focused：
  `mvn -f backend/pom.xml -B -Dtest=SchemaMigrationConfigTest,NotificationRepositoryTest test`
  → 11 tests 通過（8 migration + 3 repository）。
- Regression：`mvn -f backend/pom.xml -B test` → 205 tests 通過。
- Host 無 JDK；以上 commands 在 `maven:3.9-eclipse-temurin-17` container 執行。
- B checkpoint 當時尚未接 event services、read cursor/API 或 frontend；各行為只在對應階段
  完成後標記通過，不把 repository projection 誤報成可用 HTTP behavior。

## Transactional event checkpoint evidence

- RED test class 刻意沒有 `@Transactional`，避免 test transaction 掩蓋 production boundary；
  初次 4 tests 中 3 個如預期失敗：Bob page 為空、首次 LIKE event ID 為 null，以及 abort
  trigger 下三種來源 mutation 都錯誤地成功並各留下 1 row。Self/legacy scenario 先通過，GREEN
  wiring 後才成為有效 guard regression。
- `PostLikeRepository.like` 與 `PostRepostRepository.repost` 回 affected-row boolean；重送 active
  PUT 的 database conflict 回 false，因此不建立第二個 event，也不 read-before-write。
- `PostRepository.findAuthorAccountId` 是 nullable internal lookup，沒有把 owner account ID 加進
  public Post JSON。三個 service 都跳過 null owner 與 self actor。
- `ReplyService.createReply` 新增 production `@Transactional`；like/repost 沿用既有 transaction。
  Source insert、notification insert 與 prune 共用同一 boundary，unlike/unrepost 不刪歷史事件。
- 真實 SQLite `BEFORE INSERT ... RAISE(ABORT)` trigger 驗證 REPLY/LIKE/REPOST notification
  failure 都拋出 `DataAccessException`，且 reply/relation row 各為 0；trigger 在 finally 移除。
- Lifecycle 驗證首次 PUT 通知、重送不重複、取消後歷史仍在、重做產生較大新 event ID，active
  relation count 仍為 1。
- Focused：event、reply/like/repost mutation 與 repositories 共 57 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 209 tests 通過。
- Host 無 JDK；以上 commands 在 `maven:3.9-eclipse-temurin-17` container 執行。
- C checkpoint 尚未公開 notification read endpoint；外部 viewer 仍無法讀通知，D 階段才新增
  authenticated cursor/unread API 與 security/cache contracts。

## Read/unread API checkpoint evidence

- Cursor/read RED 首次 focused compile 只缺少計畫中的 `NotificationCursor`、
  `NotificationCursorCodec`、`NotificationSummary`、`NotificationReadRepository` 與
  `findSummary(long)` symbols。OpenCode 初稿的 lookahead boundary 會跳過一筆，主代理拒絕後
  修正為 repository 接收 `pageSize + 1`、next cursor 指向最後一筆 delivered row；25 筆 traversal
  精確 newest-to-oldest 且無缺漏/重複。
- Strict cursor 固定 `id=91` token 為 `MTo5MQ`，拒絕 padding、illegal alphabet、malformed UTF-8、
  wrong version/shape、非正數、sign/leading zero/whitespace、overflow、timeline legacy 與解碼相同但
  re-encode 不 canonical 的 `MTo5MR`。
- Summary/read repository 驗證 empty/read flags、retained unread count、monotonic max、recipient
  isolation 與第 501 筆 prune 後 ownership。GREEN review 額外發現 zero retained rows 會遺失既有
  high-water；新增 regression 先得到 `expected: 100L but was: 0L`，再改用 recipient/read-state
  rooted CTE，保留可指向已 prune/cascade ID 的 read-through。
- HTTP/security RED：`NotificationControllerTest` 13 cases 中 12 個因 endpoint/matcher 未存在而
  取得 404（預期 200/400/401），既有 CSRF rejection case 先通過。GREEN 後 13/13 通過，涵蓋
  current-content projection、global latest/unread、strict paging、read lifecycle、other-account paging
  boundary、owned read cursor、RFC problem codes、anonymous matcher ordering、CSRF 與 private no-store。
- `NotificationService` 以 read-only transaction 組合 summary 與 `limit + 1` page，以 write
  transaction 原子驗證 owned retained cursor、monotonic upsert 並重算 unread；public JSON 只使用
  camelCase cursor strings，不暴露 internal account ID。
- Focused：cursor/repository/read/API/security 共 65 tests 通過。
- Regression：`mvn -f backend/pom.xml -B test` → 257 tests 通過。
- Host 無 JDK；以上 commands 在 `maven:3.9-eclipse-temurin-17` container 執行。

## Frontend notification center checkpoint evidence

- 新增 readonly notification item/page/read state types 與 same-origin GET/PUT client；PUT 沿用共用
  in-memory CSRF boundary，不在 feature code 複製 token 或 credential handling。
- App 在 session identity success 與 account transition 取得第一頁 summary；anonymous/logout path
  立即以 empty state 取代前一帳號資料且不呼叫 notification API。每次 refresh 增加 request version，
  account switch、route refresh 或 logout 後的舊 response 不得更新新 viewer state。
- `/notifications` 支援 direct/load/popstate client route，進入時 refresh。Authenticated header 顯示
  Notifications control，unread > 0 顯示 accessible badge，視覺值上限 `99+`；anonymous 不顯示 badge
  且 page 提供 sign-in action。
- NotificationView 顯示 REPLY/LIKE/REPOST attribution、current post/reply content、timestamp 與可見
  Read/Unread 狀態；loading、empty、error、Load more 與 disabled/pending Mark all read 都有明確 UI。
- Pagination 保存 opaque cursor、用 notification ID append/dedup，且以 request version 拒絕 stale
  response。Mark-all-read 只送 latest cursor；成功套用 server unread/read-through 並標示所有已載入
  items read，失敗只更新 error/pending，保留既有 items 與 unread badge。
- OpenCode DeepSeek V4 Flash 分別產生 typed API 與 presentational view 初稿；主代理要求 mark-read
  zero-unread 狀態由 hidden 改為 rendered-disabled 後才接受，App/session/state wiring 由主代理完成。
- `npm run lint` → 通過。
- `npm run build`（`tsc -b && vite build`）→ 通過；Vite 轉換 1,864 modules，產出 production assets。
- Production browser/session behavior 尚需 F 階段 Docker runtime smoke，不以靜態 build 取代。

## Production image checkpoint evidence

- `docker build --progress=plain -t phark:sdd008 .` 通過：frontend `oxlint` 檢查 26 files，
  0 warnings / 0 errors；TypeScript/Vite production build 轉換 1,864 modules；Maven 完整
  backend suite 257 tests，0 failures / 0 errors / 0 skipped。
- Build 內 migration suite 驗證 7 個 immutable migrations，包含 empty、populated
  V3/V4/V5/V6 與 pre-Flyway legacy paths；populated V6 只套用 V7。
- Production image ID：
  `sha256:e5410cdd7947ab5ac37719e43138b4878a60515f1c8870750ddd9ed8383cf487`；
  runtime user `10001:10001`，entrypoint `java -jar /app/app.jar`。

## Production-like runtime checkpoint evidence

Image `phark:sdd008` 以 `SPRING_PROFILES_ACTIVE=prod`、`SESSION_COOKIE_SECURE=false` 在
loopback 上執行。驗證使用真實 Docker runtime、SQLite file、HTTP cookie jar 與 CSRF
token，沒有以 mock 取代 production wiring。

- Clean database：從 empty schema 套用 V1–V7，health `UP`；停止後
  `PRAGMA integrity_check=ok`、latest version 7、9 筆 seed posts、0 notifications 與 0 read
  states。Anonymous notification GET 回 `401 AUTHENTICATION_REQUIRED`；direct
  `/notifications` 回 production SPA shell，bundle 含 Notifications UI 與 `99+` badge cap。
- Populated upgrade：先以 `phark:sdd007`（image
  `sha256:cd304bfca3f6e626af6c1afd116991d33ebfe12f60ad9c765ad2b18717110c56`）
  產生真實 V6 database：2 accounts、10 posts、Bob-owned target post、Alice like/repost。
  `phark:sdd008` 原地啟動後只套用 V7，health 回 `UP`、integrity `ok`；accounts/posts
  counts 與 target post ID 保留，preexisting like/repost relations 仍存在，新 tables 為空，
  `idx_notifications_recipient_page` 存在，證明 no-backfill。
- Event lifecycle：V6 已存在 relation 的重送 PUT 不回填通知；Alice 先移除後對
  Bob 原文 reply/like/repost，Bob 收到 ID-desc `REPOST, LIKE, REPLY`三筆，
  `unreadCount=3`，Alice 為 0。重送 like/repost 不重複；Bob self 與 Alice 對
  legacy owner-null 文章的三種互動都成功但不通知。
- Cancellation：Alice unlike/unrepost 後舊三筆仍在；再 like/repost 後新增不同
  IDs，Bob 共 5 筆未讀。
- Cursor/read/security：`limit=2` 三頁精確讀完 5 筆，無重複，各頁 global
  latest/unread 一致；notification GET 含 `Cache-Control: private, no-store`。缺 CSRF
  的 read PUT 回 `403 CSRF_TOKEN_INVALID`，Bob 使用 Alice cursor 回
  `400 INVALID_CURSOR`，兩條路徑後仍為 5 未讀。Bob 以 latest cursor 標記後
  unread 為 0 且 items 皆 read，再送舊 cursor 時 read-through 仍為 `MTo1`。
- Retention：以公開 unlike/like lifecycle 再產生 496 筆真實 events；Bob 原本 5 筆
  加新事件共 501，production transaction prune 後分 5 頁精確遍歷 500 個唯一
  IDs，最舊 Bob event 已刪除，`unreadCount=496`。Alice 的 1 筆通知不受影響；
  停止後 database integrity 仍為 `ok`，Bob/Alice retained counts 為 500/1，read state
  已持久化。
- 第一次 populated harness 在容器間使用一般 host SQLite connection 做只讀檢查，
  但該 connection 建立了 host-owned WAL/SHM，使下一個 UID 10001 container 以
  `SQLITE_READONLY` 拒絕；這是 smoke harness 權限副作用，不是 migration failure。修正為
  container 停止後使用 immutable read-only inspection，並從全新 temp directory 重跑上述
  完整流程後通過。

## GitHub delivery checkpoint evidence

- Runtime evidence checkpoint `e37d97f821e34152831f827dee8668993f667c31` 已 push 至
  draft PR #8，所有前置 stages 也保持獨立 commits。
- GitHub Actions CI run `33668734684` 在該 head 通過；`Build container image` job
  `100376785263` 於 1m11s 完成。詳情 URL：
  `https://github.com/fallrising/phark/actions/runs/33668734684/job/100376785263`。
- 本 completion checkpoint 只固化狀態、任務與上述已通過 evidence；push 後仍必須
  等 PR head 自身的同一 CI workflow 通過，才將 PR 轉 ready 並 merge。
