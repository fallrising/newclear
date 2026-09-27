# FE Review Prompt — cms-scaffold

你是負責 **cms-scaffold** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚未解決的矛盾與待決定事項見 [REVIEW.md](REVIEW.md)，第 2 輪的範圍見 [DESIGN.md](DESIGN.md)。
>
> 前端正在依 v2 路線圖（`docs/v2/README.md`）逐波重寫。畫面與元件的修改由 v2 施工圖負責；v2 前端波次全部 `VERIFIED` 之前，fe-review 只改本目錄（REVIEW.md C2）。

## 專案概況

- **元件路徑：** `apps/cms-scaffold/`
- **一句話：** 可重用 CMS kernel 的 monorepo：web-front、web-back、web-admin 三個 React + Vite 7 + Tailwind 4 的 SPA，共用 `packages/ui`（shadcn/ui），並有 MSW mock 可脫離後端執行。
- **技術棧：** React、Vite 7、Tailwind 4、React Router 7、TanStack Query；共用 `packages/ui`、`packages/mocks`（MSW）；後端 `services/cms-api`（Gradle）
- **UI 入口：** `apps/web-front`（5173）、`apps/web-back`（5174）、`apps/web-admin`（5175），各有 `dev:mock`

## 啟動線索（未驗證）

- 套件管理器是 npm：在 `apps/cms-scaffold/` 執行 `npm ci`（workspace 共用 `package-lock.json`）。不需要 JDK、PostgreSQL 或 Docker。
- 三個 app 分別在自己的目錄執行 `npm run dev:mock -- --host 127.0.0.1 --strictPort`（port 5173／5174／5175）。`--host 127.0.0.1` 必須帶：`vite.config.ts` 預設 `host: true` 會綁所有介面（REVIEW.md C3）。
- 登入：網址加 `?mockUser=<種子帳號>` 直接登入（Back 用 `seed-operator-album`／`seed-operator-clinic`／`seed-operator-projects`，Admin 用 `seed-admin`）；登入表單接受任何非空密碼，`wrong-password` 除外。身分只存在 `sessionStorage`，`capture.mjs` 每張截圖都是新的 context，所以 `targets.json` 裡每個需要登入的路徑都帶 `?mockUser=`。
- 情境：網址加 `?mock=slow`、`error500`、`empty`、`conflict`（`none` 恢復），用來擷取 loading、錯誤、空狀態與衝突。
- 配色：作業面（Back、Admin）在 v2 不做深色模式；Front 相簿站的深色是站點配色，不跟隨 `prefers-color-scheme`。因此 `colorSchemes` 只有 `light`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- Front：站點選擇頁 `/` → 相簿（`/album` → `/album/albums/coast-light-2026` → `/album/photos/coast-harbour`）→ 專案（`/projects` → `/projects/cms-scaffold`）→ 診所 `/clinic`
- Back：`/sign-in` 登入 → `/entries/album` 列表 → 新增（`/entries/album/new`）與編輯一筆 entry → 三個自訂視圖（`album.composer`、`clinic.schedule`、`projects.board`，各用對應 pack 的 operator）
- Admin：`/login` 登入 → `/types` → `/users`

路由以目前 `apps/*/src/routes.tsx` 為準。v2 波次會改路由（例如 W4 把 Admin 的 `/users` 改為 `/principals`）；v2 前端波次完成後依 DESIGN.md M2 同步本節與 `targets.json`。

## 狀態擷取

在「主要流程」的列表頁與詳情頁，另外各擷取一次 `?mock=slow`（loading 只出現 skeleton）、`?mock=empty`、`?mock=error500`；Back 的編輯頁擷取一次 `?mock=conflict`。

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 三個 app 共用 `packages/ui` 的元件是否一致；問題優先在共用套件修正（屬跨 app 變更，需在報告中列出影響；修改權限見 REVIEW.md D1）。
- 發現先對照 `docs/v2/00-v1-frontend-audit.md` 與 v2 施工圖：已有稽核 ID 或已排進某一波的問題，報告只標註 ID，不另開修改。
- Back 的表單欄位（`packages/fields`）驗證與錯誤訊息。
- Front 的圖片版面與 RWD。

## 可重用的既有資產

- `playwright.mock.config.ts`、`e2e-mock/`：mock 模式的 Playwright 設定；`e2e-mock/helpers.ts` 有 axe 檢查（`@axe-core/playwright` 已是 devDependency）。
- `e2e/`：接真實 API 的 e2e（需要 Compose 與後端），fe-review 不使用。
- `docs/v2/01-frontend-sdd.md` §11.2 的 V2-AC-01～16：第 3 輪的通過條件引用它們。
- `docs/v2/assets/v1/`：v1 截圖，可與新截圖比較。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 只做 `DESIGN.md` 的修改項目；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** v2 前端波次全部 `VERIFIED` 之後，從 repository root 執行
   ```bash
   node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs apps/cms-scaffold/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄；走完「主要流程」，依 PROTOCOL.md 檢查，在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；新發現寫回 `REVIEW.md`。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
