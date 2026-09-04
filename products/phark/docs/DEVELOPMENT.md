# 開發指南

供本地開發者與接手 LLM 使用的專案說明。

## Repository 結構

```text
phark/
├── backend/                 # Spring Boot 3.5.16 + Java 17
│   ├── pom.xml
│   └── src/
│       ├── main/
│       │   ├── java/com/example/deck/
│       │   │   ├── DeckApplication.java
│       │   │   ├── config/       # Database, migration, security 與 SPA config
│       │   │   ├── controller/   # Auth、account、profile、post、reply、like、repost、notifications、search、media APIs
│       │   │   ├── dto/          # JSON request/response boundaries
│       │   │   ├── error/        # RFC 9457 codes、exception mapper、violations
│       │   │   ├── model/        # Account、profile、content、RepostState、NotificationPage/ReadState、SearchCursor 契約
│       │   │   ├── repository/   # Account/Post/Reply/PostLike/PostRepost/Notification/Search/PostImage JdbcClient repositories
│       │   │   ├── security/     # Principal、UserDetails 與 Problem writers
│       │   │   ├── service/      # Account、Post、Reply、PostLike、PostRepost、Notification、Search、Media services（含 ImageValidator、MediaStorage/LocalMediaStorage）
│       │   │   └── web/          # Request correlation filter
│       │   └── resources/
│       │       ├── application.properties
│       │       ├── application-prod.properties
│       │       └── db/migration/  # Immutable Flyway V1...V9
│       └── test/
├── frontend/                # React + TypeScript + Vite + shadcn/ui
│   ├── package.json
│   ├── package-lock.json    # 必須提交
│   ├── components.json      # shadcn/ui 設定
│   └── src/
│       ├── api/client.ts    # Problem Details、same-origin fetch、CSRF memory
│       ├── api/accounts.ts  # Account/session/profile typed calls
│       ├── api/posts.ts     # Post/reply/like/repost typed calls（含 multipart createPostWithImage）
│       ├── api/notifications.ts # Notification page/read typed calls
│       ├── api/search.ts    # Search page typed calls
│       ├── components/      # Auth、profile、timeline、composer、notifications、search、ui/*
│       ├── lib/postReposts.ts  # repost snapshot/optimistic/rollback pure helpers
│       └── types/post.ts    # Post/PostImage/PostPage type contracts
├── Dockerfile               # multi-stage build
├── .dockerignore
├── deploy/templates/        # VPS / CI 設定模板
└── docs/                    # 本目錄
```

## 應用功能：Stream Deck

簡易 TweetDeck 類似版面（**不使用 X/Twitter logo 或商標**）。

| 功能 | 說明 |
|------|------|
| 頁面名稱 | Stream Deck |
| 三欄版面 | Home、Tech、Ops（桌面並排，手機橫向捲動） |
| Post cards | 每欄顯示文章卡片 |
| Composer | 登入後以 session identity 輸入 content、channel |
| 游標分頁 | 每欄先載入 20 筆，可獨立載入更舊文章 |
| 對話串 | 每篇文章可正序讀取及建立單層回覆 |
| 帳號 | Register、login、logout 與 30 分鐘 server-side session |
| Profile | 公開 profile、作者文章分頁與 owner display name/bio 編輯 |
| Likes | 每帳號冪等 like/unlike、權威 count 與 optimistic rollback |
| Reposts | 每帳號冪等 repost/unrepost、original attribution 與 mixed timeline fan-out |
| Notifications | reply/like/repost 事件、unread badge、通知分頁與「全部標為已讀」 |
| Search | public FTS5 original post 搜尋、`s1:` cursor 分頁、load-more dedupe |
| Media | 每篇 original post 至多附一張 JPEG/PNG；composer 預覽/removal/cleanup、PostCard lazy image |
| 自動刷新 | 發文後三欄自動重新載入 |

## REST API

### `GET /api/posts`

回傳最新一頁 original/repost activities。排序固定為
`activity_at DESC, entry_kind DESC, entry_id DESC`，使用 keyset cursor，不使用
`OFFSET`。

```http
GET /api/posts?channel=home&limit=20&before=<opaque-cursor>
```

| 參數 | 預設 | 規則 |
|------|------|------|
| `channel` | 全部 | `home`、`tech`、`ops` |
| `limit` | `20` | `1..100` |
| `before` | — | 上一頁的 `nextCursor`；client 不解析 |

```json
{
  "items": [
    {
      "id": 1,
      "timelineEntryId": "post:1",
      "author": "Alice",
      "authorHandle": "alice_ops",
      "content": "Hello",
      "channel": "home",
      "createdAt": "2026-07-13T10:00:00Z",
      "replyCount": 2,
      "likeCount": 3,
      "likedByViewer": true,
      "repostCount": 3,
      "repostedByViewer": false,
      "repostedBy": null,
      "repostedByHandle": null,
      "repostedAt": null,
      "image": null
    }
  ],
  "nextCursor": null
}
```

若仍有更舊資料，`nextCursor` 為 URL-safe Base64 字串；否則為 `null`。無效的
channel、limit 或 cursor 回傳 `400 Bad Request`。

Mixed timeline 每個 item 加上 shared `repostCount` 與 session 專屬
`repostedByViewer`，以及 nullable repost attribution。每個 item 的 `id` 永遠是原文
ID；`timelineEntryId` 是 non-null opaque stable key（client 只可比較相等與作為
render/dedup key，不可解析），Original activity 的 `repostedBy`、`repostedByHandle`、
`repostedAt` 為 null，repost activity 則 non-null。排序固定為
`activity_at DESC, entry_kind DESC, entry_id DESC`；「更多」分頁使用 versioned mixed
cursor（decoder 仍接受 SDD-001–006 的 legacy `<epoch>:<postId>` cursor）。Timeline 與
profile-post GET 因 viewer-aware fields 而標記 `Cache-Control: private, no-store`。

### `POST /api/posts`

需 authenticated session 與有效 CSRF；作者只取自 session account。同一路徑接受兩種
request Content-Type，由兩支 `@PostMapping` handler 依 `consumes` 分派：

- **`application/json`**（既有行為，不變）：以 JSON body 建立純文字文章，回傳的
  `Post.image` 恆為 `null`。
- **`multipart/form-data`**（SDD-010 新增）：required `post` JSON part + `image`
  （JPEG/PNG bytes）part。建立成功回傳 `201 Created`，`Post.image` 為 non-null。

JSON 建立：

```json
{
  "content": "Hello",
  "channel": "home"
}
```

| 欄位 | 規則 |
|------|------|
| `content` | 不可空白，最多 500 字 |
| `channel` | 僅允許 `home`、`tech`、`ops`；無效回傳 `400` |

### Multipart create（SDD-010）

`post` 與 `image` 兩個 part 都是 **required**：`post` 是 part Content-Type 為
`application/json` 的既有 `CreatePostRequest` JSON；`image` 是原始 JPEG/PNG bytes。
Part 內文的驗證（`content` 不可空白、最多 500 字；`channel` 僅 `home`/`tech`/`ops`）
與 JSON 分支完全一致。

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

Copyable（`<headerName>`/`<token>` 來自 `GET /api/auth/csrf`，與 cookie jar 同
session；`photo.jpg` 是 local JPEG/PNG 檔案）：

```bash
BASE_URL=http://127.0.0.1:8080
# 先取得 CSRF headerName/token（cookie jar 同 session）
curl -fsS -c cookies.txt -o csrf.json "$BASE_URL/api/auth/csrf"

curl -fsS -b cookies.txt -c cookies.txt \
  -X POST "$BASE_URL/api/posts" \
  -H '<headerName>: <token>' \
  -F 'post={"content":"Today I shipped the boring fix.","channel":"tech"};type=application/json' \
  -F 'image=@photo.jpg;type=image/jpeg'
```

`image` part 規則（server 一律以自己驗證/測量值為準，不接受 client 宣告作為 storage
或 path 決策）：

| 規則 | 違反時 |
|------|--------|
| declared Content-Type 是 `image/jpeg` 或 `image/png` | `400 INVALID_IMAGE` |
| declared 與 signature/`ImageIO` detected type 一致；magic bytes 有效；完整 decode 成功 | `400 INVALID_IMAGE` |
| input ≤ 5 MiB（resolver `max-file-size=5MB`、`max-request-size=6MB`；service 再做 5 MiB bounded read） | `413 IMAGE_TOO_LARGE` |
| width/height 各 1–4096 且 `width*height ≤ 12,000,000` | `400 INVALID_IMAGE` |

- Client multipart filename（`filename="photo.jpg"`）**永不儲存、永不回傳**。
- Dimension 檢查先於完整 decode（先讀 width/height、驗過 pixel 界線才 allocate 全幅
  BufferedImage），截斷/損壞 input 在完整 decode 階段被拒絕。

成功（`201 Created`）——完整 `Post`，`image` 為 non-null：

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

- `image` 是 nullable object；`url` 只依 public metadata ID 產生（immutable media-ID
  reference）。public JSON/error 不含 sha256、storage key 或 filesystem path。
- Repost activity、search item、timeline 與 profile 的 `image` 一律取自 original post
  row（同一個 `{id,url,...}`，不重複儲存）。

### 建立文章回應範例

```json
{
  "id": 1,
  "timelineEntryId": "post:1",
  "author": "Alice",
  "authorHandle": "alice_ops",
  "content": "Hello",
  "channel": "home",
  "createdAt": "2026-07-13T10:00:00Z",
  "replyCount": 0,
  "likeCount": 0,
  "likedByViewer": false,
  "repostCount": 0,
  "repostedByViewer": false,
  "repostedBy": null,
  "repostedByHandle": null,
  "repostedAt": null,
  "image": null
}
```

### `GET /api/media/{id}`

Public（不需 session；維持在既有 `GET /**` permitAll matcher 之下）、metadata-first
的不可變圖片 bytes 讀取。`{id}` 是 `post_images` metadata row 的正整數 server ID；
request 不接受任何 client path 或 storage key。

```http
GET /api/media/7
```

成功（`200`）：

```http
HTTP/1.1 200 OK
Content-Type: image/jpeg
Content-Length: 209715
Content-Disposition: inline; filename="image-7.jpg"
Cache-Control: public, max-age=31536000, immutable
```

- `Content-Type` 取自 DB metadata 的 canonical type，不是 client declared value；
  `Content-Length` 取自已驗證的實際 stored bytes。
- `Content-Disposition` 的 `filename` 依 **public metadata ID + canonical type** 產生：
  `image-<mediaId>.jpg`（JPEG）或 `image-<mediaId>.png`（PNG），永不使用 storage key
  或 client filename。
- `Cache-Control: public, max-age=31536000, immutable`：一個 media ID 永遠只對應一組
  初次寫入的 stored bytes，URL 是不可變 media-ID reference，可被 browser/CDN 長期快取。
- Serving 前先依 metadata 讀取並驗證實際 byte length 與 SHA-256 相符；metadata 存在
  但 storage 遺失/byte length 或 SHA-256 不符/損壞 → `500 INTERNAL_ERROR`（log 完整，
  public body 不含內部路徑、storage key 或 SHA 值）。media ID ≤ 0 或非整數 →
  `400 INVALID_MEDIA_ID`；正整數但無 metadata row → `404 MEDIA_NOT_FOUND`。

### `GET /api/posts/{postId}/replies`

回覆依 `created_at ASC, id ASC` 正序排列，使用 `after` cursor 讀取下一頁：

```http
GET /api/posts/1/replies?limit=20&after=<opaque-cursor>
```

回傳 `{ "items": [...], "nextCursor": "..." }`，其中每個 item 包含 `id`、
`postId`、`author`、nullable `authorHandle`、`content`、`createdAt`。`limit` 允許
`1..100`；不存在的 parent post 回傳 `404`，無效 post id、limit 或 cursor 回傳
`400`。

### `POST /api/posts/{postId}/replies`

需 authenticated session 與有效 CSRF；建立成功回傳 `201 Created` 與 Reply：

```json
{
  "content": "Agreed."
}
```

作者由 session 決定，content validation 規則和文章相同。`replyCount` 由後端
計算，建立成功後再次讀取 timeline 即會增加。Account-owned content 的 `author`
使用目前 display name，`authorHandle` 是 canonical handle；V1–V3 legacy content
保留既有 author snapshot 且 `authorHandle=null`。

### `PUT /api/posts/{postId}/like` / `DELETE /api/posts/{postId}/like`

兩者都需 authenticated session 與有效 CSRF，而且都可安全重送。PUT 在 relation
已存在時為 no-op；DELETE 在 relation 不存在時為 no-op。成功一律回 `200`：

```json
{
  "postId": 1,
  "likeCount": 3,
  "likedByViewer": true
}
```

Actor 只取自 session，不接受 request body 中的 account identity。`postId <= 0` 回
`INVALID_POST_ID`，不存在的正 ID 回 `POST_NOT_FOUND`。Self-like 與 legacy post
like 都允許；mutation 不改文章 timestamp 或 timeline cursor order。

Timeline 與 profile-post GET 的 `likeCount` 對所有 viewer 相同；
`likedByViewer` 依目前 session 計算，anonymous 固定為 false。這兩種 response 使用
`Cache-Control: private, no-store`，不可放進共享 cache。

### `PUT /api/posts/{postId}/repost` / `DELETE /api/posts/{postId}/repost`

兩者都需 authenticated session 與有效 CSRF，而且都可安全重送。PUT 在 relation
已存在時為 no-op（不更新 timestamp，不 bump activity）；DELETE 在 relation 不存在時
為 no-op。成功一律回 `200`：

```json
{
  "postId": 42,
  "repostCount": 3,
  "repostedByViewer": true
}
```

Actor 只取自 session，不接受 request body。`postId <= 0` 回 `INVALID_POST_ID`，
不存在的正 ID 回 `POST_NOT_FOUND`。Self-repost 與 legacy post repost 都允許；mutation
不改原文 timestamp、content、channel、likes 或 replies。DELETE 只移除目前 actor 的
repost activity；不刪原文、其他人的 repost、likes 或 replies。

Timeline 與 profile-post GET 的 `repostCount` 對所有 viewer 相同；
`repostedByViewer` 依目前 session 計算，anonymous 固定為 false。這兩種 response 使用
`Cache-Control: private, no-store`，不可放進共享 cache。

### `GET /api/notifications`

需 authenticated session。回傳目前收件者的 `NotificationPage`，固定依
`notification.id DESC` 排序、`limit` 預設 20、範圍 1–100，以 `limit + 1` keyset
pagination：

```http
GET /api/notifications?limit=20&before=<opaque-cursor>
```

```json
{
  "items": [
    {
      "id": 91,
      "type": "REPLY",
      "actor": "Alice",
      "actorHandle": "alice_ops",
      "postId": 42,
      "postContent": "Ship the boring fix first.",
      "replyId": 12,
      "replyContent": "Agreed.",
      "createdAt": "2026-09-02T10:00:00Z",
      "read": false
    }
  ],
  "nextCursor": null,
  "latestCursor": "MTo5MQ",
  "readThroughCursor": null,
  "unreadCount": 1
}
```

- `nextCursor` 非 null 時作為下一頁的 `before`；`before` 使用 strict `id < decodedId`，
  cursor 只是 opaque ordering boundary，response 仍只查 principal recipient。
- `latestCursor` 是目前最新 retained item 的 cursor，與目前 page 的 `before` 無關；
  沒有通知時為 null。
- `readThroughCursor` 是已保存 high-water ID 的 opaque encoding；尚未讀取時為 null。
- `unreadCount` 只計算 retained rows 中 `id > readThroughId` 的數量；每個 item 的
  `read` 等同 `id <= readThroughId`。
- `postContent` 是目前原文內容；`replyContent` 只在 `REPLY` non-null。
- Response 一律 `Cache-Control: private, no-store`；anonymous 回
  `401 AUTHENTICATION_REQUIRED`。無效 `limit` 回 `INVALID_LIMIT`，無效 cursor 回
  `INVALID_CURSOR`。

### `PUT /api/notifications/read`

需 authenticated session 與有效 CSRF。把 read high-water 推進到指定 retained 通知：

```http
PUT /api/notifications/read

{ "through": "MTo5MQ" }
```

```json
{ "readThroughCursor": "MTo5MQ", "unreadCount": 0 }
```

- `through` 必須 decode 成該收件者目前仍 retained 且 owned 的通知；其他帳號、已
  prune、malformed 或 non-canonical cursor 回 `400 INVALID_CURSOR`，read state 不變。
- 更新使用 `max(currentReadThroughId, requestedId)`，較舊的有效 cursor 不會讓已讀
  狀態倒退。
- Anonymous 回 `401 AUTHENTICATION_REQUIRED`；缺 CSRF 或 token 無效回
  `403 CSRF_TOKEN_INVALID`，且不得改變 read state。

### `GET /api/search`

Public、viewer-aware 的 original post 全文搜尋（replies 不索引），回傳與 timeline 相同
的 `PostPage` envelope（同一個 `Post` JSON shape：`timelineEntryId` 固定 `post:<id>`、
repost attribution 恒為 null、boolean viewer flags 永不為 null）。排序固定為
`(posts.created_at DESC, posts.id DESC)` 的確定性 keyset，不使用 OFFSET 或 FTS rank：

```http
GET /api/search?q=ship%20boring&limit=20&before=<opaque-search-cursor>
```

| 參數 | 預設 | 規則 |
|------|------|------|
| `q` | 必填 | plain terms；trim 後 1–100 個 Unicode code points、1–8 個 terms，每 term 至少一個 Unicode letter/digit；不接受 whitespace 以外的 ISO control |
| `limit` | `20` | `1..50`（僅 search 端點，與 timeline/replies/notifications 的 `1..100` 不同） |
| `before` | — | 上一頁的 search `nextCursor`；opaque，client 不解析 |

`q` 以 nullable `@RequestParam` 綁定後交由 service 驗證，缺漏回 `INVALID_QUERY`。
編譯器把每個完整 term 包成 FTS5 quoted phrase（內含 `"` 以 `""` escape）再以 `AND`
join，例如 plain `ship the` → `"ship" AND "the"`；quoting 讓 `NOT`/`OR`/`AND`/`NEAR`/
`(`/`)`/`^`/`:col` 不成 operator、`foo*` 不成 prefix，只把 input 當結構中性的
phrase；`unicode61` tokenizer 則把 `*` 這類 punctuation 視為 separator，不是可搜尋的
literal 資料。compiled string 一律以 bound `MATCH` parameter 傳入。結果：

```json
{
  "items": [
    {
      "id": 42,
      "timelineEntryId": "post:42",
      "author": "Alice",
      "authorHandle": "alice_ops",
      "content": "Ship the boring fix first.",
      "channel": "tech",
      "createdAt": "2026-09-02T10:00:00Z",
      "replyCount": 0,
      "likeCount": 3,
      "likedByViewer": false,
      "repostCount": 1,
      "repostedByViewer": false,
      "repostedBy": null,
      "repostedByHandle": null,
      "repostedAt": null,
      "image": null
    }
  ],
  "nextCursor": "<opaque search cursor>"
}
```

- `nextCursor` 非 null 時作為下一頁的 `before`；cursor 是 search 專屬 codec 的
  canonical no-padding Base64URL payload **`s1:<epoch-second>:<positive-id>`**，只當
  ordering boundary，不驗證該 post 是否仍存在或 ownership。Malformed、non-canonical、
  overflow、plus sign/`-0`/leading zero、非 search namespace（legacy timeline
  `1:<epoch>:<id>`、timeline v2 `2:<epoch>:<kind>:<id>`、notification `1:<id>`）一律回
  `400 INVALID_CURSOR`，且無 side effect。
- 相同 `created_at` 的 post 以 `id DESC` tiebreak，保證跨頁不重複、不缺漏；repository
  讀 `limit + 1` rows 判斷 hasMore。
- `likedByViewer`/`repostedByViewer` 依目前 session 計算，anonymous 為 boolean
  `false`（非 null）。Response 一律 `Cache-Control: private, no-store`，不可放進共享
  cache。
- 意外的 FTS/repository operational failure 回 `INTERNAL_ERROR` 並 log，不廣義映射成
  `INVALID_QUERY`。

V8 (SDD-009) 在 `V8__add_post_search.sql` 建立 external-content FTS5 virtual table
`search_posts`（`content='posts'`、`content_rowid='id'`、
`tokenize='unicode61 remove_diacritics 2'`）、migration-time `rebuild` 回填與三個
same-transaction trigger（`posts_search_ai`/`posts_search_ad`/`posts_search_au`，
UPDATE 以 `AFTER UPDATE OF content` 限定），replies 不索引。

### Frontend Search

- `api/search.ts` 提供 typed `fetchSearch(query, { before, limit })`，復用既有
  `PostPage` type，不建立同形 page type；search 是 safe GET，沿用 same-origin cookie
  與 in-memory CSRF client。
- App 新增 `{ kind: "search" }` route 與 `/search?q=...` path parser；header 的 Search
  entry 與 `/search` 頁內表單把 query 帶入 route，支援 direct load、nav 與 popstate，
  每個 route 有對應 title。
- `SearchView` 以 post id append/dedup、保存 next cursor、顯示 loading/empty/error 與
  Load more；結果 render 復用 `PostCard`，authenticated reply/like/repost 互動沿用既有
  工具，不新增 dependency。
- Query/route/account 改變時 bump request version，stale response 一律丟棄；account/
  session 改變（含 logout）以新 viewer 身份重跑目前 query，logout 以 anonymous 重跑
  有效 public route、不 disabled 也不清掉 query。

### Notifications 事件寫入與 retention

Notification 不另外建立 event bus：reply、like、repost 的來源 mutation 與
notification insert/prune 在同一個 `@Transactional` service（ReplyService 已補上
transaction；like/repost service 沿用原有 transaction boundary）。Event 只在來源
mutation 確實建立新 row 時產生：

- REPLY：reply row 建立後，依原文 `author_account_id` 產生事件；self reply 與 owner
  為 null 的 legacy 文章跳過。
- LIKE / REPOST：repository insert 回傳是否真的建立 relation（`ON CONFLICT DO
  NOTHING`），冪等重送的 PUT 不會再產生通知。
- Self interaction 與 owner 為 null 的 legacy 文章一律不產生事件。
- Unlike/unrepost 只移除 relation，不撤回歷史事件；其後新的 PUT 是新的
  interaction，產生新的 event 與新的 notification ID。

每次成功建立通知後，同一 transaction 刪除該收件者第 501 筆及更舊 rows，只保留
最新 500 筆（`idx_notifications_recipient_page (recipient_account_id, id DESC)`）。
Prune 不重寫 ID 也不降低 `readThroughId`；已刪除的 ID 仍可作為較新事件的比較
boundary。V7 不回填既有 interactions，首次部署後通知從 0 筆開始。

### 帳號、Session 與 CSRF

| Method | Path | Auth | 說明 |
|--------|------|------|------|
| GET | `/api/auth/csrf` | Public | 回傳 `headerName` 與 opaque token；`no-store` |
| POST | `/api/accounts` | Public + CSRF | 註冊；成功 201，不自動登入 |
| POST | `/api/auth/login` | Public + CSRF | JSON credentials；成功旋轉 session ID |
| GET | `/api/auth/session` | Public | 回傳 `{ "account": profile-or-null }` |
| POST | `/api/auth/logout` | Session + CSRF | 清除 context、session 與 cookie；成功 204 |
| GET | `/api/profiles/{handle}` | Public | 公開 profile |
| PATCH | `/api/profiles/me` | Session + CSRF | 修改自己的 display name 與 bio |
| GET | `/api/profiles/{handle}/posts` | Public | 該帳號 original/repost activity keyset page |

Handle canonicalize 為 lowercase，必須是 3–15 個 ASCII `a-z`、`0-9`、`_`。
Display name 為 1–50 characters，bio 最多 160 characters，password 為 12–72
UTF-8 bytes。Password 只保存 delegating BCrypt hash，永不出現在 response 或 log。

同源 client 的必要順序：

1. 啟動時呼叫 `GET /api/auth/csrf`，token 只保存在記憶體。
2. 同時呼叫 `GET /api/auth/session`，建立目前 identity state。
3. 所有 `POST`、`PUT`、`PATCH`、`DELETE` 都使用 response 指定的 header name/token。
4. Login/logout 完成後丟棄舊 token，等待新的 `/api/auth/csrf` response 才允許
   下一個 mutation。
5. `CSRF_TOKEN_INVALID` 不自動重試 mutation；顯示安全錯誤並重新載入 token/page。

以下 shell sequence 示範 registration；`csrf.json` 與 cookie jar 都是敏感的本機
暫存檔，不可提交或記錄 token 值：

```bash
BASE_URL=http://127.0.0.1:8080
curl -fsS -c cookies.txt -o csrf.json "$BASE_URL/api/auth/csrf"

# 從 csrf.json 讀取 headerName/token，並在同一 cookie jar 的 POST 中帶入：
curl -fsS -b cookies.txt -c cookies.txt \
  -X POST "$BASE_URL/api/accounts" \
  -H 'Content-Type: application/json' \
  -H '<headerName>: <token>' \
  -d '{"handle":"alice_ops","displayName":"Alice","password":"correct horse battery staple"}'
```

登入 request 使用 `{ "handle": "alice_ops", "password": "..." }`。Profile update
request 使用 `{ "displayName": "Alice Ops", "bio": "..." }`。Frontend
`api/client.ts` 已實作相同的 fail-closed sequence，且不使用 local/session storage。

### API 錯誤契約

所有 `/api/**` 非 2xx response 使用 RFC 9457 Problem Details，Content-Type 為
`application/problem+json`：

```json
{
  "type": "urn:phark:problem:validation-failed",
  "title": "Validation failed",
  "status": 400,
  "detail": "One or more request fields are invalid.",
  "instance": "/api/posts",
  "code": "VALIDATION_FAILED",
  "requestId": "req-example-123",
  "violations": [
    {
      "field": "content",
      "message": "content must not be blank"
    }
  ]
}
```

Client 應以 `code` 判斷流程，不解析 `title`、`detail` 或 validation message。
`detail` 是可顯示文字；`violations` 只在欄位驗證失敗時存在。未知 extension
members 必須忽略。

| Code | HTTP | 說明 |
|------|------|------|
| `VALIDATION_FAILED` | 400 | request body 欄位 constraint 失敗 |
| `INVALID_CHANNEL` | 400 | channel 不在允許清單 |
| `INVALID_QUERY` | 400 | 搜尋 `q` 缺失或違反 plain-term 規則（trim 後 1–100 code points、1–8 terms、每 term 至少一個 Unicode letter/digit） |
| `INVALID_LIMIT` | 400 | limit 不是整數或超出範圍（timeline/replies/notifications 為 1–100；search 為 1–50） |
| `INVALID_CURSOR` | 400 | timeline、replies、notifications、search 的 cursor 不合法或 namespace 不符 |
| `INVALID_POST_ID` | 400 | post ID 不是正整數 |
| `INVALID_MEDIA_ID` | 400 | media ID 不是正整數（含 type mismatch） |
| `INVALID_IMAGE` | 400 | image part 的 declared Content-Type 不合、declared 與 detected type 不一致、magic bytes 無效、完整 decode 失敗或 dimension/pixel 越界 |
| `IMAGE_TOO_LARGE` | 413 | image input > 5 MiB（含 multipart resolver rejection、service-level bounded read） |
| `MEDIA_NOT_FOUND` | 404 | media ID 為正整數但 metadata row 不存在 |
| `MALFORMED_REQUEST` | 400 | request body 缺失、語法錯誤、multipart required part（`post`/`image`）缺失或 `post` JSON malformed |
| `INVALID_CREDENTIALS` | 401 | 登入失敗；不區分 handle 或 password 原因 |
| `AUTHENTICATION_REQUIRED` | 401 | protected endpoint 缺少有效 session |
| `CSRF_TOKEN_INVALID` | 403 | unsafe request 缺少或使用無效 token |
| `ACCESS_DENIED` | 403 | authenticated account 沒有權限 |
| `PROFILE_NOT_FOUND` | 404 | 指定 handle 不存在 |
| `POST_NOT_FOUND` | 404 | 指定文章不存在 |
| `RESOURCE_NOT_FOUND` | 404 | API route/resource 不存在 |
| `METHOD_NOT_ALLOWED` | 405 | HTTP method 不支援 |
| `HANDLE_UNAVAILABLE` | 409 | canonical handle 已被註冊 |
| `DUPLICATE_REPORT` | 409 | 同一 account 對同一 target 已有一筆 unexpired report |
| `INVALID_REPLY_ID` | 400 | reply ID 不是正整數（含 type mismatch） |
| `REPLY_NOT_FOUND` | 404 | 指定回覆不存在 |
| `RATE_LIMITED` | 429 | 命中 fixed-window quota；帶 `RateLimit-*` 與 `Retry-After` header |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | request Content-Type 不支援 |
| `INTERNAL_ERROR` | 500 | 未預期錯誤；不回傳內部 exception details |

`INTERNAL_ERROR` 也用於 metadata 存在但 storage bytes 遺失 / byte length 或 SHA-256
不符 / 損壞的 media GET（log 完整，public body 不含內部路徑、storage key 或 SHA 值）。

Multipart create 的 error 區分：part 實際缺失或 `post` JSON malformed → `400
MALFORMED_REQUEST`；part 存在但 `content` 空白/超長或 `channel` 不合規 →
`400 VALIDATION_FAILED`（與 JSON 分支相同，不混用）；image 內容不合規 →
`400 INVALID_IMAGE` / `413 IMAGE_TOO_LARGE`。Public error 一律不含內部路徑、storage
key、SHA 或 client filename。

每個 response（成功或失敗）都有 `X-Request-ID`。Client 可提供符合
`[A-Za-z0-9._-]{1,64}` 的值；缺失或不合法時 server 會產生 UUID。Error body 的
`requestId` 與 response header 相同。支援或除錯時可固定 ID：

```bash
curl -i 'http://127.0.0.1:8080/api/posts?channel=news' \
  -H 'X-Request-ID: local-debug-123'
```

Request ID 只用於關聯 response 與 server log，不是 authentication 或可信資料。
未知 500 對外只回傳固定安全 detail，完整 exception 只記錄於 server log。

### Seed Data

啟動時若資料庫無文章，自動建立至少 9 筆（每個 channel 各 3 筆）。邏輯位於 `PostService.seedData()`。

### Frontend Repost Interaction

每個原文同時最多一個互動 mutation（like 或 repost）in flight，避免 repost 成功後
的 page refresh 與另一個 reaction response 互相覆蓋：

- `PostCard` 只 render attribution/count/state 並送 intent，不私藏 server state。
- Render key 與 load-more dedup 使用 `timelineEntryId`；同一原文的多個 activity
  不可用 `post.id` 去重。
- Like、reply 與 repost state patch 仍用原文 `id`，讓所有 visible copies 同步。
- Pure helper snapshot/rollback（`lib/postReposts.ts`）只含 repost fields，不覆蓋
  concurrent like/reply/attribution。
- Repost success 後重新載入權威 first page，新增或移除 actor activity；不以 client
  clock 偽造 `repostedAt`。Stale request version 不可覆蓋較新的 identity/feed load。
- Anonymous 不送 request；顯示登入 feedback。

### Frontend Notifications

- `AccountControls` 在 authenticated controls 提供 Notifications link/button；只有
  `unreadCount > 0` 才顯示 accessible badge，顯示值最高 `99+`。
- App 提供 `/notifications` client route；anonymous viewer 使用既有的 sign-in
  feedback，不發送 notification request。
- Session identity 載入或切換帳號成功後讀第一頁取得 badge；logout 立即清空
  notification state，避免跨帳號短暫洩漏。
- `NotificationView` 以 notification ID render/dedup，保存 next/latest cursor，逐頁
  append。
- Mark-all-read 只在 latest cursor non-null 且有未讀時可按；成功後把目前已載入的所有
  items 標為 read，並套用 server 回傳的 `readThroughCursor` 與 `unreadCount`；失敗時
  不 optimistic clear，保留 badge 並顯示錯誤。
- 本輪不 polling；進入通知頁、mark read 或 session identity 改變時才 refresh。

### `POST /api/posts/{postId}/reports` 與 `POST /api/replies/{replyId}/reports`（SDD-011）

需 authenticated session 與有效 CSRF。Target 與 target type 只來自 route path；body
只接受一個 supported reason，**不能 retarget**。成功回 `201 Created` 與
`Cache-Control: private, no-store`，回傳固定六欄的 redacted representation。**沒有** public
report-read/read-update/delete API、moderator role、moderation queue 或 operator
UI：report 是 intake-only，public 面 immutable `RECEIVED`，到期由 retention 刪除。

```http
POST /api/posts/17/reports
{ "reason": "SPAM" }
```

| 欄位 | 規則 |
|------|------|
| `reason` | 必填；僅 `SPAM`、`HARASSMENT`、`HATE_OR_VIOLENCE`、`SEXUAL_CONTENT`、`OTHER`；不接受自由文字 |

Success（`201`）：

```json
{
  "id": 42,
  "targetType": "POST",
  "targetId": 17,
  "reason": "SPAM",
  "status": "RECEIVED",
  "createdAt": "2026-09-04T12:00:00Z"
}
```

規則與錯誤：

- 同一 account 對同一 target 只能有一筆 **unexpired** report；重複（含換 reason）→
  `409 DUPLICATE_REPORT`，原 report/signal 不變。不同 account 對同一 target 各自
  成立。
- 該 reporter/target 的 expired rows 會在 create transaction 內先刪除再插入。
- Reporter 可以檢舉自己的內容；report 是 intake，不是 policy verdict。
- `postId`/`replyId` 非正整數（含 non-numeric route ID）→ `400 INVALID_POST_ID` /
  `400 INVALID_REPLY_ID`；target 不存在 → `404 POST_NOT_FOUND` / `404
  REPLY_NOT_FOUND`；unsupported/missing `reason` → 既有 `VALIDATION_FAILED` shape。
- Anonymous → `401 AUTHENTICATION_REQUIRED`；缺/錯 CSRF → `403 CSRF_TOKEN_INVALID`；
  兩者都在 MVC 之前發生，**不寫 report、signal 或 quota bucket**。
- Nested report routes 只吃 `REPORT_WRITE` account/IP quota，不吃 `CONTENT_WRITE`
  quota。

### Rate limiting 契約（SDD-011）

Rate limiting 是 abuse resistance，不是 authentication/authorization。只限
authenticated mutation（依 policy）與 register/login；public read、health、CSRF、
logout、profile edit、notification read 不在本輪限流範圍。App 維持單一 writer；
fixed window 允許 boundary 瞬間最多 **2× nominal quota** 的 burst；shared IPv4 NAT
與 IPv6 /64 共享同一 quota、可能產生 collateral throttling——這是第一版單 VPS 的
accepted limit。`RateLimit-Reset` 是 aligned window 的**剩餘秒數**，本專案**不宣稱
IETF RateLimit draft conformance**。

| Scope | Requests | Subject | Limit | Window |
|---|---|---:|---:|---:|
| `REGISTER` | `POST /api/accounts` | IP | 5 | 1 hour |
| `LOGIN` | `POST /api/auth/login` | IP | 10 | 15 minutes |
| `CONTENT_WRITE` | `POST /api/posts`, `POST /api/posts/{id}/replies` | account | 20 | 1 minute |
| `CONTENT_WRITE` | 同上 | IP | 60 | 1 minute |
| `SOCIAL_WRITE` | like/unlike, repost/unrepost | account | 120 | 1 minute |
| `SOCIAL_WRITE` | 同上 | IP | 240 | 1 minute |
| `REPORT_WRITE` | post/reply report creation | account | 10 | 1 hour |
| `REPORT_WRITE` | 同上 | IP | 20 | 1 hour |

- 所有 window 都是 **UTC epoch-aligned fixed window**；counter key 是
  `(scope, subject_kind, subject_hmac, window_start_epoch)`。
- Account policy 永遠先於 IP policy 評估；authenticated request 的 account 與 IP
  quota 在**同一 SQLite transaction** 保留，任一 exhausted 即 rollback 整個
  reservation，**被拒的 request 不部分消耗另一 policy**。
- Allowed 時 binding policy 是 remaining/limit 比例最小者（tie：最短 reset，再來
  account 在 IP 前）；denied 時 binding 是 stable 順序中第一個 exhausted 的 policy、
  public remaining 為 0。Reset 一律 `>= 1` 秒。
- 第 `limit + 1` 個 request 被拒：`429 application/problem+json`、code
  `RATE_LIMITED`（`urn:phark:problem:rate-limited`）、`Retry-After` =
  `RateLimit-Reset`、`Cache-Control: private, no-store`；body 不揭露 scope、
  subject kind/hmac、IP、account ID 或內部 counter。
- 通過 policy 的 response（含之後 controller 回 4xx/5xx）一律帶：
  `RateLimit-Limit`、`RateLimit-Remaining`（永不小於 0）、`RateLimit-Reset`。被
  authentication/CSRF 擋掉的 401/403 **不帶** rate-limit header、不寫 bucket。
  Accepted 後 controller 的 validation/conflict/not-found 仍揭露 consumed quota；
  duplicate report 也消耗一單位 `REPORT_WRITE`。

### 濫用信號、secret 與 retention（SDD-011）

- **Raw IP 永不儲存、永不 log、永不回傳**。Signal 只存 action kind、authenticated
  actor ID、exactly one target/report reference、keyed IP HMAC 與
  created/expiry；不存 user agent、forwarded-header chain、credentials、session ID、
  CSRF token、content copy、report text 或 risk score。
- Account/IP subjects 都是 **domain-separated HMAC-SHA-256**：account 為
  `HMAC-SHA-256(secret, "phark-account-v1:" + accountId)`；IP 以 domain prefix +
  family byte + canonical network bytes 輸入，輸出 lowercase 64-hex。Raw remote
  address 只存在 request boundary；持久層只接觸 HMAC，public API 不回傳它。
- **Production 必須提供 `APP_ABUSE_IP_HMAC_SECRET`**：unpadded base64url、decode
  後恰 32 bytes 的隨機值（產生命令見 `deploy/templates/deck/.env.example`）。prod
  profile startup 拒絕 missing/malformed/short/committed dev 值（fail-closed）；
  test/development 才用確定的非產線值。
- **Rotation 有意的後果**：新舊 HMAC 不可關聯、effective IP/account partition 全部
  重設、舊 rows 依 retention 自然老化；本輪不做 dual-key rotation。
- **Retention**：abuse signals 30 天、content reports 180 天、rate-limit buckets 於
  window end 後 24 小時；cleanup 在 **startup** 與每天 **03:00 UTC**（cron
  `0 0 3 * * *`，zone UTC）執行、idempotent；create-time 也會清該 reporter/target
  的 expired rows。Deletion 不會從 moderation table cascade 進 accounts/posts/
  replies/interactions/notifications/media。
- 沒有 moderator/admin workflow、anonymous report、free-text report、appeals、report
  status query 或 reporter-to-reporter visibility。

## 環境變數

| 變數 | 預設 | 說明 |
|------|------|------|
| `APP_DB_PATH` | 本地為 `./data/deck.db`；prod 為 `/data/deck.db` | SQLite 檔案路徑 |
| `APP_MEDIA_PATH` | 本地為 `./data/media`；prod 為 `/data/media` | 媒體 bytes 根目錄（`MediaStorage` local adapter root） |
| `SPRING_PROFILES_ACTIVE` | — | 設為 `prod` 啟用 production 設定 |
| `SERVER_PORT` | `8080` | HTTP 埠（prod profile） |
| `SESSION_COOKIE_SECURE` | 本地 `false`；prod `true` | HTTPS production 必須為 `true` |
| `SERVER_SERVLET_SESSION_TIMEOUT` | `30m` | In-memory HTTP session idle timeout |

### SQLite 設定

- JDBC URL：`jdbc:sqlite:<APP_DB_PATH>`
- Hikari `maximum-pool-size=1`
- 啟動 PRAGMA：`journal_mode=WAL`、`foreign_keys=ON`、`busy_timeout=5000`
- Schema 由 `db/migration/V*__*.sql` 依版本建立；legacy database 由 guard
  辨識後 baseline。撰寫與 production 操作見 [MIGRATIONS.md](./MIGRATIONS.md)
- **Database 不可打包進 Docker image**，必須透過 volume 掛載

### Spring Production 設定（`application-prod.properties`）

- `server.port=8080`
- `server.forward-headers-strategy=framework`（Traefik 代理必須）
- `server.shutdown=graceful`
- Session cookie 為 HttpOnly、SameSite=Lax、Secure；timeout 預設 30 分鐘
- Actuator 僅 expose `health`、`info`
- `/actuator/health` 供 Docker healthcheck 使用

Session 只存在單一 application instance 的記憶體；container restart、重新部署或
process crash 都會登出所有使用者。這是目前 replicas=1 邊界，不可把它解讀為
persistent login。多 instance 前必須先引入共享 session store。

## 本地開發

### 需求

- Java 17 + Maven 3.9+
- Node.js 24 + npm

### 本地前後端

先啟動 backend：

```bash
mvn -f backend/pom.xml spring-boot:run
```

開發環境預設將 SQLite 寫入 `./data/deck.db`。如需其他位置，可設定
`APP_DB_PATH`。

再於另一個 terminal 啟動 frontend：

```bash
cd frontend
npm ci
npm run dev        # http://localhost:5173
npm run lint
npm run build
```

開發伺服器會將 `/api/*` proxy 到 `http://localhost:8080`。

### 僅後端（含測試）

```bash
cd backend
mvn test
```

測試使用 in-memory SQLite（`app.db.path=:memory:`）。

### Docker 本機驗證（推薦）

```bash
docker build --progress=plain -t deck:local .

mkdir -p .local-data
# Linux 若 permission denied：
# sudo chown -R 10001:10001 .local-data

docker run --rm \
  --name deck-local \
  -p 8080:8080 \
  -e APP_DB_PATH=/data/deck.db \
  -e SPRING_PROFILES_ACTIVE=prod \
  -e SESSION_COOKIE_SECURE=false \
  -v "$(pwd)/.local-data:/data" \
  deck:local
```

驗證：

```bash
curl -fsS http://127.0.0.1:8080/actuator/health
curl -fsS http://127.0.0.1:8080/api/posts
```

瀏覽器開啟 http://127.0.0.1:8080

### Volume 權限注意

容器以 **UID/GID 10001**（使用者 `app`）執行。掛載本機目錄時必須可寫：

```bash
sudo chown -R 10001:10001 .local-data
```

使用 Docker named volume 則通常無此問題：

```bash
docker run --rm -p 8080:8080 -v stream-deck-data:/data stream-deck
```

## 測試

| 範圍 | 命令 | 覆蓋 |
|------|------|------|
| Backend | `mvn -f backend/pom.xml test` | account/auth/CSRF/ownership/profile、content/likes/reposts、mixed timeline/cursor、notifications、search compiler/cursor/repository/controller/errors、image validator/storage/media service/persistence、multipart create 與 `GET /api/media` contract/errors、migration（含 V8 FTS rebuild/trigger 與 V8→V9） |
| Frontend lint | `npm run lint`（在 `frontend/`） | oxlint |
| Frontend build | `npm run build`（在 `frontend/`） | TypeScript + Vite |
| 整合 | `docker build -t stream-deck .` | 含 frontend lint/build + Maven test |

## 專案約定

1. **不使用 JPA / Hibernate** — 資料存取使用 `JdbcClient`
2. **Package 名稱** — `com.example.deck`
3. **前後端同源** — production 不設定獨立 API domain；前端 `fetch('/api/...')`
4. **SPA 路由** — `WebConfig` 將非 API/actuator 請求 fallback 到 `index.html`
5. **單一 replica** — SQLite 限制，不可水平擴展多寫入實例
6. **不建立 Kubernetes 設定** — 部署走 Docker Compose + Traefik

## 給接手 LLM 的提示

- 改 post API 時同步更新 controller contract tests 與 `frontend/src/api/posts.ts`
- 改 multipart 或 `GET /api/media` 契約時同步更新 `PostController` 的 `consumes` handler、`ApiExceptionHandler` 的 error mapping、`ImageValidator`/`LocalMediaStorage`/`MediaService` 與 `frontend/src/api/posts.ts`/`Composer`/`PostCard`；public JSON/error 不含 sha256、storage key 或 client filename
- 新增 channel 需改：`CreatePostRequest`、新增一個 forward-only migration 更新
  CHECK constraint、`PostService` seed、`frontend` 的 `Channel` type 與 UI；不可修改
  已發布的 migration
- 部署相關設定在 `deploy/templates/` 與 `docs/DEPLOYMENT.md`，不在應用程式碼內
- CI/CD workflow 模板在 `deploy/templates/github/workflows/ci-cd.yml`，加入 repo 前需設定 GitHub Secrets
