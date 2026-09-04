# 006：文章按讚設計

## 邊界與資料流

```text
PostCard optimistic toggle
  ├─ update every visible copy by post ID
  ├─ PUT/DELETE + session cookie + CSRF
  ├─ success: reconcile LikeState from server
  └─ failure: rollback snapshot and surface error
                         │
                         ▼
Spring Security ──> PostLikeController ──> PostLikeService (@Transactional)
                                              │
                                              ├─ validate post existence
                                              ├─ insert-on-conflict / delete relation
                                              └─ read authoritative count + viewer state
                                                                         │
                                                                         ▼
                                                                    SQLite V5

GET timeline/profile ──> optional principal ──> one bounded post query
                                              ├─ correlated like count
                                              └─ viewer EXISTS or literal false
```

## Schema V5

```sql
CREATE TABLE post_likes (
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (post_id, account_id)
);
```

Composite primary key 同時支援 post count scan 與精確 viewer lookup，並把 per-user
uniqueness 放在 persistence boundary。現行需求不按 account 或 `created_at` 查詢，故不加
未被使用的 secondary index。Migration 只新增 table，不改 posts/accounts，讓 V3、V4
與 baseline upgrade 維持 additive。

## Backend components

### Models

- `Post` 新增 `long likeCount`、`boolean likedByViewer`。
- `LikeState` 只公開 `postId`、`likeCount`、`likedByViewer`。
- 不公開 relation ID、account ID 或 timestamp。

### PostLikeRepository

- `like(postId, accountId)`：parameterized
  `INSERT ... ON CONFLICT(post_id, account_id) DO NOTHING`。
- `unlike(postId, accountId)`：精確 DELETE，missing row 是正常結果。
- `getState(postId, accountId)`：同一 query 回 count 與 EXISTS。
- 唯一性衝突不轉成 API error；其他 database error 仍 fail closed。

### PostLikeService / controller

- Service 先以既有 post existence boundary 區分 404，再在 transaction 內 mutation 與
  state readback。
- Controller path 是 `/api/posts/{postId}/like`，PUT/DELETE 都不接 request body。
- Actor 只來自 `AccountPrincipal.accountId`；SecurityConfig 明確保護兩種 method。
- `postId` validation 與 not-found error 沿用 replies 的既有 error code/訊息慣例。

### Viewer-aware post reads

Controller 將 nullable principal account ID 傳給 PostService/Repository。Repository 使用
兩個固定 query shape，避免 nullable bind 與三值邏輯：

- anonymous：`0 AS liked_by_viewer`
- authenticated：`EXISTS (... account_id = :viewerAccountId) AS liked_by_viewer`

兩者都以 correlated subquery 計算 `like_count`。Channel/profile filter、keyset predicate、
`ORDER BY created_at DESC, id DESC` 與 `limit + 1` 完全不變。Controller 對 timeline 與
profile-post response 設定 `Cache-Control: private, no-store`。

## Transaction 與 concurrency

Database primary key 是多 request 或未來多 connection 下的唯一 truth。Service 不做
`exists` 後 insert 的 check-then-act。單連線 pool 讓當前 writes serialize，但設計不依賴
此實作細節。Like/unlike 與 state readback 使用同一 transaction，讓 response 至少反映
本次 mutation；其他已提交 writer 仍可合理影響共享 count。

## Frontend state machine

每個 post 同時最多一個 like mutation in flight：

```text
idle
  └─ click ─> optimistic + pending
                 ├─ success ─> replace with server LikeState ─> idle
                 └─ failure ─> restore snapshot + error ──────> idle
```

- `PostCard` 是純 render/intent boundary，接收 session/security readiness、pending 與
  `onToggleLike`；不私藏 count state。
- App 以 post ID functional update 三個 feeds 的每個副本。
- ProfileView 使用相同的 pure post-patching helper 更新自己的 page。
- Pending set 以 post ID 防止 rapid double-click/out-of-order response；button pending 時 disabled。
- Optimistic state 用 `likedByViewer ? count - 1 : count + 1`，count floor 為 0。
- Success 覆寫 server 的兩個欄位，不做第二次算術；failure 只復原該 request 的 snapshot。
- Anonymous 或 security 尚未 ready 時不送 mutation；UI 引導登入或顯示安全初始化錯誤。
- Login/logout 會依現有流程重新載入 viewer-aware feeds，server state 取代舊 viewer state。

## Security、failure 與 observability

- CSRF filter 在 controller 前拒絕 invalid PUT/DELETE；request ID filter 繼續讓 401/403
  具有 correlation ID。
- 401、403、400、404 與 unexpected error 都維持 RFC 9457 schema。
- Frontend 顯示既有 `ApiError.message`，不吞掉 mutation failure。
- 不記錄 session、CSRF token 或 liker payload；relation 沒有敏感 request body。

## 驗證策略

1. Migration tests：empty、V3/V4 upgrade、legacy baseline、FK/PK 與資料保留。
2. Repository tests：兩 actor、重複 insert、重複 delete、count/viewer state。
3. Controller/contract tests：auth、CSRF、invalid/missing post、viewer isolation、legacy/self-like。
4. Regression：完整 Maven suite；確保 cursor、reply count、ownership/profile 不變。
5. Frontend：oxlint、TypeScript/Vite production build。
6. Delivery：multi-stage Docker build、真實 cookie/CSRF runtime smoke、GitHub Actions。
