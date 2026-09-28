# S0 — 前後端與 Mock Agent 資料鏈路

日期：2026-09-28。Owner 在 PR #161 合併後要求先做前後端骨架，用 mock 驗證資料流。實作來自 PR #185（Worker、SQLite／D1 驗證、React UI、Playwright），移植到 main 時改用 [M0 契約](../contracts/README.md)，並取代 PR #190 的單行 JS mock slice。不改變 M0／M1 的生產認證、Go Agent 或安全驗收標準。

## 假／真邊界

假的是主機、指標數值與身分驗證；真的是獨立程序發出的 HTTP、M0 strict JSON 與 telemetry parser、M0 persistence port 與 schema、SQL 交易、持久化、查詢、React 對 API 的消費與失敗狀態。

沒有 production mode。Node listener 只綁 127.0.0.1；Worker 同時要求 `MODE=demo` 與 loopback URL，否則一律 503。`X-Edge-Demo-Role` 與 `Authorization: Demo node_demo01` 是明文角色標記，任何能連到此入口的人都能冒充，不是登入。沒有真實 secret、node key 或雲帳號。

## 與 M0 的接線

| 層 | 用的是 | 說明 |
| --- | --- | --- |
| Wire | `edgeops.telemetry.v1`（`contracts/schemas/telemetry-report.v1.schema.json`） | mock Agent 產生 M0 report；`scripts/check-contracts.mjs` 以 M0 parser 與 schema key set 檢查，workerd smoke 另以 Ajv 驗 JSON Schema |
| 解析 | `backend/src/domain/contract/strictJson.ts`、`telemetry.ts` | Worker 的所有 body 都經 M0 strict JSON；錯誤碼沿用 M0（`strict_json_<code>` 為 400，`unknown_field` 等為 422） |
| 儲存 | `adapters/sql/telemetryStore.ts` + `migrations/0001_initial.sql` | 插入、去重、衝突判斷就是 M0 `TelemetryStore`；demo 只加 `migrations/0002_demo_clock.sql`（合成時鐘偏移） |
| D1 | `adapters/d1/d1Database.ts` | Worker 的 default export 以 M0 D1 adapter 包 `env.DB`；Node 端用 `scripts/sqlite-db.mjs`（同一 port 的 node:sqlite 實作） |
| 讀取模型 | `backend/src/demo/views.ts` | demo UI 用的 response view，不是 wire 契約；每筆樣本原樣帶回 M0 report，`metrics` 只是顯示用的衍生值 |

`demo/demoStore.ts` 另外提供：跳過 token／proof 的 demo enrollment（直接寫入 active、`host_authority='none'`、`monitor-only` 的 node）、每 node 4096 筆的保留上限（超過回 429）、`window_end` 必須在 7 天保留期內且不在未來。

## 行為

- 去重鍵 `(node_id, generation, boot_id, seq)`；以 body SHA-256 判斷是否同一份 report。逐位元相同的重送回 duplicate receipt，不增加樣本；同鍵不同內容回 409，不覆蓋。
- **心跳與資料新鮮度分開**（SDD 02 §3，M0 `TelemetryStore`）：`last_seen_received_at` 是每個有效請求的接收時間，重送也算；`data_fresh` 與 health 看最新 `window_end`。所以離線節點的舊 report 重送會讓連線狀態回到在線，但資料仍是過期、health 為 unknown。#185 原本讓重送不更新心跳，移植時改依 SDD。
- 心跳 90 秒後 stale、210 秒後 offline。舊 backfill 不蓋掉較新的樣本。`null` 指標不當 0，health 也不會因此變成 healthy。
- 查詢最多 240 點、7 天。API 失聯時 UI 保留舊快照但標為未確認，不切換成前端假資料。

## 驗證層次

1. `npm run check`（`platform/edge-ops/`，不需安裝）：mock report 對 M0 契約、Worker handler + node:sqlite 的 18 個測試、HTTP 鏈路（獨立 CLI 程序、檔案型 SQLite、server 重啟）2 個測試。
2. `backend`：`npm run check`（M0 34 個測試＋typecheck，含 demo 程式碼）；`npm run test:workerd` 啟動真正的 local workerd + local D1（套用 M0 migrations），跑 seed／replay／offline／recover／history。
3. `web`：`npm run build`（tsc + Vite）；`npm run test:e2e` 以 Playwright 跑 5 條 browser journey（含 mobile、deep-link refresh、API 503、HTML escape）。

CI（`.github/workflows/edge-ops-ci.yml`）執行以上三層與 Go 契約測試；沒有 deploy／publish／credentials。

## 後續順序

owner 在本地接受 S0 功能與 UI → 真實 enrollment（token + Ed25519 proof）與請求簽章、nonce 表（M1）→ 真實唯讀 collector → 再評估 DO／alerts。logs、R2、jobs、execd、bootstrap 仍不啟用。S0 的 mock 身分不得沿用到下一階段。
