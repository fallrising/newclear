# FE Review — kith — REVIEW

> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：文檔先行（進行中）** — [`DESIGN.md`](DESIGN.md) 已草擬，待擁有者在設計 PR 確認其中的假設 A1–A3 後合併。
- 第 2 輪：修改（未開始）
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C1 前端需要本機 worker 與 D1 才有資料

`web/` 的 `/api`、`/mcp` 代理到 `KITH_API_ORIGIN`（`web/vite.config.ts:5-16`），沒有獨立的 mock 模式，UI 無法脫離後端擷取。依 PROTOCOL 第 0 節屬測試耦合。符合第 0 節的啟動路徑已存在，但只在 Playwright global setup 內：`e2e/harness/server.ts:71-124` 以 `127.0.0.1`、隨機 port、隔離的 `--persist-to` 與 `--env-file` 啟動 worker，`e2e/global-setup.ts:54-73` 套用 migrations 與固定 seed `base-v1`。`DESIGN.md` M1 把它包成 `fe-review/` 的啟動器。

### C2 LLM provider 已有假實作，但不在 fe-review 的啟動路徑上

原始碼已有兩個 fake，都不需要真實 API key：

- e2e harness 的外部 fake provider（`e2e/harness/fake-provider.ts`）：支援 `openai_chat`、`openai_responses`、`anthropic_messages`、`gemini` 四種格式，只接受每次執行的 canary key，prompt 內的 `[[fake:…]]` directive 可控制文字、延遲、錯誤碼與串流分段。它由 `e2e/harness/server.ts:83` 啟動。
- worker 內建 fake：沒有 `XAI_API_KEY` 但設定了 `FAKE_LLM_TEXT` 時啟用（`worker/hosted/llm.ts:27-51`、`worker/env.ts:17-18`、`worker/providers/runtime.ts:64`）。

缺的是接線：seed 沒有 provider，也沒有已設定 runtime 的 hosted agent（`e2e/fixtures/seed.ts:60-73`）。要覆蓋 agent 回覆與串流畫面，必須在執行時建立指向 fake provider 的連線。

### C3 README 的本機開發路徑不符合第 0 節

`npm run dev`／`npm run dev:web` 經 `scripts/dev-bind.mjs`：worker 綁 `0.0.0.0:8787`（`scripts/dev-bind.mjs:28-43`），web 綁 Tailscale IPv4 的 5173（`:47-52`），兩者都先執行 `tailscale ip -4`，失敗即中止（`:13-23`）。worker 還會載入開發者的 `.dev.vars`。在隔離容器內這條路徑無法啟動，也不應使用；fe-review 改走 C1 的 harness 路徑，不受影響。另外 `docs/quickstart.md:22-25` 引用已不存在的 `npm run dev:frontend`。

## 已決定

- 無。

## 需要放開或決定的點

### D1 前端 mock 的位置

- 選項：(a) 前端加 contract mock（MSW 類）；(b) 沿用 `e2e/` harness 啟動真實 worker＋本機 D1＋固定 seed。
- 建議：(b)。harness 已具備隔離、seed 與清理，改動最小；(a) 視第 3 輪成本再決定。
- 狀態：**待擁有者決定**。`DESIGN.md` 以建議作為假設 A1，在設計 PR 中由擁有者確認。

### D2 fake LLM provider

- 選項：(a) 在 worker 端新增只供測試的 fake provider；(b) 在 harness 層處理，不改後端。
- 建議：(b)，而且不需要新增程式：直接使用既有的 harness fake provider（見 C2），經 console 建立指向它的 provider 連線；worker 內建的 `FAKE_LLM_TEXT` 作備用。
- 狀態：**待擁有者決定**。`DESIGN.md` 以建議作為假設 A2，在設計 PR 中由擁有者確認。

### D3 本機開發綁定策略（C3）

- 選項：(a) 維持現狀，fe-review 只走 harness 路徑；(b) 讓 `scripts/dev-bind.mjs` 的綁定可注入，新增只收窄的模式（例如 `KITH_BIND=loopback` 時 worker 與 web 都綁 `127.0.0.1`，不呼叫 `tailscale`）。依 PROTOCOL 第 0 節，選項不含對外綁定或認證旁路。
- 建議：(a)。`DESIGN.md` 不依賴此項；(b) 屬開發工具變更，若要做應另開元件 task。
- 狀態：**待擁有者決定**（不阻擋第 2 輪）。

## 進入第 2 輪的條件

- `DESIGN.md` 已合併，其中每個假設都已由擁有者確認，並改寫進上方「已決定」。
- `PROMPT.md` 與 `targets.json` 已依設計更新。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- 設計 PR（`fe-review/design-kith`，Closes #146）：新增 `DESIGN.md`，改寫 C1／C2，新增 C3／D3，修正 `PROMPT.md` 與 `targets.json`。
