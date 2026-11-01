# FE Review — loom — DESIGN

> 2026-10-23 owner 已確認本設計方向（[決策紀錄](../../../docs/fe-review/ROUND1-ACCEPTANCE.md#owner-confirmation-20261023)）：D1 採 review-only IPC/event preload；保留 callback 生命週期與未知 invoke 拒絕，不改 production adapter。 第 2／3 輪仍未由本次文件回寫執行。
> 狀態：**設計方向已確認**。實作與 runtime／browser 驗證仍須按本檔範圍另行執行；文件確認不代表產品可用。

## 目標

以受控、可重設的 synthetic IPC/event 狀態驗證現有 canvas、document、terminal 與 session-history Web 互動，不碰真 vault、PTY 或 AI。檢查三 viewport 下的版面、focus、載入／錯誤／衝突及關閉保護；browser 結果不取代 native/Linux/跨平台或真 provider 驗收。Loom 仍是 dormant prototype，見 [README](../README.md)／[SUCCESS](../SUCCESS.md)。

## 依據

- 已決定：issue #156 與 portfolio 的 FE review 例外允許此受限設計；不恢復 dormant backlog，不新增產品能力。
- **D1（已確認）**：採 REVIEW 建議 (b)，以 review-only Playwright `addInitScript` 注入 synthetic Tauri IPC/event mock，不改 production adapter。注入機制須對照鎖定 `@tauri-apps/api` 的實際 invoke/listen/callback 實作驗證；不能只設一個 `window.invoke` 就宣稱接通。
- 約束：[AGENTS](../AGENTS.md)、[FREEZE:7](../FREEZE.md#L7) 的 frozen Rust/generated TS/schema/fixture 權威；[source-of-truth](../schema/source-of-truth.md)、[canvas-sidecar](../schema/canvas-sidecar.md) 及現有關閉/衝突資料保護不變。[PROTOCOL](../../../docs/fe-review/PROTOCOL.md) §0/1/4 與 [SDD](../../../docs/fe-review/SDD.md) AC-11/15。下列建置、啟動、測試均為**下一輪提案，未執行**。

## 不做的事

不改 Rust、後端 IPC、frozen contracts、資料 schema 或資料權威；不加 MCP/plugin/approval/inbox、LOD、feeds_output_to 自動執行、新 AI 能力或 major 升級。不讓 browser mock 真的 spawn PTY、讀寫使用者檔案、送 request 到 provider；不使用既有 vault/session DB、token、cloud設定或 browser profile。不宣稱 mock terminal 的 output/resize 是真 PTY 或跨平台證據。原有 Run/Pin、Save/Discard/Cancel、restart/forget 語意與保護不可為截圖放寬。

## 修改項目

### M1 建立涵蓋所有現有 native 邊界的 review fixture

- 對應：C1、D1。
- 現況：[src/ipc.ts:25](../src/ipc.ts#L25) 起包 PTY/history，且 [ipc.ts:121](../src/ipc.ts#L121) 訂閱 events；但 native 呼叫不只在這個檔案。[doc_ipc.ts:24](../src/surfaces/document/doc_ipc.ts#L24) 的 vault/doc、[ai_ipc.ts:37](../src/surfaces/document/ai_ipc.ts#L37)、[persistence.ts:78](../src/surfaces/canvas/persistence.ts#L78) 的 canvas_read/write、[window_close_ipc.ts:5](../src/surfaces/canvas/window_close_ipc.ts#L5) 的 window events 都需處理。[App.tsx:32](../src/App.tsx#L32) mount 會讀 vault；空白畫布不代表 IPC 已可用。
- 修改：第 2 輪只在 `fe-review/` 新增 fixture/driver。建立每 context 獨立的 in-memory command registry、event callback/listener id、unlisten/disposal 與 deterministic counter。按實際 runtime DTO 回應所有上述邊界；讀寫命令驗證 origin 與參數，未知命令直接拒絕／記為 capture failure，不提供 native passthrough。不得改 generated TS 來適應 fake。
- Fixture 契約：合成 `/fixture/vault`、`notes.md`、canvas version1、session metadata/ids、PTY replay batch；doc read/create/write 分開，write 需 expectedHash，能回 conflict。AI status 預設明確無 key，Ask 不送網路；stream/error/cancel 場景若需啟用，僅由 fixture 產生 request id/events，頁面狀態與 record 均標為 synthetic。history restart 只建 fake session，forget 只刪 fixture metadata；初載入永不自行 restart。
- 驗證：新增 mock contract 自測，含 event 註冊後才 subscribe/replay、取消後無 stale event、未知 invoke 拒絕、context reset 不保留資料、mock 不接 native/network。[Terminal.tsx:66](../src/Terminal.tsx#L66) 先 listen 再 subscribe 及 [Terminal.tsx:89](../src/Terminal.tsx#L89) detach cleanup 的既有次序要保留。下一輪跑 `npm run typecheck:contracts`、`npm run typecheck:app`、`npm test`、`npm run build`；必要 `npm run verify` 會包含 Rust contract 生成檢查，須保留 `git diff --exit-code -- src/contracts/`。
- 風險與回滾：Tauri 內部 callback 協議錯誤會造成假 loading 或漏事件。若無法在 locked 版本測通，停止並提出 D1 adapter 替代設計，不偷偷改 production。回退 `fe-review/` mock/driver，保留失敗證據；不碰 vault 資料或 native runtime。

### M2 以既有互動建立可觀察、隔離的 scenario driver

- 對應：C1、D1。
- 現況：[App.tsx:73](../src/App.tsx#L73) 有 +terminal/+document 與 open prompt；[CanvasSurface.tsx:943](../src/surfaces/canvas/CanvasSurface.tsx#L943) 支援連線，[CanvasSurface.tsx:973](../src/surfaces/canvas/CanvasSurface.tsx#L973) 顯示 history。[DocumentSurface.tsx:303](../src/surfaces/document/DocumentSurface.tsx#L303) 與 [DocumentSurface.tsx:683](../src/surfaces/document/DocumentSurface.tsx#L683) 已有 save/close 與保護；[history.ts:119](../src/surfaces/canvas/history.ts#L119) 只在明確 restart 時建立 session。既有 [歷史 browser 驗證](../docs/session-recovery-verification.md) 是來源證據，不能直接當本輪可執行擷取入口。
- 修改：新增 review-only scenario runner：空畫布→+terminal→+document/open `notes.md`→編輯/關閉的 Cancel、Discard、save error/conflict→畫線/縮放/重新載入 fixture sidecar；另跑 history loading/error/empty、explicit restart/forget 與 in-memory warning。Run/Pin 只演示已存在的 fake stdin/output；不宣稱畫 `feeds_output_to` 線會驅動 Run/Pin。所有事件/動作與 scene id 寫入無秘密的 manifest，截圖長內容與窄 viewport。
- 驗證：明確 assertions 要求 dirty editor 的 Cancel/失敗 Save 不關閉、不刪 incident edges；history 初載入不寫 stdin/restart；mock reset 後無自動重跑；unlisten、detach、doc-close/cancel 可觀察且沒有未完成 promise。人工鍵盤驗證 +document prompt/焦點、CodeMirror 編輯與 close dialog，不把刪除字元誤送 canvas Delete。此為對現有行為的驗證，不改其語意。
- 風險與回滾：把常數 success 當 mock 會掩蓋衝突/生命週期錯誤；錯誤情境不可只截靜態假 DOM。每場景以真 React UI 觸發 mock 邊界；失敗回報 REVIEW。回退 scenario/fixture，不刪或放寬原有 `.close/.window/.recovery` assertions，不順手實作未交付功能。

### M3 明確區分 dev server、mock runner 與 generic capture

- 對應：C1、D1。
- 現況：[capture.mjs:114](../../../docs/fe-review/capture.mjs#L114) 自建 context/page，沒有 addInitScript hook；[capture.mjs:137](../../../docs/fe-review/capture.mjs#L137) 直接 navigation。`targets.json` 只有 `/`，沒有 scenario 或注入功能。單獨 `capture.mjs --start` 不會提供 M1 native 邊界。
- 修改：M2 driver 自行持有 preload context/頁面並產生與 PROTOCOL 對應的 screenshot/capture.json/REPORT 指標，採 targets 的 viewport/colorSchemes；更新 PROMPT 的**實際可執行**入口與先備檢查後才可驗證 targets。共用 capture 不在此配對範圍內，不新增不存在的 targets hook 或 query route。
- 驗證：fixture runner 先證明拒絕外部 HTTP/WebSocket、console/pageerror capture、request/overflow/axe 指標與 context disposal；缺 mock 即拒絕擷取，不 fallback 真 Tauri/AI。每頁保留 source SHA、fixture hash、browser版本、限制與 pointer 到 preserved evidence。
- 風險與回滾：generic capture 的空 canvas 截圖可能看似成功卻沒有 document/terminal。回退本元件 driver/targets，保留 `verified: false` 與缺口；不能以 native 啟動或真 token 補洞。

## 啟動方式（第 2 輪要驗證的版本）

**尚未 capture-ready**。D1 已由 owner 確認，後續仍須實作並自測 M1–M3。每個元件用獨立 network namespace，服務與瀏覽器同 namespace，只綁 loopback；不可 host network，不與 Flowshot 同用 1420。準備全新 context、合成資料、允許清單環境與共用 cache 與隔離 build/tmp，唯一 artifacts/evidence 保留；不讀 HOME 下的 vault 或 provider設定。OS network 隔離與 browser request allowlist 兩者都需證明，不能只用其一。

下一輪準備 Node20+ 與 npm lock，從元件目錄經 shared launcher 執行。下列是既有 scripts，**未執行且不含 M1 mock**：

```sh
npm ci
npm run typecheck:contracts
npm run typecheck:app
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1420 --strictPort
```

依 [package.json:7](../package.json#L7)／[vite.config.ts:9](../vite.config.ts#L9)。拒絕繼承 `TAURI_DEV_HOST` 外部綁定；只開 Vite，不執行 `tauri dev`。原生預設 vault 來自 [lib.rs:143](../src-tauri/src/lib.rs#L143)，本次絕不讀取；browser fixture 的 `/fixture/vault` 是字串身份，不是可開啟的主機路徑。`targets.json` 保留 home `/` 與 `verified: false`；scene/state 由未來 driver 控制，不是路由。實際 driver CLI 要等實作後才能寫回，不能把單獨 generic capture 指令當成完整流程。

## 第 3 輪驗收

- 頁面與流程：`/` 的 canvas、terminal/document nodes、open prompt、dirty/conflict/close dialog、history warning/error/restart/forget；M2 逐步互動與 synthetic events，不只首頁。三 viewport 為1440×900、834×1112、390×844，light/dark preference 都記錄現況，不預設已有 theme toggle。
- 通過條件：主要流程無 blocker/major；axe 無 critical/serious；無非預期 console/pageerror/failed request；無水平 overflow、重疊、截斷操作按鈕。640×360 terminal、560×420 document 的既有 [node sizes](../src/surfaces/canvas/config.ts#L4) 在 canvas 可平移不等於頁面可接受水平 overflow，報告需區分。focus 可見、prompt/錯誤有可讀名稱、keyboard 編輯不刪節點。每場景的 mock mutation/事件、release/unlisten 與清理可核對。
- 不在 browser 證據內：真 PTY/resize、原生 filesystem/watcher/SQLite、跨程序 CAS/crash recovery、真正視窗關閉、AI網路、nativeLinux/Windows/macOS、plugin/MCP gate；原有欠項保留。保留 Markdown/sidecar/session metadata 的權威區分，不把 mock reset 當 restart durability。

## 開放問題

1. D1 已確認；(b) 需要完整 callback/event 設計，若成本超過預期需重新審閱 adapter 方案。
2. review driver 尚未存在且 generic capture 無 hook；第 2 輪需交付可測 CLI/證據格式，不得只寫「注入 mock」就標 verified。
3. 本輪無 native window 截圖要求；任何新增 native integration 都需另列隔離資料/平台與命令，不沿用 operator vault 或 key。
- Owner 已明確確認本設計方向；原產品缺口與未執行驗證不因此通過。
