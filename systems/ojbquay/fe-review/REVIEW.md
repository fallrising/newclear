# FE Review — ojbquay console — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認假設 A1。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 沒有可供 `capture.mjs` 使用的假後端

`console-web/vite.config.ts:6-11` 把 `/api` proxy 到 `localhost:8080`，沒有後端時頁面只剩錯誤狀態。`console-web/e2e/serve.mjs` 只是 `dist/` 靜態伺服器；假資料寫在 `console-web/e2e/golden-path.spec.ts` 的 `page.route` 內，只供該測試使用。完整 stack（`KEEP_STACK=1 make e2e`，十一服務）與真 stack 旅程 `pnpm e2e:stack` 已在 2026-10-22 實跑通過。

### C2 Drawer 的窄螢幕寬度需實測

Drawer 設定寬 720–900px（例如 `pages/SubscriptionsPage.tsx:131` 的 900），專案 `styles.css:443-445` 的 max-width 規則只在 576px 以下。834px 小於 900 但大於 800；須實測元件 computed style，不能只靠設定值宣稱所有 Drawer 已溢出。驗證與修整範圍見 DESIGN M3。

### C3 Dashboard 圖表只跟隨視窗縮放

`pages/DashboardPage.tsx:47-50` 只監聽 `window` resize；收合側欄改變內容寬度時圖表不重算。

## 需要放開或決定的點

### D1 第 3 輪的後端

- 選項：(a) 寫一個實作 console 所需 `/api/v1` 端點的 mock 伺服器；(b) 用既有 Compose stack，empty／error 狀態以互動腳本的 `page.route` 覆寫。
- 建議：(b) 保留作整合來源，但先確認 DESIGN M1 的隔離方案。現有預設 project、published ports 與保留 stack 不滿足此 harness 的 loopback／所有權契約；歷史旅程通過不代表新環境已就緒。若需 Compose／後端修改，另立範圍。
- 狀態：**待擁有者決定**。`DESIGN.md` 以 (b) 作為假設 A1。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- [#550](https://github.com/fallrising/newclear/pull/550)：本次設計與複核修正；D1／AC-15 仍待確認，沒有執行 UI 或 stack。
