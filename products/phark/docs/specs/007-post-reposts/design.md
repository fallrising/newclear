# 007：文章轉發設計

## 邊界與資料流

```text
PostCard repost toggle
  ├─ patch every visible copy by original post ID
  ├─ PUT/DELETE + session cookie + CSRF
  ├─ success: reconcile RepostState, then refresh activity membership
  └─ failure: restore repost-only snapshot and surface error
                                  │
                                  ▼
Spring Security ──> PostRepostController ──> PostRepostService (@Transactional)
                                                    │
                                                    ├─ validate original post
                                                    ├─ insert-on-conflict/delete relation
                                                    └─ read count + viewer state
                                                                            │
                                                                            ▼
                                                          SQLite V6 post_reposts

GET timeline/profile ──> original/repost UNION ──> versioned mixed cursor page
                                      ├─ original content + shared interactions
                                      ├─ nullable repost attribution
                                      └─ viewer-aware repost EXISTS
```

## Schema V6

```sql
CREATE TABLE post_reposts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (post_id, account_id)
);

CREATE INDEX idx_post_reposts_timeline
    ON post_reposts(created_at DESC, id DESC);

CREATE INDEX idx_post_reposts_account_timeline
    ON post_reposts(account_id, created_at DESC, id DESC);
```

獨立 surrogate ID 是 timeline activity identity；unique constraint 是 actor/post
correctness boundary，且其 SQLite index prefix 同時支援 post count 與 viewer lookup。
Timeline index 支援 shared feed event ordering，account index 支援 profile feed。Relation 不
複製 content/channel/author，避免原文資料分叉。

## Domain models

- `Post` 新增 `timelineEntryId`、`repostCount`、`repostedByViewer` 與 nullable
  `repostedBy`、`repostedByHandle`、`repostedAt`。
- `Post.id` 始終是原文 ID；original entry key 是 `post:{postId}`，repost entry key 是
  `repost:{repostId}`。格式是 server detail，client 將整個字串視為 opaque。
- `RepostState` 只公開 `postId`、`repostCount`、`repostedByViewer`。
- Repository 以 internal `TimelinePost(Post, PostCursor)`（或等價 private projection）把
  pagination tuple 帶到 service，不把 SQL sort key 誤當 public post ID。

## Mixed timeline query

Repository 建立兩種 activity projection，再 `UNION ALL`：

1. Original branch：activity time=`posts.created_at`、kind=`POST`、entry ID=`posts.id`、
   attribution=null、profile actor=`posts.author_account_id`。
2. Repost branch：activity time=`post_reposts.created_at`、kind=`REPOST`、entry
   ID=`post_reposts.id`、profile actor=`post_reposts.account_id`；JOIN 原文與轉發者 account。

Outer query 對原文 ID 計算 reply/like/repost counts 與 viewer EXISTS，套用 channel、profile
actor、cursor predicate、`ORDER BY activity_at DESC, entry_kind DESC, entry_id DESC` 和
`LIMIT limit + 1`。Kind precedence 固定 `POST > REPOST`，只用於同秒 tie-break。

Global timeline 不依 viewer 做 delivery filtering；repost branch 繼承原文 channel。
Profile page 以 projection 的 profile actor filter，因此同一 endpoint 自然包含 owner originals
與 owner reposts。所有 copies 仍指向同一原文 ID，reply/like counts 不分叉。

## Versioned cursor

新 cursor payload 在 Base64URL 前的 logical form 是：

```text
2:<epoch-second>:<entry-kind>:<entry-id>
```

- `entry-kind` 只允許固定 canonical value；ID 必須為正數。
- Encoder 永遠產生 v2 token；decoder 嚴格拒絕 padding、非法字元、額外欄位、overflow
  與 non-canonical token。
- Decoder 仍接受 legacy `<epoch-second>:<post-id>`，映射成 `POST` tuple。Legacy token
  需以 legacy canonical encoder 驗證，不能用 v2 re-encode 比較。
- Cursor predicate完整比較 `(activity_at, entry_kind, entry_id)`，避免同秒跨 table ID
  collision。

這個版本化只存在 cursor codec/model 與 repository boundary；API 仍把 cursor 當 opaque
string，不暴露 migration branch。

## Repost repository/service/controller

### Repository

- `repost(postId, accountId)` 使用 parameterized
  `INSERT ... ON CONFLICT(post_id, account_id) DO NOTHING`，不更新 timestamp。
- `unrepost(postId, accountId)` 精確 DELETE；missing row 是正常結果。
- `getState(postId, accountId)` 在一個 query 回 count 與 EXISTS。
- 不先 read-before-write 判斷唯一性；database constraint 是 concurrent truth。

### Service 與 controller

- Service 先沿用原文 existence boundary 區分 invalid/missing post，再在 transaction 內
  mutation 與 state readback。
- Controller path `/api/posts/{postId}/repost`，PUT/DELETE 不接 request body。
- Actor 只來自 `AccountPrincipal.accountId`；SecurityConfig 明確保護兩種 method。
- Self/legacy repost 沿用相同 path，不建立特殊 error code。
- Mutation 不改 `posts.created_at`、content、channel、likes 或 replies。

## Frontend state 與 activity refresh

每個原文同時最多一個互動 mutation（like 或 repost）in flight，避免 repost 成功後的 page
refresh 與另一個 reaction response 互相覆蓋：

```text
idle
  └─ repost click ─> optimistic count/state + pending
                       ├─ success ─> RepostState reconcile
                       │             └─ refresh first page/activity membership
                       └─ failure ─> repost-only snapshot rollback + error
```

- `PostCard` 只 render attribution/count/state 並送 intent，不私藏 server state。
- `Column`/`ProfileView` render key 與 load-more dedup 改用 `timelineEntryId`；同一原文的多個
  activity 不可用 `post.id` 去重。
- Like、reply 與 repost state patch 仍用原文 `id`，讓所有 visible copies 同步。
- Pure helper snapshot/rollback 只含 repost fields，不覆蓋 concurrent like/reply/attribution。
- Repost success 後重新載入權威 first page，新增或移除 actor activity；不以 client clock
  偽造 `repostedAt`。Stale request version 不可覆蓋較新的 identity/feed load。
- Anonymous/security-not-ready 不送 request；顯示登入或安全初始化 feedback。

## Security、failure 與 cache

- CSRF filter 在 controller 前拒絕 invalid PUT/DELETE；401/403 沿用 RFC 9457 writer 與
  request correlation ID。
- Timeline/profile 因 `repostedByViewer` 保持 `Cache-Control: private, no-store`。
- 不接受 account/reposter identity body，不記錄 session、CSRF token 或 sensitive payload。
- FK cascade 讓未來刪除原文/account 時移除 activity；本輪沒有 deletion API。
- Database/UNION/cursor error fail closed，不 fallback 到只顯示 originals 的部分結果。

## 驗證策略

1. Migration：empty、V5/V4/V3、legacy baseline、FK/unique/index 與資料保留。
2. Persistence：重送 PUT/DELETE、兩 actor、timestamp stability、authoritative state。
3. Cursor/read：mixed same-second ordering、legacy cursor、channel/profile fan-out、attribution、
   viewer isolation 與 private cache。
4. Mutation API：auth/CSRF、invalid/missing/self/legacy post、actor spoof 與無副作用。
5. Frontend：lint、TypeScript/Vite production build；runtime 驗證 activity key/dedup/refresh。
6. Delivery：multi-stage Docker build、真實 cookie/CSRF two-viewer smoke、GitHub Actions。
