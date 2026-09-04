# 001：時間線游標分頁任務

## 階段 A：規格與設計

- [x] 定義問題、範圍與驗收條件。
- [x] 定義 page response 與錯誤契約。
- [x] 選定 `(created_at, id)` keyset cursor。
- [x] 定義前端各欄 state 與刷新行為。

## 階段 B：Backend vertical slice

- [x] 新增 `PostPage`、內部 cursor model 與 codec。
- [x] 將 Repository 查詢改為 bounded keyset query。
- [x] 新增 composite indexes。
- [x] Controller 接受 `limit`、`before` 並回傳 page object。
- [x] 增加正常、邊界與錯誤測試。
- [x] 更新 API 文件。

## 階段 C：Frontend vertical slice

- [x] 更新 TypeScript page contract 與 API client。
- [x] 每欄保存獨立 cursor、loading 與 error state。
- [x] Column 新增「Load more」互動。
- [x] 發文成功後重設三欄第一頁。
- [x] 更新使用者文件。

## 階段 D：整合驗證

- [x] Backend tests 通過。
- [x] Frontend lint/build 通過。
- [x] Docker build 通過。
- [x] 審查 migration、API contract 與空/錯誤狀態。

## 驗收記錄

2026-07-29：

- `docker build --progress=plain -t phark:timeline-frontend .` 成功。
- Oxlint：0 errors（1 個既有 `button.tsx` fast-refresh warning）。
- Vite/TypeScript production build 成功。
- Backend：32 tests，0 failures，0 errors。
- Production container health 為 `UP`，SPA 可讀取。
- Runtime API 驗證第一頁、下一頁、無效 channel 400 與 POST 後最新頁。
- GitHub Actions `Build container image` 通過。
