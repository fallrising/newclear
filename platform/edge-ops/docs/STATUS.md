# Edge Ops — STATUS

本檔是本專案唯一的進度權威。日期：2026-09-28。

## 目前狀態

**M0 Contract foundation：已實作於 branch `claude/newclear-sdd-implementation-7bm747`（實作 commit `7194b50`），經使用者明確要求以 PR [#188](https://github.com/fallrising/newclear/pull/188) 合併進 main；merge 不等於 owner acceptance，仍未經獨立安全審查。沒有部署，沒有接觸任何主機或 Cloudflare 帳號。**

SDD v0.1 已隨 #161 merge 進 main（base `05809fc951ef929665e798846aba348d6c9071a5`）；merge 只代表設計進入 tree，不代表 owner 已接受全部 gate。本次由使用者明確要求「開始實現代碼」，範圍限定為最早未完成的 M0。

| 項目 | 狀態 | 證據／限制 |
| --- | --- | --- |
| Strict JSON profile | implemented (TS + Go) | `contracts/vectors/strict-json.json` 38 cases，兩端同碼 |
| Telemetry v1 schema | implemented (TS + Go) | 22 cases；uint64 字串、無浮點、null≠0 |
| Request signing `edgeops-req-v1` | implemented (TS + Go) | 22 cases；Go 以相同 seed 重簽並與 TS 逐位元相同 |
| Enrollment proof v1 | implemented (TS + Go) | 6 cases |
| RunManifest / approval v1 | implemented (TS + Go) | 29 cases；含重排 bytes、無 domain、非正規 S、duplicate key、未知特權欄位 |
| Job state machine | contract + TS 嵌入副本 | `contracts/state-machines/job.v1.json`；漂移測試 |
| OpenAPI / JSON Schema | draft，描述性 | 13 條 path（P0 + job 核心）；schema 欄位集合與向量做漂移測試。log-chunks、recipes、start-permit、WS events 尚未寫入 |
| D1 CAS／0-row／rollback spike | implemented on **node:sqlite stand-in** | `backend/test/jobStore.test.ts` 等；**尚未在 workerd/D1 執行**，D1 batch 語義仍待 M1 以 wrangler/miniflare 驗證 |
| Enrollment／telemetry store | implemented on stand-in | AC-ID-01、AC-MON-01 的伺服器側邏輯 |
| Root CI `edge-ops-ci.yml` | added | path-scoped、`contents: read`、timeout、concurrency、無 credentials；action SHA 沿用 repo 既有 workflow 已使用的值，本次未重新核對上游 |
| Frontend `web/` | mock slice implemented | React/Vite fleet overview 讀取 `/api/v1/nodes`；尚未接 Cloudflare deploy |
| HTTP mock backend / mock Agent | implemented in current branch | Node HTTP + memory store + mock telemetry；Cloudflare Worker/D1/DO/R2 與真實 collector 仍未接線 |
| 獨立 review／owner acceptance | pending | 本次只有作者自查 |
| Target-host／Cloudflare live tests | not run | 未授權 |

## 本次已執行的驗證（2026-09-28，雲端開發容器，linux/amd64）

| 命令 | 環境 | 結果 |
| --- | --- | --- |
| `npm ci` + `npm run typecheck` | Node 22.22.2、TypeScript 5.9.3、@types/node 22.19.1 | exit 0 |
| `npm test`（node:test，type stripping，node:sqlite） | Node 22.22.2 | 34 pass / 0 fail |
| `gofmt -l`、`go vet ./...`、`go test -count=1 ./...` | Go 1.24.7 | exit 0 |
| 變異檢查：竄改一個 strict-json 與兩個 run-approval 向量 | 同上 | TS 與 Go 皆如預期失敗，還原後通過 |
| `actionlint -no-color .github/workflows/edge-ops-ci.yml` | actionlint v1.7.7（go install） | exit 0 |

GitHub Actions `Edge Ops CI` 在 PR #188 上兩個 job（Node 24.18.0 TS、Go 1.24.7）皆通過。

未執行：workerd／D1／DO／R2；任何 live 環境。

## 已知限制與風險

- node:sqlite 以 `BEGIN IMMEDIATE`/`ROLLBACK` 模擬 D1 batch；D1 實際的 batch 原子性、`changes` 計數與 constraint error 行為需在 M1 用 workerd 驗證後，才能把 AC-CON-02 標為通過。
- Ed25519 驗證在 Node（OpenSSL）與 Go 一致；Workers（BoringSSL）對非正規簽章的行為未實測。
- `requestAuth` 只做簽章與格式層；nonce 重放表、credential 撤銷／generation 查詢屬 M1 HTTP 層，尚未串接。
- operator 將 `reconciling` 標為 `unknown`、start permit、execd 本地 journal 屬 M4，尚未實作。

## 2026-09-28 mock vertical slice

依 owner 要求改採功能先行：新增 `backend/` Node HTTP mock、`mock-agent/` 與 `web/` React/Vite dashboard。資料流為 mock Agent → `/agent/v1/telemetry` → memory store → `/api/v1/nodes` → dashboard；另提供 per-node metrics history endpoint。這一批刻意不把完整 QA／E2E、安全 hardening 當前置。

目前尚未在本工具環境實際啟動三個 process；branch 內只有 backend 的小型 `node:test`，因此本段只標記 implemented、**不標記 runtime verified**。完整跑法見 `docs/DEV-MOCK.md`。

## 下一個最小切片

1. 在可執行 Node/npm 的開發環境跑 backend test、啟動 backend + mock-agent、build web，修第一輪整合 bug。
2. 將 memory store 換成既有 M0 store/D1 adapter，讓 HTTP 路由開始使用正式 contracts；UI 再加 node detail/history。
3. 完成這一輪功能後再集中做 QA，不提前擴寫 logs/jobs/bootstrap。

## 續作規則

先核對實際 main、相關 PR 與此檔；不要僅憑固定入口 prompt 認定目前 milestone。每次完成更新固定 commit、實測／未測、pending review、下一步。PR merge、設計接受、功能驗收與 deployment 分開記錄。
