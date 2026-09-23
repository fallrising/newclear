# 08 — 測試：以 E2E 為主

[回 v2 索引](README.md)

## 1. 規則（使用者指定）

1. **不在寫完程式後補單元測試。**
2. **E2E 是主要且預設唯一的測試手段。** 複雜功能以 E2E 證明可用。
3. **每次 E2E 結束產出可驗證、可重跑的證據資料夾**（§4）。
4. **必須單獨測試某個系統時，先寫下它所有可能的失敗方式（FM 清單），再寫程式。** v2 已知需要單獨驗證的：LLM adapter（[03](03-agent-runtime.md) §2.7）、runner（[03](03-agent-runtime.md) §3.3）、RoomSync（[05](05-frontend-architecture.md) §5.3）。
5. **開發期間不跑全套 E2E**；只跑當前里程碑或當前功能的 spec。全套只在開 PR 前跑一次，或交給 CI。

v1 既有 vitest（`npm test`）保留為回歸，改動後端時照跑；v2 不新增 vitest 單元測試。

## 2. 架構

```text
products/kith/e2e/
  playwright.config.ts
  global-setup.ts         # 建立隔離環境（§3），寫 run manifest 開頭
  global-teardown.ts      # 關閉子程序，寫 manifest 結尾
  fixtures/
    seed.ts               # 決定性種子資料
    accounts.ts           # 測試帳號（固定、非機密的測試密碼）
    kith.ts               # Playwright fixtures：operatorPage、guestPage、api、ws
  harness/
    fake-provider/        # 本機 HTTP 伺服器，模擬 openai_chat / anthropic_messages / openai_responses / gemini
    ws-chaos/             # 受控 WS 代理：延遲、亂序、丟包、斷線（RoomSync FM 用）
    fake-cli/             # runner 用的假 CLI（沿用 v1 sidecar/fake-cli.mjs 的思路）
    evidence.ts           # 截圖命名、hash、manifest 寫入
  specs/
    w1-chat.spec.ts
    w1-history.spec.ts
    w2-rooms.spec.ts
    …                     # 一個里程碑一到數個檔案
  artifacts/              # gitignored；每次執行一個子資料夾
```

### 2.1 被測系統

- 後端：`wrangler dev --local --persist-to <run_dir>/state`，每次執行一個全新目錄，執行 migration 與 seed。
- 前端：`web/` 以 `vite build` 產出後由 wrangler assets 提供（與 production 相同路徑）。開發期可改用 `vite dev` 代理（`E2E_WEB=dev`）。
- LLM：`fake-provider` 在 `127.0.0.1:<port>` 提供各格式端點；後端以 `KITH_DEV_ALLOW_HTTP_PROVIDERS=on` 允許。它可依 prompt 中的指令字串回傳固定文字、延遲、串流分段、特定錯誤碼（對應 FM-LLM-xx）。
- runner：`kith-runner` 以真實程式執行，adapter 設為 `command` 並指向 `fake-cli`。
- 沒有任何真實 API key、真實 CLI 登入、外部網路。

### 2.2 決定性

- 種子資料固定（帳號、房間、agent、連線、歷史訊息數量與內容）。
- `client_message_id` 在測試中由 fixture 產生（帶 spec 名與序號），方便追查。
- 前端時間顯示：以 Playwright `page.clock` 固定瀏覽器時間；伺服器時間無法固定，截圖時遮罩時間戳（`mask` 選項）。
- 不以 `sleep` 作為正確性證明；等待條件一律是可觀察狀態（元素出現、WS 封包到達、API 回應）。

## 3. 執行

| 指令（工作目錄 `products/kith`） | 用途 |
| --- | --- |
| `npm run e2e -- specs/w1-chat.spec.ts` | 開發期：只跑一個檔案 |
| `npm run e2e -- --grep @W3` | 開發期：只跑一個里程碑 |
| `npm run e2e:all` | PR 前或 CI：全套 |
| `npm run e2e:open <run_id>` | 打開該次的 HTML 報告 |

瀏覽器使用預裝 Chromium（`executablePath` 設定，見環境說明）；不執行 `playwright install`。預設 viewport：桌面 1280×800、手機 390×844，各 spec 以 tag `@mobile` 標示需要手機版的案例。

## 4. 證據資料夾（artifact）

每次執行產出 `e2e/artifacts/<run_id>/`，`run_id = YYYYMMDD-HHMMSS-<git short sha>[-dirty]`。

```text
<run_id>/
  manifest.json           # §4.1
  summary.md              # 人讀摘要：通過／失敗表、每個驗收 ID 的證據連結
  report/                 # Playwright HTML report
  traces/<test>.zip       # Playwright trace（失敗必留；成功依設定）
  screenshots/<E2E-ID>/<step>-<viewport>.png
  api/<E2E-ID>.jsonl      # 該測試期間的 HTTP 請求／回應摘要（遮罩 cookie、token、key）
  ws/<E2E-ID>.jsonl       # WS 封包紀錄（遮罩同上）
  server.log              # wrangler 輸出（遮罩）
  seed.json               # 本次種子資料的描述與 hash
```

### 4.1 `manifest.json`（輪廓；Phase 2 寫成 JSON Schema）

```json
{
  "schema": "kith-e2e-manifest/v1",
  "run_id": "20260923-101500-30bc902",
  "git": { "sha": "30bc902…", "dirty": false, "branch": "…" },
  "command": "npm run e2e -- specs/w1-chat.spec.ts",
  "scope": "partial",
  "versions": { "node": "24.18.0", "wrangler": "…", "playwright": "…", "chromium": "…" },
  "seed": { "id": "base-v1", "sha256": "…" },
  "started_at": "…", "finished_at": "…",
  "results": [
    {
      "id": "E2E-W1-02",
      "spec": "specs/w1-chat.spec.ts",
      "title": "two humans exchange messages with identical seq",
      "status": "passed",
      "duration_ms": 4210,
      "evidence": [
        { "kind": "screenshot", "path": "screenshots/E2E-W1-02/03-both-see-message-desktop.png", "sha256": "…" },
        { "kind": "assertion", "text": "operator and guest see seq 12 with same id" }
      ]
    }
  ],
  "redaction": { "patterns": ["session", "kith_bot_", "canary"], "hits_after_redaction": 0 }
}
```

### 4.2 可驗證

- 每個結果以驗收 ID 為鍵，可對照 [09](09-roadmap.md) 的里程碑驗收表。
- 每個證據檔有 sha256；`summary.md` 列出檔案與 hash，事後可驗證未被竄改。
- `redaction.hits_after_redaction` 必須為 0，否則整次執行標為失敗（V2-INV-01 的自動檢查）。

### 4.3 可重跑

- manifest 記錄 git sha、指令、版本、種子 id。同 sha＋同指令＋同種子應得到同樣的通過／失敗結果。
- 截圖不做像素級比對作為通過條件（字型渲染與時間戳會變）；它們是證據，不是斷言。

### 4.4 視覺回歸（選用）

W7 前可對少數穩定元件（登入頁、空狀態、控制台清單）啟用 `toHaveScreenshot`，基準圖來自 [07](07-visual-design.md) §8 的視覺稿實作，容忍度 Phase 2 定義。

### 4.5 保存

- `artifacts/` 在 `.gitignore`；不提交進 git。
- CI 把該次資料夾上傳為 workflow artifact（保存 14 天）。
- PR 說明貼上 `summary.md` 內容（或其摘要）與 run_id。

## 5. 受控故障注入

RoomSync 與 runner 的 FM 以 E2E＋故障注入驗證，不寫單元測試：

| 工具 | 能做什麼 | 用在 |
| --- | --- | --- |
| `ws-chaos` 代理（前端 WS 經它連後端） | 延遲指定封包、調換順序、丟掉某個 seq、在送出後立刻斷線、注入壞封包 | FM-SYNC-01–07、12–17 |
| Playwright `context.setOffline` | 瀏覽器斷網 | FM-SYNC-06、13 |
| `page.route` | 讓某個 REST 回應延遲、失敗或回 401 | FM-SYNC-08–10 |
| `fake-provider` 指令 | 依 prompt 標記回特定錯誤、延遲、串流切段、中途斷線 | FM-LLM-01–16（端到端層面） |
| `fake-cli` 指令 | 非零退出、逾時、超長輸出 | FM-RUN-03–04 |

LLM adapter 的**協定解析**（SSE 切段、欄位缺漏）屬於純轉換，若 E2E 無法經濟地覆蓋每一種切法，允許以 golden fixture 腳本單獨驗證——前提是 [03](03-agent-runtime.md) §2.7 的 FM 清單已先寫好並逐條對應 fixture。這是規則 4 的唯一預先核准例外。

## 6. 追溯表

Phase 2 在此維護完整表格：驗收 ID → 業務規則／旅程／FM → spec 檔 → 最近一次通過的 run_id。

| E2E ID | 覆蓋 | spec |
| --- | --- | --- |
| E2E-W1-01 | V2-INV-04（舊前端仍可用） | w1-compat.spec.ts |
| E2E-W1-02 | UJ-02、BR-31 | w1-chat.spec.ts |
| … | … | … |

## 7. CI

- 根 `.github/workflows/kith.yml` 新增 job `e2e`（Phase 2 設計）：path-scoped、`contents: read`、無 secrets、timeout、concurrency cancel、上傳 artifacts。遵守 `docs/specs/monorepo-ci.md`，並同步更新該文件。
- 既有 `npm test`、`npm run lint` 照跑。

## 8. Phase 2 待細化

- [ ] 每個 E2E ID 的逐步腳本（操作、等待條件、斷言、截圖點）。
- [ ] `fake-provider` 的指令語法與每個格式的回應樣本。
- [ ] `ws-chaos` 的控制 API。
- [ ] seed 資料的完整內容（含 1,200 則歷史的長房間）。
- [ ] manifest JSON Schema 與遮罩規則清單。
- [ ] CI job 定義與執行時間預算。
