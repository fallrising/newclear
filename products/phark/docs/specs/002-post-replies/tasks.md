# 002：回覆與對話串任務

## 階段 A：規格與設計

- [x] 定義範圍、非目標與驗收條件。
- [x] 定義 Reply、ReplyPage 與 `replyCount` 契約。
- [x] 選定獨立 replies table 與正序 keyset cursor。
- [x] 定義 inline conversation state 與錯誤邊界。

## 階段 B：Backend vertical slice

- [x] 新增 replies schema 與 composite index。
- [x] 新增 Reply model、request、page、repository。
- [x] 新增 parent validation 與 ReplyService。
- [x] 新增 nested replies controller routes。
- [x] Timeline Post 增加 server-computed `replyCount`。
- [x] 增加正常、分頁、404 與 validation tests。
- [x] 更新 API 文件。

## 階段 C：Frontend vertical slice

- [x] 更新 Post、Reply、ReplyPage TypeScript contract。
- [x] 新增 replies API client。
- [x] 新增 ReplyThread 與 reply composer。
- [x] PostCard 顯示 count 並獨立展開 conversation。
- [x] 發表後 append reply 並更新 timeline count。
- [x] 更新使用者文件。

## 階段 D：整合驗證

- [x] Backend tests 通過。
- [x] Frontend lint/build 通過。
- [x] Docker build 通過。
- [x] Production container runtime smoke 通過。
- [x] GitHub Actions 通過。
