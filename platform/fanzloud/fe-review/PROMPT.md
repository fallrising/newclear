# FE Review Prompt — fanzloud

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採靜態資產＋有限假 API/WS，不新增 production fake-runner 或連真 Cloud。第 2 輪已交付（[R2 報告](tasks/round2/report.md)）；第 3 輪未開始。
你是負責 **fanzloud** 前端品質的 LLM agent。目標是自主掃描這個 UI、用 headless 瀏覽器產生截圖、找出問題，並在允許範圍內優化。

先完整閱讀共用規範 [PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)，本檔只補充這個專案特有的資訊；兩者衝突時以元件自己的 `AGENTS.md`／`README.md` 為準，其次是 PROTOCOL.md。

> 狀態：**第 2 輪已交付**。[`targets.json`](targets.json) 指向 review harness origin，已由 `capture-002` 實跑核對（`verified: true`）；目前結論與後續見 [REVIEW.md](REVIEW.md)。

## 專案概況

- **元件路徑：** `platform/fanzloud/`
- **一句話：** Cloud coding-agent 平台的 control plane：「Codebox operator」頁面是不用框架的純 JS + CSS，由 Rust axum 伺服器以 `include_bytes!` 提供，含 WebSocket。
- **技術棧：** Rust axum；前端為原生 JS（`p0-app.js`、`p0-client.js`）與 CSS
- **UI 入口：** `apps/control-plane/web/`，由 control-plane 在 `/`、`/assets/*` 提供

## 啟動方式

- 只用 `fe-review/` 的 review harness（DESIGN M1）：`fixture.mjs`、`transport.mjs`、`trust.mjs`、`lifecycle.mjs`，由專用 driver 在固定映像 `fe-review-trust-terminal:20261024`、`--network none` 容器內啟動，綁 `127.0.0.1:8443`，當次 CA 只由本次瀏覽器信任。production control-plane 的 runner／Cloud／私有目錄不可留空當 fake 模式，也不能沿用真實設定啟動。
- 共用 `capture.mjs` 只由 `fe-review/shared-capture.mjs` 呼叫：它複製 `targets.json` 到私有 state，先 `--dry-run` 再擷取靜態初始頁。targets 無 start，不直接用 `--start` 或本機既有 listener。
- 每次瀏覽器執行都要 owner 單獨批准，失敗不自動重試。

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
2. **第 2 輪（修改，已交付）：** 只實作已確認 DESIGN 範圍；結果與限制見 [R2 報告](tasks/round2/report.md)。
3. **第 3 輪（完整 e2e，未開始）：** 由專用流程設定當次 CA trust／port／合成狀態與 ephemeral targets，從 repository root 跑共用 capture 的 dry-run／capture，再用互動腳本走主要流程。共用腳本不會登入、mock WSS 或處理 CA。停用 trace/video/HAR 與秘密 body 留存，不提交 browser state、bearer 或 CA private key；在報告分開 mock、backend 整合及未驗證結果。

## 產出

- 第 1 輪：`PROMPT.md`、`targets.json`、`REVIEW.md` 的修訂（每次一個 PR）
- 第 2 輪：前端修正與 harness，結果在 [tasks/round2/report.md](tasks/round2/report.md)；run 結果、截圖與收據私有、不提交
- 第 3 輪：報告與經審閱的摘要（提交）；截圖、browser state 與私鑰不提交
