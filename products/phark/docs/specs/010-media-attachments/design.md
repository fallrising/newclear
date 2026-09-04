# 010：媒體附件設計

> 狀態：Complete（實作、local/runtime 與 delivery-head CI 已驗證）

## 邊界與資料流

```text
POST /api/posts                              (JSON handler, consumes=application/json: 既有
                                              行為不變, image=null)
POST /api/posts  multipart/form-data         (multipart handler, consumes=multipart/form-data,
                                               Session + CSRF)
  └─ createPostWithImage(accountId, CreatePostRequest, MultipartFile)
       ├─ ImageValidator:
       │    declared contentType ∈ {image/jpeg, image/png}
       │    bounded read ≤ 5 MiB                        → 413 IMAGE_TOO_LARGE
       │    magic bytes / ImageIO format 與 declared 一致
       │    ImageIO reader 先讀 width/height (getWidth(0)/getHeight(0))
       │    bounds 1..4096 且 width*height ≤ 12,000,000   → 400 INVALID_IMAGE
       │    才完整 decode (reject truncated/corrupt)     → 400 INVALID_IMAGE
       │    產出 canonical contentType, byteSize, width, height, sha256
       ├─ MediaStorage.store(bytes, validatedExtension) → storageKey
       │    server-generated UUID key, path 鎖在 ${APP_MEDIA_PATH} 之下, temp → atomic move
       └─ short SQLite transaction → insert posts → insert post_images → commit
            └─ 任一 DB/commit 失敗 → compensating delete(storageKey)
            └─ crash-gap 只可能留下無 DB row 的 private orphan (runbook 清理)

GET /api/media/{id}                           (Public, immutable cache)
  └─ MediaController → PostImageRepository.findPositiveId(id)
       ├─ metadata 不存在 → 404 MEDIA_NOT_FOUND
       ├─ read(storageKey) → 驗證 bytes.length == byte_size 且 sha256 == metadata.sha256
       │    缺失/不符/損壞 → 500 INTERNAL_ERROR + log (public body 不含內部細節)
       └─ 相符 → canonical contentType/length, filename "image-<id>.jpg|png",
            Cache-Control: public, max-age=31536000, immutable

Browser Composer
  └─ file input accept="image/jpeg,image/png" → size/type precheck
     → object-URL preview (cleanup on remove) → disabled/pending → multipart create
     → success 後 reset; failure 保留現況
PostCard (timeline / search / profile / 所有 reuse surface)
  └─ Post.image != null → responsive lazy <img> + author-based alt
```

順序保證：**image validation 與 file write 都發生在 SQLite transaction 之前**；post +
metadata 原子 commit，DB row 永不先於檔案存在。

## Schema V9

SQLite immutable migration `V9__add_post_images.sql` 支援 empty 與 populated V8 upgrade。

```sql
CREATE TABLE post_images (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id      INTEGER NOT NULL UNIQUE REFERENCES posts(id) ON DELETE CASCADE,
    storage_key  TEXT    NOT NULL UNIQUE,
    content_type TEXT    NOT NULL CHECK (content_type IN ('image/jpeg', 'image/png')),
    byte_size    INTEGER NOT NULL CHECK (byte_size > 0 AND byte_size <= 5242880),
    width        INTEGER NOT NULL CHECK (width >= 1 AND width <= 4096),
    height       INTEGER NOT NULL CHECK (height >= 1 AND height <= 4096),
    sha256       TEXT    NOT NULL CHECK (length(sha256) = 64
                                         AND sha256 = lower(sha256)
                                         AND sha256 NOT GLOB '*[^0-9a-f]*'),
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    CHECK (width * height <= 12000000)
);
```

- One-to-one：`post_id NOT NULL UNIQUE`（提供 per-post index）保證每篇 original post 至多
  一張圖片；`ON DELETE CASCADE` 讓 post 刪除自動移除 metadata row。Cascade **只作用於
  SQLite metadata**，**不會**刪除 filesystem bytes；本輪沒有 post delete endpoint，此
  約束只保護直接/未來刪除的 metadata 完整性。Unreferenced files 由 stopped-app
  reconciliation 清理。
- `storage_key NOT NULL UNIQUE` 是 server-generated UUID key，同時是 filesystem 檔名與
  DB 對應值；SQLite 只存 metadata，**不存 blob**。
- `sha256` 是**內部** column：儲存檔以相同 bytes 在 write 前計算 lowercase 64-hex
  SHA-256；strict CHECK 限定長度 64、全 lowercase 且只含 `[0-9a-f]`。`sha256` 與
  `storage_key` 永遠不出現在 public JSON。
- Strict checks：content_type 只允許偵測到的 canonical type；byte_size ≤ 5 MiB；
  width/height 1–4096；`width * height ≤ 12,000,000`。
- Migration 測試確認 empty/populated V8→V9、既有 counts/IDs/timestamps 保留、
  `post_images` 資料完整性（含 CHECK 拒絕非法 sha256）與 `PRAGMA integrity_check`。

## Image validation

`ImageValidator` 是純函式（byte input → validated metadata），在進入 storage/DB 前執行：

1. `declared`：multipart part 的 Content-Type 必須是 `image/jpeg` 或 `image/png`，否則
   `INVALID_IMAGE`。
2. Size：service 對 multipart bytes 做 **bounded read**；結果 > 5 MiB（`5242880`）→
   `IMAGE_TOO_LARGE`（413）。此檢查獨立於 resolver limit，因此 tests/adapters 直接呼叫
   service 或 bypass resolver 時仍受 5 MiB 上限保護。
3. Signature：JPEG magic `FF D8 FF`、PNG magic `89 50 4E 47 0D 0A 1A 0A`；同時以
   `ImageIO` reader 的 format name 交叉比對 declared type。mismatch → `INVALID_IMAGE`。
4. Dimensions（先於全幅 decode）：用 `ImageReader.getWidth(0)`/`getHeight(0)` 只讀尺寸；
   width/height 各在 1–4096、`width * height ≤ 12,000,000`，**pixel bounds violation 在
   allocate 全幅 BufferedImage 之前就拒絕**，避免大圖記憶體衝擊。違規 → `INVALID_IMAGE`。
5. Full decode：`ImageIO.read`（reader）**之後**必須成功取回完整 `BufferedImage`；失敗 →
   `INVALID_IMAGE`（reject truncated/corrupt input）。SVG/GIF/WebP 因 declared/detected
   不在 `{image/jpeg, image/png}`、signature 不符或 ImageIO format 不同一律 rejected。
6. 產出 canonical `contentType`、`byteSize`（實際 stored bytes，非 client 宣告）、
   `width`、`height` 與 `sha256`（stored bytes 的 lowercase 64-hex SHA-256），供 metadata
   row、disposition filename 與 response。**Stored bytes 是 original validated bytes**，
   不 re-encode、不重新壓縮。

Validator 只回傳驗證結果或明確的 `ApiErrorCode`，不寫檔、不碰 DB。

## MediaStorage interface 與 local adapter

**Byte-oriented boundary，永不從介面洩漏 `Path`。**

```java
public interface MediaStorage {
    String store(byte[] data, String validatedExtension); // temp write + atomic move;
                                                          // 回傳 server-generated storageKey
    byte[] read(String storageKey);                       // 回 bytes；失敗由 call site 轉 500
    void delete(String storageKey);                       // compensating (best-effort)
}
```

- `validatedExtension` 只可能是 `"jpg"` 或 `"png"`（由 validator 的 canonical type 派生）；
  `storageKey` 由 adapter 產生，例如
  `UUID.randomUUID() + "." + validatedExtension`，並以嚴格 key grammar 驗證
  （`[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|png)`）。
- `LocalMediaStorage`（唯一 adapter）：root = `Path.of(APP_MEDIA_PATH)`（local
  `./data/media`、prod `/data/media`）。**整個** normalized-path 處理、key grammar
  驗證、symlink/path-escape defense（`resolve` 後確認 normalized path `startsWith(root)`、
  有效 storage key 本身是相對檔名；拒絕 absolute path、dot segment、path separator、grammar 外 key
  與 symlink final target）、temp file 與 atomic move
  都封裝在 adapter 內，不流入 service/controller/public contract。
- Persist 流程：先寫 temp file（同一 filesystem），再 `Files.move(..., ATOMIC_MOVE)` 到
  final 路徑；檔案只在 move 成功後以 final key 可見。
- `read(storageKey)` 依 key grammar 解析並回 bytes；檔案缺失或內容無法讀取 → 丟儲存例外，
  由 read service 轉成 500（先比對 metadata）與完整 log。
- Compensating delete：transaction 失敗時以 best-effort 刪除已 move 的檔案並 log；如果
  delete 本身失敗，留下 private orphan，由 stopped-app reconciliation/runbook 清理。
- 永不使用、永不驗證 client multipart filename；`contentType`/`byteSize`/`width`/`height`/
  `sha256` 都以 server 測量為準。

## Repository / service

- `PostImageRepository`（JdbcClient）：`insert(postId, storageKey, contentType, byteSize,
  width, height, sha256)`、`findPositiveId(id)`（回 metadata 含 storage_key、byte_size、
  content_type、sha256）、`findByPostId(postId)`（repost/search projection join 使用）。
  **沒有**刪檔的 repository 方法——filesystem bytes 不由 DB 層刪除。
- `PostService.createPost` 保留既有 JSON 路徑。新增 multipart 路徑：
  1. 解析 required parts；`post` JSON 缺漏 → `MALFORMED_REQUEST`；`image` 缺漏 →
     `MALFORMED_REQUEST`（truthful 400，由 `handleMissingServletRequestPart` 處理）。
  2. `post` part 有值但內容不合規 → 既有 `VALIDATION_FAILED`（不混用
     `MALFORMED_REQUEST`）。
  3. `ImageValidator.validate(declared, bytes)`；失敗照碼回 400/413，無任何持久化。
  4. `mediaStorage.store(bytes, validatedExtension)` → `storageKey`；同份 bytes 計算
     `sha256`。
  5. short transaction：insert post → insert post_images（含 sha256，同一 transaction）
     → commit。
  6. commit 失敗 → compensating `mediaStorage.delete(storageKey)` → 原錯誤往上拋。
  7. 回傳 `Post` + `image` object（不帶 storage_key/sha256）。
- Media read service：by positive id → `findPositiveId(id)` → `read(storageKey)` →
  **驗證 `bytes.length == byte_size` 且 `sha256(bytes) == metadata.sha256`** 相符才提供
  Resource（含 canonical `Content-Type`/`Content-Length` 與
  `filename="image-<mediaId>.jpg|png"`）；metadata 無 → 404 `MEDIA_NOT_FOUND`；storage
  missing/byte length 或 SHA mismatch/corrupt → 500 `INTERNAL_ERROR`（log 完整，public
  body 不含路徑/storage key/SHA）。

## Controller、security 與 cache

- Create：**兩支 `@PostMapping` 方法，以 `consumes` 選派**（一支 method 不能同時綁定
  `@RequestBody` 與 required multipart parts）：
  - 既有 JSON handler：`@PostMapping(consumes = APPLICATION_JSON_VALUE)` +
    `@Valid @RequestBody CreatePostRequest` —— 行為不變。
  - 新 multipart handler：`@PostMapping(consumes = MULTIPART_FORM_DATA_VALUE)` +
    `@RequestPart("post") CreatePostRequest post` + `@RequestPart("image") MultipartFile image`。
  - Auth 與 CSRF 不變：principal 必需、unsafe method 由既有 filter 驗證 token。
- Multipart resolver limits：`spring.servlet.multipart.max-file-size=5MB`、
  `max-request-size=6MB`；service-level bounded read（5 MiB）在 resolver 被 bypass 時仍
  生效。
- `MediaController`：`GET /api/media/{positiveId}` public，參數以 `@PathVariable` 綁定後
  驗證正整數；type mismatch（非可解析數值）→ `INVALID_MEDIA_ID`（沿用既有 `postId`→
  `INVALID_POST_ID` 的 type-mismatch pattern）。Response：canonical `Content-Type`、
  `Content-Length`（實際 bytes）、`Content-Disposition: inline; filename="image-<id>.jpg|png"`
  （依 public metadata ID + type 產生）、`Cache-Control: public, max-age=31536000,
  immutable`。不設定 `private`；payload 是 public immutable bytes（immutable media-ID
  reference）。
- Security：create 維持在 authenticated + CSRF 路徑；media GET 是 public，維持在既有
  `GET /**` permitAll matcher 之下，不新增 authenticated matcher；確認不與其他更 specific
  matcher 衝突、不擋 anonymous。
- Error wires：
  - `InvalidImageException → INVALID_IMAGE`；
  - `ImageTooLargeException / MaxUploadSizeExceededException → IMAGE_TOO_LARGE`（413）；
  - `MissingServletRequestPartException → MALFORMED_REQUEST`（**新增**
    `handleMissingServletRequestPart`，truthful 400）；
  - type-mismatch：`mediaId` → `INVALID_MEDIA_ID`（擴充既有 `handleTypeMismatch` switch）；
  - `INVALID_MEDIA_ID`、`MEDIA_NOT_FOUND`；
  - 全部新增到 `ApiErrorCode`，走既有 RFC 9457 writer 與 `X-Request-ID`。Multipart
    resolver 的 `MaxUploadSizeExceededException` 必須由 `ApiExceptionHandler` 明確 mapping
    成 413，不落入未處理 500。

## Frontend

- `types/post.ts`：新增 `PostImage { id, url, contentType, width, height, byteSize }` 與
  `Post.image: PostImage | null`（不含 sha256/storage key）。`api/posts.ts` 新增 multipart
  create：`createPostWithImage(request, imageFile)` —— `FormData` 中 `post` 以
  `Blob([JSON.stringify(request)], { type: 'application/json' })` 附上、`image` 附原始
  `File`；沿用 same-origin cookie 與 in-memory CSRF header（unsafe method）。
- `Composer`：
  - `<input type="file" accept="image/jpeg,image/png">`。
  - Client precheck：`file.type ∈ {image/jpeg,image/png}`、`file.size ≤ 5 MiB`；不合規直接
    顯示 local error，不送 request（server 仍權威）。
  - `URL.createObjectURL(file)` preview 顯示縮圖；可移除，移除/更換時 `revokeObjectURL`
    （cleanup），避免 blob 洩漏。
  - Submit 期間 disabled/pending；成功後才 reset file/preview 與 composer；失敗顯示受控
    error、保留現有檔案與 preview、不產生 orphan blob。Server 維持 authoritative。
- `PostCard`（timeline、search、profile 與所有 reuse surface）：
  - `post.image != null` 時 render responsive lazy `<img src={image.url} loading="lazy">`
    （max-width/height 100%、維持 aspect），以 post id render key 沿用既有機制。
  - `alt` 由 author 產生（例如 "Post image by {author}"），不停留 client path。
  - 載入失敗/無圖時 graceful 降級，不破壞布局；server 是 authoritative（無 client path、
    無 client filename）。
- 不需新增 dependency；不為本輪加入 test runner，以 backend contract、lint、build、
  typecheck 與 production runtime smoke 補足 evidence。

## Failure、atomicity 與相容性

- Validation 與 file write 都在 DB 之前；只有通過所有檢查的 bytes 會被 move 到 final 路徑。
- post + metadata 在同一 short transaction 原子 commit；DB/commit 失敗 → compensating
  delete + 原錯誤往上拋。
- Crash 窗口（atomic move 成功後、commit 前）只會留下 private orphan（無 DB row、public
  不可見）；這是明示 limitation，由 stopped-app reconciliation/runbook 清理，DB row 永不
  先於檔案暴露。
- 404 vs 500 由「metadata 是否存在」決定；storage 遺失/byte length 或 SHA-256 不符/損壞
  一律 500 + log，不回 `MEDIA_NOT_FOUND`。
- DB FK cascade 只刪 `post_images` metadata row；**不刪 filesystem bytes**（本輪無 post
  delete endpoint，cascade 只是直接/未來刪除的 metadata 完整性保證）。Unreferenced
  files 由 stopped-app reconciliation 清理。
- 既有 JSON HTTP 契約不變；`Post` 只新增 nullable `image`（既有所有欄位含
  `timelineEntryId` 不變）。Repost/search/profile 復用 original post image（同一 `Post`
  物件），不重複儲存。
- Deployment 維持單一 `/data` volume 與 read-only root FS；新增 `APP_MEDIA_PATH=/data/media`
  （prod）。Backup/restore/migration docs 把 stopped SQLite 檔案與 media directory 視為
  同一個 release snapshot；rollback = 還原 DB backup + media snapshot + 回滾 image。

## 驗證策略

1. Migration：empty、populated V8→V9 upgrade、count/ID/timestamp 保留、one-to-one、FK
   cascade（只刪 metadata）、strict CHECK constraints（含 64-hex lowercase sha256）、
   `PRAGMA integrity_check`。
2. Validator：declared/detected 一致、magic bytes、`ImageIO` dimension-then-decode
   順序、pixel bounds 檢查發生在全幅 allocate 之前、truncated/corrupt reject、5 MiB
   bounded read、1–4096、12,000,000 pixels、100% 不寫檔不碰 DB。
3. Storage：server-generated UUID key、key grammar、path 鎖定、symlink/path-escape
   rejection、byte-oriented `store/read/delete`（不洩漏 `Path`）、temp+atomic move、
   compensating delete、corrupt/missing file 行為、read 回 bytes。
4. Repository/service/controller：multipart required parts（缺失 →
   `handleMissingServletRequestPart`→`MALFORMED_REQUEST`）、`post` 內容不合規 →
   `VALIDATION_FAILED`、兩支 `consumes` handler、JSON 分支保留、413
   （含 `MaxUploadSizeExceededException` mapping）、`INVALID_IMAGE`/`INVALID_MEDIA_ID`
   （含 type-mismatch）/`MEDIA_NOT_FOUND`、serving 前 byte length/SHA-256 驗證、public
   matcher、immutable cache。
5. Frontend：lint、TypeScript/Vite build；runtime 驗證 file precheck、preview/cleanup、
   pending/disabled、reset-on-success、responsive lazy image、author-based alt。
6. Delivery：multi-stage Docker build、clean V1–V9 與 populated V8→V9、production runtime
   真實 upload/read/restart/cache/error/rollback/path、GitHub Actions final-head 與
   post-merge master。
