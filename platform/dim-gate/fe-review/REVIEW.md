# FE Review — dim-gate — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可依元件 `AGENTS.md` 與 PROTOCOL 第 4 節直接修改前端。

## 矛盾點

### C1 demo 模式的啟用方式未確認

`.env.demo` 定義 `VITE_DATA_MODE`，但 `targets.json` 的 `npm run dev` 是否載入 demo 資料未驗證；smoke 設定可能用不同的啟動參數。

### C2 既有 e2e 與 fe-review 可能重疊

`e2e/` 已有大量 Playwright spec（含 browser health、keyboard、isolation）。fe-review 若再寫一套，會出現兩個互相漂移的真相。

## 需要放開或決定的點

### D1 fe-review 與既有 e2e 的分工

- 選項：(a) fe-review 只負責截圖與視覺／a11y 檢查，流程正確性交給既有 e2e；(b) 把 `capture.mjs` 的頁面清單改由既有 e2e 產生。
- 建議：(a)。責任清楚，不重複維護流程。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
