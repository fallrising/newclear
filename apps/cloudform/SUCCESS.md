---
project: apps/cloudform
purpose: 保留 Terraform schema 驅動表單與雲資源申請平台的歷史實作
kind: archived
mainline: not-applicable
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# cloudform 成功契約

## 主線與範圍

[README](README.md) 已列 Tier D retired；本次的結束條件是保留可追溯的歷史，
並將未實現的原產品承諾留下，不重新開發或新增使用教學。
原主線是 schema → WYSIWYG 設計器 → JSON 表單 → 審批 → Terraform 資源建立。
[路線圖](docs/06-roadmap.md) 保留五個 Phase，不能把 Phase 1 完成當成整個平台完成。
封存不表示產品驗收成功；`not-applicable` 僅表示已停止執行主線。

## 驗收條件

本表的 passed 僅表示本次已核對的靜態條件；historical 是既有紀錄，
不表示 2026-10-21 重跑產品。pending／failed 保留其實際缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 已封存專案，When 查閱入口，Then 能辨識退役狀態及原五階段範圍。 | passed | [README](README.md)、[原路線圖](docs/06-roadmap.md)。 |
| AC-02 | Given 已匯入的 schema，When 回看歷史實作，Then 可定位欄位配置與 JSON／HCL 生成切片。 | passed | [2026-06-14 進度](PROGRESS.md)；此項只核對來源，沒有本次 runtime 結果。 |
| AC-03 | Given 使用者提交申請，When 經動態表單與審批執行 Terraform，Then 真實資源建立且狀態可追蹤。 | pending | [PROGRESS](PROGRESS.md) 明列 Preview、DynamicForm、嵌套 block 與 orchestrator 待做；封存不補做。 |

## 現況與缺口

已有 Spring Boot／PostgreSQL／Redis 骨架、schema parser、template API 與設計器。
Phase 2 M1–M3 的完成勾選屬歷史開發記錄，未提供全產品驗收。
HCL 生成跳過嵌套 block，runtime 表單、四節點工作流及多雲整合仍有缺口。
舊路線圖部分勾選較舊；以具體來源與 PROGRESS 辨識已有切片，不改寫原歷史。
不把封存狀態轉成新一輪維護承諾。

schema artifact有預生成與manual fallback，來源存在不代表即時provider匯入已驗。
Template發布狀態也不等於雲資源provisioning已完成。

## 啟動與驗證

僅保留 [README 的舊開發入口](README.md)：Compose、backend `./gradlew bootRun`、
frontend `pnpm dev`；須先核對舊 Java 17、Node、PostgreSQL／Redis 相容性。
[frontend/package.json](frontend/package.json) 有 dev／build／lint，沒有測試 script。
後端入口與歷史測試位於 [backend](backend/)；本次未安裝、啟動或建立雲資源。
這些是歷史入口，不是經此次重驗的操作手冊。

本次只核對文件、入口與證據連結；未執行產品建置、服務或外部整合。
未執行的產品驗收不會因本文件通過格式檢查而轉為通過。

## 可用版本

目前 `usable_tag: none`。
不建立封存產品的可用標記。
若 owner 另行恢復，需先確認原範圍，再補完整動態表單、審批、Terraform 整合與目標環境驗收。

任何未來可用標記都須對應已合併的目標 SHA、必要 CI／審查與核心流程證據。
較早證據須先比對其後程式與設定差異；有關變更補驗後才能沿用。
