# FE Review — flowshot — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — 下一步是撰寫 `DESIGN.md`（見 PROTOCOL.md「三輪節奏」與 `docs/fe-review/DESIGN-PROMPT.md`）。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「Owner override 2026-09-27 — fe-review 休眠元件」，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 前端直接依賴 Tauri IPC

瀏覽器中沒有 Tauri runtime，Web 層無法單獨執行；依 PROTOCOL 第 0 節屬耦合。

### C2 原生視窗無法在 headless 容器擷取

需要 xvfb 或桌面環境；`scripts/macos-window-check.swift` 只適用 macOS。

## 需要放開或決定的點

### D1 IPC 解耦方式

- 選項：(a) 在前端加一層 IPC adapter，瀏覽器環境用記憶體實作；(b) fe-review 以 `addInitScript` 注入 mock，不改程式碼。
- 建議：(b) 先行（不改程式碼）；(a) 是較乾淨的解耦，屬前端架構變更，可在 DESIGN.md 評估。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

### D2 是否要求原生視窗截圖

- 選項：(a) 第 3 輪加 xvfb 擷取；(b) 只擷取 Web 層並在報告註明。
- 建議：(b)。
- 狀態：**待擁有者決定**。撰寫 `DESIGN.md` 時可先以建議作為「假設」，在設計 PR 中由擁有者確認。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
