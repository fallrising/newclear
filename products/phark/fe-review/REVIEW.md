# FE Review — phark — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行，草稿待確認** — [DESIGN.md](DESIGN.md) 已草擬；D1 仍待擁有者確認，尚未完成 AC-15。沒有啟動 UI 或執行擷取。
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

## 需要放開或決定的點

### D1 合成資料的來源

- 選項：(a) 後端提供 seed 指令；(b) fe-review 腳本透過 API 建立資料。
- 建議：(b)。不修改後端即可達成。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- [#552](https://github.com/fallrising/newclear/pull/552)：本次 issue #155 設計草稿；D1 與 AC-15 仍待確認。
