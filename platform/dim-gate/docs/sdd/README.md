# SDD 專題規格

先讀 [總綱](../../SDD.md)。所有章節共同構成 v0.1 基線。

| 文件 | 實作時回答的問題 |
| --- | --- |
| [01 — 產品與 UX](01-product-ux.md) | 哪些頁面、入口、操作與畫面狀態需要實作？ |
| [02 — CMDB 與資料模型](02-cmdb-model.md) | 實體、身分、provider 特有欄位與依賴如何表達？ |
| [03 — 業務流程與狀態](03-workflows.md) | 申請、發布、回滾與 incident 如何轉移、失敗與重試？ |
| [04 — 權限與平台治理](04-permissions-admin.md) | 角色、資料 scope、選單、服務目錄及模型誰能管理？ |
| [05 — 前端架構](05-frontend-architecture.md) | 模組、元件、路由、快取、持久化與 UI 如何實作？ |
| [06 — API 與 Mock](06-api-mock.md) | 每一個讀寫的 request、response、錯誤與模擬行為是什麼？ |
| [07 — 交付與驗收](07-delivery-validation.md) | 依什麼順序開發，以及如何證明需求完成？ |
| [08 — 決策與來源](08-decisions-sources.md) | 選擇理由、替代方案、待驗證事項與技術來源？ |

需求 `REQ-*`、不變量 `INV-*`、驗收 `AC-*`、里程碑 `M*` 的定義各有單一來源；驗收映射見 07。所有命令與 package 結構若標示「規劃」，在 M0 完成前均不能視為已存在。
