# 008：帳號通知設計

## 邊界與資料流

```text
reply / like / repost mutation
  └─ authenticated actor
       └─ domain service (@Transactional)
            ├─ validate post + resolve owner
            ├─ write source row/relation
            ├─ when newly created and actor != owner: insert notification
            └─ prune recipient rows after newest 500
                                      │
                                      ▼
                       SQLite V7 notifications/read state

Header badge / NotificationView
  ├─ GET /api/notifications (private, no-store)
  ├─ keyset page by notification ID
  └─ PUT /api/notifications/read + CSRF
                 └─ validate owned retained cursor + monotonic max
```

事件直接掛在三個既有 domain service transaction，不新增 event bus。這是目前同步、單資料庫
架構下最小且可證明 atomicity 的設計。

## Schema V7

```sql
CREATE TABLE notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    recipient_account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    actor_account_id INTEGER NOT NULL
        REFERENCES accounts(id) ON DELETE CASCADE,
    post_id INTEGER NOT NULL
        REFERENCES posts(id) ON DELETE CASCADE,
    reply_id INTEGER
        REFERENCES replies(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('REPLY', 'LIKE', 'REPOST')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    CHECK ((type = 'REPLY' AND reply_id IS NOT NULL)
        OR (type IN ('LIKE', 'REPOST') AND reply_id IS NULL)),
    UNIQUE (reply_id)
);

CREATE INDEX idx_notifications_recipient_page
    ON notifications(recipient_account_id, id DESC);

CREATE TABLE notification_read_state (
    account_id INTEGER PRIMARY KEY
        REFERENCES accounts(id) ON DELETE CASCADE,
    read_through_id INTEGER NOT NULL DEFAULT 0 CHECK (read_through_id >= 0),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`UNIQUE(reply_id)` 讓同一 reply 最多一筆事件；SQLite 允許多筆 null，LIKE/REPOST 的取消後
重建仍可產生新事件。Like/repost 的 active relation uniqueness 留在 V5/V6 source tables。
Read-through 不 foreign-key 到 notifications，避免 retention 刪除 boundary row 時破壞 state。

## Event 寫入與 atomicity

`PostRepository.findAuthorAccountId(postId)`（或等價 focused query）回 nullable owner，不把
internal account ID 暴露到 public `Post` JSON。

- Reply：`ReplyService.createReply` 加上 `@Transactional`；先建立 reply，取得 ID，再依 owner
  建立 `REPLY` notification。
- Like：`PostLikeRepository.like` 從 `void` 改為 `boolean`/affected row 判斷；只有 true 時建立
  `LIKE` notification。
- Repost：`PostRepostRepository.repost` 同樣回是否插入；只有 true 時建立 `REPOST`。
- Self/owner null 跳過 event insert。Service 仍完成來源 mutation。
- Unlike/unrepost 不呼叫 notification repository。

`NotificationRepository.insertAndPrune` 插入後，以 recipient-scoped ID boundary 刪除第 501 筆
及更舊 rows。所有 SQL parameterized；constraint/FK 或 prune failure 會讓 Spring transaction
rollback source row。

## Read model 與 pagination

Repository 以單一 recipient-scoped query JOIN actor、post 與 optional reply，並用
`notification.id < :beforeId`、`ORDER BY id DESC`、`LIMIT limit + 1` 取得 page。另一個 bounded
summary query（或同一 projection）取得 newest retained ID、read-through ID 與 unread count；
不做 per-item repository call。

Public models：

- `NotificationType`：固定 `REPLY | LIKE | REPOST`。
- `NotificationItem`：ID/type、current actor display name/handle、post ID/content、nullable reply
  ID/content、createdAt/read。
- `NotificationPage`：items、next/latest/read-through cursors、unreadCount。
- `NotificationReadState`：readThroughCursor、unreadCount。

`NotificationCursorCodec` 嚴格 canonical decode `Base64URL("1:<id>")`；拒絕 padding、非法字元、
額外欄位、0/負數、overflow、錯誤 UTF-8 與 re-encode 不一致。Paging cursor 只當排序 boundary；
read mutation 另用 recipient existence query 驗證該 ID 仍 retained 且 owned。

Read state upsert 使用 monotonic max：

```sql
INSERT INTO notification_read_state (account_id, read_through_id)
VALUES (:accountId, :requestedId)
ON CONFLICT(account_id) DO UPDATE SET
    read_through_id = MAX(notification_read_state.read_through_id, excluded.read_through_id),
    updated_at = CASE
        WHEN excluded.read_through_id > notification_read_state.read_through_id
        THEN datetime('now') ELSE notification_read_state.updated_at END;
```

## Controller、security 與 cache

- `NotificationController` 的 actor/recipient 只取自 `AccountPrincipal.accountId`。
- `GET /api/notifications` matcher 必須位於 `.requestMatchers(GET, "/**").permitAll()` 之前並
  authenticated。
- `PUT /api/notifications/read` authenticated 且沿用 session CSRF filter。
- `limit` 沿用 `INVALID_LIMIT`，所有 cursor failures 沿用 `INVALID_CURSOR`，不新增可推測其他
  account notification existence 的 error。
- Controller GET response 明確設定 `Cache-Control: private, no-store`；錯誤仍由既有 RFC 9457
  writer 與 request ID filter 處理。

## Frontend state 與 routing

- 新增 typed notification API/types；沿用 same-origin cookie 與 in-memory CSRF client。
- `AccountControls` 在 authenticated controls 顯示 Notifications link/button；`unreadCount > 0`
  才顯示 accessible badge，顯示值最高 `99+`。
- App 新增 `/notifications` client route，anonymous viewer 使用既有 sign-in feedback，不發送
  notification request。
- Session identity 成功載入或切換帳號後讀第一頁取得 badge；logout 立即清空 notification
  state，避免跨帳號短暫洩漏。
- `NotificationView` 以 notification ID render/dedup，保存 next/latest cursor，逐頁 append。
- Mark-all-read 只在 latest cursor non-null 時可按。成功後套用 server unreadCount，並把
  `id <= readThroughId` 的 visible items 標為 read；失敗時不 optimistic clear，保留 badge 並
  顯示錯誤。
- 本輪不 polling。使用者進入通知頁、mark read 或 session identity 改變時才 refresh。

## Failure、retention 與相容性

- Event insert/prune fail closed；不允許 source interaction 成功但通知 transaction 部分失敗。
- Read page/summary 任一 query 失敗就整個 request 失敗，不回部分 page 或假 unread count。
- Retention 只刪目前 recipient，保留全域 monotonic IDs；read-through 可能指向已 prune ID，
  仍可正確比較新事件。
- V7 不回填歷史 interactions；這避免把過去取消的 relation 誤當新事件，也讓部署成本 bounded。
- Existing replies/likes/reposts HTTP JSON 不變，只把 repository affected-row signal 留在 internal
  service boundary。

## 驗證策略

1. Migration：empty、V6/V5/V4/V3、legacy upgrade、checks/FKs/indexes、無回填與資料保留。
2. Event persistence：三 type、self/legacy skip、idempotent PUT、取消後重建、500-row prune、
   transaction rollback。
3. Cursor/read：canonical codec、strict keyset page、unread/high-water monotonic、ownership isolation。
4. API/security：auth/CSRF、private cache、invalid limit/cursor/body 與拒絕路徑無副作用。
5. Frontend：lint、TypeScript/Vite build；production runtime 驗證 badge/page/mark read/session reset。
6. Delivery：multi-stage Docker build、clean/populated V6-to-V7 migration、two-viewer cookie/CSRF smoke、
   GitHub Actions final head。
