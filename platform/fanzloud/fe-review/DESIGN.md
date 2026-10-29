# FE Review — fanzloud / Codebox operator — DESIGN

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採靜態資產＋有限假 API/WS，不新增 production fake-runner 或連真 Cloud。
> 狀態：**第 2 輪 M1–M3 已交付**（[R2 報告](tasks/round2/report.md)）。這是合成 harness 範圍的結果，不代表真實後端、Cloud 或產品可用；第 3 輪未開始。

## 目標

以同版 operator 靜態資產和合成 HTTP／WebSocket 契約，在隔離環境檢查 Authenticate、登入狀態、提交／取消、事件重播／斷線、diff 與登出畫面。保留私人單 operator、明確操作、固定權限與不重試 mutation 的邊界；本設計不把 mock 畫面轉成真 Cloud 或完整平台驗收。

## 依據

- 來源基準 `d8ca3c4089a9fbe852459da3d9602329224230e7`；2026-10-23 UTC 回讀 main `65a22ac15ec8d334d4c0e7c778b690b1076358de`，八份相關 FE／main 來源與基準一致。[README](../README.md)、[SUCCESS](../SUCCESS.md) 的 dormant 與未完成主線保留。
- 已決定：issue [#159](https://github.com/fallrising/newclear/issues/159) 允許第 2 輪在 DESIGN 範圍修前端，不新增功能或 major 升級。
- **D1 已確認：** 採 [REVIEW](REVIEW.md) 建議 (b)，新增本元件 `fe-review/` 專用的靜態檔＋最小假 API／WS 擷取 harness；不新增 production fake-runner 模式，也不使用真實 runner 設定。
- 規範：[AGENTS](../AGENTS.md)、[TD](../docs/TD.md) §1.6–1.7／9.3、[ADR-0002](../docs/adr/ADR-0002-personal-byos-codex-p0.md)、[ADR-0004](../docs/adr/ADR-0004-p0-session-api-and-stream.md)、[T006](../docs/specs/SPEC-T006-private-operator-web.md)、[T007](../docs/specs/SPEC-T007-p0-subscription-e2e.md)、共用 [PROTOCOL](../../../docs/fe-review/PROTOCOL.md) 與 [SDD](../../../docs/fe-review/SDD.md) AC-14／AC-15。
- 第 2 輪 production 修改前，仍須依元件規則建立 Ready task、對應 CU／規格與測試骨架、取得 fresh-context acceptance。FE 例外不授權跳過規格或改動已接受的 API／安全語意；必要規範修正另案處理。

## 不做的事

- 不啟動 production control-plane、Codex CLI、device login 或 Cloud task；不讀現有 CODEX_HOME、token、session、帳號、Cloud environment／branch 或私人狀態。
- 不修改 Rust backend、runner、credential scope、HTTP／WS schema、Origin／cookie／CSP、安全驗證、mutation 重試／idempotency、durability 或 P1 actor；不新增 recovery 控制項、apply、push、多使用者、provider 選擇或 light theme。
- 不以 mock 或既有驗收紀錄冒充本輪 browser／runtime／Cloud PASS；不修改 SUCCESS 的產品 AC。

## 修改項目

### M1 專用 HTTPS／WSS 合成 harness（C1、D1）

- 現況：[main.rs](../apps/control-plane/src/main.rs):42–85 要求經驗證的 executable、獨立私有目錄、Cloud scope、HTTPS origin 與 bootstrap token；留空不是 fake 模式。[p0-client.js](../apps/control-plane/web/p0-client.js):573–588 要求 HTTPS，:1314 使用 WSS；舊 HTTP targets 不能走正常 operator 流程。既有 [T007](../docs/specs/SPEC-T007-p0-subscription-e2e.md) 是 Node controller/DOM 測試加真 loopback HTTP／WS 與 fake CLI 的組合，不是可直接執行的 browser screenshot server。
- 修改：D1 確認後，在 `fe-review/` 新增專用 mock server、有限場景 fixture、互動腳本及啟動／清理 wrapper。只服務同版 `index.html`、`p0-app.js`、`p0-client.js`、`p0.css` 的固定路徑；HTTP／WS 只實作 [T006](../docs/specs/SPEC-T006-private-operator-web.md) 列出的表面及已接受 T005/B/C shape，不做任意 URL proxy、檔案瀏覽或 shell/provider 呼叫。缺少 fixture／未知路徑 fail closed；不自動 fallback 到真 API。
- 安全前置：瀏覽器、server 與 fixture 同一獨立 network namespace，只綁 loopback；runtime 阻外網。每次新建 task state、全新 browser profile/context，清除繼承的 CODEBOX／CODEX／provider 設定，不掛現有 HOME、憑證或 volume，不覆寫共用 HOME。產生本次 test CA／含 loopback SAN 的 certificate，僅信任於本次瀏覽器環境，不改全域 trust、不關閉產品 HTTPS 或使用 HTTP bypass。
- Fixture：每個場景產生符合 schema 的合成 UUID、sequence、session／instance、短／長中文 prompt 與無秘密 diff；有界重播以 replay-begin／snapshot／replay-end／live 順序對齊，另有 gap、過期 instance、斷線、403、timeout 及 malformed frame 的負向場景。模擬 bootstrap/session cookie 只在本機、本次有效，形狀對齊契約；不是 production 認證驗收。device 畫面的固定官方 URL 只作文字（client validator:454），verification code 是合成值，不開外部連結、不進行登入。
- 驗證：新增 harness 拒絕非 loopback、既有 state、未知場景及外部 fallback 的檢查；對照現有 controller 測試的 exact schema、bounds、explicit-action、sequence 與 idempotency 斷言。記錄有限 route/mutation 次數與無秘密狀態摘要，禁止存 token、header、cookie、prompt body 或原始 frame。真 backend 整合仍須另以受授權的假 executable／新私有目錄及真正瀏覽器驗證 HTTPS 接線；不能拿靜態 mock 代替那個 gate。
- 風險與回滾：mock 容易與產品 contract 漂移，故來源 SHA／fixture schema 及負向斷言一起記錄。前置或契約不足就記缺口並停止，不降低 parser／auth。回退 FE harness／targets 即可；清理只處理記錄並核對屬於本次的資源，不刪既有 state。實作結果見 [R2 報告](tasks/round2/report.md)。

### M2 既有響應式與狀態可讀性（C2）

- 現況：[p0.css](../apps/control-plane/web/p0.css):75–78 已限制 shell 寬度，:123–136 是自適應 grid／flex wrap，:157–164 已對事件／diff 做有界捲動及折行；不能宣稱完全沒有 RWD。:1–5 只有固定 dark 樣式。長字串、focus、狀態更新與對比尚無本輪實測結果。
- 修改：只在 `apps/control-plane/web/index.html`、`p0.css`、`p0-app.js` 補經實測需要的 min-width、換行、可操作局部捲動、focus-visible、狀態標籤與適量 live-region／description 關聯；避免每個事件或整段 diff 重複播報。不重設視覺、不更動 controller、操作順序或自動重試邏輯。
- 驗證：390×844、834×1112、1440×900，dark；長中文、長 diff、空事件、busy、登入拒絕、斷線／重連與 recovery-required。頁面無非預期水平溢出；局部事件／diff 捲動須具可讀名稱、鍵盤可達。axe 無 critical／serious，focus 可見、對比符合共用規範。無問題的區域不修改。
- 風險與回滾：live region 可能過度播報，wrap 可能改變 diff 可讀性；保留 inert text 與明確操作，逐項比較並回退局部 markup/CSS。

### M3 操作與秘密呈現的回歸擷取（C3）

- 現況：[index.html](../apps/control-plane/web/index.html):18–24 是 bootstrap、:36–54 是 login/turn 操作、:58–74 是事件／diff／登出。[p0-app.js](../apps/control-plane/web/p0-app.js):52–76 以 textContent 顯示狀態與 diff，:118–135 在送出前清空 bearer／prompt；:126–144 的按鈕有不同操作，不能把 device login、cancel、refresh 或 Show diff 當成無副作用頁面導航。
- 修改：在 `fe-review/` 新增互動場景及 browser assertions，擷取 bootstrap 空表單、已登入、busy、成功 diff、拒絕、取消監看及斷線；任何自動動作只呼叫有限 mock，不操作 production。保留不重送 mutation、diff 僅明確讀取、refresh 不 submit、recovery 只顯示提示、logout 清除狀態等斷言。若需 production 行為修改，超出本輪。
- 驗證：只用合成 prompt／diff／device code，驗證看似 HTML 的 diff 仍是文字且不執行。新 context 及獨立場景不沿用現有 sessionStorage；同場景 refresh 則檢查 cursor／instance 契約。擷取前 bearer／prompt 已清空；停用 trace、video、HAR／body dump，cookie/storageState 僅放本次受保護 state、不得提交。共用 capture 不會 authenticate、seed、遮罩或走互動；正常 UI 的 200 不等於 HTTP/WS 成功。
- 風險與回滾：攔截失效不能向真服務送出；先驗證 namespace／origin／fallback 拒絕。回退專用場景／測試，原本 controller 與安全邊界保持原意。

## 啟動方式（第 2 輪已驗證的版本）

production `cargo run` 會進 production startup，不用於 review；不能靠留空 runner 設定或沿用本機 CODEBOX_* 啟動，也不把既有本機 listener 當 fixture。

M1 harness 由各專用 driver 啟動（`remaining-v7-baseline.mjs`、`conformance-browser.mjs`、`journeys-browser.mjs`、`shared-capture.mjs`），每次在固定映像 `fe-review-trust-terminal:20261024`、`--network none` 容器內：新 private state、即時 CA／loopback TLS 與本次 browser trust、固定資產與契約 fixture、owned process／shutdown 收據。review origin 是 `https://127.0.0.1:8443`。`targets.json` 只記這個 origin、無 start；私有 targets 由 `shared-capture.mjs` 逐 byte 複製到本次 state，不寫回 token。

共用 `docs/fe-review/capture.mjs` 只由 `shared-capture.mjs` 呼叫，先 `--dry-run` 再擷取靜態初始 `/`（`capture-002`）。共享腳本本身不設定 CA 信任、WSS mock 或登入；authenticated 狀態由專用 driver 擷取，兩者分開記錄。

原生 gate 是 `node --test --test-isolation=none apps/control-plane/web/p0-client.test.mjs` 與 Rust fmt／Clippy／test／build（CI `fanzloud-ci.yml`），實際結果見 [R2 報告](tasks/round2/report.md)。fake CLI 的後端整合驗證必須另立明確範圍，不能換成真 Codex executable 或 Cloud runner。

## 第 3 輪驗收

- `/` 唯一產品頁；按 M3 走 Authenticate → login 狀態／合成 device 畫面 → 明確 submit → 順序事件／busy／完成 → Show diff → refresh → cancel／斷線負向場景 → logout；不是新增 session CRUD 或導航路由。
- 三 viewport、dark，正常流程無 blocker／major、非預期 console/page/request errors，無 axe critical／serious；負向場景逐項標記預期失敗。未知 outcome／recovery-required 不自動重送或自行恢復，取消本機監看不宣稱 Cloud task 已終止。
- 報告列 source SHA、場景、mock/backend 整合的不同證據、實際命令、失敗／跳過與範圍。PNG、browser state、CA private key、bearer、cookie、prompt／diff 原文等不提交；公開結果只用合成且經審閱的摘要。全部實際通過後才可更新 verified，文件合併不自動更新。
- 不包含真帳號／Cloud、P1 persistence／actor、部署、多使用者或完整 SUCCESS；既有 T007 歷史接受也不能填補本輪 browser 證據。

## 開放問題

1. D1 已確認採靜態資產＋有限假 API/WS；production fake-runner mode 仍是範圍外後端變更。
2. M1 的 HTTPS/WSS、fixture、trust、process/state ownership 與擷取 wrapper 已實作並實跑（見 R2 報告）。後續若任何 security／atomicity／retry／recovery 契約無法從現有 T005/T006 規格確定，按 AGENTS 記 `[TD-GAP]` 並先補規範，不猜測。
- Owner 已明確確認本設計方向；原產品缺口與未執行驗證不因此通過。
