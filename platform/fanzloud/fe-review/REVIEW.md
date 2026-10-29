# FE Review — fanzloud — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- 第 1 輪：設計方向已由 owner 於 2026-10-23 確認（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）。
- 第 2 輪：**已交付**（desk T-0433，[issue706](https://github.com/fallrising/newclear/issues/706)）。R2-AC-14 各條件與證據見 [R2 報告](tasks/round2/report.md)；`targets.json` 為 `verified: true`。
- 第 3 輪：完整 e2e（未開始）。

## 修改權限

文檔檔位 **C（dormant）**：依 [`PORTFOLIO.md`](../../../PORTFOLIO.md)「休眠」一節的 fe-review 例外，第 2 輪在 `DESIGN.md` 範圍內修改前端。這不恢復投入，不做新功能或 major 依賴升級。

## 矛盾點的目前結論

### C1 control-plane 啟動需要雲端 runner 設定

production control-plane 仍要求 validated runner、私有目錄、Cloud scope、HTTPS origin 與 bootstrap，留空不是 fake 模式。第 2 輪改用 `fe-review/` 的專用合成 HTTPS/WSS harness（DESIGN M1）：同版四個產品資產、有限 T006 介面、私有 CA、`--network none` 容器。真實後端與 Cloud 整合未驗證，需另定範圍。

### C2 響應式與 dark 樣式

三種尺寸實測發現三項缺陷，已修正（PR725）：mobile 水平溢出、事件／diff 區域不可聚焦且沒有名稱、對比證據。其餘區域未修改。沒有 light theme。

### C3 主要流程的 mutation 與秘密邊界

authenticate、device login、submit、cancel、diff、logout 都是明確操作。實測只有這些操作產生 mutation，refresh 不重送，diff 保持純文字，送出前清空 bearer／prompt。這是合成 harness 的證據，不是 production auth 驗收。

## 已確認的決定

### D1 解耦方式

採 (b) 靜態資產＋有限假 API/WS（2026-10-23 owner 確認）。(a) production fake-runner 模式屬後端變更，不在範圍內。

## 後續與待決定

- 產品 findings（未修，見 R2 報告）：client 自行偵測到協定錯誤後 socket 仍開著，直到 Refresh（原因 `close(1008)` 是推論，未觀測）；favicon 404；Authenticate 按鈕緊貼輸入框。是否修正需另定範圍。
- `capture-002` 的本次 CA／leaf 私鑰仍以 0600 留在 repo 外的私有 state，是否銷毀由 owner 決定。
- 第 3 輪、真實後端／Cloud 整合各需另定範圍與批准。

## 相關 PR

- fallrising/newclear#141、#144：第 1 輪工作包與 owner 決定。
- 第 2 輪：#604、#725、#731、#735、#739、#743、#752、#754、#761、#764、#765 與最終整合 PR；逐項見 [R2 報告](tasks/round2/report.md)。
