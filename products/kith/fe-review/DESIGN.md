# FE Review — kith — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**（待擁有者在設計 PR 確認假設）。每次修改都走 PR。

## 目標

第 2 輪結束時，kith 的 SPA（`web/`）能在 PROTOCOL 第 0 節的隔離環境內，用一個只綁 `127.0.0.1` 的指令單獨啟動：真實 worker（`wrangler dev --local`，miniflare D1）、固定的合成 seed、e2e harness 的 fake LLM provider，不讀開發者的 `.dev.vars`、不需要 Tailscale、不連任何正式環境或真實 provider。`targets.json` 以固定頁面清單與合成登入狀態跑通並改為 `verified: true`，`PROMPT.md` 的主要流程可由本目錄的 Playwright 腳本重播，讓第 3 輪只需「啟動 → 擷取 → 檢查 → 報告」。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **A1（對應 D1 前端 mock 的位置）**：採用建議 (b)：不做前端 contract mock，沿用 `e2e/` harness 啟動真實 worker＋本機 D1＋固定 seed。(a) MSW 類 mock 延到第 3 輪報告顯示有需要時再提。
  - **A2（對應 D2 fake LLM provider）**：不新增任何後端 fake。原始碼已有兩個假實作（見 REVIEW.md C2）：以 harness 的外部 fake provider（`e2e/harness/fake-provider.ts`，四種 API 格式、只接受每次執行的 canary key）為主，經 console 建立指向它的 provider 連線；worker 內建的 `FAKE_LLM_TEXT` fake 只作備用。兩者都不需要後端變更，等同 D2 選項 (b)「在 harness 層處理」。
  - **A3（實作細節，隨 A1 成立）**：啟動器與流程腳本放在 `fe-review/`，以唯讀方式 import `e2e/harness`、`e2e/fixtures` 的模組；第 2 輪不修改 `e2e/`。
- 相關規範：
  - 元件 `AGENTS.md`：預設只改 `products/kith/**`；測試使用 fake clock／fake LLM；故障與清理只能對本次建立的 child process 操作，禁止廣域 `pkill`；測試資料不得含真實 credential。
  - PROTOCOL 第 0 節（只綁 loopback、合成資料、不關認證）與第 4 節（後端、綁定策略變更只提議）。
  - `docs/v2/milestones/W0.md` §5.1.6–5.1.7：harness 的隔離與清理語意（`e2e/harness/server.ts:11-12`、`e2e/global-setup.ts:13`）。

## 不做的事

- 不改 worker、D1 schema、`wrangler.toml`、`scripts/dev-bind.mjs` 與根目錄 npm scripts（C3／D3 只記錄、只提議）。
- 不改 `e2e/` 的 harness、fixtures、specs；不改 `web/` 的程式碼、樣式、依賴。第 2 輪沒有預定的前端修正：尚未擷取過畫面，前端問題由第 3 輪報告寫回 `REVIEW.md`，再開新的第 2 輪 PR。
- 不做前端 contract mock（A1）；不新增後端 fake provider（A2）。
- 不覆蓋 runner／sidecar（外部 CLI、`operator_personal` 訂閱）、ambient、線上部署 `kith.fallrising.workers.dev`。
- 不升級 React、Vite、Tailwind 等主要依賴；不改文案語意或視覺設計。

## 修改項目

### M1 隔離啟動器 `fe-review/launch.mjs`
- 對應：C1、C3；A1、A2、A3。
- 現況：
  - README 的本機路徑 `npm run dev`／`npm run dev:web`（`README.md:64-65`）經 `scripts/dev-bind.mjs`：worker 綁 `0.0.0.0:8787`（`scripts/dev-bind.mjs:28-43`），web 綁 Tailscale IPv4 的 5173（`:47-52`），且兩者都先呼叫 `tailscale ip -4`，失敗即中止（`:13-23`）。worker 會載入開發者的 `.dev.vars`，帳號來自 `db:bootstrap:local` 的隨機密碼。這條路徑不符合第 0 節，隔離環境裡也跑不起來。
  - 符合第 0 節的路徑已存在，但只在 Playwright global setup 內：harness 以 `--ip 127.0.0.1`、隨機 port、`--persist-to <run>/state`、`--env-file`（避開 `.dev.vars`）啟動 wrangler，並開 fake provider（`e2e/harness/server.ts:71-107`）；migrations 與固定 seed `base-v1` 在 `e2e/global-setup.ts:54-73`。web 的 Vite 預設就是 `127.0.0.1:5174`、`strictPort`，並把 `/api`、`/mcp` 代理到 `KITH_API_ORIGIN`（`web/vite.config.ts:5-16`）。
  - `capture.mjs` 需要固定的 `baseUrl`（`docs/fe-review/capture.mjs:132`），但 harness 的 web port 是隨機的（`e2e/harness/server.ts:111-123`）。
- 修改：新增 `products/kith/fe-review/launch.mjs`（只新增此檔，Node 24 直接 import `.ts`）：
  1. 狀態目錄固定為 `fe-review/runs/.state/<ts>/`（已 git-ignored，`fe-review/.gitignore:5`），不寫入 `e2e/artifacts/` 或元件根目錄。
  2. 重用 harness 模組：`wranglerEnv`、`getFreePort`、`waitForHttp`、`track`、`stopStack`（`e2e/harness/server.ts`）、`startFakeProvider`（`e2e/harness/fake-provider.ts`）、`buildSeed`（`e2e/fixtures/seed.ts`）、`PROVIDER_CANARY`（`e2e/fixtures/accounts.ts:16`）。wrangler 參數與 `e2e/harness/server.ts:93-99` 相同（`--local --ip 127.0.0.1`、隨機 port、`--env-file`、每次執行產生的 `KITH_SECRETS_KEY`、`ff_providers`／`ff_drafts`／`KITH_DEV_ALLOW_HTTP_PROVIDERS` on、`ff_sidecar`／`ff_ambient` off）。
  3. worker ready（`/api/csrf` 200）後，以 `KITH_API_ORIGIN=<worker origin>` 在 `web/` 跑 `npm run dev`，得到固定的 `http://127.0.0.1:5174`。
  4. 以 seed 帳號 `ada`（operator，`e2e/fixtures/seed.ts:60`）經 UI 登入一次，存成 `fe-review/runs/.state/<ts>/auth.storage.json`，並更新 `fe-review/runs/.state/current` 指向它，供 `targets.json` 使用。
  5. 以 JSON 印出 `baseUrl`、`apiOrigin`、`fakeProviderUrl`、seed id；收到 SIGINT／SIGTERM 時呼叫 `stopStack()`，只結束自己啟動的 process group。
- 驗證：
  - 在隔離容器內執行 `node products/kith/fe-review/launch.mjs`：`/login` 回 200，經代理的 `/api/csrf` 回 JSON。
  - `ss -ltn` 只看到 `127.0.0.1` 的 listener（worker、inspector、Vite、fake provider），沒有 `0.0.0.0` 或 Tailscale 位址。
  - 送出 SIGTERM 後沒有殘留的 child process；`git status` 只剩 git-ignored 的 `.state`。
  - 不需要 `tailscale`、`.dev.vars`、`wrangler login`；在沒有這些東西的環境成功啟動。
  - 未修改 `e2e/`：`npm --prefix products/kith/e2e run lint` 與 `npm run e2e` 結果與 main 相同。
- 風險與回滾：wrangler 參數從 harness 複製，harness 改參數時可能不同步。啟動器在檔頭註明來源行號，第 3 輪 Discover 步驟比對。若擁有者希望消除重複，另提把參數組裝抽成 harness 匯出函式的 PR（屬 `e2e/` 變更，不在本設計）。回滾：刪除 `launch.mjs`。

### M2 主要流程腳本 `fe-review/flows.mjs`
- 對應：C2；A2。`PROMPT.md` 的「主要流程」。
- 現況：seed 沒有 provider、thread，也沒有已設定 runtime 的 hosted agent（`e2e/fixtures/seed.ts:60-73` 只有 members、rooms、messages）。因此 `/r/:slug/t/:threadId`、`/console/providers/:id`、agent 回覆與串流狀態無法只靠 `capture.mjs` 的靜態頁面清單擷取。既有 e2e 已示範做法：`createProviderViaApi`（`e2e/fixtures/console.ts:21-22`）與開 thread 的 UI 操作（`e2e/specs/w6-thread.spec.ts:62-64`）。
- 修改：新增 `products/kith/fe-review/flows.mjs`，連到 M1 啟動的環境，依序執行並截圖到 `runs/<ts>/screenshots/`（檔名沿用 `capture.mjs` 格式，加上步驟序號）：
  1. 登入頁（未登入）→ 以 `ada` 登入 → `/`。
  2. 進入 `/r/lobby` → 發一則訊息 → 看到自己的訊息。
  3. 以 API 建立指向 fake provider 的 provider 連線（`openai_chat`、key 為 canary），把 `grok` 的 runtime 設為 hosted、使用該連線；在 lobby 發 `@grok` 訊息，fake directive 控制為多段串流（`chunks`／`chunk_ms`），分別截「串流中」與「完成」。
  4. 在一則訊息上開 thread（`message-action-thread`）→ `/r/lobby/t/:threadId` → 在 thread 回覆。
  5. `/r/long-history`：捲到頂端載入更多，再捲回底部，截圖並記錄捲動位置。
  6. Console：agents 列表 → `/console/agents/m-grok` → `/console/agents/new`；providers 列表 → 步驟 3 建立的 `/console/providers/:id`（截圖中只可出現 `secret_last4`，`web/src/features/console/providers/ProviderForm.tsx:309-312`）→ `/console/providers/new`；people；rooms。
  7. 離線狀態：以 `context.setOffline(true)` 嘗試觸發 room 的 offline／reconnecting 提示（`web/src/features/rooms/RoomHeader.tsx:22-27,93`、`web/src/features/composer/Composer.tsx:177-179`）。無法觸發就在報告標 `n/a` 並記錄原因，不改程式碼。
  每步寫入 `runs/<ts>/flows.json`：URL、console error、失敗的 request、各 viewport 是否水平溢出。
- 驗證：在 M1 環境跑 `node products/kith/fe-review/flows.mjs`，每步都有截圖且 exit 0；截圖與 `flows.json` 不含 seed 密碼與 canary（用 `e2e/harness/redact.ts` 掃描輸出）；`git status` 沒有新增要提交的 PNG 或 `*.storage.json`。
- 風險與回滾：腳本依賴 `data-testid`，UI 改版時會失效，這時應修腳本，而不是放寬檢查。回滾：刪除 `flows.mjs`。

### M3 `targets.json` 驗證與定稿
- 對應：C1。
- 現況：`targets.json` 的 `start` 只起 Vite，並假設 worker 在 `127.0.0.1:8787`（`fe-review/targets.json:16-19`）。除了 `/login`，所有頁面都在 `RequireAuth` 後面（`web/src/app/App.tsx:52-70`），但目前沒有 `storageState`。
- 修改：
  - 拆成兩個 app：`web-anon`（只有 `/login`，無 `storageState`）與 `web`（其餘頁面，`storageState: "products/kith/fe-review/runs/.state/current/auth.storage.json"`）。
  - 兩個 app 的 `start` 都改為 M1 的啟動器，並註明只能由一個 app 以 `--start` 啟動，或先手動啟動再不帶 `--start` 擷取。
  - 頁面清單以本 PR 列出的 seed 路由為準（見下方「第 3 輪驗收」），跑通後改為 `verified: true` 並寫上日期。
- 驗證：先跑 `node docs/fe-review/capture.mjs products/kith/fe-review/targets.json --dry-run`，再在 M1 環境實際擷取一次：每頁 HTTP 200，沒有被導回 `/login`。
- 風險與回滾：`storageState` 過期會讓頁面被導回登入頁；啟動器每次重新登入。回滾：還原 `targets.json`。

### M4 `PROMPT.md`、`REVIEW.md` 同步
- 對應：C1–C3。
- 修改：以 M1–M3 實際跑通的指令更新 `PROMPT.md` 的「啟動線索」與「主要流程」。`REVIEW.md` 的「目前輪次」改為第 2 輪完成，C1 改寫成「以 harness 啟動器解耦」的結論，C3 保留到擁有者決定 D3 為止。
- 驗證：文件中的每個指令都在 M1 環境實際執行過；連結有效。
- 風險與回滾：純文件；還原即可。

## 啟動方式（第 2 輪要驗證的版本）

在隔離容器內，從 repository root（Node 24.18.0）執行：

```bash
npm ci --prefix products/kith
npm ci --prefix products/kith/web
npm ci --prefix products/kith/e2e && npx --prefix products/kith/e2e playwright install chromium
node products/kith/fe-review/launch.mjs          # 前景執行；Ctrl-C 或 SIGTERM 會清理
# 另一個 shell：
node docs/fe-review/capture.mjs products/kith/fe-review/targets.json
node products/kith/fe-review/flows.mjs
```

- web：`http://127.0.0.1:5174`（固定）；worker、inspector、fake provider：`127.0.0.1` 的隨機 port，由啟動器輸出。
- 合成資料：seed `base-v1`（`e2e/fixtures/seed.ts`）：operator `ada`、成員 `ben`／`chen`／停用的 `dora`、agent `grok`（`api_key`）與 `codex`（`operator_personal`）；房間 `lobby`、`long-history`、`quiet`、`ada-private`。帳號密碼與 provider canary 是 repo 內固定的測試字串（`e2e/fixtures/accounts.ts:6-16`），不是秘密，但仍不得出現在提交的截圖或報告中。
- 狀態：`products/kith/fe-review/runs/.state/`（git-ignored），執行結束可整個刪除。

## 第 3 輪驗收

- 頁面與流程：
  - `web-anon`：`/login`。
  - `web`：`/`、`/r/lobby`、`/r/long-history`、`/r/quiet`、`/r/ada-private`、`/settings`、`/console/agents`、`/console/agents/m-grok`、`/console/agents/new`、`/console/providers`、`/console/providers/new`、`/console/people`、`/console/rooms`，以及一個不存在的路徑（NotFound）。
  - `flows.mjs` 的七個步驟（含動態的 thread 與 provider 詳細頁）。
  - viewport：desktop、tablet、mobile；color scheme：light、dark（`web/src/app/theme.ts` 預設跟隨系統）。
- 通過條件：沒有 blocker／major；axe 沒有 critical／serious；三種 viewport 都沒有水平溢出；console 沒有 error（未登入頁預期的 401 須註明）；截圖不含密碼、canary、`KITH_SECRETS_KEY`；主要流程至少完整走通一次。
- 已知不在驗收範圍：runner／sidecar 與 `operator_personal` agent 的實際回覆（需要外部 CLI）、ambient、真實 LLM provider、線上部署、`scripts/dev-bind.mjs` 的 Tailscale 路徑、WebSocket 故障注入（`e2e/harness/ws-chaos.ts` 屬 e2e 範圍）。

## 開放問題

- D3（見 REVIEW.md）：README 的本機開發路徑是否要讓綁定策略可注入（只收窄到 loopback）。本設計不依賴它的結果。
- `docs/quickstart.md:22-25` 仍寫 `npm run dev:frontend`（Vite :5173），但 `package.json` 沒有這個 script，`frontend/` 也已刪除（README v2 段落）。這在 `fe-review/` 範圍外，需另開文件修正。
