# FE Review Prompt — fanzloud

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採靜態資產＋有限假 API/WS，不新增 production fake-runner 或連真 Cloud。 第 2／3 輪仍未由本次文件回寫執行。
你是負責 **fanzloud** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 1 輪（文檔先行）**。下面的啟動線索與 [`targets.json`](targets.json) 都是從原始碼推斷，未經驗證；尚待實作或驗證的事項見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/fanzloud/`
- **一句話：** Cloud coding-agent 平台的 control plane：「Codebox operator」頁面是不用框架的純 JS + CSS，由 Rust axum 伺服器以 `include_bytes!` 提供，含 WebSocket。
- **技術棧：** Rust axum；前端為原生 JS（`p0-app.js`、`p0-client.js`）與 CSS
- **UI 入口：** `apps/control-plane/web/`，由 control-plane 在 `/`、`/assets/*` 提供

## 啟動線索（未驗證）

- 先依 [DESIGN.md](DESIGN.md) M1 完成新的 HTTPS/WSS 靜態／mock harness；目前不存在，D1 已確認。production main 的 runner／Cloud／私有目錄不可留空當 fake 模式，也不能沿用真實設定啟動。
- 原生 client 明確要求 HTTPS，HTTP targets 只會 unsupported。先建立同 namespace 的 loopback TLS、當次 CA/browser trust、合成 state 及有限 API/WS 契約；禁止真 executable、device login、Cloud 或外網 fallback。targets 無 start、仍 unverified，不直接用 --start 或本機既有 listener。

## 主要流程

至少走通以下流程各一次，並對每一步截圖：

- 開啟 operator 頁 → Authenticate → 檢視 login/session → 明確提交合成 turn → 順序事件／斷線 → Show diff → refresh／cancel 負向場景 → logout；全程只走專用 mock，不建立任意 session 或增加 recovery 控制項。

## 專案特有檢查重點

在 PROTOCOL.md 第 3 節的通用清單之外，特別檢查：

- 原生 JS 狀態更新時的 DOM 閃爍與 aria-live。
- WebSocket 斷線提示。
- 無框架樣式的一致性與 RWD。

## 可重用的既有資產

- `apps/control-plane/web/p0-client.test.mjs`：controller／DOM 契約。
- `apps/control-plane/tests/p0_subscription_e2e.rs`：fake CLI＋loopback HTTP/WS 組合；不是現成真瀏覽器 screenshot harness。兩者只能作 contract 依據，不能當本輪 browser PASS。

## 待補的頁面

產品只有 `/`；Authenticated、busy、device、diff、錯誤等是互動狀態，不能用不存在的路由補清單。現行固定 dark、英文 UI，targets 只保留 dark／en-US。

## 執行步驟

先讀 [REVIEW.md](REVIEW.md) 確認目前輪次，只做該輪允許的事（PROTOCOL.md「三輪節奏」）：

1. **第 1 輪（文檔先行）：** 對照原始碼打磨本檔、`targets.json` 與 `REVIEW.md`；不啟動、不修改程式碼。
2. **第 2 輪（修改）：** 先確認 D1，按元件規則建立 Ready task/CU/規格與測試骨架；只實作已確認 DESIGN 範圍。隔離、契約與真正 browser 流程驗證後才可改 verified，不以缺少 runner 參數降低邊界。
3. **第 3 輪（完整 e2e）：** M1 完成後，由專用流程設定當次 CA trust／port／合成狀態與 ephemeral targets，從 repository root 跑共用 capture 的 dry-run／capture，再用互動腳本走主要流程。共用腳本不會登入、mock WSS 或處理 CA。停用 trace/video/HAR 與秘密 body 留存，不提交 browser state、bearer 或 CA private key；在報告分開 mock、backend 整合及未驗證結果。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與已決定事項的實作，每個問題一個 commit，附驗證指令
- 第 3 輪：`runs/<ts>/capture.json`、`runs/<ts>/REPORT.md`（提交）；`runs/<ts>/screenshots/`（不提交）
