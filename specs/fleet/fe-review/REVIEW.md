# FE Review — fleet — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — 下一步是撰寫 `DESIGN.md`（見 PROTOCOL.md「三輪節奏」與 `docs/fe-review/DESIGN-PROMPT.md`）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **B（maintain / public contract）**：第 2 輪修改不得改變對外契約；不新增 tutorial 系列。

## 矛盾點

### C1 操作員登入需要測試憑證

`fleetd` 的登入方式與建立測試操作員的步驟未確認。

### C2 htmx 從 embed 的靜態檔載入

修改 UI 可能牽動公開契約（模板路徑、表單欄位）；B 檔要求不改變對外契約。

## 需要放開或決定的點

### D1 第 2 輪可修改的範圍

- 選項：(a) 只允許樣式與 a11y 修正；(b) 允許模板結構調整。
- 建議：(a)，符合 B 檔的契約限制。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
