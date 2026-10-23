# FE Review — pokercase — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 保留 ANSI 快照與純文字報告；合成登入、禁止真 provider。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 TUI 不在 `capture.mjs` 的能力範圍

DESIGN M4 提出本次專用 tmux socket/pane、ANSI 原檔及純文字報告；D1 未確認，尚未實作。

### C2 資料目錄內含憑證類資料

預設資料目錄會讀既有憑證。DESIGN M1 要求新 task data、明確 --data-dir、無憑證隔離；M3 規範一次性 API key 的保護。

### C3 版面與主題需實測

已有 720px breakpoint；長表格／TUI 裁切仍待測。現行固定深色，targets 只保留 dark。

### C4 Keys 文案落後於 admission

`templates/keys.html` 的「無 keys 開放」落後於預設拒絕契約。DESIGN M3 限定未來模板文案修正，本輪未改程式。

## 本次確認的決定

### D1 TUI 擷取的格式

- 選項：(a) `tmux capture-pane -p -e` 保留 ANSI；(b) 純文字。
- 建議：(a) 存檔、(b) 放進報告，方便閱讀與比較。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
