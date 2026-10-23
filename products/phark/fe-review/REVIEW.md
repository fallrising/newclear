# FE Review — phark — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 以 fe-review 腳本經現有 API 建立合成資料，保留 Session/CSRF，不直接改 DB。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 前端只能透過 Spring 後端取得資料

沒有獨立的 FE review mock／seed harness；`frontend/vite.config.ts:13` 將 `/api` 代理到 Spring，`frontend/src/App.tsx:250` 初始化 CSRF 與 session。第 3 輪需在隔離環境使用 Spring＋SQLite 與合成資料，不能以 mock 代替整合接線驗收。

`frontend/src/App.tsx:129` 已有 `/`、`/profiles/:handle`、`/notifications`、`/search` 與 not-found 的路由解析及 history 導覽，不需要新增路由功能。

### C2 版面、狀態與主題需實測

`frontend/src/App.tsx:837` 的手機橫向 deck／固定高度、`frontend/src/components/Column.tsx:50` 的最小欄寬與內部捲動，以及長字串、表單與 pending／error 狀態尚無本輪瀏覽器證據。`frontend/src/index.css:30` 只有 light 色票，不能把 dark capture 當作已支援主題。修整與驗證範圍見 DESIGN M2／M3。

## 已決定

- 依 issue #155，dormant 元件可在第 2 輪於已確認 DESIGN 範圍內修改前端；不做新功能或 major 升級，不改變產品主線驗收。

## 本次確認的決定

### D1 合成資料的來源

- 選項：(a) 後端提供 seed 指令；(b) fe-review 腳本透過 API 建立資料。
- 建議：(b)。不修改後端即可達成。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- [#552](https://github.com/fallrising/newclear/pull/552)：本次 issue #155 設計草稿；D1 已由 owner 確認。
