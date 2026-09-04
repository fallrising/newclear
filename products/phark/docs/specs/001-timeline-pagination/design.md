# 001：時間線游標分頁設計

## 元件變更

```text
React Column
  └─ fetchPosts(channel, limit, before)
       └─ GET /api/posts
            └─ PostService（驗證 + cursor encode/decode）
                 └─ PostRepository（keyset SQL + limit + 1）
                      └─ SQLite posts
```

## Backend

### Response model

新增 `PostPage`：

```java
public record PostPage(List<Post> items, String nextCursor) {}
```

新增內部 `PostCursor`，保存 `Instant createdAt` 與正整數 `id`。Cursor codec
負責 URL-safe Base64 encode/decode，Controller 與前端都不解析內容。

### Cursor payload

未編碼 payload：

```text
<epoch-second>:<post-id>
```

選用 epoch second 是因為 SQLite schema 的 `datetime('now')` 精度為秒；`id`
作為同秒資料的穩定 tie-breaker。解碼後必須驗證 epoch second 可轉為 `Instant`
且 id 大於 0。

### Query

第一頁：

```sql
SELECT id, author, content, channel, created_at
FROM posts
WHERE channel = :channel
ORDER BY created_at DESC, id DESC
LIMIT :fetchLimit
```

下一頁另加：

```sql
AND (
  created_at < :cursorCreatedAt
  OR (created_at = :cursorCreatedAt AND id < :cursorId)
)
```

省略 channel 時使用相同排序與 cursor boundary，但不加入 channel predicate。
`fetchLimit = requestedLimit + 1`。Service 只回傳前 `requestedLimit` 筆；若多讀到
一筆，以回傳頁最後一筆產生 `nextCursor`。

### Index

以兩個 covering-order index 支援全域與 channel 查詢：

```sql
CREATE INDEX IF NOT EXISTS idx_posts_timeline
ON posts(created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_posts_channel_timeline
ON posts(channel, created_at DESC, id DESC);
```

既有單欄 index 可由新 composite indexes 取代。

### 錯誤處理

Service 在 Repository 呼叫前驗證：

- channel 屬於 allowlist
- limit 位於 `1..100`
- cursor 可被 codec 完整解碼

驗證失敗拋出 `ResponseStatusException(HttpStatus.BAD_REQUEST, ...)`。非整數 limit
由 Spring MVC request binding 回傳 400。

## Frontend

每個 channel 保存：

```ts
interface ChannelPageState {
  items: Post[]
  nextCursor: string | null
  loadingMore: boolean
  error: string | null
}
```

初次載入以 `Promise.all` 並行取得三欄第一頁。`loadMore(channel)` 只送出該欄的
`nextCursor`，成功後依 `id` 去重並 append。Composer 發文成功後重新取得三欄
第一頁，清除舊 cursor 與載入更多錯誤。

## 相容性

`GET /api/posts` response 由陣列改為 page object，屬於刻意的內部 API
breaking change。Repository 尚無外部 client 或發布版本；同一 commit series
同步更新 React client 與文件。`POST /api/posts` 完全相容。

## 可觀測性與效能

- 每個 request 最多從 SQLite 取 101 筆。
- 不計算 `COUNT(*)`，因此 UI 顯示「N loaded」，不宣稱總數。
- Cursor 不包含個資或 secret；Base64 僅是 opaque encoding，不作為簽章。

## 測試策略

- Controller integration tests：預設頁、limit、channel、invalid inputs。
- Repository integration tests：相同 timestamp 跨頁、channel boundary。
- Service/codec tests：cursor round trip 與 malformed cursor。
- Frontend：TypeScript build 驗證 page contract；人工/整合驗證三欄獨立載入。
- Docker build 作為最終全棧 gate。
