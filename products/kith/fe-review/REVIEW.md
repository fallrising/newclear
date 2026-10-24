# FE Review — kith — REVIEW

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：沿用既有 worker/D1/seed harness 與 fake provider；不改 dev-bind 工具。 第 2／3 輪仍未由本次文件回寫執行。
> 活文件：只描述目前狀態。已解決的項目直接改寫成目前的結論，不留過期描述；歷史由 Git 與 PR 保存。每次修改都走 PR。規則見 PROTOCOL.md 的「`REVIEW.md` 規則」。

## 目前輪次

- **第 1 輪：設計方向已由 owner 確認**；見上方決策紀錄。文件回寫／必要 CI 與後續實作驗證分開追蹤。
- 第 2 輪：修改（IN_PROGRESS）；launch／flows／targets 已加入，完整 runtime 驗證仍待本輪報告核對。
- 第 3 輪：完整 e2e（未開始）

## 修改權限

文檔檔位 **A（active）**：第 2 輪可在 `DESIGN.md` 範圍內，依元件 `AGENTS.md` 與 PROTOCOL 第 4 節修改前端。

## 矛盾點

### C1 前端需要本機 worker 與 D1 才有資料

`web/` 的 `/api`、`/mcp` 代理到 `KITH_API_ORIGIN`（`web/vite.config.ts:5-16`），沒有獨立的 mock 模式，UI 無法脫離後端擷取。依 PROTOCOL 第 0 節屬測試耦合。原符合第 0 節的啟動路徑位於 Playwright global setup：`e2e/harness/server.ts:71-124` 以 `127.0.0.1`、隨機 port、隔離的 `--persist-to` 與 `--env-file` 啟動 worker，`e2e/global-setup.ts:54-73` 套用 migrations 與固定 seed `base-v1`。`launch.mjs` 已重用 helpers／seed 完成隔離接線，實測 worker/D1/fake/Vite/UI 登入及 owned cleanup 通過；完整驗收仍依本輪報告，不以可啟動宣告全部完成。

### C2 LLM provider 已有假實作，但不在 fe-review 的啟動路徑上

原始碼已有兩個 fake，都不需要真實 API key：

- e2e harness 的外部 fake provider（`e2e/harness/fake-provider.ts`）：支援 `openai_chat`、`openai_responses`、`anthropic_messages`、`gemini` 四種格式，只接受每次執行的 canary key，prompt 內的 `[[fake:…]]` directive 可控制文字、延遲、錯誤碼與串流分段。它由 `e2e/harness/server.ts:83` 啟動。
- worker 內建 fake：沒有 `XAI_API_KEY` 但設定了 `FAKE_LLM_TEXT` 時啟用（`worker/hosted/llm.ts:27-51`、`worker/env.ts:17-18`、`worker/providers/runtime.ts:64`）。

seed 本身沒有 provider，也沒有已設定 runtime 的 hosted agent（`e2e/fixtures/seed.ts:60-73`）。`flows.mjs` 已透過既有 API 建立指向本輪 fake provider 的連線並設定 grok，實跑串流／完成／thread；不改 seed 或後端。

### C3 README 的本機開發路徑不符合第 0 節

`npm run dev`／`npm run dev:web` 經 `scripts/dev-bind.mjs`：worker 綁 `0.0.0.0:8787`（`scripts/dev-bind.mjs:28-43`），web 綁 Tailscale IPv4 的 5173（`:47-52`），兩者都先執行 `tailscale ip -4`，失敗即中止（`:13-23`）。worker 還會載入開發者的 `.dev.vars`。在隔離容器內這條路徑無法啟動，也不應使用；fe-review 改走 C1 的 harness 路徑，不受影響。另外 `docs/quickstart.md:22-25` 引用已不存在的 `npm run dev:frontend`。

## 已決定

- 本次選定方案已獲 owner 明確確認，見頁首與下方決定。

## 本次確認的決定

### D1 前端 mock 的位置

- 選項：(a) 前端加 contract mock（MSW 類）；(b) 沿用 `e2e/` harness 啟動真實 worker＋本機 D1＋固定 seed。
- 建議：(b)。harness 已具備隔離、seed 與清理，改動最小；(a) 視第 3 輪成本再決定。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

### D2 fake LLM provider

- 選項：(a) 在 worker 端新增只供測試的 fake provider；(b) 在 harness 層處理，不改後端。
- 建議：(b)，而且不需要新增程式：直接使用既有的 harness fake provider（見 C2），經 console 建立指向它的 provider 連線；worker 內建的 `FAKE_LLM_TEXT` 作備用。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

### D3 本機開發綁定策略（C3）

- 選項：(a) 維持現狀，fe-review 只走 harness 路徑；(b) 讓 `scripts/dev-bind.mjs` 的綁定可注入，新增只收窄的模式（例如 `KITH_BIND=loopback` 時 worker 與 web 都綁 `127.0.0.1`，不呼叫 `tailscale`）。依 PROTOCOL 第 0 節，選項不含對外綁定或認證旁路。
- 建議：(a)。`DESIGN.md` 不依賴此項；(b) 屬開發工具變更，若要做應另開元件 task。
- 狀態：**2026-10-23 owner 已確認上述選定方案**；未選方案不在授權內。

## 第 2 輪剩餘條件

- 原設計與具體 ROUND2-SDD 已批准；M1–M4 的實作與必要驗證分開記錄。
- 完成報告中既有 e2e 路徑前置診斷、browser-health 分類及獨立審查／CI，才判定 targets 是否可改 verified。不得省略失敗或用旗標代替行為證據。

## 相關 PR

- fallrising/newclear#141：建立工作包、REVIEW 與三輪節奏。
- fallrising/newclear#144：記錄擁有者決定與設計文件入口。
- 設計 PR（`fe-review/design-kith`，Closes #146）：新增 `DESIGN.md`，改寫 C1／C2，新增 C3／D3，修正 `PROMPT.md` 與 `targets.json`。

## 2026-10-24 實作 checkpoint

M1–M4 已實作並有必要本地實跑證據；[`tasks/round2/report.md`](tasks/round2/report.md) 記實際命令與證據。targets 已按本輪實測 true；沒有修改產品 web、worker、e2e 或 dev-bind。D3 已採不改 dev-bind，DESIGN 開放問題中的舊疑問不構成再求批准。新的安全邊界契約與原生 gates 分別列證，不以靜態測試冒充完整啟動／流程驗證。

R4 focused correction：import失敗的lock生命週期已RED/GREEN（4tests）；新增15route finalURL＋loaded-content smoke，quiet/private/settings/not-found均實跑通過，正常cleanup再驗證。原R3 browser-health與axe缺口保持，整體仍依本輪報告及父層審查。


### 第2輪證據範圍

15個靜態路由另以 route-smoke.mjs 確認最終URL與實際內容；原90capture不單獨當作未重導證據。啟動依賴載入失敗的owned-lock清理已RED/GREEN修正。原生/e2e失敗與補跑分列於報告；完整e2e原exit1不改寫為PASS。

第3輪仍未執行：未登入探測401及刻意offline的WebSocket錯誤有來源解釋；ERR_ABORTED仍保留，不統一當作無害。axe未跑，未宣稱零違規。這些限制不授權修改產品web，也不更改M1–M4驗收。必要CI／合併與遠端回讀由PR578記錄，產品主線完成度不變。
