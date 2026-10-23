# FE Review — goku web — DESIGN

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D2 改用無敏感值環境範例並移出追蹤；D3 不做 major 升級。 第 2／3 輪仍未由本次文件回寫執行。
> 狀態：**設計方向已確認**。實作與 runtime／browser 驗證仍須按本檔範圍另行執行；文件確認不代表產品可用。

## 目標

第 2 輪結束時，`web/` 能在隔離環境內以 json-server 合成資料啟動並擷取；API 失敗時畫面明確顯示錯誤而不是「沒有書籤」；卡片操作可用鍵盤與螢幕閱讀器使用；repository 不再追蹤 `web/.env`。

## 依據

- REVIEW.md 已決定：休眠元件可在第 2 輪於本檔範圍內修改前端（PORTFOLIO「休眠」fe-review 例外）。
- 已確認的設計依據（2026-10-23）：
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

以下程序尚未執行。在 PROTOCOL 第 0 節的獨立 network namespace 內，
瀏覽器與服務同處、只綁 loopback；建置與資料放共用 launcher 的 task 目錄。
從 `products/goku/web` 操作；先在 `AGENT_BUILD_DIR/goku-review/db.json` 建立一次性合成資料，
使用固定 ID／時間、本機 favicon fixture，不能讀取真實書籤或覆寫來源樹資料。
`getFaviconUrl` 使用 hostname 而不保留自訂 port；fixture 須明確提供本機圖片 URL，
更新書籤 URL 時產生的本機 `/favicon.ico` 由測試瀏覽器回傳固定圖片，禁止外網 fallback，
不可假設書籤的 dev port 會保留。未攔截的 request 仍是待修正的驗收失敗。

```sh
npm ci
./node_modules/.bin/json-server --watch "$AGENT_BUILD_DIR/goku-review/db.json" --routes mock/routes.json --host 127.0.0.1 --port 3001
VITE_API_URL=http://127.0.0.1:3001/api npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

`npm run mock` 沒有明確 loopback 且會寫來源樹 `mock/db.json`，不直接用作驗收啟動程序。
`targets.json` 的 start 只啟動 Vite，不管理 mock；須先確認 mock 就緒與合成資料，
實際跑通後才更新 verified。`web/mock/routes.json:2` 的 `/api/bookmarks` 與
`api/cmd/api/main.go:30` 的 `/api/v1` 不同，mock 成功不代表真 API path／schema 已修復。

## 第 3 輪驗收

- 頁面與流程：`/`（唯一路由）；以互動腳本擷取：搜尋有結果／無結果、側欄切換分類、開啟原生編輯表單並儲存、卡片選單、API 失敗狀態（M3）。`BookmarkEditor.tsx:11` 使用 input／textarea，未接線 Tiptap；`bookmarkStore.ts:60` 目前未套用篩選，不能把控制項存在當作流程通過。實測發現依 REVIEW 記錄，未通過不得宣告本輪完成。
- 通過條件：無 blocker／major；axe 無 critical／serious；desktop／tablet／mobile 無水平溢出；console 除 M3 刻意觸發的失敗外無 error。
- 已知不在驗收範圍：Go API 與 MQTT consumer 的真實整合。`src/lib/utils.ts:26` 會從書籤 URL 產生 favicon；fixture URL 與圖片必須指向本機，禁止把外網 request 當作可忽略的驗收例外。

## 開放問題

D2／D3 已由 owner 明確確認，依上方決策紀錄回寫；
第 2 輪須先滿足 REVIEW 的進入條件。新增資料／互動腳本尚未存在，啟動命令是待驗證程序。
