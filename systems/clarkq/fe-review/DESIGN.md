# FE Review — clarkq — DESIGN

> 狀態：**草稿；D1、AC-15 待擁有者確認**。本 PR 只有第 1 輪文件，未啟動服務或執行 capture。

## 目標

在隔離的單節點 ClarkQ 與瀏覽器，以本次新 API key 和合成 queues/messages 驗證 /ui/ 的操作、狀態、可及性及三種 viewport。保留已驗收單機核心與 dormant 狀態，不以 FE 設計擴大 cluster／production 承諾。

## 依據

- 來源 d8ca3c4089a9fbe852459da3d9602329224230e7；[README](../README.md)、[AGENTS](../AGENTS.md)、[SUCCESS](../SUCCESS.md)、[PROGRESS](../PROGRESS.md)。[早期技術設計](../TECHNICAL_DESIGN.md) 是歷史 Phase1，不能用其待實作清單覆蓋現有功能與驗收。
- [REVIEW](REVIEW.md) 的 dormant FE 例外已允許；**D1 假設**採單程序 Go＋既有 API seed，不用 Docker demo，仍待擁有者確認。
- [PROTOCOL](../../../docs/fe-review/PROTOCOL.md)、[DESIGN-PROMPT](../../../docs/fe-review/DESIGN-PROMPT.md)、[SDD](../../../docs/fe-review/SDD.md)：本設計 AC-13；AC-15 人工確認未取得。

## 不做的事

不改 queue 語意、後端 API/auth、WAL/schema、cluster/lease/quorum、依賴 major、部署或 usable tag。不使用既有 key、OIDC、TLS 憑證、WAL/snapshot、browser profile 或正式 queue；不執行 demo 的 compose up/down，也不把刪除真 queue 當 UI 測試。本輪不寫 runtime code、不啟動 UI、不跑 capture。

## 修改項目

### M1 隔離啟動與合成資料（C1、C2、D1）

- 現況：[internal/config/config.go](../internal/config/config.go):15 預設 :8080；:155 接受 CLARKQ_ADDR。不是預設只綁 loopback。[internal/config/yaml.go](../internal/config/yaml.go):89 的 MustLoad 會讀 CLARKQ_CONFIG，再疊環境；舊 targets 的裸 go run 可能讀到現有 auth／cluster／state。[demo/run-demo.sh](../demo/run-demo.sh):15、38 有預設 project 及 compose 操作，不是 FE 隔離 wrapper。
- 修改：第 2 輪新增元件專用啟動／seed／旅程 wrapper（目前不存在），由 launcher 提供唯一 task state/build/evidence，拒絕既有 WAL/snapshot。以乾淨 allowlist 環境啟動，清除繼承的 CLARKQ_CONFIG／OIDC／OTEL／cluster／TLS／持久化設定；只設定本次 loopback address、新隨機 API key，單機 RF1、無 peers、無外部 exporter。baseline 用記憶體資料；若測持久化只用本次專有 state 路徑，不讀任何既有檔案。
- seed 經既有 authenticated API 建 0／數筆／多筆 queue，合法 1–64 字 ASCII 名稱、長中文 message body；queue 名稱不能用非法中文假資料。資料含空 queue、長合法名稱、中文及固定特殊字元 body，不含私人 payload。每組 destructive 流程用獨立 queue，避免 consume/clear 污染後續案例。
- 驗證：缺 key／錯 key 的 API 回 401，正確 key 可操作；/ui/ 本身公開是既有行為，不以 HTML 200 當 authenticated API 已通過。確認 listeners 僅 loopback、無 peers/OIDC/OTEL 請求、state 可歸屬本次工作。
- 風險與回滾：env 空字串不一定覆蓋 YAML，因此必須不載入既有 config 並先 scrub。前置不足不啟動；可回退專用 wrapper／targets，產品程式不變。

### M2 窄螢幕、長資料與鍵盤（C3）

- 現況：[internal/ui/index.html](../internal/ui/index.html):38 grid 最小欄寬 320px、:63 table、:67 pre overflow；長 queue/JSON 在 panel padding 下是否溢出尚未實測。:93–104、119–124 已有 label，不能宣稱全部缺 label。:8 是固定深色配色，沒有 light theme。
- 修改：依第 2 輪證據調整 grid minmax/min-width、table 的局部可存取捲動與長名稱折行、focus-visible、動態錯誤／狀態語意。不新增主題或大改操作布局，不把待測風險寫成已觀察到的缺陷。
- 驗證：1440×900、834×1112、390×844；長合法 queue 名、長中文 body／JSON、多列 table。頁面無水平溢出、操作欄可鍵盤抵達、焦點可見，axe 無 critical/serious，aria 狀態不因五秒刷新持續打斷讀屏。
- 風險與回滾：換行與捲動可能影響按鈕位置，逐項視覺／鍵盤比對；每項 HTML/CSS 修改獨立 revert。

### M3 API 狀態與 destructive 操作（C4）

- 現況：[internal/ui/index.html](../internal/ui/index.html):222 有 queues empty/error，:292 區分 peek 與 consume、:306 clear 有 confirm；:339 初始 refreshAll，:340 只有 queues 每五秒刷新。Metrics/Cluster 並非自動全部刷新。:198 Save 將 base/key/tenant 放 localStorage。
- 修改：保留 peek 不移除、consume 移除、clear 確認的既有語意。只依可重現問題修前端 loading/error/disabled、重複送出或動態焦點；不能為了截圖跳過認證或 clear 確認。不添加新 queue 能力或改自動刷新 API 契約。
- 驗證：Save 正確 key→Refresh all→POST→Use→Peek 深度不變→Consume 深度減一→Clear 取消不變／確認清空；missing/invalid key、空 queue、非法名、受控網路失敗都呈現明確狀態。錯誤狀態透過獨立 browser route interception 或同環境測試服務建立；專用 harness 尚待實作。五秒刷新前後維持可用焦點與正確 depth。
- 風險與回滾：操作是會改資料的，僅對本次合成 queues。案例各自 seed；回退前端狀態修正，後端語意不變。

## 啟動方式（第 2 輪要驗證的版本）

所有命令是候選，未執行。先完成 M1 專用環境／wrapper：服務與瀏覽器同獨立 namespace、不用 host network、不掛真資料／憑證，runtime 阻外網；建置依賴先按 go.mod/go.sum 取得，Go cache/output 經共同 launcher。不要覆寫共用 HOME。Go 版本以 go.mod 與現行 CI 為準。

由 wrapper 在 scrub 後設定 CLARKQ_ADDR=127.0.0.1:8080、CLARKQ_API_KEY 為新隨機值；不以空 key 關掉 API 認證。從元件目錄啟動：

~~~sh
# cwd: systems/clarkq；上文隔離與 scrub 完成後
: "${CLARKQ_API_KEY:?fresh task key required}"
CLARKQ_ADDR=127.0.0.1:8080 go run ./cmd/clarkq
~~~

命令本身不建立隔離、不 scrub、不 seed；不能離開前置直接當安全 harness 使用。targets 改為顯式 loopback／要求 key，verified 維持 false；不將秘密寫進 targets/env。

UI 在 [internal/ui/index.html](../internal/ui/index.html):158 讀 clarkq.base/apiKey/tenant，初始就會發 API。未來專用 Playwright 流程先用全新無既有 profile 的 context，在首次頁面 script 前注入本次 localStorage（或以本次專有 storageState 建 context），設定 base 為 loopback origin、key 為本次值、tenant 空。共用 capture 每頁新 context，不提供任意 addInitScript hook；須先產生本次私有 storageState，放入 ephemeral targets。原始 targets 無此狀態，直接 capture 只會得到預期 401，不能宣稱主要流程成功。

完成前置後從 **repository root** 跑共用 capture.mjs 的 ephemeral targets dry-run，再 capture；互動狀態用專用腳本。禁止提交 storageState、key、trace/network headers；password input 雖遮罩，DOM/localStorage 仍含秘密，不收集 dump。只保留無秘密的 API 結果摘要與 UI 截圖。關閉僅本次擁有的程序／資料，不使用 demo compose down 清理。

## 第 3 輪驗收

- /ui/ 的 Connection、Enqueue、Queues、Metrics、Cluster、Activity log；無真 cluster時明列單節點顯示，不把它當多節點驗收。
- 完整 M3 流程、空／多資料、401／網路錯誤、Clear取消／確認；body特殊字元以文字呈現。錯誤案例列為預期，正常流程沒有非預期 console/page/request errors。
- 三 viewport、深色、鍵盤、可見焦點、axe無critical/serious、無page overflow；記 source SHA、Go/Chromium版本、fixture摘要、實際命令與未驗證項。runtime完成才可更新verified。
- 第2輪候選產品檢查為 go test ./...、go build（output在AGENT_BUILD_DIR），使用共同launcher；本輪未執行。既有單機可用資格不代表本次FE檢查已跑。
- 不含真OIDC/TLS、cluster故障／quorum、長時負載／production；不以圖像驗收擴大SUCCESS。

## 開放問題

1. D1 是否採單程序Go＋API seed，仍待擁有者確認。
2. AC-15設計確認仍pending；代理合併權限不代替擁有者決策。
3. 隔離wrapper、seed與authenticated browser fixture尚未存在。後端不足以支援安全解耦時另提議，不在前端工作中改認證。
