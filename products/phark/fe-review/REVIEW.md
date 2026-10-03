# FE Review — phark — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — 下一步是撰寫 `DESIGN.md`（見 PROTOCOL.md「三輪節奏」與 `docs/fe-review/DESIGN-PROMPT.md`）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 前端只能透過 Spring 後端取得資料

沒有前端 mock，也沒有路由；第 3 輪需要起 Spring＋SQLite 並建立合成帳號與貼文。

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
