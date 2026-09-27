# FE Review — pokercase — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — 下一步是撰寫 `DESIGN.md`（見 PROTOCOL.md「三輪節奏」與 `docs/fe-review/DESIGN-PROMPT.md`）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「Owner override 2026-09-27 — fe-review 休眠元件」，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 TUI 不在 `capture.mjs` 的能力範圍

需要 tmux 文字快照；格式與比較方式尚未定義。

### C2 資料目錄內含憑證類資料

gateway 儲存 OAuth／session token；只能用暫存目錄與假 connection。

## 需要放開或決定的點

### D1 TUI 擷取的格式

- 選項：(a) `tmux capture-pane -p -e` 保留 ANSI；(b) 純文字。
- 建議：(a) 存檔、(b) 放進報告，方便閱讀與比較。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- {THIS_PR}：記錄擁有者決定與設計文件入口。
