# 架構與技術決策

> 最後更新：2026-09-04

本專案目標是在**閒置 VPS** 上建立一條**單機、可重現、可回滾**的部署路徑，**不碰 Kubernetes**。

## 部署藍圖

```text
本機 / Agent Coding CLI
        │
        │ git push master
        ▼
GitHub Actions
  ├─ Docker build + 測試
  ├─ 推送 ghcr.io
  └─ SSH 通知 VPS
        │
        ▼
VPS deploy script
  ├─ 拉取 sha-<commit> 映像
  ├─ Docker Compose 更新服務
  ├─ 等待 healthcheck
  └─ 失敗自動切回舊映像
        │
        ▼
Traefik
  ├─ 監聽 Docker labels
  ├─ 自動設定路由
  └─ Let's Encrypt HTTPS
```

三個核心組件的分工：

| 組件 | 角色 | 類比 K8s |
|------|------|----------|
| **Docker Compose** | 單機服務、網路、volume | Deployment + Service |
| **Traefik** | 依容器 labels 動態路由、HTTPS | Ingress Controller + Ingress |
| **GHCR** | 映像 registry | Container Registry |

參考：[Docker Compose 文檔](https://docs.docker.com/compose/)、[Traefik Docker Provider](https://doc.traefik.io/traefik/providers/docker/)、[GitHub Container Registry](https://docs.github.com/packages/working-with-a-github-packages-registry/working-with-the-container-registry)

## 版本鎖定（2026-07-13）

| 組件 | 版本 |
|------|------|
| Java | 17 |
| Spring Boot | 3.5.16 |
| Node.js | 24 LTS |
| SQLite JDBC | 3.53.2.0 |
| Traefik | 3.7.3 |

## 為何不用自訂 Nginx 事件腳本

自訂 Nginx 腳本的概念類似輕量 Ingress Controller（監聽容器事件 → 產生 upstream → reload），但不建議作為本專案基礎：

- 監聽 `ctr events`（containerd 低階介面），非 Docker Engine 正式 API
- 依賴 `ctr` 輸出格式、PID network namespace、`/proc/net/tcp`，環境敏感
- `PORT=0` 時可能選到錯誤的管理埠或 metrics 埠
- `DOMAIN` 未嚴格驗證
- 無效設定檔殘留會導致後續 `nginx -t` 持續失敗
- 缺少 HTTPS、自動憑證、健康檢查、部署回滾
- 未完整處理 `X-Forwarded-For`、`X-Forwarded-Proto` 等代理 headers

**保留事件驅動自動路由的概念，改用 Traefik：**

```yaml
labels:
  - "traefik.enable=true"
  - "traefik.http.routers.deck.rule=Host(`deck.example.com`)"
  - "traefik.http.services.deck.loadbalancer.server.port=8080"
```

容器啟動後 Traefik 自動更新路由，無需生成 Nginx 設定檔或手動 reload。

## 第一版：單體應用容器

```text
Spring Boot (port 8080)
├─ /api/*          REST API
├─ /actuator/*     健康檢查
├─ SQLite          /data/deck.db（volume 掛載）
└─ React static    編譯後放入 classpath:/static/
```

React build 完成後嵌入 Spring Boot `static` 目錄，production 時前後端同源。

## 帳號、Session 與 content ownership

```text
Browser SPA
  ├─ GET /api/auth/csrf + GET /api/auth/session
  ├─ HttpOnly JSESSIONID + in-memory CSRF token
  └─ POST/PATCH + server-selected CSRF header
              │
              ▼
RequestIdFilter → Spring Security filter chain
                  ├─ CSRF validation
                  ├─ HttpSession SecurityContext
                  └─ RFC 9457 401/403 writer
                              │
                              ▼
Controller → AccountPrincipal.accountId → Service → SQLite ownership FK
```

Password 使用 delegating BCrypt hash；login 失敗固定為 `INVALID_CREDENTIALS`，不提供
account enumeration signal。Login 旋轉 session ID，logout 清除 security context、
session 與 cookie。CSRF token 不放 cookie/localStorage，login/logout 後由 SPA 重新
取得且 mutation 不自動重試。

V4 的 `posts.author_account_id`、`replies.author_account_id` 是 nullable FK。新內容
只從 authenticated principal 寫入 ownership，同時保存 display-name snapshot；
read 以 account 的目前 display name 為優先。V1–V3 legacy rows 不回填、不認領，
仍以原始 `author` snapshot 顯示。

V5 的 `post_likes` 以 `(post_id, account_id)` composite primary key 保證每個帳號對
每篇文章只有一筆 relation，兩個 foreign keys 都使用 `ON DELETE CASCADE`。Like/unlike
使用 conflict-safe insert/精確 delete，在同一 transaction 讀回權威 count 與 viewer
state；identity 只取自 `AccountPrincipal`。Timeline/profile 的 bounded query 同時計算
共享 `likeCount` 與 session 專屬 `likedByViewer`，response 標記
`Cache-Control: private, no-store`。Frontend 先 optimistic toggle，再以 server state
對齊；failure 只復原 like snapshot，不覆蓋同時發生的 reply 或其他 post 更新。

V6 的 `post_reposts` 以 surrogate `id`（AUTOINCREMENT）作為 timeline activity identity，
`(post_id, account_id)` UNIQUE constraint 保證每帳號對每原文只有一筆 repost relation，
兩個 foreign keys 都使用 `ON DELETE CASCADE`。Repost/unrepost 使用
`INSERT ... ON CONFLICT DO NOTHING`（冪等 PUT）與精確 DELETE（冪等 DELETE），在
同一 transaction 讀回權威 `RepostState`（`postId`、`repostCount`、`repostedByViewer`）。
Timeline/profile 的 mixed query 使用 `UNION ALL` 合併 original 與 repost branch，
計算共享 `repostCount` 與 session 專屬 `repostedByViewer`；response 標記
`Cache-Control: private, no-store`。

Mixed timeline JSON 新增 activity identity、shared/viewer state 與 nullable attribution：

```json
{
  "id": 42,
  "timelineEntryId": "repost:17",
  "repostCount": 3,
  "repostedByViewer": false,
  "repostedBy": "Bob",
  "repostedByHandle": "bob_ops",
  "repostedAt": "2026-08-09T12:00:00Z"
}
```

- `id` 永遠是原文 ID；reply/like/repost mutation 都繼續使用這個 ID。
- `timelineEntryId` 是 opaque stable key；original 格式 `post:{postId}`、repost
  格式 `repost:{repostId}`，client 只比較相等與用作 dedup。
- Original activity 的 `repostedBy`、`repostedByHandle`、`repostedAt` 都是 `null`。
- Repost activity 的三個 attribution fields 都 non-null；原文 `author`、`authorHandle`、
  `content`、`channel`、`createdAt` 不被轉發者覆蓋。

Fan-out 規則：每個 original 保留一個 original activity（排序時間為原文 `createdAt`），
每筆 repost relation 產生一個 repost activity（排序時間為 relation `createdAt`）。
Profile posts 包含 owner originals 與 owner repost activities。排序固定為
`activity_at DESC, entry_kind DESC, entry_id DESC`；同秒 tie-break 由 kind
precedence（`POST > REPOST`）與 entry ID 決定。Mixed cursor 是 opaque、無 padding 的
Base64URL v2 token；其 canonical payload 為 `2:<epoch>:<kind>:<entryId>`。Decoder
仍接受 canonical legacy `<epoch>:<postId>` payload 的 Base64URL token，並將它解讀為
original activity boundary。Frontend render key 與 load-more dedup 使用
`timelineEntryId`；互動 patch（like/repost count/state）仍使用原文 `id` 讓所有
visible copies 同步。

V7 新增 `notifications` 與 `notification_read_state` 兩個 table。`notifications`
以 `UNIQUE(reply_id)` 保證同一 reply 最多一筆事件，LIKE/REPOST 的取消後重建仍可
寫入新事件（SQLite 允許多筆 null）；actor/recipient/post/reply 都使用
`ON DELETE CASCADE` foreign keys。`notification_read_state` 以 account 為 primary
key 保存 monotonic high-water `read_through_id`，不 foreign-key 到 notifications，
retention 刪除 boundary row 不會破壞 read state。

Reply/like/repost 的來源 mutation 與 notification insert/prune 在同一個
`@Transactional` service 中（ReplyService 已補上 transaction；like/repost 沿用
原有 transaction boundary），任一寫入失敗即整體 rollback。REPLY 事件只在 reply row
建立後依原文 `author_account_id` 產生；LIKE/REPOST 事件只在 repository insert 真的
建立新 relation 時產生（`ON CONFLICT DO NOTHING` 冪等重送不重複通知）。Self
interaction 與 owner 為 null 的 legacy 文章不產生事件；unlike/unrepost 不撤回歷史
事件，其後的新 PUT 是新的 interaction，會建立新事件與新 ID。

Notification API 只服務 authenticated viewer：actor 是執行 reply/like/repost 的使用者，
身份取自 `AccountPrincipal.accountId`；每筆通知的 recipient 是原文的
`author_account_id`。每個收件者只能看到自己的通知（recipient isolation），
`GET` response 明確設定 `Cache-Control: private, no-store`，security matcher 排在
public `GET /**` permitAll 之前。Paging 使用 notification ID keyset（`id < beforeId`、
`ORDER BY id DESC`、`LIMIT limit + 1`）；notification cursor 是獨立 codec 的
canonical Base64URL `1:<id>` token，與 mixed timeline cursor 不互通。
`readThroughId` 是 monotonic high-water mark：read mutation 使用
`max(current, requested)`，較舊 cursor 不會讓已讀狀態倒退，且 cursor 必須 decode 成
該收件者仍 retained 且 owned 的通知。`unreadCount` 只計算 retained rows 中
`id > readThroughId` 的數量。

Retention：每次成功插入通知後，同一 transaction 刪除該收件者第 501 筆及更舊 rows，
只保留最新 500 筆；`idx_notifications_recipient_page (recipient_account_id, id DESC)`
支援 recipient-scoped pagination/summary。Prune 不重寫 ID 也不降低
`readThroughId`。V7 不回填既有 interactions，部署當下從 0 筆開始，之後每筆新互動
產生事件。

Frontend 新增 `/notifications` client route 與 header unread badge：badge 只在
`unreadCount > 0` 顯示（上限 `99+`），session identity 載入或切換帳號後讀第一頁
取得 badge，logout 立即清空 notification state，避免跨帳號短暫洩漏。「全部標為已讀」
只在 latest cursor non-null 且有未讀時可按，成功後把目前已載入的所有 items 標為
read，並套用 server 回傳的 `readThroughCursor` 與 `unreadCount`；失敗時不做
optimistic clear，保留 badge 並顯示錯誤。本輪不 polling。

V8（SDD-009 search）新增 `search_posts`：一個 **external-content FTS5 virtual table**，
索引來源是 `posts.content`（original post content only；replies 留在 `replies` table，
**不索引**）。以 `content='posts'`、`content_rowid='id'` 宣告 external content，FTS 只
保存 index 與 mirror `posts.id` 的 rowid，內容以 `posts` 為真值；
`tokenize='unicode61 remove_diacritics 2'`。Migration 內緊接 `INSERT INTO
search_posts(search_posts) VALUES('rebuild')` 做 **migration-time rebuild**，把全部既有
original posts 立即索引（explicit backfill，與 SDD-008 的 no-backfill 決策相反，因 FTS
冷啟動無法配對）。三個 trigger 與 posts mutation **同一 transaction**，任一 trigger
失敗即 rollback post 寫入（fail-closed）：`posts_search_ai` AFTER INSERT、
`posts_search_ad` AFTER DELETE、`posts_search_au` **AFTER UPDATE OF content**（delete +
insert 覆寫 content 變更）。Search 的 keyset timestamp 一律由 source-of-truth `posts`
join 取得，FTS index 不複製 created_at。

`GET /api/search` 維持 **public viewer-aware**（在既有 `GET /**` permitAll 之下、
matcher 不擋 anonymous）：`SearchService` 用 `@Transactional(readOnly = true)`，先以
`SearchQueryCompiler` 把 plain terms 編譯成 **bound `MATCH` parameter**。Compiler 只
接受 trim 後 1–100 code points、1–8 terms、每 term 至少一個 Unicode letter/digit 的
輸入，把每個完整 term 包成 FTS5 quoted phrase（quote 以 `""` escape），再以 `AND`
join；quoting 讓 `NOT`/`OR`/`AND`/`NEAR`/`(`/`)`/`^`/`:col` 不成 operator、`foo*`
不成 prefix；`unicode61` tokenizer 則把 `*` 這類 punctuation 視為 separator，不是可
搜尋的 literal 資料。全部值都是 bound parameter，永不 string-concatenation。其他
FTS/operational unexpected failure 回 `INTERNAL_ERROR` 並
log，不廣義映射成 `INVALID_QUERY`。

分頁是確定性 keyset：排序 `(posts.created_at DESC, posts.id DESC)`，repository 讀
`limit + 1` rows，由最後一筆 delivered row 產生 next cursor。Cursor 是 search 專屬
codec 的 canonical **no-padding Base64URL payload `s1:<epoch-second>:<positive-id>`**，
`epoch-second` 是 UTC signed epoch seconds（canonical decimal，拒絕 plus sign、`-0`、
leading zero），`id` > 0；與 legacy timeline `1:<epoch>:<id>`、timeline v2
`2:<epoch>:<kind>:<id>`、notification `1:<id>` byte-distinct，不接受其他 namespace。
Cursor 只當 ordering boundary，不驗證 post 存在或 ownership。`limit` 預設 20、範圍
1–50（僅 search 端點，與 timeline/replies/notifications 的 1–100 不同）。

Response 復用既有 `PostPage` 與 `Post` JSON shape（不發明第二種 shape）：每個 item 都
是 original row，`timelineEntryId` 固定 `post:<id>`，repost attribution 恒為 null；
`likedByViewer`/`repostedByViewer` 是 boolean（anonymous 為 false、永不 null）。
Controller 明確設定 `Cache-Control: private, no-store`，viewer-aware payload 不可被
browser/CDN 快取。Frontend 新增 typed `api/search.ts` 與 `/search` SPA route：
`SearchView` 以 post id append/dedup、保存 next cursor、顯示 loading/empty/error 與
load-more，結果 render 復用 `PostCard`（authenticated reply/like/repost 互動沿用既有
工具，不新增 dependency）。Query/route/account 改變時 bump request-version，stale
response 一律丟棄；account/session 改變（含 logout）以新（或 anonymous）viewer 身份
重跑目前 query，logout 不 disabled 或清掉有效 public search route。

### V9（SDD-010 media attachments）：metadata 與 bytes 分離

V9 新增 one-to-one `post_images` metadata table（`post_id NOT NULL UNIQUE`、FK
`posts(id) ON DELETE CASCADE`、`storage_key NOT NULL UNIQUE`、strict CHECK 的
content_type/byte_size/width/height/sha256 與 `width * height <= 12000000`）。
SQLite **只存 metadata、不存 blob**：image bytes 一律落在 `${APP_MEDIA_PATH}`
（local `./data/media`、prod `/data/media`）。`sha256` 與 `storage_key` 是**內部**
欄位，永不進入 public JSON。V9 **不回填**：既有 V1–V8 posts 的 `image` 都是 null，
部署當下 `post_images` 為空。完整 schema、升級/降級與資料完整性程序見
[docs/MIGRATIONS.md](MIGRATIONS.md) 的 V9 段落；規格見
[docs/specs/010-media-attachments/spec.md](specs/010-media-attachments/spec.md) 與
[design.md](specs/010-media-attachments/design.md)。

**MediaStorage（byte-only boundary）**：`MediaStorage` interface 只暴露
`store(bytes, validatedExtension) -> storageKey`、`read(storageKey) -> bytes`、
`delete(storageKey)`，永不洩漏 `Path`、永不接受 client filename。`LocalMediaStorage`
是唯一 adapter：server-generated lowercase UUID-v4 storage key、whole-root 的
normalized-path/symlink/path-escape defense、temp file + `ATOMIC_MOVE`，都封裝在
adapter 內，不流入 service/controller/public contract。

**File-first、transaction later**：image validation（declared/detected type、magic
bytes、`ImageIO` 先讀 dimensions 驗過 pixel 界線才完整 decode、5 MiB bounded read）
與 file write 都發生在 short SQLite transaction 之前；post + metadata 以同一
transaction 原子 commit。commit 失敗 → compensating `delete(storageKey)`；crash-gap
（atomic move 成功後、commit 前）只會留下無 DB row 的 private orphan，由 stopped-app
reconciliation 清理。DB row 永遠不會先於檔案存在或暴露。

**Metadata-first read + integrity**：`GET /api/media/{id}` 先以正整數 metadata ID 查
`post_images`，再 `read(storageKey)`，serving 前驗證實際 byte length 與
`sha256(bytes)` 都與 metadata 一致。metadata 缺失 → `404 MEDIA_NOT_FOUND`；storage
遺失 / byte length 或 SHA-256 不符 / 損壞 → `500 INTERNAL_ERROR`（log 完整，public
body 不含內部路徑、storage key 或 SHA 值）。

**Public immutable media-ID URL**：一個 media ID 永遠只對應一組初次寫入的 stored
bytes，因此回應是 `Cache-Control: public, max-age=31536000, immutable`；
`Content-Disposition` 的 `filename` 依 public ID + canonical type 產生
（`image-<mediaId>.jpg|png`），永不使用 storage key 或 client filename。Create 的
multipart 分支與既有 JSON 分支是兩支 `@PostMapping`、依 `consumes` 分派；auth +
CSRF 與既有一致（Session + CSRF），media GET 維持在既有 `GET /**` permitAll matcher
之下、不新增 authenticated matcher。

**Deployment boundary**：維持單一 `/data` volume（`deck.db` metadata + `/data/media`
bytes）與 read-only root FS，prod 設定 `APP_MEDIA_PATH=/data/media`。Backup/restore/
migration 把 stopped SQLite 檔案與 media directory 視為**同一個 release snapshot**；
orphan reconciliation 是 stopped-app 的 runbook，DB 層不負責刪檔。完整操作程序見
[docs/MIGRATIONS.md](MIGRATIONS.md) 的 media snapshot/restore/reconciliation 與
[docs/DEPLOYMENT.md](DEPLOYMENT.md) 的步驟 5/6；本節只記錄決策與 boundary，不重複
runbook 內容。

### V10（SDD-011 moderation and abuse controls）：buckets、reports、signals

V10 新增三張 **internal-only** 資料表：`abuse_rate_limit_buckets`（restart-persistent
fixed-window 計數器）、`content_reports`（authenticated 檢舉）與 `abuse_signals`
（minimized author/IP 來源信號）。三者都以明確 FK/`ON DELETE`/CHECK/partial-unique/
expiry index 約束，只會 cascade 刪除 moderation rows，**任何 moderation table 都不能
cascade 進 accounts、posts、replies、interactions、notifications 或 media**。V10
**不做 backfill**：legacy content 的歷史 IP origin 未知，不留假信號，仍可被檢舉。
完整 schema 與操作程序見 [docs/MIGRATIONS.md](MIGRATIONS.md) 的 V10 段落。

**Request-rate boundary**：MVC interceptor 在 Spring Security 之後、controller 之前，
依 exact method/path 對應 policy set，在**單一 SQLite transaction** 內以
account-then-IP 順序條件式 upsert 保留 quota。Counter key 是
`(scope, subject_kind, subject_hmac, window_start_epoch)`；window 是 UTC
epoch-aligned fixed window，bucket 在 window end 後 24 小時到期。deployment 維持
單一 writer，rate-limit state 從 SQLite 讀寫，因此 **restart 後 quota 仍在**。

**網路 identity boundary**：raw IP 永不持久化、永不進 log、永不回傳。Account subject
以 `HMAC-SHA-256(secret, "phark-account-v1:" + accountId)` 產生；IP subject 是
domain-separated HMAC-SHA-256——先處理成 canonical network bytes（strict four-octet
IPv4；IPv4-mapped IPv6 正規化為 IPv4；native IPv6 只 hash 前 8 bytes、即 /64
partition；拒絕 whitespace/zone/hostname/DNS lookup），HMAC 輸出是 lowercase
64-hex。Production 需要 `APP_ABUSE_IP_HMAC_SECRET`（unpadded base64url、decode 後
恰 32 bytes）；prod startup 拒絕 missing/malformed/short/dev 值。**Rotation 有意的
重設有效 partition 並斷開新舊 HMAC 關聯**，舊 rows 依 retention 自然老化（無
dual-key rotation）。

**Trust boundary**：只有 Traefik publish 80/443，app port 不 publish。Prod 才有
`server.forward-headers-strategy=framework`，且只限於收到 Traefik 淨化後的流量
（Traefik `forwardedHeaders.insecure=false` 於 web/websecure、JSON access log drop
`ClientAddr`/`ClientHost`/`ClientPort`、全部 request headers 與 query parameters）。
任何在共享 `proxy` network 上的 container 都在 trusted infrastructure boundary
內；直接 publish port 的本機 smoke 要顯式 `SERVER_FORWARD_HEADERS_STRATEGY=none`。

**Retention**：signals 30 天、reports 180 天、rate-limit buckets 於 window end + 24
小時；cleanup 在 startup 與每天 03:00 UTC（cron `0 0 3 * * *` zone UTC）執行，
idempotent，create-time 也會先清該 reporter/target 的過期 rows。新增 quota/report/
signal/429 的 header 與 RFC 9457 契約見 [docs/DEVELOPMENT.md](DEVELOPMENT.md)；
執行面向的 secret/backup/rollback/smoke 見 [docs/DEPLOYMENT.md](DEPLOYMENT.md) 與
[MIGRATIONS.md](MIGRATIONS.md)。

HTTP session 是單 instance process memory，idle timeout 預設 30 分鐘；restart 或
重新部署會登出所有使用者。這與 SQLite 的 replicas=1 限制一致，但不是 durable
login。需要水平擴展時，shared session store 與 PostgreSQL 必須一起重新評估。

### 好處

- 只有一個 image、一個 healthcheck
- 前後端同源，無需 CORS
- Traefik 只需一條 route
- SQLite 只被一個應用實例存取
- 部署與回滾簡單

### 後續擴展（本輪不做）

- 前端拆成獨立 Nginx container
- WebSocket
- 背景 worker
- 其他微服務

## 與 Kubernetes 的對照

| Kubernetes 概念 | 目前單機方案 |
|-----------------|-------------|
| Deployment | Docker Compose service |
| Pod | container |
| Service | Docker network DNS |
| Ingress Controller | Traefik |
| Ingress | Traefik labels |
| Container Registry | GHCR |
| Readiness/Liveness probe | Docker healthcheck |
| Rollout | deploy script + SHA image |
| Rollback | `.env` 恢復舊 image |
| PersistentVolume | `/opt/apps/deck/data` |
| ConfigMap | `.env` |
| CronJob | systemd timer（規劃中） |
| Namespace | Compose project + network |
| Scheduler | 暫無（單機） |

本方案**不具備** K8s 的多節點 scheduler、工作負載自動重分配、真正的 rolling deployment 或控制面 HA，但對單台 VPS 已足夠清楚、可控。

## SQLite 現階段界線

SQLite 適合第一版：

- 無需額外 database container
- 備份即單一檔案
- 管理成本低
- 適合單機小型服務

### 限制

- **replicas 必須為 1** — SQLite 採檔案鎖，同一 database 同時只有一個 writer
- WAL 模式可改善 reader/writer 並行，但不等同多節點資料庫
- 不要在 app 運行時直接 `cp deck.db`；應使用 [SQLite Online Backup API](https://sqlite.org/backup.html)

### 何時換 PostgreSQL

- 多 instance 水平擴展
- 大量並行寫入
- 零停機藍綠部署
- 多台 VPS
- 外部 worker 同時寫入

## 安全注意事項

1. **`docker` group 等同 root 權限** — 使用專用 `deploy` 帳號，GitHub Actions 透過 SSH forced command 限制只能執行部署腳本
2. **Traefik 讀取 Docker socket** — 即使 `:ro` 仍為高權限；正式加固時應改用 socket proxy 或 rootless Docker
3. **應用容器不 publish port** — 僅 Traefik 對外開放 80/443；Docker publish 可能繞過 UFW
4. **映像以 `sha-<commit>` 部署** — 不使用漂移的 `latest` tag 作為 production 部署目標
5. **Session cookie 只經 HTTPS** — production profile 預設 Secure、HttpOnly、SameSite=Lax；只有本機 HTTP smoke 可顯式關閉 Secure
6. **CSRF secrets 不持久化** — token 只存在 server session 與 SPA memory，不進 URL、storage 或 log
