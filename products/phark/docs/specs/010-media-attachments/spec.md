# 010：媒體附件

> 狀態：Complete（實作、local/runtime 與 delivery-head CI 已驗證）
> 日期：2026-09-03
> Baseline：`e2c8e11330628baab457269ab21425fe22b5dc16`

## 問題

Phark 的文章目前只有純文字。使用者無法發表附圖，也無法在 timeline、search、replies 或
profile 看到任何圖片。附件是 user-visible 的跨 schema/API/filesystem/UI change：需要新的
V9 migration、`MediaStorage` 介面與 local filesystem adapter、multipart create 契約、
public media read endpoint，以及 frontend compose/preview/rendering。因此先以 live spec
固定契約再實作（documentation-first）。

## 目標

- 每篇 original post 可附**零或一張**圖片；`content` 仍然必填。Replies、avatars、GIF、
  SVG、WebP、video/audio、圖片 edit/delete 為非目標。
- `POST /api/posts` 的 JSON 契約不變；同一路徑新增 `multipart/form-data`（以兩支
  `@PostMapping` handler 依 `consumes` 分派），其中 `post` part（`CreatePostRequest` JSON）
  與 `image` part 都是 required。Authentication 與 CSRF 與既有一致。
- 只接受 JPEG/PNG；input 上限 5 MiB；declared 與 detected type 必須一致；require 有效
  signature 且 `ImageIO` decode 成功（先讀 dimensions、驗過 pixel 界線後才完整 decode）；
  width/height 各 1–4096、pixels ≤ 12,000,000。永不儲存 client filename。
- Shared `Post` JSON 新增 nullable `image`：`{id,url,contentType,width,height,byteSize}`；
  既有**所有**欄位保持不變，既有 rows 回 null；repost/search/profile 復用 original post
  image。`sha256`/`storage_key` 從不出現在 public JSON。
- V9 新增 one-to-one `post_images` metadata table（FK cascade、unique post_id 與
  storage_key、strict type/size/dimension/pixel checks、內部 lowercase 64-hex SHA-256）；
  SQLite 不存 blob。FK cascade 只刪 metadata row，**不刪 filesystem bytes**。
- `MediaStorage` interface + local filesystem adapter：server-generated（UUID）key 存放在
  `${APP_MEDIA_PATH}` 之下（local `./data/media`、prod `/data/media`），temp+atomic move。
- Public read `GET /api/media/{positive-id}`：metadata lookup first、永不接受 client path。
  以 public metadata ID + canonical type 產生 `Content-Disposition: inline;
  filename="image-<mediaId>.jpg|png"`，永不使用 storage key。Serving 前驗證實際 byte
  length 與 SHA-256 與 metadata 一致；metadata 缺失 404、storage 遺失/損壞/不符 500 並 log。
- File write 與 image validation 發生在 short SQLite transaction 之前；post+metadata 以
  同一 transaction 原子 commit；任何 DB/commit 失敗觸發 compensating file deletion。
  Crash-gap private orphan 是明示 limitation，由 stopped-app reconciliation/runbook 處理；
  檔案存在前永不暴露 DB row。
- 新增精確 RFC 9457 codes/handling：invalid image、image too large（413，含 multipart
  resolver rejection）、invalid media ID、media not found。Missing/malformed parts 維持
  truthful 400 `MALFORMED_REQUEST`；`post` 內容本身不合規維持既有
  `VALIDATION_FAILED`，不混用。Public error 不含內部路徑、storage key、SHA 或內部細節。
- Frontend 新增 JPEG/PNG file selection、size/type client precheck、可移除的 object-URL
  preview（含 cleanup）、disabled/pending 狀態、multipart create、success 後才 reset，
  以及在每個 PostCard reuse surface 的 responsive lazy image（author-based alt text）。
  Server 維持 authoritative。
- Deployment 維持單一 `/data` volume 與 read-only root FS；設定 `APP_MEDIA_PATH=/data/media`。
  Backup/restore/migration docs 必須把 stopped SQLite 檔案與 media directory 視為同一個
  release snapshot。
- 以 RED/GREEN focused suites、full backend、zero-warning frontend lint/build、Docker
  image、clean V1–V9、populated V8→V9（count/ID 保留）、真實 upload/read/restart/cache/
  error/rollback/path tests、final-head 與 post-merge CI 提供 evidence。

## 非目標

- 不支援 replies 圖片、avatar、GIF、SVG、WebP、video/audio、多張圖片、圖片 edit/delete。
  本輪沒有 post delete endpoint，也沒有 image delete endpoint。
- 不支援外部 S3/CDN/object store；本輪只有 local filesystem adapter。
- 不把 image bytes 存入 SQLite（無 blob column）。
- 不改 `POST /api/posts` 的 JSON 分支行為；JSON 仍建立 image=null 的文章，只新增獨立的
  multipart handler（兩支 `@PostMapping` 依 `consumes` 分派）。
- 不儲存或回傳 client 提供的 filename；generated filename 一律 server-side。
- 不在 public JSON 或 public error 暴露 `sha256`、`storage_key` 或任何 filesystem path。
- DB FK cascade 不回刪 filesystem bytes；無 metadata 參照的檔案由 stopped-app
  reconciliation 清理，不由 DB 刪除帶動。

## HTTP 與 JSON 契約

沿用 RFC 9457 Problem Details、`X-Request-ID`、session auth 與 CSRF boundary。

| Method | Path | Auth | 成功 |
|--------|------|------|------|
| `POST` | `/api/posts`（JSON，`consumes=application/json`） | Session + CSRF | `201 Post`（`image` 為 null）— 不變 |
| `POST` | `/api/posts`（`multipart/form-data`，`consumes=multipart/form-data`） | Session + CSRF | `201 Post`（`image` non-null） |
| `GET` | `/api/media/{id}` | Public | `200` binary（immutable cache） |

### Multipart create

`POST /api/posts` 同時接受 `application/json`（既有行為，不變）與 `multipart/form-data`
（新增）。兩支 handler 以 Spring `consumes` 選派：一支沿用 `@RequestBody
CreatePostRequest`（JSON），另一支以 required 的 `@RequestPart("post")` 與
`@RequestPart("image")` 綁定 multipart parts。Multipart variant 的兩個 part 都是
required：`post`（JSON `CreatePostRequest`，part Content-Type `application/json`）與
`image`（JPEG/PNG bytes）。一支 method 不能同時綁定 `@RequestBody` 與 required multipart
parts，因此是兩支方法，不是一支方法取兩用。

```http
POST /api/posts
Content-Type: multipart/form-data; boundary=----PharkBoundary

------PharkBoundary
Content-Disposition: form-data; name="post"
Content-Type: application/json

{"content":"Today I shipped the boring fix.","channel":"tech"}
------PharkBoundary
Content-Disposition: form-data; name="image"; filename="photo.jpg"
Content-Type: image/jpeg

<binary bytes>
------PharkBoundary--
```

- `post` part 的 JSON 與既有 `CreatePostRequest` 相同：`content` 不可空白、最多 500 字；
  `channel` 僅 `home`/`tech`/`ops`。`post` 內容本身的 Bean Validation 沿用既有
  `VALIDATION_FAILED`；`MALFORMED_REQUEST` 只用於 part 實際缺失或
  `post` JSON malformed。
- `image` part 的 client filename（`filename="photo.jpg"`）**永不儲存、永不回傳**；multipart
  part 的 declared Content-Type 必須是 `image/jpeg` 或 `image/png`，且與偵測到的 signature/
  `ImageIO` format 一致。
- Spring multipart resolver 設定 `max-file-size=5MB` 與 `max-request-size=6MB`；service
  層對 multipart bytes 仍做 bounded read（5 MiB），因此 resolver 被 bypass（tests/adapters）
  時 limit 仍然有效。
- Created Post 完整沿用既有 shape，只新增 nullable `image`（additive）。既有所有欄位
  （`id`、`author`、`authorHandle`、`content`、`channel`、`createdAt`、`replyCount`、
  `likeCount`、`likedByViewer`、`timelineEntryId`、`repostCount`、`repostedByViewer`、
  `repostedBy`、`repostedByHandle`、`repostedAt`）保持不變：

```json
{
  "id": 42,
  "author": "Alice",
  "authorHandle": "alice_ops",
  "content": "Today I shipped the boring fix.",
  "channel": "tech",
  "createdAt": "2026-09-03T10:00:00Z",
  "replyCount": 0,
  "likeCount": 0,
  "likedByViewer": false,
  "timelineEntryId": "post:42",
  "repostCount": 0,
  "repostedByViewer": false,
  "repostedBy": null,
  "repostedByHandle": null,
  "repostedAt": null,
  "image": {
    "id": 7,
    "url": "/api/media/7",
    "contentType": "image/jpeg",
    "width": 1200,
    "height": 800,
    "byteSize": 209715
  }
}
```

- `image` 是 nullable object；`id` 是 image metadata row 的 server ID、`url` 是公開讀取
  path（`/api/media/{id}`，immutable media-ID URL）、`contentType` 是偵測到的 canonical
  type、`width`/`height` 0 不會出現（範圍 1–4096）、`byteSize` 是實際 stored bytes。
- `sha256` 與 `storage_key` 是**內部** metadata，render 在任何 public JSON（timeline、
  search、repost、profile）都不出現。
- Repost 與 search items 沿用同一個 `Post` shape；`image` 一律取自 original post row，
  不重複儲存。

### `GET /api/media/{id}`

Public、metadata lookup first、永不接受 client path。ID 以 public metadata row 的正整數
ID 表示；media bytes 因為「一個 media ID 永遠只對應一組初次寫入的 stored bytes」而不可變
（URL 是 immutable media-ID reference，與 storage key 內容無關），因此可被 browser/CDN
長期快取。Server 以 UUID 產生 storage key，**不是** content-addressed key。

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 209715
Content-Disposition: inline; filename="image-7.jpg"
Cache-Control: public, max-age=31536000, immutable
```

- `Content-Type` 取自 DB metadata 的 canonical type，不是 client declared value。
- `Content-Length` 取自已驗證的實際 bytes；`Content-Disposition` filename 依 **public
  metadata ID + canonical type** 產生，`filename` 恆為 `image-<mediaId>.jpg`（JPEG）或 `image-<mediaId>.png`
  （PNG），**永不使用 storage key 或 client filename**。
- `Cache-Control: public, max-age=31536000, immutable`：immutable media-ID URL。
- Fetch reader：metadata lookup by positive `id` → `read(storageKey)` 取得 bytes →
  驗證實際 `bytes.length == metadata.byte_size` 且 `sha256(bytes) == metadata.sha256` 後
  才回 200。metadata 缺失回 `404 MEDIA_NOT_FOUND`；storage 檔案遺失、byte length 或
  SHA-256 與 metadata 不符、或內容損壞回 `500 INTERNAL_ERROR` 並完整 log（public body
  不含內部路徑、storage key 或 SHA 值）。

### Error 契約

| 情境 | Status | Code |
|------|--------|------|
| multipart 缺 `post` part 或缺 `image` part（`MissingServletRequestPartException`） | `400` | `MALFORMED_REQUEST` |
| `post` part 存在但其 JSON malformed | `400` | `MALFORMED_REQUEST` |
| `post` part 存在但 `content` 空白/超長或 `channel` 不合規 | `400` | `VALIDATION_FAILED`（與 JSON 分支不變） |
| `mediaId` path variable 非可解析型別（type mismatch） | `400` | `INVALID_MEDIA_ID` |
| declared Content-Type 不是 `image/jpeg`/`image/png` | `400` | `INVALID_IMAGE` |
| declared 與 detected type 不一致 / signature 無效 / `ImageIO` decode 失敗 | `400` | `INVALID_IMAGE` |
| width/height 超出 1–4096 或 pixels > 12,000,000 | `400` | `INVALID_IMAGE` |
| input > 5 MiB（含 multipart resolver rejection、service-level bounded read） | `413` | `IMAGE_TOO_LARGE` |
| media ID ≤ 0 或非正整數 | `400` | `INVALID_MEDIA_ID` |
| media ID 正整數但 metadata row 不存在 | `404` | `MEDIA_NOT_FOUND` |
| metadata 存在但 storage 遺失/byte length 或 SHA-256 不符/損壞 | `500` | `INTERNAL_ERROR`（log 完整，body 不含內部細節） |

- 新增到 `ApiErrorCode`（required，非 open alternative）：`INVALID_IMAGE`（400）、
  `IMAGE_TOO_LARGE`（413）、`INVALID_MEDIA_ID`（400）、`MEDIA_NOT_FOUND`（404）。
- `ApiExceptionHandler` 必須新增/確認 `handleMissingServletRequestPart` →
  `MALFORMED_REQUEST`（truthful 400）；type-mismatch 對 `mediaId` 明確 mapping 成
  `INVALID_MEDIA_ID`（沿用既有 `postId`→`INVALID_POST_ID` 的 pattern）。
- Spring multipart resolver 超過 limit 時會拋 `MaxUploadSizeExceededException`，必須明確
  mapping 成 `413 IMAGE_TOO_LARGE` Problem Details，不得變成未處理 500。
- 所有錯誤走既有 RFC 9457 writer 與 `X-Request-ID` filter；public error 絕不包含內部
  filesystem path、storage key、SHA 或 client filename。
- 既有 JSON `POST /api/posts` 的 validation 行為（包含 channel 驗證在內均為
  `VALIDATION_FAILED`）不變。

## BDD 驗收情境

### Scenario：multipart create 建立一張 authoritative 圖片

Given 已登入 viewer 以 `multipart/form-data` 發送 required `post` JSON part 與一張有效
JPEG/PNG `image` part
When session 驗證通過且 CSRF token 有效
Then 回 `201` 且 Post 的 `image` 為 non-null object（`{id,url,contentType,width,height,
  byteSize}`）
And 資料庫 `post_images` 有且僅有一筆 row，其 storage_key 是 server-generated（UUID）且
  content_type/byte_size/width/height/sha256 與 stored file 的實際值一致
And Post 其餘所有既有欄位（含 `timelineEntryId`）與 JSON create 完全一致，僅多 nullable
  `image`

### Scenario：content 仍然必填

Given multipart request 的 `post` part 中 `content` 空白或缺失（part 存在但內容不合規）
When 建立請求被驗證
Then 回 truthful `400` `VALIDATION_FAILED`（沿用既有 content validation），不建立 post
  也不寫入任何 media file
And `400 MALFORMED_REQUEST` 只用於 part 實際缺失或 `post` JSON malformed，不與
  `VALIDATION_FAILED` 混用

### Scenario：JSON create 保留行為、既有 rows image 為 null

Given 既有 V1–V8 文章與以 JSON `POST /api/posts` 建立的新文章
When timeline/search/profile/replies 讀取這些 Post
Then 每個 Post 的 `image` 都是 null（不存在 attachment）
And JSON create 的 201 Post shape 與既有契約完全一致，僅新增 null `image` 欄位
And JSON handler 與 multipart handler 是兩支 `@PostMapping` 方法、依 `consumes` 分派，
  JSON 分支不因新增 multipart 而改變行為

### Scenario：拒絕不受信任的 image input

Given `image` part 的 declared type、signature、`ImageIO` decode 或 dimension/pixel 任一
違反契約（含 declared 與 detected 不一致、magic bytes 無效、decode 失敗、width/height
不在 1–4096、pixels > 12,000,000）
When 嘗試建立文章
Then 回 `400 INVALID_IMAGE` Problem Details
And 不寫入任何 media file、不建立 post、不留任何 DB row
And image bytes 以 **先讀取 dimensions、驗過 pixel 界線、才完整 decode** 的順序驗證；
  truncated/corrupt input 在完整 decode 階段被拒絕

### Scenario：image too large（含 multipart resolver rejection）

Given `image` part 內容 > 5 MiB
When 嘗試建立文章
Then 回 `413 IMAGE_TOO_LARGE`
And 不管是 service-level bounded read、validator 檢查還是 multipart resolver 在
  controller 之前拒絕，對外都統一是 `413 IMAGE_TOO_LARGE` Problem Details，不變成 500，
  也不寫入部分狀態
And resolver `max-file-size=5MB`、`max-request-size=6MB`、service bounded read = 5 MiB

### Scenario：public read 回傳不可變 bytes

Given 已建立含圖片的 post，取得其 `image.url = /api/media/{id}`
When 任何 client（含 anonymous）GET 該 path
Then 回 `200` 與 stored bytes，`Content-Type` 為 canonical type、`Content-Length` 與
  stored bytes 一致、`Content-Disposition` 為 inline 且 filename 為
  `image-<mediaId>.jpg|png`（依 public ID + type 產生，非 storage key）
And 回 `Cache-Control: public, max-age=31536000, immutable`
And 回傳前已驗證實際 byte length 與 SHA-256 與 metadata 一致；metadata 查詢永遠走
  `{id}`，security matcher 不擋 anonymous、request 不接受任何 client path

### Scenario：media not found 與 corrupt storage 分離

Given 一組不存在的 media ID 與一組 metadata 存在但 storage 檔案被手動移除或竄改（byte
length 或 SHA-256 與 metadata 不符）的 ID
When 各自 GET `/api/media/{id}`
Then 前者回 `404 MEDIA_NOT_FOUND`（無 DB row）
And 後者回 `500 INTERNAL_ERROR` 且 server log 保留完整錯誤，public body 不含內部路徑、
  storage key 或 SHA 值

### Scenario：post + metadata 同 transaction 且 fail-closed

Given 圖片已寫入 media directory
When SQLite transaction 內 post 或 metadata insert 任一失敗以至於 commit 失敗
Then writer 執行 compensating file deletion，stored file 不留殘檔（除 crash-gap 外）
And DB row 永遠不會在檔案存在之前被建立或暴露；SHA-256 與 byte_size 在 insert metadata
  前由同一份 bytes 計算
And 若 crash 發生在 atomic move 與 commit 之間，只留下 private orphan file（無 DB row，
  public 不可見），由 stopped-app reconciliation/runbook 清理

### Scenario：FK cascade 只刪 metadata、不刪 filesystem bytes

Given 一篇含圖片的 original post 其 `post_images` metadata row 被直接/未來 post 刪除
  cascade 移除
When DB 層 cascade 生效
Then `post_images` metadata row 被刪除（無孤兒 metadata）
And filesystem bytes **不**被 DB cascade 刪除；unreferenced file 之後由 stopped-app
  reconciliation 清理，DB 不負責刪檔

### Scenario：repost 與 search 復用 original image

Given 一篇含圖片的 original post 被 repost，也被 search index 涵蓋
When 讀取 repost activity 與 search result item
Then 兩者的 `image` 都直接來自 original post（同一個 `{id,url,...}`），不重複儲存
And search item 其餘欄位與既有 search 契約一致（boolean viewer flags、`post:<id>`
  timelineEntryId、null repost attribution、不含 sha256/storage key）

### Scenario：frontend precheck、preview 與 reset

Given viewer 在 composer 選擇一張 JPEG/PNG 檔案
When 檔案通過 client size/type precheck
Then 顯示 removable object-URL preview；提交中 disabled；success 後才 reset form 與 preview
And 移除或更換檔案時 object URL 被 revoke（cleanup），失敗時保留現有檔案與 preview

### Scenario：V8→V9 populated upgrade 保留既有資料

Given 一份已升級到 V8 的 warm database（accounts、posts、replies、likes、reposts、
notifications 都有既有資料）
When 升級到 V9
Then accounts/posts/replies/likes/reposts/notifications 的 count 與所有 IDs/timestamps
  逐項保留，`post_images` 為空表
And Flyway history 只新增 V9、`PRAGMA integrity_check` 為 ok

## 約束與相容性

- SQLite/Flyway 下一個 immutable migration 是 **V9**；V1–V8 不修改。
- V9 支援 empty 與 populated V8 upgrade；既有資料與 IDs 不變，`post_images` **不回填**
  （既有文章 image 為 null，V9 部署當下為空，與 SDD-008 no-backfill 政策一致）。
- Media 是 additive：既有 HTTP JSON 契約不變；`Post` 只新增 nullable `image`，既有所有
  欄位保持不變。
- **不存 blob**：SQLite 只存 metadata（含內部 `sha256`）；bytes 在 `${APP_MEDIA_PATH}`
  local filesystem。SHA-256/storage key 為內部值，不出現在 public JSON。
- `POST /api/posts` JSON 分支保持可用且不變；multipart 分支是獨立 handler，只在其 variant
  內要求 required parts。
- `GET /api/media/{id}` 是 public，維持在既有 `GET /**` permitAll matcher 之下，不新增
  authenticated matcher；確認不被其他更 specific matcher 擋住 anonymous。
- Authentication 與 CSRF 不變：create 需要 session + CSRF；read 不需要。Viewer-aware
  responses 仍 `Cache-Control: private, no-store`；media bytes 是 public immutable。
- `contentType`/`byteSize`/`width`/`height` 以 server 實際驗證/測量值為準，不接受 client
  宣告作為 storage 或 path 決策。
- 新增 4 個 `ApiErrorCode`；`INTERNAL_ERROR` 沿用既有 operational error 路徑。
- File I/O 是新增 boundary；`MediaStorage` interface 是 byte-oriented
  （`store(bytes, ext) -> key`、`read(key) -> bytes`、`delete(key)`），public contract 不
  暴露 `Path` 或 storage 實作；local adapter 才處理 normalized paths、key grammar、
  symlink/path-escape defense、temp file 與 atomic move。
- Frontend 沒有 test runner；以 backend contract、lint、build、typecheck 與 production
  runtime smoke 補足 evidence，不新增 dependency。

## 假設與未知

- 已驗證（既有 codebase）：`POST /api/posts` 是 `@Valid @RequestBody CreatePostRequest`，
  auth 必需、CSRF 由 filter 處理；`Post` JSON shape（含 required `timelineEntryId`）與
  `ApiErrorCode` 已有完整清單；`ApiExceptionHandler` 已處理 type-mismatch（`postId`→
  `INVALID_POST_ID`）但**尚無** `handleMissingServletRequestPart`；`Cache-Control` 由
  controller 明確設定。Multipart create 以第二支 `consumes` handler 加入，保留 JSON 分支。
- 已驗證（SDD-009）：search/PostCard 復用同一 `Post` shape；新增 nullable `image` 對既有
  consumers 是 additive（unknown member 忽略規則已存在）。
- 已定案：`GET /api/media/{id}` 以正整數 metadata ID 查詢；404 與 500 分離由 metadata
  存在性決定，500 另加 byte length/SHA-256 驗證；`IMAGE_TOO_LARGE` 統一 413（含 resolver
  rejection）；storage key 為 UUID，URL 是 immutable media-ID reference（非 content-addressed）。
- 未量測：ImageIO dimension-then-decode + atomic move 在 5 MiB 上限下的平均延遲與峰值；
  假設在容器資源內可接受，runtime smoke 若顯著則回報權衡。
- 未驗證：production runtime 下 `/data/media` 權限（container UID 10001）與 read-only
  root FS 設定需在 Docker 驗證 stage 確認；`APP_MEDIA_PATH` 若是相對路徑的解析行為需在
  測試固定。
- 未決定：media file 的 retention/組合清理政策（本輪只處理 metadata 的 FK cascade 摘要與
  stopped-app reconciliation）；orphan reconciliation runbook 在 Stage F 寫定。Crash-gap
  private orphan 是已知、明示、可接受的 limitation。

## 完成條件

- V9 migration（`post_images`，含 `sha256` 內部欄位）、`PostImageRepository`、
  `ImageValidator`、`MediaStorage` interface + `LocalMediaStorage` 的 TDD 全部通過。
- Migration 驗證 empty/populated V8→V9、count/ID/timestamps 保留、FK cascade 只刪
  metadata、strict CHECK（含 64-hex lowercase SHA-256）與 `PRAGMA integrity_check`。
- Validator/storage/contract tests 驗證 declared-vs-detected、signature、ImageIO
  dimension-then-decode、5 MiB bounded read、1–4096、12,000,000 pixels、byte-oriented
  `store/read/delete`、key grammar、temp+atomic move、corrupt-storage 500（byte
  length/SHA-256 mismatch）。
- API/security tests 驗證 multipart create（required parts、`consumes` 分派兩支 handler）、
  JSON 分支保留、`413 / INVALID_IMAGE / INVALID_MEDIA_ID / MEDIA_NOT_FOUND`、public media
  matcher、immutable cache、`handleMissingServletRequestPart`→`MALFORMED_REQUEST`、
  type-mismatch `mediaId`→`INVALID_MEDIA_ID`。
- Frontend lint/build 0 warnings、Docker build、clean/populated migration 與 production
  runtime smoke 通過（真實 upload/read/restart/cache/error/rollback/path）。
- 文件、ROADMAP、runtime evidence 與 GitHub Actions final-head **及 post-merge master** 一致。
- 每個階段獨立 commit、push；draft PR checks 全綠後才 ready 並 merge。
