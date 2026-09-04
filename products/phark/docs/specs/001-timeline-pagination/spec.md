# 001：時間線游標分頁

> 狀態：Implemented
> 日期：2026-07-29

## 問題

目前 `GET /api/posts` 會一次讀取並傳回所有文章。資料量增加後，資料庫查詢、
JSON 序列化與三欄前端渲染成本都會隨總文章數無上限成長。

## 目標

- 每次 API 查詢只讀取有上限的一頁資料。
- Home、Tech、Ops 三欄可各自載入下一頁。
- 分頁期間若有新文章加入，不重複或跳過游標以前的舊文章。
- 相同 `created_at` 的文章仍維持穩定順序。
- 無效的 channel、limit 或 cursor 明確回傳 `400 Bad Request`。

## 非目標

- 不提供跳頁、總頁數或精確文章總數。
- 不實作無限捲動；本輪使用明確的「Load more」按鈕。
- 不處理文章刪除、編輯、按讚或回覆。
- 不改變 `POST /api/posts` 的 request/response。

## 使用者故事

1. 作為讀者，我開啟 Stream Deck 時，每欄先看到最新一頁文章。
2. 作為讀者，我可以只替某一欄載入更舊的文章，不影響其他欄。
3. 作為發文者，我發文後三欄重設到最新一頁，新文章立即出現。
4. 作為 API client，我收到不透明的下一頁游標，不需理解資料庫欄位。

## API 契約

### Request

```http
GET /api/posts?channel=home&limit=20&before=<opaque-cursor>
```

| 參數 | 必填 | 規則 |
|------|------|------|
| `channel` | 否 | `home`、`tech`、`ops`；省略時查詢全部 |
| `limit` | 否 | 整數 `1..100`，預設 `20` |
| `before` | 否 | 上一頁回傳的不透明 cursor |

### Success response

```json
{
  "items": [
    {
      "id": 9,
      "author": "Ivy",
      "content": "Scheduled maintenance window confirmed for Sunday.",
      "channel": "ops",
      "createdAt": "2026-07-29T10:00:00Z"
    }
  ],
  "nextCursor": "opaque-or-null"
}
```

- `items` 依 `createdAt DESC, id DESC` 排序。
- 只有確定仍有下一頁時 `nextCursor` 才是字串，否則為 `null`。
- `nextCursor` 指向本頁最後一筆資料；下一頁不包含該筆資料。

### Error response

下列輸入回傳 `400 Bad Request`：

- 未支援或空白的 `channel`
- 非整數、低於 1 或高於 100 的 `limit`
- 格式錯誤、無法解碼或數值非法的 `before`

錯誤本文沿用 Spring Boot 的標準 error response；client 不依賴錯誤字串。

## 功能需求

- **FR-001**：Repository 必須使用 keyset query，不得使用 `OFFSET`。
- **FR-002**：排序與游標邊界必須同時使用 `created_at` 和 `id`。
- **FR-003**：Repository 讀取 `limit + 1` 筆，以判斷是否存在下一頁。
- **FR-004**：Cursor 必須為 URL-safe、無 padding 的 Base64 字串，內容視為
  server implementation detail。
- **FR-005**：初次載入、單欄載入更多與發文後刷新不得產生重複文章。
- **FR-006**：單欄載入更多時，該欄按鈕顯示 loading 並避免重複請求。
- **FR-007**：沒有下一頁時不顯示「Load more」按鈕。

## 驗收條件

- [x] 無參數查詢最多回傳 20 筆，response 符合 page schema。
- [x] `limit=2` 可逐頁讀完資料，頁與頁之間無重複。
- [x] channel 分頁不會混入其他 channel。
- [x] 兩筆相同 timestamp 的文章可依 `id DESC` 穩定跨頁。
- [x] 新文章在讀取下一頁前加入時，舊游標分頁結果不重複。
- [x] 無效 channel、limit、cursor 均回傳 400。
- [x] 三欄可獨立載入更多，發文後重設為最新頁。
- [x] Backend tests、frontend lint/build、Docker build 全部通過。
