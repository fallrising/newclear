# 08 — 測試：以 E2E 為主

[回 v2 索引](README.md)

## 1. 規則（使用者指定）

1. **不在寫完程式後補單元測試。**
2. **E2E 是主要且預設唯一的測試手段。** 複雜功能以 E2E 證明可用。
3. **每次 E2E 結束產出可驗證、可重跑的證據資料夾**（§4）。
4. **必須單獨測試某個系統時，先寫下它所有可能的失敗方式（FM 清單），再寫程式。** v2 已知需要單獨驗證的：LLM adapter（[03](03-agent-runtime.md) §2.7）、runner（[03](03-agent-runtime.md) §3.3）、RoomSync（[05](05-frontend-architecture.md) §5.3）、E2E harness 本身（§5.1）。
5. **開發期間不跑全套 E2E**；只跑當前里程碑或當前功能的 spec。全套只在開 PR 前跑一次，或交給 CI。

v1 既有 vitest（`npm test`）保留為回歸，改動後端時照跑；v2 不新增 vitest 單元測試。

## 2. 架構

```text
products/kith/e2e/
  package.json            # 獨立套件：@playwright/test、ajv、typescript（W0）
  playwright.config.ts    # 專案 desktop／mobile、reporter、輸出位置
  global-setup.ts         # 建立隔離環境（§2.1），寫 run-context.json
  global-teardown.ts      # 停止子程序、刪 state/
  fixtures/
    seed.ts               # 決定性種子資料（base-v1 全文見 W0 §4.4）
    accounts.ts           # 測試帳號（固定、非機密的測試密碼）、canary
    kith.ts               # Playwright fixtures：baseURL、recorder、api
  harness/
    paths.ts、git.ts、run-env.ts   # 路徑、git 資訊、run_id
    server.ts             # 啟動／停止 wrangler 與 vite
    redact.ts             # 遮罩規則 R01–R07 與掃描
    recorder.ts           # 每個測試的 API／WS 紀錄
    evidence.ts           # 截圖命名、斷言、證據檔
    reporter.ts           # 寫 manifest.json、summary.md，遮罩掃描
    validate.ts、nested.ts
    ws-chaos.ts           # §5.2；W1 實作
    fake-provider/        # §5.3；W4 實作
    fake-cli/             # §5.4；W6 實作
  scripts/                # print-seed、validate-run、open-report（Node 24 直接執行 .ts）
  specs/
    w0-shell.spec.ts
    w0-evidence.spec.ts
    w0-probe.spec.ts      # 只給 E2E-W0-02 巢狀執行
    …                     # 一個里程碑一到數個檔案
  artifacts/              # gitignored；每次執行一個子資料夾
```

### 2.1 被測系統

- 後端：`wrangler dev --local --persist-to <run_dir>/state`，每次執行一個全新目錄，執行 migration 與 seed。port 與 inspector port 每次取空閒 port，所以巢狀或並行的執行不會互撞。
- 隔離：wrangler 一律帶 `--env-file <run_dir>/state/wrangler.env`，因此**不**讀開發者的 `.dev.vars`（FM-E2E-05）；並設 `CLOUDFLARE_CF_FETCH_ENABLED=false`、`WRANGLER_SEND_METRICS=false`，不對外連線。flag 以 `--var` 傳入，不改 `wrangler.toml`（值見 [W0](milestones/W0.md) §2.3）。
- 前端：`web/` 以 `vite build` 產出後由 wrangler `--assets web/dist` 提供（與 production 相同路徑；`--assets` 覆蓋 `wrangler.toml` 的 `./frontend/dist`，W7 前兩者並存）。開發期可改用 `vite dev` 代理（`E2E_WEB=dev`）。
- LLM：`fake-provider` 在 `127.0.0.1:<port>` 提供各格式端點；後端以 `KITH_DEV_ALLOW_HTTP_PROVIDERS=on` 允許。它可依 prompt 中的指令字串回傳固定文字、延遲、串流分段、特定錯誤碼（對應 FM-LLM-xx）。
- runner：`kith-runner` 以真實程式執行，adapter 設為 `command` 並指向 `fake-cli`。
- 沒有任何真實 API key、真實 CLI 登入、外部網路。

### 2.2 決定性

- 種子資料固定（帳號、房間、agent、連線、歷史訊息數量與內容）。
- `client_message_id` 在測試中由 fixture 產生（帶 spec 名與序號），方便追查。
- 前端時間顯示：以 Playwright `page.clock.setFixedTime()` 固定瀏覽器時間（`install()` 會讓時間繼續走，不適合斷言固定字串）；伺服器時間無法固定，截圖時遮罩時間戳：顯示伺服器時間的元素一律加 `data-mask="time"`，`shot()` 會遮住它。
- 所有測試依序執行（`workers: 1`、`retries: 0`），共用同一個 seed 資料庫。
- 不以 `sleep` 作為正確性證明；等待條件一律是可觀察狀態（元素出現、WS 封包到達、API 回應）。

## 3. 執行

| 指令（工作目錄 `products/kith`） | 用途 |
| --- | --- |
| `npm run e2e -- specs/w1-chat.spec.ts` | 開發期：只跑一個檔案 |
| `npm run e2e -- --grep @W3` | 開發期：只跑一個里程碑 |
| `npm run e2e:all` | PR 前或 CI：全套 |
| `npm run e2e:open -- [run_id]` | 打開該次的 HTML 報告（省略時取最新一次） |
| `npm run e2e:validate -- [run_id]` | 以 JSON Schema 與 hash 驗證該次證據資料夾 |

瀏覽器：Playwright 1.56.1 綁定的 Chromium revision 1194。本專案雲端環境已預裝（`PLAYWRIGHT_BROWSERS_PATH`），不執行 `playwright install`；其他機器在 `e2e/` 執行一次 `npx playwright install chromium`。專案：`desktop`（1280×800、`zh-TW`）跑全部測試；`mobile`（390×844、`en-US`、touch）只跑帶 `@mobile` tag 的測試。

## 4. 證據資料夾（artifact）

每次執行產出 `e2e/artifacts/<run_id>/`，`run_id = YYYYMMDD-HHMMSS-<git short sha>[-dirty]`。

```text
<run_id>/
  manifest.json           # §4.1
  summary.md              # 人讀摘要：通過／失敗表、每個驗收 ID 的證據連結、檔案雜湊
  run-context.json        # global setup 寫入：版本、git、seed、base_url
  seed.json               # 本次種子資料的描述與 sha256（contracts/v2/e2e-seed.json）
  server.log              # wrangler 輸出（遮罩）
  web-build.log           # vite build 輸出（build 模式）
  report/                 # Playwright HTML report
  test-output/            # Playwright outputDir（失敗時的 error-context 等）
  traces/<E2E-ID>.<project>.zip          # Playwright trace（失敗才保留）
  screenshots/<E2E-ID>/<NN>-<step>-<project>.png
  api/<E2E-ID>.<project>.jsonl           # HTTP 請求／回應摘要（遮罩 cookie、token、key、密碼）
  ws/<E2E-ID>.<project>.jsonl            # WS 封包紀錄（遮罩同上）
  files/<E2E-ID>/<name>                  # 其他證據檔
  nested/                 # 只有 E2E-W0-02：巢狀執行各自的資料夾
  state/                  # D1／DO 本機狀態；teardown 刪除（KITH_E2E_KEEP_STATE=1 保留）
```

### 4.1 `manifest.json`

JSON Schema：[`contracts/v2/e2e-manifest.json`](../../contracts/v2/e2e-manifest.json)。欄位語意、成功與失敗範例、reporter 如何產生它，見 [W0](milestones/W0.md) §4.2、§5.1.10。遮罩規則 R01–R07 與掃描範圍見 [W0](milestones/W0.md) §5.1.5。

### 4.2 可驗證

- 每個結果以驗收 ID 為鍵，可對照 [09](09-roadmap.md) 的里程碑驗收表。
- 每個證據檔有 sha256；`summary.md` 列出檔案與 hash，事後可驗證未被竄改。
- `redaction.hits_after_redaction` 必須為 0，否則整次執行標為失敗（V2-INV-01 的自動檢查）。
- 標題缺驗收 ID、證據檔不存在、manifest 自我驗證失敗，都寫進 `errors` 並使整次執行失敗。

### 4.3 可重跑

- manifest 記錄 git sha、指令、版本、種子 id。同 sha＋同指令＋同種子應得到同樣的通過／失敗結果。
- 截圖不做像素級比對作為通過條件（字型渲染與時間戳會變）；它們是證據，不是斷言。

### 4.4 視覺回歸（選用）

W7 前可對少數穩定元件（登入頁、空狀態、控制台清單）啟用 `toHaveScreenshot`，基準圖來自 [07](07-visual-design.md) §8 的視覺稿實作。依 D-16，W0–W7 都不做像素比對，只截圖；整體施工完成後另立工作。

### 4.5 保存

- `artifacts/` 在 `.gitignore`；不提交進 git。
- CI 把該次資料夾上傳為 workflow artifact（保存 14 天）。
- PR 說明貼上 `summary.md` 內容（或其摘要）與 run_id。

## 5. 受控故障注入

RoomSync 與 runner 的 FM 以 E2E＋故障注入驗證，不寫單元測試。E2E harness 本身的 FM 見 §5.1；三個故障注入工具的控制介面見 §5.2–§5.4（W0 定義，各自的里程碑實作）。


| 工具 | 能做什麼 | 用在 |
| --- | --- | --- |
| `ws-chaos`（以 Playwright `page.routeWebSocket` 在瀏覽器與後端之間轉送 WS，§5.2） | 延遲指定封包、調換順序、丟掉某個 seq、在送出後立刻斷線、注入壞封包 | FM-SYNC-01–07、12–17 |
| Playwright `context.setOffline` | 瀏覽器斷網 | FM-SYNC-06、13 |
| `page.route` | 讓某個 REST 回應延遲、失敗或回 401 | FM-SYNC-08–10 |
| `fake-provider` 指令 | 依 prompt 標記回特定錯誤、延遲、串流切段、中途斷線 | FM-LLM-01–16（端到端層面） |
| `fake-cli` 指令 | 非零退出、逾時、超長輸出 | FM-RUN-03–04 |

LLM adapter 的**協定解析**（SSE 切段、欄位缺漏）屬於純轉換，若 E2E 無法經濟地覆蓋每一種切法，允許以 golden fixture 腳本單獨驗證——前提是 [03](03-agent-runtime.md) §2.7 的 FM 清單已先寫好並逐條對應 fixture。這是規則 4 的唯一預先核准例外。

### 5.1 FM 清單：E2E harness

harness 是「必須單獨驗證的系統」之一：它決定一次執行算不算通過。以下失敗模式在寫 harness 前定義，全部由 `E2E-W0-02` 以巢狀執行覆蓋（細節見 [W0](milestones/W0.md) §7.2、§8）。

- **FM-E2E-01** 證據檔在遮罩後仍含已知秘密、bot token 形狀字串或本次 session 值 → 列入 `redaction.hits`，整次執行失敗。
- **FM-E2E-02** 測試標題缺驗收 ID → `errors` 記錄，整次執行失敗。
- **FM-E2E-03** evidence 指向不存在的檔案 → `errors` 記錄，整次執行失敗。
- **FM-E2E-04** global setup 失敗（run 資料夾已存在、wrangler 未就緒、build／migration／seed 失敗）→ 不覆寫既有資料夾、停止已啟動的子程序、exit ≠ 0。
- **FM-E2E-05** 開發者本機的 `.dev.vars`（其中若有真實 key）被 wrangler 自動載入 → harness 以 `--env-file` 阻止；`server.log` 不得出現 `Using secrets defined in`。
- **FM-E2E-06** teardown 後 wrangler／workerd 殘留 → 以 process group 終止，port 必須關閉。

### 5.2 `ws-chaos` 控制介面（W0 定義；W1 實作於 `e2e/harness/ws-chaos.ts`）

實作方式：`page.routeWebSocket(/\/api\/rooms\/[^/]+\/ws$/, ws => { const server = ws.connectToServer(); … })`。W0 細化時已實測：這樣轉送會帶上 session cookie，`send` 能落盤並收到 `event`（[W0](milestones/W0.md) §10）。不需要另起代理程序或 port。

```ts
export type FrameDir = "in" | "out";            // in = 伺服器→瀏覽器；out = 瀏覽器→伺服器
export type FrameMatch = {
  dir: FrameDir;
  type?: "event" | "status" | "error" | "draft" | "send" | "ack";
  seq?: number;                                 // 只比對 type=event 的 event.seq
  bodyIncludes?: string;
};
export type ChaosFrame = { dir: FrameDir; at: number; raw: string; json: unknown | null };
export type ChaosRule =
  | { kind: "hold"; match: FrameMatch }                        // 攔住，直到 release
  | { kind: "delay"; match: FrameMatch; ms: number }           // 攔住 ms 後自動送出（Node 端計時）
  | { kind: "drop"; match: FrameMatch }                        // 永遠不送
  | { kind: "closeAfter"; match: FrameMatch; code: number };   // 送出符合的封包後，以 code 關閉瀏覽器端連線
export interface WsChaos {
  attach(page: Page): Promise<void>;            // 必須在 page.goto 之前呼叫
  add(rule: ChaosRule): string;                 // 回傳 rule id
  remove(ruleId: string): void;
  release(ruleId: string): void;                // 依原順序送出該規則攔住的封包
  inject(raw: string): void;                    // 立刻送一段原始文字給瀏覽器（壞封包）
  closeFromServer(code: number): void;          // 模擬伺服器端斷線（含 hibernation）
  frames(): ChaosFrame[];                       // 看過的所有封包（含被丟棄的）
  waitForFrame(match: FrameMatch, timeoutMs: number): Promise<ChaosFrame>;
}
export function createWsChaos(): WsChaos;
```

亂序＝先 `hold` seq 4 與 seq 5，再依 5、4 的順序 `release`。每條 FM-SYNC 用哪個規則，在 W1 的 `W1.md` FM 對照表寫明。

### 5.3 `fake-provider` 控制介面（W0 定義語法；W4 實作並補各格式回應樣本）

- 程序：`e2e/harness/fake-provider/server.ts`，由 global setup 以空閒 port 啟動，位址放在 `KITH_E2E_FAKE_PROVIDER_URL`；後端以 `KITH_DEV_ALLOW_HTTP_PROVIDERS=on` 允許連它。
- 各格式的端點路徑、請求／回應欄位、串流事件：**未查證**，W4 Phase 2 依 [10](10-decisions.md) §4 S2-01–S2-03 查證後寫入 `W4.md`。W0 不寫任何格式細節。
- 指令語法：fake-provider 在收到的請求本文中找**第一個** `[[fake:…]]`，格式為 `[[fake:` + `name=value` 以 `;` 分隔 + `]]`，`value` 以 `encodeURIComponent` 編碼。沒有指令時回覆 `fake reply`。

| 指令 | 值 | 行為 |
| --- | --- | --- |
| `text` | 字串 | 回覆內容 |
| `delay_ms` | 整數 ≥ 0 | 第一個 byte 之前等待 |
| `chunks` | 整數 ≥ 1 | 串流時把回覆切成幾段 |
| `chunk_delay_ms` | 整數 ≥ 0 | 串流段與段之間的間隔 |
| `status` | HTTP 狀態碼 | 回該狀態與該格式的錯誤本文 |
| `retry_after` | 秒 | 同時回 `retry-after` header |
| `drop_after_chunks` | 整數 ≥ 0 | 送出 N 段後直接關閉連線 |
| `malformed` | `1` | 回無法解析的本文（非串流）或壞掉的串流事件 |

- 控制端點：`GET /__fake/requests`（本次收到的請求摘要：時間、路徑、格式、`authorization` 只留末 4 碼）、`POST /__fake/reset`。schema 由 W4 寫進 `contracts/v2/`。

### 5.4 `fake-cli` 控制介面（W0 定義語法；W6 實作）

- 檔案：`e2e/harness/fake-cli/fake-cli.mjs`。沿用 v1 `sidecar/fake-cli.mjs` 的記錄方式：把 argv、stdin、呼叫次數寫進 `$KITH_FAKE_CLI_DIR/invocations.json`。
- 指令語法與 §5.3 相同（`[[fake:…]]`，從 stdin 找第一個）：

| 指令 | 值 | 行為 |
| --- | --- | --- |
| `text` | 字串 | 寫到 stdout 的最終摘要 |
| `exit` | 整數 | 以此 exit code 結束（FM-RUN-03） |
| `sleep_ms` | 整數 ≥ 0 | 結束前等待（逾時用，FM-RUN-04） |
| `stdout_bytes` | 整數 ≥ 0 | 額外輸出這麼多 bytes 的填充（超長輸出，FM-RUN-04） |

- 輸出格式（純文字或 JSON 事件流）取決於 runner adapter 契約，W6 Phase 2 與 Q-08 一起決定。

## 6. 追溯表

Phase 2 在此維護完整表格：驗收 ID → 業務規則／旅程／FM → spec 檔 → 最近一次通過的 run_id。

| E2E ID | 覆蓋 | spec |
| --- | --- | --- |
| E2E-W0-01 | 隔離環境、seed、登入、FE-05（語言偵測）、FE-22、BR-22、UJ-11（部分） | w0-shell.spec.ts |
| E2E-W0-02 | 證據資料夾、V2-INV-01 的檢查機制、FM-E2E-01–06 | w0-evidence.spec.ts |
| E2E-W1-01 | V2-INV-04（舊前端仍可用） | w1-compat.spec.ts |
| E2E-W1-02 | UJ-02、BR-31 | w1-chat.spec.ts |
| … | … | … |

## 7. CI

- 根 `.github/workflows/kith.yml` 新增 job `e2e`（Phase 2 設計）：path-scoped、`contents: read`、無 secrets、timeout、concurrency cancel、上傳 artifacts。遵守 `docs/specs/monorepo-ci.md`，並同步更新該文件。
- 既有 `npm test`、`npm run lint` 照跑。

## 8. Phase 2 待細化

- [ ] 每個 E2E ID 的逐步腳本（操作、等待條件、斷言、截圖點）。W0 已完成（[W0](milestones/W0.md) §7）；其餘隨各 `Wn.md`。
- [ ] `fake-provider` 的指令語法與每個格式的回應樣本。語法已完成（§5.3）；各格式回應樣本在 W4（需要 S2-01–S2-03 查證）。
- [x] `ws-chaos` 的控制 API → §5.2。
- [x] seed 資料的完整內容（含 1,200 則歷史的長房間）→ [W0](milestones/W0.md) §4.4（`base-v1`）。
- [x] manifest JSON Schema 與遮罩規則清單 → [`contracts/v2/e2e-manifest.json`](../../contracts/v2/e2e-manifest.json)、[W0](milestones/W0.md) §5.1.5。
- [ ] CI job 定義與執行時間預算。
