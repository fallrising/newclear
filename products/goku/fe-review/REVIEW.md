# FE Review — goku — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D2 改用無敏感值環境範例並移出追蹤；D3 不做 major 升級。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 `web/.env` 被 Git 追蹤

public repository 中追蹤了 `web/.env`。已確認只有 `VITE_API_URL`，值與 `src/services/api.ts:4` 的預設值相同，不是敏感值；仍與「不提交環境檔」的慣例衝突。

### C2 技術棧落後其他元件

React 18、Vite 5、Tailwind 3；PROTOCOL 禁止未經提議升級 major 版本。

### C3 卡片操作沒有可讀名稱，鍵盤 focus 時看不見

`src/components/BookmarkCard.tsx:89-101` 的編輯、刪除按鈕只有圖示，沒有 `aria-label`；容器 `opacity-0 group-hover:opacity-100` 只在 hover 時顯示。

### C4 API 失敗被當成空結果

`src/store/bookmarkStore.ts:77-81` fetch 失敗只寫 console，`src/components/BookmarkGrid.tsx:64-68` 因此顯示「No bookmarks found」；新增、更新、刪除失敗沒有提示。

## 本次確認的決定

### D2 `web/.env` 的處理

- 選項：(a) 改為 `.env.example` 並移出追蹤；(b) 確認無敏感值後維持。
- 建議：(a)。內容已確認無敏感值。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

### D3 是否升級技術棧

- 屬 major 升級，不在 fe-review 休眠例外的範圍內。
- 建議：建議不升級；若要升級，需另行決定恢復投入。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- [#551](https://github.com/fallrising/newclear/pull/551)：`DESIGN.md` 與本檔、`PROMPT.md`、`targets.json` 的修正；D2／D3 已由 owner 確認。
