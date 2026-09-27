# FE Review Prompt — cloudform

你是負責 **cloudform** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `apps/cloudform/`
- **一句話：** Terraform schema 驅動的雲資源表單設計器：React 18 + Vite 6 + Tailwind 4 + Radix/shadcn + react-hook-form + dnd-kit 的 SPA（`frontend/`），後端是 JVM（Gradle Kotlin DSL）。
- **技術棧：** React 18、Vite 6、Tailwind 4、Radix／shadcn、TanStack Query、Zustand、react-hook-form、dnd-kit、React Router 6；後端 Gradle（Kotlin DSL）
- **UI 入口：** `apps/cloudform/frontend/`（dev port 3000，`/api` 代理到 `http://localhost:8080`）

## 啟動線索（未驗證）

- 依 `backend/` 起本機服務（8080）；若無法起後端，記錄在報告，只拍不需 API 的頁面。
- 在 `frontend/` 執行 `npm ci` 與 `npm run dev -- --host 127.0.0.1`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 模板列表 → 新增模板 → 設計器拖放欄位 → 表單預覽與驗證

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- dnd-kit 拖放的鍵盤替代操作與 focus。
- 動態表單（react-hook-form）的錯誤訊息位置與一致性。
- 設計器在窄螢幕的可用性。

## 可重用的既有資產

- （無）

## 待補的頁面

`/templates/:id/design`：新增模板後取得 id 補齊。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs apps/cloudform/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs apps/cloudform/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
