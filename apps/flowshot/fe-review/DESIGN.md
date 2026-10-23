# FE Review — flowshot — DESIGN

> 活文件，狀態：**草稿，待 owner 確認**。第 1 輪，Refs #156／SDD AC-11；不代表 AC-15 已通過。來源 `d8ca3c4089a9fbe852459da3d9602329224230e7`。本次不啟動 UI、不實作 harness、不跑 capture。

## 目標

讓**目前可見的 foundation shell**能在隔離瀏覽器以合成 build-info 呈現 loading／ready／error，供第 3 輪檢查排版、鍵盤與輔助技術狀態。這是 FE review 切片；不把尚未接入主畫面的閱讀／annotation 旅程或 Mac 發行 gate 當成已完成。主線仍依 [SUCCESS](../SUCCESS.md) 與 [SPEC](../SPEC.md)。

## 依據

- 已決定：issue #156 允許受限的 FE review 設計／後續前端修改，不加新功能或 major 升級。Flowshot 已由 owner 恢復主線開發，見 [README](../README.md)；舊 REVIEW 的 dormant 描述不再作為現況。本設計不擴張其他開發任務。
- **假設 D1（待 owner）**：採 REVIEW 建議 (b)，由 review-only Playwright `addInitScript` 在 navigation 前注入 mock，不新增 production IPC adapter。優先用既有 `window.__FLOWSHOT_BUILD_INFO_PROMISE__` seam，不手改生成 contracts 或猜測 Tauri 內部物件。
- **假設 D2（待 owner）**：本輪只要求 Web 層截圖；原生視窗截圖另列未驗。這不豁免原有 Linux native／Mac release 驗收。
- 約束：[AGENTS](../AGENTS.md)、[SPEC](../SPEC.md) §3/10/13 的唯讀來源、無網路、Rust contract 權威與平台 gate；[PROTOCOL](../../../docs/fe-review/PROTOCOL.md) §0/1/4、[SDD](../../../docs/fe-review/SDD.md) AC-11/15。所有下一輪命令均為**提案，未執行**。

## 不做的事

不做 Markdown／annotation 新 UI、N02/N03 整合、N03 效能修復、N04 tabs、資料庫／Rust／IPC contract 變更、新權限或 major 升級。不讀既有 workspace、app-data 或使用者設定。不把 browser mock 當作 WebView IPC、原生視窗、資料持久或 `<1500ms` 產品證據。不修未經觀察的視覺問題；第 3 輪新增發現回到 REVIEW，再另提設計。

## 修改項目

### M1 在既有啟動 seam 建立三種 synthetic 狀態

- 對應：C1、D1。
- 現況：[src/main.ts:1](../src/main.ts#L1) 先載入 launch 模組；[src/launch-build-info.ts:12](../src/launch-build-info.ts#L12) 在 React mount 前呼叫 IPC，除非 window promise 已存在。[src/render.tsx:15](../src/render.tsx#L15) 把該 promise loader 傳給 App。[generated/contracts/commands.ts:34](../src/generated/contracts/commands.ts#L34) 包裝 `get_build_info`。[App.tsx:25](../src/App.tsx#L25) 已處理 reject，因此缺 IPC 不等於整個頁面無法載入，而是 shell 的 error 狀態。
- 修改：第 2 輪在 `fe-review/` 新增 review-only fixture/driver。先 newContext，再 addInitScript，再 goto；注入 pending promise（loading）、合成 `BuildInfoDto`（ready）、安全 `AppErrorDto` rejection（error）。先注入受控 pending promise；driver 看到 loading 後才 resolve/reject，避免在 initScript 裡立即 rejection 形成未處理錯誤。資料形狀依 [types.ts:6](../src/generated/contracts/types.ts#L6)／[types.ts:10](../src/generated/contracts/types.ts#L10)，不得以真 revision、環境路徑或錯誤堆疊代替 fixture。每場景新 context，測試清除 seam 後不會沿用前一場景。未知 native invoke 必須報錯，不回傳萬用 success。
- 驗證：fixture 自測要求注入發生在 eager import 前，三狀態都能由可讀 heading／alert 定位，無未處理 rejection。下一輪跑 `npm run lint`、`npm test`、`npm run build`；保留 [App.build-info.test.tsx:15](../src/App.build-info.test.tsx#L15) 與 [launch-build-info.test.ts:23](../src/launch-build-info.test.ts#L23) 的現有 oracle，不放寬 assertions。
- 風險與回滾：太晚注入會先觸發真 IPC；以失敗案例阻止 capture。只回退 `fe-review/` driver/fixture；不得改 eager 啟動計時或生成 command 來遷就截圖。若 D1 改選 adapter，先修設計並獲確認，不能自行切換方案。

### M2 建立有隔離證據的互動畫面擷取入口

- 對應：C1/C2、D1/D2。
- 現況：[capture.mjs:114](../../../docs/fe-review/capture.mjs#L114) 自建 context/page，[capture.mjs:137](../../../docs/fe-review/capture.mjs#L137) 直接 goto，沒有 fixture preload hook。只執行既有 targets 的 start 或 generic capture 不會載入 M1 mock。`targets.json` 的 `/` 是唯一目前入口；[App.tsx:55](../src/App.tsx#L55) 只輸出 foundation shell。
- 修改：第 2 輪在本元件 `fe-review/` 的獨立 review driver 實作 M1 preload、狀態選擇、三 viewport/light+dark preference、console/pageerror/request/overflow/axe 結果與 screenshot manifest。它使用 targets 的座標/port，但不能宣稱現有共用 capture 已支持 hook；不修改共用 capture。保存進 `runs/<timestamp>/`，圖片與 context state 按既有 gitignore 不提交。若不能達到 PROTOCOL 相同的 capture.json/REPORT 證據，先停止擷取並回報缺口。
- 驗證：新 driver fixture 測試需阻擋非 `127.0.0.1:1420` 的 HTTP/WebSocket 請求，並拒絕未準備 fixture、遺留 context 或 server；確認 dark preference 沒有被誤報為既有 theme 功能。[styles.css:1](../src/styles.css#L1) 是固定色票；兩種 preference 都測現況，不新增主題功能。`verified` 只有下一輪實跑後才可改 true。
- 風險與回滾：缺 init hook 會產生貌似有效的 error-only 截圖。回退 review driver／targets 修正，保留失敗 report；不能把真桌面環境作為 fallback。

## 啟動方式（第 2 輪要驗證的版本）

以下**未執行且未 capture-ready**。D1/D2 與 AC-15 確認後，先實作／測試 M1/M2，再由下一輪 worker 在獨立 network namespace 執行。服務和瀏覽器必須同 namespace、只綁 loopback；Flowshot/Loom 分別啟動，兩者不可共用 1420。拒絕 `--network host`、既有 app-data、browser profile、storageState 與任何真資料；環境採 allowlist，不繼承 cloud/provider tokens。只用本輪新建合成資料；不需要 login/token。不能僅靠 browser route block 宣稱 OS network 隔離。

從元件目錄準備 Node 24.18.0、鎖定 npm dependencies，依 shared workspace 政策將 cache/build/temp 放 launcher task 目錄，唯一 screenshots/reports 保留在 evidence/artifacts；如需 `runs/` manifest 必須明確連到 preserved 證據，不把唯一成果放 disposable cache。下列既有命令只提供 dev server／靜態檢查，**沒有** IPC fixture 或瀏覽器 runner：

```sh
npm ci
npm run lint
npm test
npm run build
npm run dev -- --host 127.0.0.1 --port 1420 --strictPort
```

端口依 [vite.config.ts:7](../vite.config.ts#L7)，scripts 依 [package.json:9](../package.json#L9)。不啟動 `tauri dev`、Docker/native/macOS probes。`targets.json` 保留 `verified: false`，頁面只有 home `/`；M1 三狀態是 driver scenario，**不是**不存在的路由或 query API。driver 的實際 CLI／檢查命令須在第 2 輪完成時寫回 PROMPT；本輪不捏造可執行 harness 指令。

## 第 3 輪驗收

- 頁面與流程：對 `/` 以新 context 各跑 pending → loading、resolve → ready、typed reject → error；核對 heading、Version/Revision/Profile 與 alert。加入合成長 metadata；檢查 [styles.css:93](../src/styles.css#L93) 的三欄／窄螢幕單欄與 ellipsis，不把隱藏文字當成資料遺失。
- 通過條件：三 viewport（1440×900、834×1112、390×844）、兩種 preference 無水平 overflow、重疊、不可讀狀態；axe 無 critical/serious，狀態具可讀名稱、error alert 可辨識；無非預期 pageerror/console error/外部 request。預期 mock rejection 與產品 error 分清楚，不忽略其他錯誤。每場景有 source SHA、fixture/hash、capture 指標與 REPORT。
- 未覆蓋：reader/annotation/list/reanchor 尚未在主畫面交付，不能靠 mock 生造；原生 IPC、真檔案、DB、原生 screenshot、Mac launch SLA／MVP 均不在 browser 證據內。保留原主線欠項；後續接線改變須更新設計，不能繼承舊 capture。

## 開放問題

1. D1 是否確認使用 review-only preload，或改選 production adapter？目前只是 (b) 假設。
2. D2 是否接受本輪僅 Web 層，原生 screenshot 不作本 FE 切片 gate？不得推論 Mac release gate 已豁免。
3. M1/M2 尚未實作，generic capture 無 hook；需下一輪明確交付可測 driver 後才啟動/驗證 targets。
4. AC-15 由 owner 確認，尚無 signoff；此文件合入或格式檢查通過不等於產品可用。
