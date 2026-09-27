# FE Review — hai-taskboard — DESIGN

> 活文件：描述第 2 輪要做的修改與驗收方式。狀態：**草稿**。每次修改都走 PR。

## 目標

第 2 輪結束時，hai-taskboard 的 fixture 驅動 SPA 能在隔離環境內以釘選版本（Node 24.20.0、pnpm 11.25.0）單獨啟動；
四個 surface、選取、被接受與被 guard 拒絕的轉移、深色主題與 200% 縮放都有可重跑的擷取腳本；
轉移被拒絕時，視覺使用者也看得到結果；`targets.json` 改為 `verified: true`。

## 依據

- REVIEW.md 已決定：無。
- 假設（待擁有者在本 PR 確認）：
  - **D1 → (b)**：不加 URL 路由；fe-review 以互動腳本擷取次級狀態。
  - **D2**：fe-review 不等待後端整合，本設計只涵蓋 fixture 驅動的 UI；第 3 輪報告必須註明「前後端整合未驗證」。何時接上後端仍由產品路線決定。
  - **D3 → (a)**：轉移結果（接受或拒絕）在畫面上可見，沿用現有訊息文字，不改語意。
- 相關規範：
  - PROTOCOL 第 0 節（隔離環境）、第 4 節（修改範圍）。
  - `docs/reproducibility.md:13,31-32`：Node 24.20.0、pnpm 11.25.0，`web/package.json` 加上 `pnpm-lock.yaml` 構成唯一的前端套件，版本無範圍。
  - 元件 `AGENTS.md` 與 `docs/SDD.md` 的前端版本釘選（`docs/SDD.md:336`）。

## 不做的事

- 不加路由，不引入 router 套件（依 D1 假設）。
- 不接後端、不新增 API client、不改 fixture 的資料語意（依 D2 假設）。
- 不新增或升級依賴：擷取腳本使用 `web/package.json` 既有的 `@playwright/test` 與 `@axe-core/playwright` devDependencies。
- 不做視覺改版；M2 只把現有訊息變成可見，不改文字。
- 不修改或放寬既有的 Vitest spec 斷言。

## 修改項目

### M1 啟動方式改用釘選的 pnpm

- 對應：C4（安裝方式）。
- 現況：`targets.json` 的 `install` 是 `npm ci`，但 `web/` 只有 `pnpm-lock.yaml`，沒有 `package-lock.json`，`npm ci` 無法執行；
  專案釘選 pnpm 11.25.0（`docs/reproducibility.md:13`）。
- 修改：本 PR 已先把 `targets.json` 改為 `corepack pnpm install --frozen-lockfile` 與 `corepack pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort`。
  第 2 輪在隔離環境內實際執行、確認 corepack 取得的 pnpm 版本與 `packageManager` 一致後，把 `verified` 改為 `true` 並記錄日期。
- 驗證：`corepack pnpm install --frozen-lockfile` 成功且不改動 lockfile；`capture.mjs --start` 能等到 `/` 就緒。
- 風險與回滾：只改 fe-review 設定檔；回滾為還原 `targets.json`。

### M2 轉移結果的可見回饋

- 對應：C3、D3（假設 a）。
- 現況：選取與轉移的結果訊息只放在 `sr-only` 的 live region（`web/src/app.tsx:171`）。被 guard 拒絕時
  （`web/src/app.tsx:100-102`），卡片留在原欄位、焦點回到按鈕，視覺使用者沒有任何「操作被拒絕」的回饋；
  詳情面板雖然常駐顯示 guard 條件（`web/src/app.tsx:349-356`），但不會指出剛才那次操作的結果。
- 修改：把同一個 live region 改為可見的狀態列（保留 `aria-live="polite"`、`aria-atomic="true"`，只移除 `sr-only` 並加上樣式），
  文字與觸發時機不變，避免重複播報。樣式沿用 `styles.css` 既有的 token 與 class，不 hardcode 色彩；
  拒絕與接受可用 `components/ui/badge.tsx` 的 `tone` 區分（只用 `styles.css` 已定義的 `badge-*`）。
- 驗證：
  - 既有 spec 全數通過，特別是 `board-transition-guard-rejection.spec.tsx`、`board-transition-accessibility.spec.tsx`。
  - 在 `board-transition-guard-rejection.spec.tsx` 新增斷言：拒絕訊息所在元素不帶 `sr-only`。
  - `pnpm lint`、`pnpm build`、`pnpm format` 通過；M3 的擷取中拒絕狀態截圖可見訊息，axe 無新增 violation。
- 風險與回滾：狀態列會佔用版面，需在三種 viewport 與 200% 縮放下確認不溢出（`responsive-theme-zoom.spec.tsx` 應繼續通過）。
  回滾為恢復 `sr-only`。

### M3 互動擷取腳本

- 對應：C2、D1（假設 b）、C4（主題）。
- 現況：沒有路由，四個 surface（`Board`、`Work item`、`Attention`、`Impact preview`，`web/src/app.tsx:18`）靠導覽按鈕切換
  （`web/src/app.tsx:155-165`，當前項目有 `aria-current="page"`）；深色主題靠畫面上的切換按鈕設定 `data-theme`
  （`web/src/app.tsx:147-150`、`styles.css:33`），不跟隨 `prefers-color-scheme`，所以 `capture.mjs` 的 `colorSchemes` 無法擷取深色。
- 修改：新增 `fe-review/flows.mjs`，使用 `web/` 既有的 `@playwright/test` 與 `@axe-core/playwright`，在三種 viewport 下依序擷取：
  1. 四個 surface（點導覽按鈕，以 `aria-current` 確認已切換）；
  2. 在 Board 選取另一個 work item；
  3. 一次被接受的轉移，與一次被 QA guard 拒絕的轉移（fixture 中的 `guard-qa`）；
  4. Attention 中的 recovery／stale 狀態；
  5. 切到深色主題後重拍 Board 與 Work item；
  6. 200% 縮放下的 Board。
  每步寫入 `runs/<ts>/flows.json`：surface、動作、console error、axe violations、是否水平溢出；截圖存 `runs/<ts>/screenshots/`（不提交）。
- 驗證：腳本在 M1 的啟動方式下完整跑完；每一步都有截圖與紀錄。
- 風險與回滾：只新增檔案；選擇器以 role 與可讀名稱為主，UI 文字改動時需要同步。回滾為刪除該腳本。

## 啟動方式（第 2 輪要驗證的版本）

在 PROTOCOL 第 0 節的隔離環境內（建議使用 `docs/reproducibility.md` 釘選的 `node:24.20.0-bookworm-slim` image）：

```bash
cd products/hai-taskboard/web
corepack pnpm install --frozen-lockfile
corepack pnpm exec playwright install chromium
corepack pnpm exec vite --host 127.0.0.1 --port 5173 --strictPort

# 另一個 shell，在 repository root：
node docs/fe-review/capture.mjs products/hai-taskboard/fe-review/targets.json
node products/hai-taskboard/fe-review/flows.mjs
```

- 資料：`web/src/fixtures.ts` 的靜態 fixture，不需要後端、帳號或任何憑證。

## 第 3 輪驗收

- 頁面與流程：`targets.json` 的 `/`（light）；`flows.mjs` 的四個 surface、選取、接受與拒絕的轉移、recovery 狀態、深色主題、200% 縮放。
- 通過條件：無 blocker／major；axe 無 critical／serious；三種 viewport 與 200% 縮放下無水平溢出；轉移被拒絕時畫面上有可見訊息。
- 已知不在驗收範圍：前後端整合（UI 只接 fixture，報告必須註明）、Go 後端本身。

## 開放問題

- 若 D1 之後改為 (a) 加路由，`flows.mjs` 的 surface 擷取應改由 `targets.json` 的頁面清單承擔，本設計的 M3 需要縮減。
