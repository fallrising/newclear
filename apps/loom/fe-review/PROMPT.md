# FE Review Prompt — loom

你是負責 **loom** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `apps/loom/`
- **一句話：** AI-native canvas / terminal / document 工作區桌面 App：Tauri 2（Rust）包 React 18 + Vite 5 + React Flow 前端。
- **技術棧：** Tauri 2（Rust）、React 18、Vite 5、React Flow（`@xyflow/react`）
- **UI 入口：** `apps/loom/`（Vite dev port 1420，HMR 1421）

## 啟動線索（未驗證）

- headless 只擷取 Web 層：`npm ci` 後 `npm run dev -- --host 127.0.0.1`。
- `src/ipc.ts` 依賴 Tauri；以 `addInitScript` 注入 IPC mock，並在報告註明無法在瀏覽器驗證的部分（終端、檔案系統）。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- canvas 新增節點與連線 → 開啟 document surface → terminal surface

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- React Flow 畫布的縮放、節點文字截斷、選取狀態對比。
- Terminal 元件的字型、捲動與 resize。
- 多 surface 切換的 focus 管理。

## 可重用的既有資產

- `npm run verify`：contracts 與 app typecheck、測試。

## 待補的頁面

無路由。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs apps/loom/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs apps/loom/fe-review/targets.json
   ```
   需要互動才能看到的狀態，另寫 Playwright 腳本放在本目錄並在報告中引用。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
