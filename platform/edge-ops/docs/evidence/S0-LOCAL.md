# S0 本地執行證據（移植到 main 之後）

日期：2026-09-28。branch `agent/edge-ops/adopt-s0-chain`，base main `f2c969b`。環境：雲端開發容器 linux/amd64，Node v22.22.2、npm 10、Go 1.24.7，可連 npm registry。PR #185 自帶的證據檔描述的是它自己的 base 與無網路環境，不適用於本 branch，未沿用。

| 命令 | 位置 | 結果 |
| --- | --- | --- |
| `npm run check` | `platform/edge-ops` | PASS：mock report 對 M0 parser 與 schema key set；20 tests（Worker／node:sqlite 18、HTTP 鏈路 2）/ 0 fail |
| `npm ci`、`npm run typecheck`、`npm test` | `backend` | PASS：TypeScript 5.9.3，含 demo 程式碼；M0 34 tests / 0 fail |
| `npm run test:workerd` | `backend` | PASS：wrangler 4.135.0 local workerd + local D1，套用 `0001_initial.sql`、`0002_demo_clock.sql`；seed／replay／offline／recover／history |
| `gofmt -l`、`go vet ./...`、`go test -count=1 ./...` | `agent` | PASS：M0 向量未變 |
| `npm run build` | `web` | PASS：tsc + Vite 8 |
| `npx playwright test` | `web` | PASS：5/5。本地以容器預裝的 Chromium（revision 1194）替代 Playwright 1.63 下載的 browser（暫時設定，未提交）；CI 使用 `playwright install` |
| `actionlint .github/workflows/edge-ops-ci.yml` | repo root | PASS |

未執行：Cloudflare 遠端資源、真實主機、DO／R2、job CAS／rollback 的 D1 驗證。沒有獨立 reviewer 或安全審查。
