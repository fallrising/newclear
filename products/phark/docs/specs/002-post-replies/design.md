# 002：回覆與對話串設計

## 元件

```text
PostCard
  └─ ReplyThread
       ├─ GET /api/posts/{id}/replies
       └─ POST /api/posts/{id}/replies
              └─ ReplyService
                   ├─ PostRepository（parent existence）
                   └─ ReplyRepository（keyset page + insert）
                         └─ SQLite replies
```

## 資料模型

使用獨立 table，避免把回覆混入三個 channel timeline：

```sql
CREATE TABLE IF NOT EXISTS replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_replies_post_timeline
ON replies(post_id, created_at ASC, id ASC);
```

`Reply`：

```java
public record Reply(
        long id,
        long postId,
        String author,
        String content,
        Instant createdAt) {}
```

`Post` 增加 `long replyCount`。Timeline query 以 indexed correlated subquery 計算
每頁最多 20（上限 100）篇文章的 count：

```sql
(SELECT COUNT(*) FROM replies r WHERE r.post_id = p.id) AS reply_count
```

## 回覆分頁

回覆以正序顯示。第一頁：

```sql
SELECT id, post_id, author, content, created_at
FROM replies
WHERE post_id = :postId
ORDER BY created_at ASC, id ASC
LIMIT :fetchLimit
```

下一頁另加：

```sql
AND (
  created_at > :cursorCreatedAt
  OR (created_at = :cursorCreatedAt AND id > :cursorId)
)
```

重用 `PostCursorCodec` 的 opaque `(epoch-second, id)` encoding；API 參數名稱為
`after`，表達正序方向。Service 讀取 `limit + 1` 並以本頁最後一筆建立下一頁
cursor。

## Parent existence

GET 與 POST 都先呼叫 `PostRepository.existsById(postId)`：

- `postId <= 0`：400
- 不存在：404
- 存在但沒有回覆：200，`items=[]`、`nextCursor=null`

此檢查與 insert 在目前單 instance SQLite 邊界內足夠；未來加入 post deletion
時，foreign key 仍是最後一致性防線。

## Frontend state

`ReplyThread` 由每個 `PostCard` 擁有：

```ts
interface ReplyThreadState {
  expanded: boolean
  items: Reply[]
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  submitting: boolean
  error: string | null
}
```

- 第一次展開才 fetch。
- load more 以同步 ref 防止同一 thread 重複 request。
- append 前依 reply id 去重。
- 發表成功後 append reply，清空 content，並呼叫
  `onReplyCreated(postId)` 更新所有 timeline state 中該 post 的 `replyCount`。
- 每個 PostCard 的錯誤與 loading state 不影響其他欄或文章。

## 測試

- Repository：正序、同 timestamp、cursor boundary、parent isolation。
- Controller：page schema、validation、404、201 與 count。
- Codec：沿用 SDD-001 tests。
- Frontend：TypeScript/oxlint build gate。
- Integration：Docker build；production container 驗證 SPA、GET/POST replies 與
  timeline `replyCount`。
