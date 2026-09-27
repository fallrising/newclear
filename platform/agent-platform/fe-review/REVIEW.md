# FE Review — agent-platform — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接刪除或改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — `PROMPT.md`、`targets.json` 與本檔已建立，等待擁有者確認下列事項。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可依元件 `AGENTS.md` 與 PROTOCOL 第 4 節直接修改前端。

## 矛盾點

### C1 UI 需要 FastAPI＋PostgreSQL

`web/` 代理到 8000，後端需要資料庫；沒有前端 mock。

### C2 模型呼叫需要假實作

repo 內有 `model_mock.py`、`fake_model.py`，但後端如何切換到它們未確認。

## 需要放開或決定的點

### D1 第 3 輪的後端形態

- 選項：(a) 容器內起 PostgreSQL＋真實 FastAPI＋fake model；(b) 前端 contract mock。
- 建議：(a)。已有 fake model，整合覆蓋較完整；PostgreSQL 在隔離容器內沒有暴露問題。
- 狀態：**待擁有者決定**

## 進入第 2 輪的條件

- 上述每個待決定事項都有擁有者的決定，並已改寫成結論。
- `PROMPT.md` 與 `targets.json` 已依決定更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏（第 1 輪）。
