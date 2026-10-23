# FE Review Prompt — pokercase

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 保留 ANSI 快照與純文字報告；合成登入、禁止真 provider。 第 2／3 輪仍未由本次文件回寫執行。
你是負責 **pokercase** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚待實作或驗證的事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `gateways/pokercase/`
- **一句話：** 多 provider LLM gateway（thinrouter）：Rust axum + minijinja 的 Web 管理後台，另有 ratatui + crossterm 的終端介面。
- **技術棧：** Rust、axum、minijinja 模板、SQLite；TUI 使用 ratatui + crossterm
- **UI 入口：** Web admin `/admin/*`（`thinrouter serve`，預設 127.0.0.1:20128）；TUI（`thinrouter tui`）

## 啟動線索（未驗證）

先依 [DESIGN.md](DESIGN.md) M1 建立隔離、唯一空白 data-dir、新 admin token、假資料及專用登入／擷取流程。wrapper 尚未實作；targets 不是完整 harness。serve/tui 必須顯式帶 data-dir，禁止退回既有資料。

不執行 import-local、login-siwc、refresh，不讀 CLI token 或呼叫真 provider。服務、瀏覽器與假上游同獨立 namespace、僅 loopback、runtime 阻外網。TUI 使用本次專用 tmux socket/session/pane，不擷取既有 terminal。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 登入 → Dashboard → 新增 connection → 新增 route → 建立 API key → Usage

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 後台表單的伺服器端驗證訊息、CSRF 與錯誤頁。
- Keys 建立回應顯示一次完整 key，並非已遮罩；依 DESIGN M3 先離開秘密回應，或由待實作專用流程 mask；共用 capture 不支援 mask。
- TUI 在 80×24 與 120×40 的版面。

## 可重用的既有資產

- `templates/`、`src/web.rs`、`src/tui_app.rs`。

## 待補的頁面

`/admin/connections/{id}/edit`、`/admin/routes/{id}/edit`：新增假資料後補齊。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 實作 `REVIEW.md` 中已決定的事項；在隔離環境確認 UI 能啟動，修正 `targets.json` 並改為 `verified: true`；跑元件自己的 lint／typecheck／test／build。
3. **第 3 輪（完整 e2e）：** 先完成 DESIGN M1 的 fixture／登入／專用遮罩前置；由本次 ephemeral targets 填入真實 ID 與私有 storageState，登入頁分開無 session app。從 repository root 執行共用 capture.mjs dry-run，再 capture；不得以原始 targets 的登入重導宣稱受保護頁已驗收。TUI 按 DESIGN M4 用本次專用 socket/pane 擷取兩格式。報告保留失敗與未驗證項目，狀態不會因文件合併自動變更。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
