# FE Review — dim-gate — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：fe-review 做視覺／a11y 擷取；流程正確性交由既有 e2e，不改共用 capture。 第 2 輪實跑證據見本輪報告；第 3 輪尚未驗收。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：M1–M3 review tooling 已實作，必要原生與隔離擷取驗證通過；PR583待獨立複審／交付，targets為true僅原R2本機證據。
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C2 既有 e2e 與 fe-review 可能重疊

`e2e/` 已有大量 Playwright spec（含 browser health、keyboard、isolation），部分 spec 也做 axe 與 viewport 檢查（`e2e/m2-admin.spec.ts:192-205`、`e2e/w5-identity.spec.ts:37-39`）。fe-review 若再寫一套流程，會出現兩個互相漂移的真相。處理方式依已確認 D1。

### C3 `capture.mjs` 只能擷取預設身分

`capture.mjs` 每頁都開新 context（`docs/fe-review/capture.mjs:114-120`）。demo session 存在分頁的 `sessionStorage`（`src/demo/browser.ts:15-37`），預設身分 `user-rd-commerce`（`src/demo/controller.ts:72`）只有 RD 中心（`src/demo/seed/core.ts:4`），所以 Ops／Admin 頁面只會擷取到 403（`src/app/layouts/CenterLayout.tsx:9`）。修正方向見 DESIGN.md M2。

### C4 深色主題不跟隨 `prefers-color-scheme`

主題由 `localStorage` 的 `dim-gate.ui.v1` 決定（`src/app/shell/AppShell.tsx:27-31`、`:61`），`capture.mjs` 的 `colorSchemes` 模擬不會切換主題。`targets.json` 目前只擷取淺色；深色由 DESIGN.md M2 處理。

## 已決定

- 見本頁開頭的 owner 決定。

## 本次確認的決定

### D1 fe-review 與既有 e2e 的分工

- 選項：(a) fe-review 只負責截圖與視覺／a11y 檢查，流程正確性交給既有 e2e；(b) 把 `capture.mjs` 的頁面清單改由既有 e2e 產生。
- 建議：(a)。責任清楚，不重複維護流程。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新（本輪實跑後 `verified: true`，僅原R2本機證據；最終複審／CI／交付分開追蹤）。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- fallrising/newclear#176：撰寫 DESIGN.md，依原始碼修正 PROMPT.md 與 targets.json（Closes #147）。

## 第2輪進度與限制

capture-personas.mjs／personas.json 使用真示範身分、同分頁 sessionStorage、實際 UI theme，三身分×兩主題×三viewport；不改共用capture、產品、mock或既有e2e。參數頁使用seed IDs，執行時details只從現有列表點入；fresh seed沒有記錄時保留空清單與not_available證據，不擅自建立domain state。完整結果見 [本輪報告](tasks/round2/report.md)。

### 本輪觀測到的健康限制（未修正／非第3輪通過）

216個persona頁面皆有 `region` moderate（2 nodes）。Ops `/ops/capacity` 在三viewport×兩主題共6組有 `aria-prohibited-attr` serious（每組6 nodes）。導航／身分／主題與整頁溢出檢查通過，但這些axe findings仍未解決；產品修正超出本批准R2 review-only範圍。初次擷取另曾遇axe execution-context例外，原FAIL保留；續跑122頁沒有scanner error。詳細結果見 [驗證證據](tasks/round2/verification.json)。
