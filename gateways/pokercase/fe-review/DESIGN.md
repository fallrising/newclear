# FE Review — pokercase — DESIGN

> 狀態：**草稿，D1 與 AC-15 待擁有者確認**。本輪只交付文件；合併不代表已啟動、截圖或完成產品驗收。

## 目標

Web admin 與只讀 TUI 使用同一受控環境、本次產生的合成資料，完成可重現的版面、鍵盤與狀態檢查。第 2 輪限以下前端修改；gateway 主線與真 provider 驗收維持原有缺口。

## 依據

- 來源：d8ca3c4089a9fbe852459da3d9602329224230e7；[README](../README.md)、[AGENTS](../AGENTS.md)、[SUCCESS](../SUCCESS.md)、[安全契約](../docs/security.md)、[費用 admission](../docs/cost-safety.md)。
- [REVIEW](REVIEW.md) 允許 dormant 元件在設計範圍內修前端，不恢復新功能開發。
- **D1 假設，待確認：** TUI 保留 ANSI 原檔與純文字報告，分別保存；不當成瀏覽器頁面。
- [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)、[DESIGN-PROMPT](../../../docs/fe-review/DESIGN-PROMPT.md)、[SDD](../../../docs/fe-review/SDD.md)；本設計對應 AC-12，擁有者確認 AC-15 仍 pending。

## 不做的事

不更動後端 API、schema、provider adapter、認證／CSRF、major 依賴或部署。不執行 import-local、login-siwc、refresh；不讀 CLI 憑證，不呼叫真模型、Claude/Cursor CLI 或帳號 plugin。本輪無 UI 啟動、capture、Rust runtime 測試或 usable tag。資料庫讀取錯誤的後端語意若需改動，另提議。

## 修改項目

### M1 合成資料與登入前置（C2）

- 現況：[src/config.rs](../src/config.rs):56 未指定 data-dir 時開既有使用者資料；[src/main.rs](../src/main.rs):49、120 的 serve/tui 都支援顯式 data-dir。管理登入及 CSRF 在 [src/web.rs](../src/web.rs):48、95，不能用 keyless bootstrap 取代。
- 修改：第 2 輪建立元件專用 fixture／旅程 wrapper（目前不存在）。只接受 launcher 提供的唯一、空白 task state，拒絕重用 DB；經既有管理表單/API 建短／長中文 connection、route、多列及空表 fixture。Usage 非空畫面須另備同環境 loopback 假上游、operator override 與本次 gateway key；不具備安全接線時記未驗證，不接正式 provider。
- 登入使用新 admin token；合成 session storageState 僅存本次受保護 state。共用 capture 不會登入、seed 或遮罩；先用專用流程完成登入，受保護頁指定本次 storageState，登入頁另用無 session app，避免重導。禁止提交 token、cookie、headers、含秘密表單及 state。
- 驗證：缺少／重用資料目錄必須失敗。瀏覽器、服務、mock 同一獨立 network namespace、僅 loopback、runtime 阻外網；沒有 provider CLI 啟動。只記 seed 數量及無秘密摘要。
- 風險與回滾：wrapper 尚未存在，沒有完整可直接驗收的 harness。前置不足就不啟動；可回退 fixture／旅程與 targets，保留產品安全邊界。

### M2 Web 版面、表單與鍵盤（C3）

- 現況：[templates/style.css](../templates/style.css):26、55、159、216 已有側欄、表格及 720px breakpoint，不能稱作完全沒有 responsive；長 URL／多 targets 的窄螢幕表現尚未實測。CSS:1 只有固定深色 token，沒有 light theme。
- 修改：只依第 2 輪實際證據補 min-width、長字串折行或具名稱的局部表格捲動、focus-visible、表單 error 關聯與語意；不預先宣稱 overflow／axe 失敗，不新增 light theme 或大改導航。
- 驗證：三種 viewport、鍵盤順序／焦點、中文長資料、空資料、非法輸入、登入失敗及 CSRF 拒絕；axe 無 critical/serious。局部捲動仍可操作編輯／刪除，頁面無水平溢出。
- 風險與回滾：局部捲動可能藏操作欄，必須實測鍵盤。每項模板／CSS 修正獨立提交與 revert，不放寬後端驗證。

### M3 API key 畫面與文案（C2、C4）

- 現況：[templates/keys.html](../templates/keys.html):26、73 的「無 keys 就開放」落後於預設拒絕的 [cost-safety](../docs/cost-safety.md)；:31 建立回應顯示一次完整 new_secret，並非已遮罩。
- 修改：第 2 輪只修模板文案，符合目前預設拒絕／明確 opt-in bootstrap 契約；需要額外後端狀態時另提需求。專用旅程建立 key 時停用 trace/video/network-body 留存，key 只留程序記憶體；先撤銷或離開一次性回應，再截普通清單。若要截一次性畫面，專用 Playwright screenshot 必須用 locator mask 並檢查產物；共用 capture 無 mask 支援，不能靠新增 targets 欄位宣稱遮罩。
- 驗證：清單只有 prefix，報告、DOM dump、console、快照無可用秘密；不開 keyless 或關閉管理認證。本輪未改程式或執行上述流程。
- 風險與回滾：秘密易混入 trace，故不收集這類 artifact。可回退模板與專用旅程，認證程式不變。

### M4 TUI 可讀性與雙格式擷取（C1、D1）

- 現況：[src/tui_app.rs](../src/tui_app.rs):54 直接讀 SQLite；:80 三頁 Connections／Routes／Usage；:180 支援 Tab/左右/h/l、q/Esc，沒有 CRUD 快捷鍵。:96、137 長列可能裁切、:166 footer 顯示 DB path，均為待測風險。
- 修改：依實測只調整 TUI 行寬、換行、空狀態與 help 排版，不增加 CRUD/provider 操作或改 DB 錯誤語意。以本次專用 tmux socket/session 與明確 pane 擷取 ANSI 和純文字，不連既有 tmux，不使用全域 kill-server。
- 驗證：80×24、120×40，各三分頁的 empty／長中文／大量列、可見退出提示；q/Esc 後 raw mode／alternate screen 正常恢復。名稱、URL、DB path 都來自合成環境，不收集私人路徑。
- 風險與回滾：固定 TERM、locale、尺寸、fixture、版本；純文字報告配狀態斷言，不以整屏 byte equality 取代行為。D1 未確認不實作，可獨立回退 TUI 排版／擷取腳本。

## 啟動方式（第 2 輪要驗證的版本）

以下是已核對 CLI 的候選命令，**未執行**。先完成 M1：服務、瀏覽器、tmux、假上游在同獨立 namespace，不掛真 HOME／憑證／既有資料，不用 host network。launcher 提供 disk-backed build/state/evidence，Cargo target 指到 AGENT_BUILD_DIR；不覆寫共用 HOME。預先核對 pinned toolchain/dependencies，runtime 阻外網。

未來 wrapper 設 FE_POKER_DATA_DIR 為本次新建空目錄、THINROUTER_ADMIN_TOKEN 為本次隨機值；清除繼承的 THINROUTER_* provider/CLI/秘密設定，只 allowlist 本次值。密鑰在新 data-dir 產生。禁用 keyless bootstrap 與 Cursor account plugin opt-in。假上游 override 只在 M1 完成後加入，不使用現存 provider 配置。

~~~sh
# cwd: gateways/pokercase；先完成隔離／fixture 前置
cargo run --locked -- serve --host 127.0.0.1 --port 20128 --data-dir "${FE_POKER_DATA_DIR:?fresh task data required}"
# 本次專用 terminal，讀相同合成 state；不由 capture --start 啟動
cargo run --locked -- tui --data-dir "${FE_POKER_DATA_DIR:?fresh task data required}"
~~~

先走登入與 CRUD，取得真實 fixture ID，再加入 /admin/connections/{id}/edit、/admin/routes/{id}/edit（[src/web.rs](../src/web.rs):23、28）；不導覽占位符。targets 維持 verified:false，尚未有 seed ID／登入狀態，不能當完整驗收清單。

M1 完成後，從 **repository root** 使用本次 ephemeral targets（填本次 storageState 與實際 ID）跑共用 capture.mjs dry-run，再 capture；不把 state/token 寫回受版控 targets。登入頁與已登入頁分開 app。TUI 的 capture-pane -p -e 及 capture-pane -p 必須指定本次專用 socket/pane，輸出本次 evidence。wrapper 尚待實作，沒有可直接貼上的全域 tmux 命令。

## 第 3 輪驗收

- Web：無 session 登入頁、登入失敗／成功、Dashboard、Connections/Routes 建立編輯刪除、Keys 建立後離開秘密回應再看清單、Usage 空／合成成功與錯誤、登出。無法安全建立的 fixture 明列未驗證。
- desktop 1440×900、tablet 834×1112、mobile 390×844；目前只驗深色。無 blocker/major、非預期 console/page/request errors、axe critical/serious；鍵盤與 error 實測。本輪無上述結果。
- TUI 兩尺寸×三只讀分頁，ANSI artifact 與純文字報告分開，記錄終端版本及退出結果，不套瀏覽器 axe。
- 記 source SHA、隔離、fixture 摘要、實際命令、失敗／跳過，完成才改 verified。第 2 輪產品檢查候選：cargo fmt --check、cargo test --locked、cargo clippy --locked --all-targets -- -D warnings，均經 launcher；本輪未跑。
- 不含真 provider、OAuth/import、訂閱帳號、部署或完整 gateway SUCCESS；視覺結果不能替代產品驗收。

## 開放問題

1. D1 ANSI 原檔＋純文字報告仍待擁有者確認。
2. AC-15 需擁有者接受假設；本次代理合併權限不等於設計決策已確認。
3. M1 fixture／登入／mask／tmux wrapper 尚未實作；完成前沒有受保護頁／Usage 的完整 capture harness。超出前端範圍的後端接線另案提議。
