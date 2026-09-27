# Quickstart — 目前為設計閱讀入口

**Runtime blocked / not implemented。** 目前沒有可執行前端、Worker、Agent binary、安裝器、Terraform module 或 image。A-tier 的本檔明確記錄阻擋，不提供會讓人誤以為能執行的 placeholder command。

閱讀順序：[總綱](../SDD.md) → [SDD 索引](sdd/README.md) → [狀態](STATUS.md) → [開發約定](../AGENTS.md)。要先理解 image／Terraform／agent，可直接讀 [初始化章節](sdd/04-bootstrap-and-images.md)。

| 驗證種類 | 本階段狀態 | 理由 |
| --- | --- | --- |
| 設計閱讀／邊界自查 | 可進行 | 所有 SDD 與官方來源在 tree 中 |
| frontend dev/build | skipped | 沒有 runtime source/package/lockfile |
| Go agent unit/integration | skipped | 沒有 Go module／binary |
| Worker/D1/DO/R2 local integration | skipped | 沒有 Worker／migrations／fixtures |
| Cloudflare live deployment／quota | skipped | 非本次授權，無帳號配額證據 |
| OS bootstrap／Packer／Terraform | skipped | 尚未實作，且不得變更現役主機 |

後續 M0/M1 補上真正執行過的命令、固定版本與證據，再把本檔改成可重現 quickstart；不得只補一行 curl 安裝命令就稱整條鏈路已驗收。
