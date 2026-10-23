# FE Review — clarkq — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 單程序 Go＋authenticated API seed，僅新建合成 state/key，不用既有 demo project。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪可在 `DESIGN.md` 範圍內修改前端與做最小解耦。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點

### C1 啟動方式有兩種

單程序 Go 與 `demo/run-demo.sh`（Docker）兩路；DESIGN M1 建議單程序加 API seed。Demo 有預設 compose project 與清理行為，不作本次 FE 隔離 wrapper。

### C2 啟動與 browser state 尚未隔離

預設 listener 是 :8080，config/env 可載入既有 auth、cluster、WAL。UI localStorage 持有 base/key；DESIGN M1 要求乾淨設定、loopback、新 key、全新 browser context。專用 wrapper 尚未實作。

### C3 主題及版面需實測

現行固定深色；長 queue/JSON 的 grid/table 行為待測，不能先宣稱已破版。

### C4 操作與刷新範圍

UI 支援 enqueue、peek、consume、確認 clear；只有 queues 每五秒自動刷新，Metrics/Cluster 需 Refresh all。DESIGN M3 保留這些既有語意。

## 本次確認的決定

### D1 第 3 輪採用的啟動方式

- 選項：(a) `go run`＋腳本透過 API 灌入資料；(b) `run-demo.sh`。
- 建議：(a)。避免容器內 Docker。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
