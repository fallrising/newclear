# FE Review — goku — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — 下一步是撰寫 `DESIGN.md`（見 PROTOCOL.md「三輪節奏」與 `docs/fe-review/DESIGN-PROMPT.md`）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「Owner override 2026-09-27 — fe-review 休眠元件」，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 `web/.env` 被 Git 追蹤

public repository 中追蹤了 `.env`。內容應只有 API URL，但這與「不提交環境檔」的一般慣例衝突；本次未輸出其值。

### C2 技術棧落後其他元件

React 18、Vite 5、Tailwind 3；PROTOCOL 禁止未經提議升級 major 版本。

## 需要放開或決定的點

### D2 `web/.env` 的處理

- 選項：(a) 改為 `.env.example` 並移出追蹤；(b) 確認無敏感值後維持。
- 建議：(a)，並在 PR 中確認內容無敏感值。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

### D3 是否升級技術棧

- 屬 major 升級，不在 fe-review 休眠例外的範圍內。
- 建議：建議不升級；若要升級，需另行決定恢復投入。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
