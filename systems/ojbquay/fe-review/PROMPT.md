# FE Review Prompt — ojbquay console

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1/A1 保留真 Compose 整合來源；先交付有所有權與 loopback 證據的隔離方案，額外後端變更另定範圍。 第 2／3 輪仍未由本次文件回寫執行。
你是負責 **ojbquay console** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚待實作或驗證的事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `systems/ojbquay/`
- **一句話：** Kafka messaging control/data plane 的管理主控台：React 19 + Vite 8 + Ant Design 5 + ECharts 的 SPA（`console-web/`），後端是 JVM（Gradle）。
- **技術棧：** React 19、Vite 8、Ant Design 5、ECharts、Zustand、React Router 8、TanStack Query；pnpm
- **UI 入口：** `systems/ojbquay/console-web/`（dev 5173，preview 4173；Compose stack 內為 `console-web:8080`）。UI 只有 light 主題、英文文案。

## 啟動線索（未驗證）

- 第 3 輪先滿足 [DESIGN.md](DESIGN.md) M1 的隔離與所有權契約；現有預設 Compose stack 不符合此 FE harness 的 loopback／獨立資源要求，不能直接啟動或清理。`pnpm dev` 沒有後端，`e2e/serve.mjs` 只是靜態伺服器；新 seed／login／states harness D1 已確認，尚待實作。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → Dashboard → Topics 列表與詳情 drawer → Groups → Subscriptions（建立精靈與 DLQ drawer）→ Delay 查詢 → Admin（clusters、audit、users）

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- ECharts 圖表在窄螢幕的縮放、tooltip、無資料狀態。
- Ant Design Table 的分頁、欄寬、長 topic 名稱。
- Ant Design 主題 token 與自訂樣式是否一致。

## 可重用的既有資產

- `console-web/e2e-stack/golden-path.stack.spec.ts`：真 stack 旅程（`pnpm e2e:stack`），可沿用其選擇器。
- `console-web/e2e/golden-path.spec.ts`：`page.route` mock 旅程，示範如何覆寫 API 回應。

## 待補的頁面

Topics、Groups、Subscriptions 的詳情與建立流程是 Drawer，沒有獨立路由，以互動腳本擷取（DESIGN M2）。`/admin/:section` 只有 `clusters`、`audit`、`users`，已列入 `targets.json`。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs systems/ojbquay/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
