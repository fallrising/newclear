# FE Review Prompt — dim-gate

你是負責 **dim-gate** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/dim-gate/`
- **一句話：** CMDB 核心的企業運維自助平台前端 demo：React 19 + Vite 8 + Tailwind 4 + Radix/shadcn + TanStack Query，資料來自內建 demo seed，不需後端。
- **技術棧：** React 19、Vite 8、Tailwind 4、Radix／shadcn、TanStack Query、React Router 7；Vitest、Playwright、axe
- **UI 入口：** `platform/dim-gate/`（純前端 SPA，demo 資料在 `src/demo/seed/`，模式由 `.env.demo` 的 `VITE_DATA_MODE` 控制）

## 啟動線索（未驗證）

- `npm ci`，然後 `npm run dev`（已綁 127.0.0.1）。若需 demo 模式，以 `--mode demo` 啟動或參考 `playwright.smoke.config.ts` 的 webServer 設定。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 首頁 → Ops CMDB 列表 → CI 詳情（`/cis/ci-aws-checkout-01`）→ 拓撲
- RD：應用 → 服務目錄 → 提出資源申請
- Admin：使用者、權限、稽核、功能開關

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 高密度表格與篩選器在 tablet／mobile 的處理（水平捲動 vs 卡片化）。
- 拓撲圖（`/topology`、`/ops/topology`）的可讀性與空狀態。
- Admin 表單的鍵盤操作與 focus（既有 `m5-keyboard.spec.ts` 可參考）。
- 中英混排的長 CI 名稱、標籤截斷。

## 可重用的既有資產

- `platform/dim-gate/e2e/`：大量既有 Playwright spec 與 `browser-health.ts`；`npm run test:smoke`。
- `npm run check:docs`、`check:architecture`：修改後必跑。

## 待補的頁面

`/ops/*/:id`、`/rd/apps/:appId/*`：從 `src/demo/seed/` 取 id 補齊。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs platform/dim-gate/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs platform/dim-gate/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
