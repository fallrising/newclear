# FE Review Prompt — cms-scaffold

你是負責 **cms-scaffold** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `apps/cms-scaffold/`
- **一句話：** 可重用 CMS kernel 的 monorepo：web-front、web-back、web-admin 三個 React + Vite 7 + Tailwind 4 的 SPA，共用 `packages/ui`，並有 MSW mock 可脫離後端執行。
- **技術棧：** React、Vite 7、Tailwind 4、React Router 7、TanStack Query；共用 `packages/ui`、`packages/mocks`（MSW）；後端 `services/cms-api`（Gradle）
- **UI 入口：** `apps/web-front`（5173）、`apps/web-back`（5174）、`apps/web-admin`（5175），各有 `dev:mock`

## 啟動線索（未驗證）

- 在 `apps/cms-scaffold/` 安裝 workspace 依賴（依 lockfile 使用對應的套件管理器）。
- 三個 app 分別執行 `npm run dev:mock -- --host 127.0.0.1`（port 已固定）。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- Front：首頁 → Album → Projects → Clinic
- Back：登入 → entries 列表 → 新增／編輯 entry → 三個 view composer
- Admin：登入 → types → users

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 三個 app 共用 `packages/ui` 的元件是否一致；問題優先在共用套件修正（屬跨 app 變更，需在報告中列出影響）。
- Back 的表單欄位（`packages/fields`）驗證與錯誤訊息。
- Front 的圖片版面與 RWD。

## 可重用的既有資產

- `apps/cms-scaffold/e2e/`、`playwright.mock.config.ts`：可直接沿用 mock 設定。

## 待補的頁面

`/entries/:type`、`/album/albums/:slug`、`/projects/:slug`：從 `packages/mocks` 取值補齊。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
