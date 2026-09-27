# FE Review — cms-scaffold — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可依元件 `AGENTS.md` 與 PROTOCOL 第 4 節直接修改前端。

## 矛盾點

### C1 共用 `packages/ui` 的修正會同時影響三個 app

PROTOCOL 第 4 節把共用套件列為「先提議」，但多數視覺一致性問題的根因會在共用套件。

### C2 PROMPT 未指明套件管理器

workspace 依 lockfile 決定 npm／pnpm，`targets.json` 的 install 目前是佔位字串。

## 需要放開或決定的點

### D1 放開 `packages/ui` 的修改權限

- 選項：(a) 允許第 2 輪直接修改 `packages/ui`，條件是三個 app 的測試都通過；(b) 維持先提議。
- 建議：(a)。共用套件是這個專案的設計重點，逐次提議只會拖慢；以三個 app 的測試作為護欄。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
