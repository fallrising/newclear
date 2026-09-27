# FE Review Prompt — pokercase

你是負責 **pokercase** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**尚未執行**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證。

## 專案概況

- **元件路徑：** `gateways/pokercase/`
- **一句話：** 多 provider LLM gateway（thinrouter）：Rust axum + minijinja 的 Web 管理後台，另有 ratatui + crossterm 的終端介面。
- **技術棧：** Rust、axum、minijinja 模板、SQLite；TUI 使用 ratatui + crossterm
- **UI 入口：** Web admin `/admin/*`（`thinrouter serve`，預設 127.0.0.1:20128）；TUI（`thinrouter tui`）

## 啟動線索（未驗證）

- `cargo build`，以暫存目錄啟動：`THINROUTER_DATA_DIR=<tmp> cargo run -- serve --host 127.0.0.1 --port 20128`；admin token 用本機產生的隨機值，只放環境變數，不寫入檔案。
- **不要**執行 `import-local` 或匯入任何真實 OAuth／session token；只用假 connection 資料。
- TUI：在 `tmux` 中執行 `cargo run -- tui --data-dir <tmp>`，以 `tmux capture-pane -p -e` 取得文字快照存到 `runs/<ts>/tui/`。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → Dashboard → 新增 connection → 新增 route → 建立 API key → Usage

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 後台表單的伺服器端驗證訊息、CSRF 與錯誤頁。
- Keys 頁面：key 只顯示一次、遮罩，截圖中不得出現可用的 key。
- TUI 在 80×24 與 120×40 的版面。

## 可重用的既有資產

- `templates/`、`src/web.rs`、`src/tui_app.rs`。

## 待補的頁面

`/admin/connections/{id}/edit`、`/admin/routes/{id}/edit`：新增假資料後補齊。

## 執行步驟

1. 讀元件文件與原始碼，修正 `targets.json` 中錯誤的指令、port、頁面。
2. 依「啟動線索」在本機啟動；啟動不了就把原因寫進報告，不要繞過安全限制。
3. 從 repository root 執行：
   ```bash
   node docs/fe-review/capture.mjs gateways/pokercase/fe-review/targets.json --dry-run
   node docs/fe-review/capture.mjs gateways/pokercase/fe-review/targets.json
   ```
   TUI 部分依「啟動線索」以 tmux 擷取文字快照。
4. 依 PROTOCOL.md 檢查、優化、重新截圖。
5. 在 `runs/<YYYY-MM-DD_HHMM>/REPORT.md` 寫報告；成功跑通後把 `targets.json` 的 `verified` 改為 `true` 並更新 `verifiedNote`。

## 產出

- `runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）
- `runs/<ts>/screenshots/`（不提交）
- 前端修正：每個問題一個 commit，附驗證指令
