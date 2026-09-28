# Quickstart — M0 契約與 S0 loopback demo

**可執行的是 M0 契約層，以及只綁 loopback 的 S0 mock 鏈路（mock Agent → Worker → SQLite／local D1 → React）。沒有可部署的 Worker、Agent binary、安裝器、Terraform module 或 image。** 以下命令全部離線、不需任何憑證，也不會接觸主機或 Cloudflare。

閱讀順序：[總綱](../SDD.md) → [SDD 索引](sdd/README.md) → [契約](../contracts/README.md) → [狀態](STATUS.md) → [開發約定](../AGENTS.md)。

```sh
# TypeScript：strict JSON、簽章、schema 與 D1 transaction spike（node:sqlite 替身）
cd platform/edge-ops/backend
npm ci
npm run check          # tsc --noEmit + node --test

# Go：同一組 contracts/vectors，並逐位元比對簽章
cd ../agent
go vet ./... && go test ./...

# S0 loopback 鏈路（見 docs/DEV-MOCK.md）
cd ..
npm run check                        # mock report 對 M0 契約 + Worker／HTTP 鏈路（node:sqlite）
(cd backend && npm run test:workerd) # 真正的 local workerd + local D1
(cd web && npm ci && npm run build && npm run test:e2e)   # React build + Playwright
npm run demo                         # http://127.0.0.1:8787，合成資料
```

需求：Node ≥22.18（CI 使用 24.18.0；需要內建 TypeScript type stripping 與 `node:sqlite`）、Go 1.24。變更契約後執行 `npm run vectors` 重新產生簽章向量，再讓 TS 與 Go 測試同時通過。

| 驗證種類 | 本階段狀態 | 理由 |
| --- | --- | --- |
| 契約向量（TS／Go） | 可執行 | 見上方命令 |
| D1 CAS／rollback spike | 可執行（SQLite 替身） | job CAS／rollback 的真 D1 行為待 M1 以 workerd 驗證（telemetry 路徑已在 local D1 跑過） |
| frontend build／Playwright | 可執行 | S0 demo UI；只讀 loopback API |
| Worker + local D1 | 可執行 | `backend/scripts/workerd-smoke.mjs`；只有 demo 模式 |
| DO/R2 local integration | skipped | 尚未實作 |
| Cloudflare live deployment／quota | skipped | 未授權，無帳號配額證據 |
| OS bootstrap／Packer／Terraform | skipped | 尚未實作，且不得變更現役主機 |
