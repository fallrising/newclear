# FE Review — ice-maker — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可依元件 `AGENTS.md` 與 PROTOCOL 第 4 節直接修改前端。

## 矛盾點

### C1 document service extras 名稱未確認

`targets.json` 的 install 是佔位字串；`--pdfinfo` 需要系統安裝 poppler。

### C2 UI 是內嵌在 Python 字串中的 HTML

`_PAGE` 無法單獨以前端工具檢查或測試；修改需要改 Python 原始碼。

## 需要放開或決定的點

### D1 內嵌頁面是否抽成獨立檔案

- 選項：(a) 抽成 package data 的 HTML／CSS／JS，由服務讀取；(b) 維持內嵌。
- 建議：建議第 3 輪後再決定：頁面很小，(a) 的收益取決於報告發現的問題數量。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
