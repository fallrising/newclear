# FE Review — goku web — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**。每次修改都走 PR。

## 目標

第 2 輪結束時，`web/` 能在隔離環境內以 json-server 合成資料啟動並擷取；API 失敗時畫面明確顯示錯誤而不是「沒有書籤」；卡片操作可用鍵盤與螢幕閱讀器使用；repository 不再追蹤 `web/.env`。

## 依據

- REVIEW.md 已決定：休眠元件可在第 2 輪於本檔範圍內修改前端（PORTFOLIO「休眠」fe-review 例外）。
- 假設（待擁有者在本 PR 確認）：
  - **A1（D2）**：`web/.env` 移出追蹤，改為 `web/.env.example`。已確認 `.env` 只有 `VITE_API_URL`，值與 `src/services/api.ts:4` 的預設值相同，不是敏感值；移除後行為不變。
  - **A2（D3）**：不升級 React 18／Vite 5／Tailwind 3。
- 相關規範：[AGENTS.md](../AGENTS.md)（文件先行、未跑不可寫通過）；[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md) 第 0、4 節。

## 不做的事

- 不升級任何 major 依賴（A2），不新增測試框架或其他依賴。
- 不改 Go API、CLI、MQTT consumer。
- 不新增 dark mode（目前沒有任何 `dark:` 樣式），不改文案語言。
- 不改刪除行為（例如加確認對話框），不重新設計卡片或版面。

## 修改項目

### M1 `web/.env` 改為範例檔
- 對應：C1、D2（A1）
- 現況：`web/.env` 被 Git 追蹤；值與 `src/services/api.ts:4` 的 fallback 相同。
- 修改：`git rm --cached web/.env` 並刪除；新增 `web/.env.example`（`VITE_API_URL=http://localhost:3001/api`）；`web/.gitignore` 加 `.env`。
- 驗證：`npm run build` 成功；`git ls-files web/.env` 無輸出；dev 模式仍連到 3001。
- 風險與回滾：使用者若依賴已追蹤的 `.env` 指向其他 URL，需自行建立；還原兩個檔案即回滾。

### M2 卡片操作的可讀名稱與鍵盤可見性
- 對應：C3
- 現況：`src/components/BookmarkCard.tsx:89-101` 的編輯與刪除是只有圖示的 `<button>`，沒有可讀名稱；容器 `opacity-0 group-hover:opacity-100`，鍵盤 focus 時仍看不見。
- 修改：兩個按鈕加 `aria-label`（「Edit bookmark」「Delete bookmark」）與 `type="button"`；容器加 `group-focus-within:opacity-100`，按鈕加可見的 `focus-visible` 樣式。檢查 `BookmarkMenu.tsx`、`Sidebar.tsx` 中其他只有圖示的按鈕並同樣處理。
- 驗證：`npm run lint`、`npm run build`；第 3 輪 axe 無 `button-name`；以 Tab 走到卡片時操作按鈕可見。
- 風險與回滾：只加屬性與 class；還原即回滾。

### M3 區分 API 失敗與空結果
- 對應：C4
- 現況：`src/store/bookmarkStore.ts:77-81` 的 fetch 失敗只 `console.error` 並結束 loading，`src/components/BookmarkGrid.tsx:64-68` 於是顯示「No bookmarks found」；新增、更新、刪除失敗（同檔 98-100、109-111、135-137）沒有任何提示。
- 修改：store 加 `error: string | null`，各 API 失敗時設定、成功時清除；`BookmarkGrid` 在有 `error` 時顯示 `role="alert"` 的錯誤訊息與「Retry」按鈕（重呼 `fetchBookmarks`），不顯示空狀態；變更操作失敗時顯示同一個訊息區。
- 驗證：`npm run lint`、`npm run build`；第 3 輪停止 json-server 後擷取錯誤狀態，再啟動後按 Retry 恢復。
- 風險與回滾：只影響前端狀態；還原 store 與 grid 即回滾。

## 啟動方式（第 2 輪要驗證的版本）

在 PROTOCOL 第 0 節的隔離環境內（`products/goku/web`）：

```sh
npm ci
npm run mock          # json-server 於 3001，資料取自 mock/db.json（合成資料）
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`mock/db.json` 被 json-server `--watch` 寫入；第 3 輪先複製到 `fe-review/runs/.state/` 再指向該副本，避免改動提交的 fixture。第 2 輪驗證後同步到 `targets.json`。

## 第 3 輪驗收

- 頁面與流程：`/`（唯一路由）；以互動腳本擷取：搜尋有結果／無結果、側欄切換分類、開啟 Tiptap 編輯器並儲存、卡片選單、API 失敗狀態（M3）。
- 通過條件：無 blocker／major；axe 無 critical／serious；desktop／tablet／mobile 無水平溢出；console 除 M3 刻意觸發的失敗外無 error。
- 已知不在驗收範圍：Go API 與 MQTT consumer 的真實整合。書籤 favicon 直接取自各網站（`src/lib/utils.ts:26`、`mock/db.json`），隔離環境離線時這些請求失敗屬預期，REPORT 註明而不計入失敗 request。

## 開放問題

無。
