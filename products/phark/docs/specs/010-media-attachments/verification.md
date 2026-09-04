# SDD-010 驗證紀錄

> 狀態：Complete — local/runtime 與 delivery-head gates complete；completion-head/post-merge
> gate 由交付流程及 final handoff 固化
> Branch：`agent/media-attachments`
> Base merge：`e2c8e11330628baab457269ab21425fe22b5dc16`

## Checkpoints

| Commit | 範圍 | 狀態 |
|--------|------|------|
| `cc79e32` | Spec、design、風險與 54 項孫任務 | 通過文件檢查 |
| `47c6f2c` | V9 migration、one-to-one image metadata repository | 通過 |
| `320d19c` | Bounded JPEG/PNG validation | 通過 |
| `8202c84` | Byte-only local MediaStorage、path/symlink 防護 | 通過 |
| `9c7ad2b` | Typed multipart client、preview/cleanup、lazy image rendering | 通過 |
| `79a6b5f` | File-first create、短 transaction、compensating delete | 通過 |
| `6de7cb0` | Metadata-first read、length/SHA integrity | 通過 |
| `caced7c` | Production storage config、snapshot/rollback/reconciliation runbook | 通過 |
| `c987d55` | Multipart HTTP handlers、resolver/error contract | 通過 |
| `0acdf6c` | Public API、development、architecture 文件 | 通過 |
| `b48bda9` | Public media GET、headers/cache/security contract | 通過 |
| `56a187a` | Production image、V7→V8→V9、API/search/restart/rollback/browser evidence | 通過 |

Completion checkpoint 完成 6/6 stages、18/18 tasks、54/54 subtasks。Delivery-head CI 已通過；
completion-head 與 post-merge `master` gates 仍是 merge 的硬條件，結果由 final handoff 固化。

## Required gates

| Gate | 狀態 | 證據 |
|------|------|------|
| V9 migration/metadata tests（含 SHA-256 CHECK） | 通過 | focused 52；0 failures/errors/skipped |
| ImageValidator tests | 通過 | focused 33；0 failures/errors/skipped |
| LocalMediaStorage tests | 通過 | focused 30；0 failures/errors/skipped |
| Create transaction/read integrity tests | 通過 | focused 15 + 9；0 failures/errors/skipped |
| Multipart/error HTTP tests | 通過 | focused 56；0 failures/errors/skipped |
| Media GET/service/error tests | 通過 | RED 7/7 expected 404；GREEN focused 42 |
| Complete backend regression | 通過（host gate + production image） | 529 tests；0 failures/errors/skipped |
| Frontend lint/build | 通過（host gate + production image） | oxlint 0 warnings/errors；Vite 1,866 modules |
| Multi-stage Docker build | 通過 | image `sha256:6142ebd446ba3e428231d952a5e9bc8b06fe1d75753609a6650f77b8e401e926` |
| Production-like runtime | 通過 | populated V7→V8→V9、upload/read/errors/search/restart/corrupt/rollback/browser |
| GitHub Actions delivery head | 通過 | [run 33789175602](https://github.com/fallrising/phark/actions/runs/33789175602)；[job 100761291430](https://github.com/fallrising/phark/actions/runs/33789175602/job/100761291430) |
| GitHub Actions completion head | pending | completion checkpoint push 後執行 |
| GitHub Actions post-merge `master` | delivery gate | merge 後執行，URL 記錄於 final handoff |

## Exact gates

```text
docker run --rm -v "$PWD":/workspace -w /workspace -v /root/.m2:/root/.m2 \
  maven:3.9-eclipse-temurin-17 mvn -f backend/pom.xml -B test
npm run lint
npm run build
docker build --progress=plain -t phark:sdd010 .
APP_IMAGE=phark:sdd010 APP_DOMAIN=example.invalid \
  docker compose -f deploy/templates/deck/compose.yml config
bash -n /tmp/phark-sdd010-runtime.sh
/tmp/phark-sdd010-runtime.sh
bash -n /tmp/phark-sdd010-runtime-browser-finalize.sh
/tmp/phark-sdd010-runtime-browser-finalize.sh
git diff --check
```

Host 無 JDK；backend commands 以 pinned `maven:3.9-eclipse-temurin-17` 執行。Node 使用既有
Node 24/npm，沒有更換 package manager、lockfile 或 production dependency。Runtime evidence
保存於 `/tmp/phark-sdd010-runtime-20260903/evidence/`，不是 repository artifact。Cookie jars
不在 evidence directory；其中 CSRF response artifacts 僅屬已停止 container 的非 production
session，runtime 完成後已失效。

## RED/GREEN 與 implementation evidence

- V9 migration/repository 的第一次 RED 在沒有 migration/table/repository 時產生預期 compile/
  schema failures；GREEN 後 root reran focused 52、當時 full 422。V9 是 immutable forward-only
  migration，既有 posts 不回填 image。
- Validator 初版因 mutable bytes、ImageIO disk cache 與 IOException public mapping 而 REWORK；
  storage 初版因 root revalidation、ancestor symlink 與 existing target 防護不足而 REWORK。
  最終 validator focused 33、storage focused 30，當時 full 438/435。
- Create transaction 初版未關閉 multipart stream；REWORK 加上 open/read/close failure regressions。
  File write 在 DB transaction 前，post+metadata 同 transaction，commit failure compensating
  delete。Root reran focused 15、full 500。
- Media read 以 positive public metadata ID lookup first，storage read 後以 actual length 與
  constant-time SHA-256 comparison 驗證，再 defensive-copy。Root reran focused 9、full 509。
- Multipart HTTP rework 補 direct `MaxUploadSizeExceededException`→413 contract、所有 rejected
  path 零 post/image rows，以及 transactional test 的 storage cleanup。Root reran focused 56、
  full 522。
- Media controller 由 root 在 worker escalation 失敗後實作：RED 時 7/7 均因 endpoint 不存在
  而回 404；GREEN 只依賴 `MediaService`，JPEG/PNG 之外 fail closed。Focused 42、最終 full 529。
- Frontend 初版因 invalid replacement 保留 stale bytes、pending controls 未全鎖、image failure
  state 未依 URL reset 而 REWORK；root reran zero-warning lint 與 production build。

## Production image evidence

`docker build --progress=plain -t phark:sdd010 .` 通過：

- Frontend stage：oxlint 檢查 28 files，0 warnings、0 errors；TypeScript/Vite production build
  轉換 1,866 modules，產出 `index-C2jxD4G7.js` 與 `index-BaqKDlRz.css`。
- Backend stage：完整執行 529 tests，0 failures、0 errors、0 skipped；驗證 9 個 immutable
  Flyway migrations。
- Local image content ID：
  `sha256:6142ebd446ba3e428231d952a5e9bc8b06fe1d75753609a6650f77b8e401e926`；本機 image
  未 push registry，因此 `RepoDigests=[]`。Runtime user 是 `10001:10001`，預設
  `APP_DB_PATH=/data/deck.db`、`APP_MEDIA_PATH=/data/media`。
- Compose render 保留 `read_only: true`、`no-new-privileges:true`、64 MiB `/tmp` tmpfs，且
  SQLite metadata 與 `/data/media` 共用單一 `/data` bind mount。

## Populated V7→V8→V9 migration evidence

同一個 bind-mounted dataset 依序由既有 `phark:sdd008`（V7）、`phark:sdd009`（V8）與
本次 `phark:sdd010`（V9）啟動；每一段都用真實 HTTP/session/CSRF 建資料，再停止 container
並用 production fat jar 內的 sqlite-jdbc 做獨立 probe。

- V7：1 account、10 posts、0 replies/likes/reposts/notifications；Flyway V7、SQLite integrity
  `ok`，且 `/api/search` 是 404。
- V7→V8 log 明確顯示 `Current version ... 7`、只套用 `8 - add post search`、now at V8。
  Core counts 與 V7 完全相同；FTS integrity `ok`，V7 建立的 `sdd010migration` post 立即可搜尋。
- V8→V9 log 明確顯示 `Current version ... 8`、只套用 `9 - add post images`、now at V9。
  Core counts 再次逐項相同；SQLite/FTS integrity `ok`、`POST_IMAGES=0`，既有 search item 的
  `image:null`，證明沒有錯誤 backfill 或破壞 V8 search。

## Runtime media/API/search evidence

- Legacy JSON create 維持 201 與 `image:null`。真實 multipart PNG/JPEG create 均為 201，
  server 測得 3×2、產生 `/api/media/1|2`，public JSON 無 storage key/SHA/client filename。
- Anonymous+valid CSRF create → 401；authenticated missing CSRF → 403；missing image part →
  `400 MALFORMED_REQUEST`；declared/detected mismatch → `400 INVALID_IMAGE`；5 MiB+1 真實
  resolver request → `413 IMAGE_TOO_LARGE`。
- Media ID 0/nonnumeric → `400 INVALID_MEDIA_ID`，missing positive ID → 404
  `MEDIA_NOT_FOUND`，traversal-shaped encoded path → 400。Problem Details 都含 request ID，
  不含內部 path/key/SHA/exception/client filename。
- PNG GET 是 77 bytes、JPEG GET 是 669 bytes；兩者均回 canonical `Content-Type`、actual
  `Content-Length`、`inline; filename="image-<id>.png|jpg"` 與精確
  `Cache-Control: public, max-age=31536000, immutable`。`cmp` 與 SHA-256 證明 upload、GET、
  restart 後 GET bytes 相同。
- Search runtime scenarios：exact `sdd010runtimepng` 回唯一 image post 且 URL 一致；
  `sdd010nomatch` 回 empty/null-cursor；operator-shaped literal `OR` 正常 200；punctuation-only
  `***` 回 `400 INVALID_QUERY`。Restart 後 exact search 仍回同一 media URL。
- Timeline、Alice profile、search 與 Bob repost profile 都回 original post 的同一 media ID；
  repost 沒有新增 metadata/bytes。

## Integrity、restart 與 rollback evidence

- Runtime 使用 read-only root FS、executable 64 MiB `/tmp` tmpfs、`no-new-privileges`、app
  UID 10001。第一次 harness 額外加 `noexec` 時 SQLite native library 如預期 fail closed；deploy
  compose 未設定 `noexec`，最終 production-like run 可健康啟動。
- Media files 維持 app-owned/private；host user 無法直接讀 mode-600 bytes。Corruption probe 由
  app UID 對已驗證的 metadata key 建暫存備份，覆寫 bytes 後真實 GET 回 redacted 500
  `INTERNAL_ERROR`；還原後 GET bytes/SHA 立即恢復。
- Stopped snapshot 同時保存 `deck.db` 與 media tar，snapshot probe 為 Flyway V9、SQLite/FTS
  integrity `ok`、2 image rows。之後新增第三個 image post（3 rows），再用 root helper container
  將 DB+media 一起還原；舊 PNG bytes 可讀，`sdd010rollbacklater` 搜尋為 empty。原 mutated state
  被移到 recoverable discard directory，沒有直接刪除。

## Headless Chromium evidence

沒有新增 frontend dependency；使用既有 pinned Playwright 1.62 package workspace（read-only）
與 `mcr.microsoft.com/playwright:v1.62.0-noble` 跑 production bundle。最終真實 browser run：

- JPEG/PNG type 與 5 MiB client precheck、preview 顯示/Remove、每個 object URL revoke 全通過。
- Injected 500 顯示固定安全 fallback + request ID，content 與 preview 保留。
- 真實 upload pending 時 content/image/channel/submit 全 disabled；成功後 reset。
- Post image 有 author-based alt、3×2 dimensions、`loading="lazy"`、`decoding="async"`。
- Timeline、search、Alice profile 與 Bob repost profile 顯示相同 original media URL。
- Screenshot 與 browser output 位於 runtime evidence directory；browser 完成後 final DB 是
  Flyway V9、SQLite/FTS integrity `ok`、3 image rows（rollback snapshot 的 2 + browser 的 1）。

## GitHub delivery checkpoint

Draft [PR #10](https://github.com/fallrising/phark/pull/10) 的 delivery head `56a187a` 通過
[CI run 33789175602](https://github.com/fallrising/phark/actions/runs/33789175602)（
[Build container image job 100761291430](https://github.com/fallrising/phark/actions/runs/33789175602/job/100761291430)）。
本 completion checkpoint 將 6/6 stages、18/18 tasks、54/54 subtasks 與 ROADMAP 標為 complete；
它自身的 final-head CI 必須通過才可 merge。Merge 後另等 `master` workflow 通過；final-head、
post-merge run/job URL、merge SHA、remote equality 與 clean tree 記錄於 final handoff。
