# 010：媒體附件任務樹

> 原則：每個階段獨立 commit 並推送；行為變更遵循 RED → GREEN → REFACTOR。
> 共 6 階段、18 個可驗證任務、54 個孫任務。
> Completion checkpoint：6/6 階段、18/18 任務、54/54 孫任務完成；delivery-head CI 已通過，
> final-head 與 post-merge `master` gate 由交付流程及 final handoff 固化。
> REWORK 1 已併回：必要 `timelineEntryId`、UUID key、immutable media-ID URL、`image-<id>.jpg|png`
> disposition、內部 lowercase 64-hex SHA-256、byte-oriented `MediaStorage`（不洩漏 `Path`）、
> 兩支 `consumes` `@PostMapping`、`VALIDATION_FAILED` vs `MALFORMED_REQUEST` 分流、
> `handleMissingServletRequestPart`/type-mismatch、resolver 5MiB/6MiB 與 bounded read、
> cascade 只刪 metadata 不刪 bytes、ImageIO dimension-before-decode。

## A：規格與媒體契約

- [x] **A.1 盤點現況**
  - [x] A.1.1 盤點 posts schema、`CreatePostRequest`/`Post` JSON（含 required
    `timelineEntryId`）、V8→V9 migration extension points 與 `APP_DB_PATH`/volume 現況。
  - [x] A.1.2 盤點 multipart/validation/error/security patterns（Bean Validation 的
    `VALIDATION_FAILED` vs `MALFORMED_REQUEST`、type-mismatch `postId`→`INVALID_POST_ID`）、transaction 邊界與
    Dockerfile/deploy volume 可擴充點。
  - [x] A.1.3 盤點 frontend `Composer`/`PostCard`、`api/posts.ts`、`types/post.ts` 與既有
    precheck/preview/optimistic patterns。
- [x] **A.2 定義 API/data contract**
  - [x] A.2.1 定義 `multipart/form-data` POST /api/posts：兩支 `consumes` `@PostMapping`
    handler；required JSON `post` part（`CreatePostRequest`）+ required `image` part；JSON
    分支不變。
  - [x] A.2.2 定義 nullable `Post.image` JSON shape（`{id,url,contentType,width,height,
    byteSize}`，不含 sha256/storage key）、immutable media-ID URL 與 `GET
    /api/media/{positive-id}` read/cache/`image-<id>.jpg|png` disposition contract。
  - [x] A.2.3 定義 V9 `post_images` one-to-one schema、FK cascade（只刪 metadata）、unique
    post_id/storage_key、strict type/size/dimension/pixel checks、內部 lowercase 64-hex
    SHA-256；SQLite 不存 blob。
- [x] **A.3 定義 storage/atomicity/BDD/gates**
  - [x] A.3.1 定義 byte-oriented `MediaStorage` interface（`store(bytes, ext)`、
    `read(key)`、`delete(key)`，不洩漏 `Path`）+ local adapter temp+atomic move、
    server-generated UUID keys、strict key grammar、symlink/path-escape defense、
    crash-gap limitation。
  - [x] A.3.2 定義 BDD 情境（create/content/JSON legacy/untrusted input/too large/read/
    not-found-vs-corrupt（byte length/SHA）/atomic/cascade-metadata-only/repost-search/UI/
    V8→V9）。
  - [x] A.3.3 定義 resolver limits（max-file 5 MiB、max-request 6 MiB）、bounded read、
    RED/GREEN、full backend、zero-warning frontend、Docker、clean V1–V9 與 populated
    V8→V9、final-head/post-merge CI gates。

## B：V9 migration 與 metadata repository

- [x] **B.1 RED — Migration contract**
  - [x] B.1.1 測試 empty database 建立 `post_images`（one-to-one UNIQUE post_id、UNIQUE
    storage_key、FK cascade）與 `PRAGMA integrity_check`。
  - [x] B.1.2 測試 populated V8 upgrade 保留 accounts/posts/replies/likes/reposts/
    notifications 的 count/IDs/timestamps 且 `post_images` 為空。
  - [x] B.1.3 測試 migration 原子性、`flyway_schema_history` 一致與 strict CHECK（含 64-hex
    lowercase sha256）拒絕非法值。
- [x] **B.2 RED — Metadata repository contract**
  - [x] B.2.1 測試 `PostImageRepository` insert/findPositiveId/findByPostId round-trip 與
    byteSize/寬高/contentType/sha256 一致。
  - [x] B.2.2 測試 post 直接刪除時 `post_images` metadata row 一併刪除（FK cascade 只刪
    metadata，無孤兒 metadata；filesystem bytes 不受 DB 影響）。
  - [x] B.2.3 測試 strict CHECK constraints（content_type、5 MiB、1–4096、12,000,000
    pixels、sha256 grammar）拒絕非法值。
- [x] **B.3 GREEN/REFACTOR — V9 schema + repository**
  - [x] B.3.1 新增 immutable `V9__add_post_images.sql`（one-to-one + cascade + strict checks
    + sha256 column）。
  - [x] B.3.2 實作 `PostImageRepository`（JdbcClient insert/lookup，無刪檔方法）。
  - [x] B.3.3 執行 focused migration/metadata 與完整 backend regression。

## C：Image validation 與 MediaStorage adapter

- [x] **C.1 RED — ImageValidator contract**
  - [x] C.1.1 測試 declared vs detected type 一致：JPEG `FF D8 FF`、PNG
    `89 50 4E 47 0D 0A 1A 0A`、`ImageIO` format 交叉比對、mismatch → `INVALID_IMAGE`。
  - [x] C.1.2 測試 5 MiB bounded read、width/height 1–4096、pixels ≤ 12,000,000、pixel
    bounds 在全幅 allocate 之前檢查、truncated/corrupt `ImageIO` decode reject。
  - [x] C.1.3 測試 invalid image → `INVALID_IMAGE`、too large → `IMAGE_TOO_LARGE`、
    sha256（lowercase 64-hex）/byteSize/寬高由 server 測量、validator 不寫檔、不碰 DB、
    不洩漏內部路徑。
- [x] **C.2 RED — MediaStorage/local adapter contract**
  - [x] C.2.1 測試 server-generated UUID storage_key、key grammar、路徑鎖在
    `${APP_MEDIA_PATH}` 之下、永不使用 client filename。
  - [x] C.2.2 測試 byte-oriented `store/read/delete`（不洩漏 `Path`）、temp+atomic move
    （final 存在性、可讀、byteSize/contentType/寬高/sha256 與 metadata 一致）。
  - [x] C.2.3 測試 symlink/path-escape（absolute、dot segment、separator、grammar 外 key
    與 symlink final target）拒絕、corrupt/missing file 行為與 compensating delete。
- [x] **C.3 GREEN/REFACTOR — Validator/storage wiring**
  - [x] C.3.1 實作 `ImageValidator`（dimension-before-decode、signature + `ImageIO`、
    dimension/pixel/byteSize/sha256）。
  - [x] C.3.2 實作 `MediaStorage` interface + `LocalMediaStorage`（server UUID key、
    key grammar、temp+atomic move、guarded resolve、byte-oriented read/delete）。
  - [x] C.3.3 執行 focused validator/storage 與完整 backend suite。

## D：Multipart create 與 media read HTTP API

- [x] **D.1 RED — CreatePost multipart contract**
  - [x] D.1.1 測試 multipart POST /api/posts（`consumes=multipart/form-data` handler）：
    required JSON `post` part + `image` part 成功回 201 且 Post 含 non-null image object。
  - [x] D.1.2 測試 multipart 缺 `post`/`image` part（→`MALFORMED_REQUEST`，含
    `handleMissingServletRequestPart`）、`post` JSON malformed → `MALFORMED_REQUEST`；`post`
    內容不合規 → `VALIDATION_FAILED`；JSON handler 行為不變。
  - [x] D.1.3 測試 image too large（service-level bounded read 與 multipart resolver
    rejection `MaxUploadSizeExceededException`）統一 `413 IMAGE_TOO_LARGE`，不變成 500；
    resolver max-file 5 MiB / max-request 6 MiB。
- [x] **D.2 RED — Media read/security/cache contract**
  - [x] D.2.1 測試 `GET /api/media/{id}`：metadata lookup first、serving 前 byte length 與
    SHA-256 驗證、canonical type/length、`inline; filename="image-<id>.jpg|png"`、200。
  - [x] D.2.2 測試 invalid media ID（type mismatch 與 ≤0）→ `INVALID_MEDIA_ID`、metadata
    缺失 → 404 `MEDIA_NOT_FOUND`、storage missing/byte length 或 SHA mismatch/corrupt →
    500 `INTERNAL_ERROR`（log 完整，body 無內部細節）。
  - [x] D.2.3 測試 `Cache-Control: public, max-age=31536000, immutable`、public matcher 不擋
    anonymous、create 的 authenticated+CSRF 不變、public JSON 不含 sha256/storage
    key/client filename。
- [x] **D.3 GREEN/REFACTOR — Service/controller wiring**
  - [x] D.3.1 實作 `PostService` multipart create（validate→bounded read→write→post+metadata
    單一 transaction→compensating delete）與 media read service（length+SHA 驗證）。
  - [x] D.3.2 實作兩支 `consumes` `@PostMapping` handlers、`MediaController`、新增
    `ApiErrorCode`（`INVALID_IMAGE`、`IMAGE_TOO_LARGE`、`INVALID_MEDIA_ID`、
    `MEDIA_NOT_FOUND`）、`handleMissingServletRequestPart`、type-mismatch `mediaId` 與 cache
    header。
  - [x] D.3.3 執行 focused create/read/security/error 與完整 backend suite。

## E：Frontend media compose 與 rendering

- [x] **E.1 Typed contract 與 composer precheck**
  - [x] E.1.1 `types/post.ts` 新增 nullable `PostImage`（id/url/contentType/width/height/
    byteSize，不含 sha256/storage key）與 `Post.image`；`api/posts.ts` 新增 multipart create。
  - [x] E.1.2 Composer 新增 `<input type="file" accept="image/jpeg,image/png">` 與 size/type
    client precheck（5 MiB、`image/jpeg`/`image/png`）。
  - [x] E.1.3 新增可移除的 object-URL preview，移除/更換時 revoke（cleanup），提交期間
    disabled/pending。
- [x] **E.2 Create 與 PostCard 渲染**
  - [x] E.2.1 以 multipart create（FormData `post` JSON Blob + `image` File、CSRF header），
    success 後才 reset form/preview，failure 保留現況。
  - [x] E.2.2 PostCard 在所有 reuse surface（timeline/search/profile）以 responsive lazy
    `<img>` 渲染 `Post.image`。
  - [x] E.2.3 產出 author-based alt text、無 client path、載入失敗/無圖 graceful 降級不破
    layout；server 維持 authoritative。
- [x] **E.3 Interaction/gate**
  - [x] E.3.1 Create 失敗顯示受控 error、不 reset、不產生 orphan blob；submit pending 期間
    不重送。
  - [x] E.3.2 既有 authenticated reply/like/repost/search 行為維持；repost/search 顯示
    original image 而不重複儲存。
  - [x] E.3.3 執行 frontend oxlint 0 warnings、TypeScript 與 production build。

## F：文件與整合交付

- [x] **F.1 開發/營運文件**
  - [x] F.1.1 記錄 multipart create（兩支 `consumes` handler）、`Post.image` JSON、`GET
    /api/media` 契約與 4 個新 error codes。
  - [x] F.1.2 記錄 V9 upgrade/backup/rollback：stopped SQLite + media directory 單一 release
    snapshot、`APP_MEDIA_PATH`、cascade 只刪 metadata、crash-gap stopped-app
    reconciliation/runbook。
  - [x] F.1.3 更新 architecture、development、roadmap、Dockerfile/deploy（`APP_MEDIA_PATH`、
    read-only root FS、單一 `/data` volume）與 SDD evidence。
- [x] **F.2 Production-like validation**
  - [x] F.2.1 Docker multi-stage build 與 clean V1–V9、populated V8→V9 migration（count/ID
    preservation）。
  - [x] F.2.2 Runtime 驗證真實 multipart upload、binary read（含 byte length/SHA 驗證）、
    restart persistence、immutable cache 與 413/error paths。
  - [x] F.2.3 Runtime 驗證 rollback（DB+media snapshot 還原）/path 限制與 browser UI（file
    precheck、preview/cleanup、lazy image、alt）。
- [x] **F.3 CI 與交付**
  - [x] F.3.1 推送所有階段 commits 並維護 draft PR。
  - [x] F.3.2 GitHub Actions final head 全綠（completion checkpoint 本身仍須通過才可 merge）。
  - [x] F.3.3 Post-merge `master` CI 為必要 merge gate；URL 與最終結果固化於 final handoff。
