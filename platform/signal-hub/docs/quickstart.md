# Quickstart — 目前為設計閱讀入口

**Runtime blocked / not implemented。** 目前沒有 Go binary、前端、設定 schema 或 fixtures。本檔明確記錄阻擋，不提供會讓人以為能執行的指令。

閱讀順序：[總綱](../SDD.md) → [SDD 索引](sdd/README.md) → [狀態](STATUS.md) → [開發約定](../AGENTS.md)。

| 驗證種類 | 本階段狀態 | 理由 |
| --- | --- | --- |
| 設計閱讀／邊界自查 | 可進行 | 所有 SDD 與來源都在 tree 中 |
| schema／fixtures 驗證 | skipped | M0 尚未開始 |
| Go 單元與整合測試 | skipped | 沒有 Go module |
| 前端 build | skipped | 沒有 package 與 lockfile |
| 部署與真實資料 | skipped | 需要另行授權 |

M1 完成後，把本檔改成真正執行過、可重現的本機啟動與驗證步驟。
