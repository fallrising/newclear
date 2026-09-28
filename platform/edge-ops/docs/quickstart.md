# Quickstart — M0 契約驗證

**只有 M0 契約層可執行；沒有可部署的 Worker、前端、Agent binary、安裝器、Terraform module 或 image。** 以下命令全部離線、不需任何憑證，也不會接觸主機或 Cloudflare。

閱讀順序：[總綱](../SDD.md) → [SDD 索引](sdd/README.md) → [契約](../contracts/README.md) → [狀態](STATUS.md) → [開發約定](../AGENTS.md)。

```sh
# TypeScript：strict JSON、簽章、schema 與 D1 transaction spike（node:sqlite 替身）
cd platform/edge-ops/backend
npm ci
npm run check          # tsc --noEmit + node --test

# Go：同一組 contracts/vectors，並逐位元比對簽章
cd ../agent
go vet ./... && go test ./...
```

需求：Node ≥22.18（CI 使用 24.18.0；需要內建 TypeScript type stripping 與 `node:sqlite`）、Go 1.24。變更契約後執行 `npm run vectors` 重新產生簽章向量，再讓 TS 與 Go 測試同時通過。

| 驗證種類 | 本階段狀態 | 理由 |
| --- | --- | --- |
| 契約向量（TS／Go） | 可執行 | 見上方命令 |
| D1 CAS／rollback spike | 可執行（SQLite 替身） | 真 D1 行為待 M1 以 workerd 驗證 |
| frontend dev/build | skipped | `web/` 尚未建立 |
| Worker/DO/R2 local integration | skipped | 尚無 Worker 入口與 wrangler 設定 |
| Cloudflare live deployment／quota | skipped | 未授權，無帳號配額證據 |
| OS bootstrap／Packer／Terraform | skipped | 尚未實作，且不得變更現役主機 |
