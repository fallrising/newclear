# FE Review — dim-gate — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [DESIGN.md](DESIGN.md) 已草擬，待擁有者在設計 PR 確認假設 A1、A2（對應 D1）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C2 既有 e2e 與 fe-review 可能重疊

`e2e/` 已有大量 Playwright spec（含 browser health、keyboard、isolation），部分 spec 也做 axe 與 viewport 檢查（`e2e/m2-admin.spec.ts:192-205`、`e2e/w5-identity.spec.ts:37-39`）。fe-review 若再寫一套流程，會出現兩個互相漂移的真相。處理方式待 D1。

### C3 `capture.mjs` 只能擷取預設身分

`capture.mjs` 每頁都開新 context（`docs/fe-review/capture.mjs:114-120`）。demo session 存在分頁的 `sessionStorage`（`src/demo/browser.ts:15-37`），預設身分 `user-rd-commerce`（`src/demo/controller.ts:72`）只有 RD 中心（`src/demo/seed/core.ts:4`），所以 Ops／Admin 頁面只會擷取到 403（`src/app/layouts/CenterLayout.tsx:9`）。修正方向見 DESIGN.md M2。

### C4 深色主題不跟隨 `prefers-color-scheme`

主題由 `localStorage` 的 `dim-gate.ui.v1` 決定（`src/app/shell/AppShell.tsx:27-31`、`:61`），`capture.mjs` 的 `colorSchemes` 模擬不會切換主題。`targets.json` 目前只擷取淺色；深色由 DESIGN.md M2 處理。

## 已決定

- 無

## 需要放開或決定的點

### D1 fe-review 與既有 e2e 的分工

- 選項：(a) fe-review 只負責截圖與視覺／a11y 檢查，流程正確性交給既有 e2e；(b) 把 `capture.mjs` 的頁面清單改由既有 e2e 產生。
- 建議：(a)。責任清楚，不重複維護流程。
- 狀態：**待擁有者決定**。DESIGN.md 以 (a) 作為假設 A1（並推出 A2），在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新（本次設計 PR 已依原始碼先行修正，仍為 `verified: false`）。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- PR_PLACEHOLDER：撰寫 DESIGN.md，依原始碼修正 PROMPT.md 與 targets.json（Closes #147）。
