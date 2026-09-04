# 002：回覆與對話串驗收紀錄

> 驗收日期：2026-07-29
> 實作 commit：`70f51b4`

## 自動化驗證

| Gate | 結果 | 證據 |
|------|------|------|
| Diff hygiene | 通過 | `git diff --check` 無輸出 |
| Frontend lint | 通過 | oxlint：0 errors、1 個既有 `button.tsx` Fast Refresh warning |
| Frontend build | 通過 | TypeScript + Vite production build |
| Backend tests | 通過 | 48 tests、0 failures、0 errors、0 skipped |
| Docker build | 通過 | image `phark-replies-frontend-check`，SHA `80e19ad7b003` |
| GitHub Actions | 通過 | `Build container image`，run `30472976647`、job `90647545343` |

## Production runtime smoke

使用 production image 啟動一次性 container
`phark-replies-smoke`（host port `18081`），完成後已停止並自動移除。

| 檢查 | 結果 |
|------|------|
| `GET /actuator/health` | `{"status":"UP"}` |
| `GET /` | 回傳 Stream Deck production SPA |
| `POST /api/posts` | 建立 post `id=10`，初始 `replyCount=0` |
| `POST /api/posts/10/replies` | `201 Created`，建立 reply `id=1` |
| `GET /api/posts/10/replies?limit=20` | 正序讀回 reply，`nextCursor=null` |
| `GET /api/posts?channel=home&limit=20` | post `id=10` 的 `replyCount=1` |

## 規格追蹤

- Repository 與 controller tests 覆蓋 parent isolation、正序與相同 timestamp
  cursor boundary。
- Controller tests 覆蓋 page schema、201、404、無效 post id、limit、cursor 與
  request body。
- Production smoke 覆蓋同源 SPA、文章建立、回覆建立、conversation 讀取與
  server-computed count。
- `ReplyThread` state 由每個 `PostCard` 擁有，load-more 與 submit 分別以同步
  ref 阻擋重複 request；合併資料時依 id 去重並重建正序。
