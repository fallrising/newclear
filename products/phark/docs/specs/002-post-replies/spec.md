# 002：回覆與對話串

> 狀態：Implemented
> 日期：2026-07-29

## 問題

目前文章只能被閱讀，沒有最基本的對話能力。Phark 尚未有帳號系統，因此本輪沿用
既有自由輸入 author 的模式，先建立單層回覆與穩定分頁，避免提前綁定身份設計。

## 目標

- 使用者可在文章卡片內展開對話串。
- 使用者可送出一則單層回覆。
- 回覆依時間正序顯示，並可用 cursor 載入後續資料。
- 每篇文章在時間線顯示正確的 `replyCount`。
- 不存在的 parent post 明確回傳 `404 Not Found`。

## 非目標

- 不支援 reply-to-reply 或任意深度樹狀對話。
- 不支援編輯、刪除、排序演算法或折疊低品質回覆。
- 不建立帳號、權限、通知或 moderation。
- 不將回覆混入 Home、Tech、Ops 的主時間線。

## 使用者故事

1. 作為讀者，我可看到每篇文章的回覆數。
2. 作為讀者，我可展開某篇文章並先讀取最舊的 20 則回覆。
3. 作為讀者，我可載入同一對話串的後續回覆，不產生重複。
4. 作為參與者，我可輸入 author 與 content 發表回覆。
5. 作為參與者，我發表成功後可立即看到新回覆與更新後的回覆數。

## API 契約

### Timeline post

既有 `Post` response 增加：

```json
{
  "id": 1,
  "author": "Alice",
  "content": "Hello",
  "channel": "home",
  "createdAt": "2026-07-29T10:00:00Z",
  "replyCount": 2
}
```

### 讀取回覆

```http
GET /api/posts/{postId}/replies?limit=20&after=<opaque-cursor>
```

| 參數 | 必填 | 規則 |
|------|------|------|
| `postId` | 是 | 正整數且 parent post 必須存在 |
| `limit` | 否 | 整數 `1..100`，預設 `20` |
| `after` | 否 | 上一頁回傳的不透明 cursor |

成功：

```json
{
  "items": [
    {
      "id": 7,
      "postId": 1,
      "author": "Bob",
      "content": "Agreed.",
      "createdAt": "2026-07-29T10:01:00Z"
    }
  ],
  "nextCursor": null
}
```

排序固定為 `createdAt ASC, id ASC`。

### 建立回覆

```http
POST /api/posts/{postId}/replies
Content-Type: application/json

{
  "author": "Bob",
  "content": "Agreed."
}
```

- 成功回傳 `201 Created` 與建立後的 `Reply`。
- `author` 不可空白、最多 80 字。
- `content` 不可空白、最多 500 字。

### 錯誤

- parent post 不存在：`404 Not Found`
- `postId <= 0`、limit 或 cursor 無效：`400 Bad Request`
- request body validation 失敗：`400 Bad Request`

## 功能需求

- **FR-001**：回覆保存於獨立 `replies` table，並以 foreign key 連到 `posts`。
- **FR-002**：回覆 query 使用 `(created_at, id)` keyset，不使用 `OFFSET`。
- **FR-003**：Repository 讀取 `limit + 1` 筆判斷 `nextCursor`。
- **FR-004**：`replyCount` 由 server 計算，不信任 client。
- **FR-005**：展開不同文章時，各 conversation state 必須彼此獨立。
- **FR-006**：同一對話串不得同時送出重複的 load-more request。
- **FR-007**：發表成功後，新回覆只加入目標對話串，並同步更新 timeline count。
- **FR-008**：載入與發表錯誤顯示在目標文章內，不遮蔽其他欄位。

## 驗收條件

- [x] Timeline page 的每篇文章都包含 `replyCount`。
- [x] 無回覆的既有文章 `replyCount` 為 0。
- [x] `limit=2` 可依正序逐頁讀完回覆且無重複。
- [x] 相同 timestamp 的回覆可依 `id ASC` 穩定跨頁。
- [x] 建立回覆回傳 201，timeline count 隨後增加。
- [x] 不存在的 parent 在 GET/POST 都回傳 404。
- [x] 無效 postId、limit、cursor 與 body 均回傳 400。
- [x] 三欄內的對話串可獨立展開、載入與發表。
- [x] Backend tests、frontend lint/build、Docker build 與 runtime smoke 全部通過。
