---
project: labs/browser-fingerprint
purpose: 觀測瀏覽器設備訊號與任務操作事件以比較測試環境
kind: lab
mainline: complete
usable_tag: none
reviewed: 2026-10-23
source_commit: 2ce7200f7eb55cfaf623121182d7bd14e10fc66d
---

# browser-fingerprint 成功契約

## 主線與範圍

[Daylight README](README.md) 定義繁體中文任務工作台、Go記憶體CRUD與本機JSONL觀測。
主線是新增→編輯→完成→搜尋→刪除，核對本輪設備與事件是否完整記錄。
指紋是實驗摘要，sample是操作者標記；兩者都不能證明個人身分或真人／AI。
任務資料重啟後回六個seed，未承諾永久任務儲存或生產多租戶。
Quick Tunnel為可選外部測試路徑，私人PIN流程尚無實測。

## 本次執行 / 2026-10-23

Owner 已啟用 START_DEVELOPMENT_PROMPT；沿用 Go + browser-native 技術棧。來源 b7f2a4311d1135977ba273efba8e77702b908036 加本次未提交差異，保留其他項目工作。先驗五步真 Chromium 旅程與失敗提示，再驗巢狀白名單、分析器與 private log HTTP 邊界。原 AC 不縮減；本地 lab 是驗收範圍，私人 tunnel/PIN 不宣稱通過。

驗證計畫：原生 test/race/vet/build；Node 分析器回歸；Chromium 操作與 API/JSONL/analysis 同輪比對；失敗記錄不撤銷 CRUD；project-success 與 diff 檢查；獨立審查。依 [任務板](docs/tasks/BOARD.md) 推進。

## 驗收條件

passed 表示下列同版本地實測或明列的文件核對；historical 才是舊結果。來源為上述已提交產品版本，並由 [candidate 雜湊](docs/evidence/candidate-sha256.json) 綁定既有瀏覽器與本地驗證。完整證據與失敗歷史見 [本次驗證](docs/evidence/2026-10-23-local.md)。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 本機服務與新訪客，When 完成五步教學，Then CRUD成功且本輪事件完整或清楚提示記錄缺漏。 | passed | Chromium 154 三個五步旅程、各步 server CRUD、正常輪 JSONL/analysis 相符；真實 event/fingerprint 寫入失敗均保留 CRUD 並提示缺漏。[證據](docs/evidence/browser-results.json) |
| AC-02 | Given 設備與操作資料，When 寫入與分析JSONL，Then 只記白名單欄位，且不把fingerprint當身份。 | passed | 遞迴白名單與錯型拒絕；13 Go 頂層測試、8 analyzer 測試、真 Chromium 採集與同輪分析。[證據](docs/evidence/2026-10-23-local.md) |
| AC-03 | Given LOG_DIR與log請求，When 嘗試將日誌置於public內或讀取private資料，Then 不公開觀測檔。 | passed | public/symlink/dangling 目的地 native 回歸；僅六個靜態資產；18 次 HTTP 負向檢查。[證據](docs/evidence/browser-results.json) |
| AC-04 | Given 說明頁與分析用途，When 判讀轉送header及fingerprint，Then 明示來源未驗證、無JA3/JA4且不能分類真人。 | passed | README、實驗頁、analyzer cautions 均明示限制；已核對，未跑 tunnel/PIN。[證據](docs/evidence/2026-10-23-local.md) |

## 現況與缺口

本地 lab 主線 AC-01–04、獨立 T-884 審查及 hosted component/project-success CI 已通過，mainline 標記 complete。程式已提交並開 [PR #533](https://github.com/fallrising/newclear/pull/533)；整合狀態以該 PR 為準，任務板只在實際合併後填 done/end。未建立 usable tag 或部署。UI 隱藏搜尋不得前進，觀測／事件失敗不撤銷成功 CRUD。

原生 test/vet/build、Node analyzer/tutorial、三個真 Chromium 旅程已同版重跑。2026-10-23 owner 安裝 GCC 14.2.0 後，已以 CGO_ENABLED=1 補跑 `go test -race -v ./...` 並通過；先前缺 compiler 的啟動失敗保留為歷史。新增 component CI 仍保留該檢查。歷史 RED 與環境失敗詳見證據，未刪除或當成通過。私人 tunnel/PIN 是額外未驗證路徑，不由本地結果推論。

教學提示只核對 fingerprint/event 收據；requests log 回應後寫入，單獨失敗僅報 server stderr，分析時需核對 CRUD 記錄與 parseErrors。fingerprint 不能推導同一個人，origin HTTP/TLS 不能當原始 browser handshake。

## 啟動與驗證

依 [README](README.md) 在本目錄 `go run .`，使用 `http://127.0.0.1:4173/`。
`PORT`、`LOG_DIR`、`DEMO_RUN_ID` 分別選埠、日誌目錄與本輪標記。
原生檢查是 `go test ./...`、`go vet ./...` 與 `go build`；agent 建置輸出放 `AGENT_BUILD_DIR`。另跑 `node tests/analyzer.test.cjs`、`node tests/tutorial.test.cjs`，瀏覽器入口為 `scripts/verify-browser.cjs`。
[package.json](package.json) 只是Go命令捷徑；服務不需Node，分析器才需Node18+。
[analyze-observations.cjs](analyze-observations.cjs) 讀取本機JSONL；分享證據前排除敏感session資料。

本次實際命令、結果、來源 hash、剩餘缺口與環境失敗均保留在 [驗證紀錄](docs/evidence/2026-10-23-local.md)。

## 可用版本

目前 `usable_tag: none`。
本地 native/race、指定 Chromium 五步旅程、JSONL 對照、錯誤路徑及 hosted CI 已補足。[Component CI](https://github.com/fallrising/newclear/actions/runs/39955826984) 與 [project-success CI](https://github.com/fallrising/newclear/actions/runs/39955826623) 對應已提交產品版本；合併紀錄見 PR #533。
限定local lab即可驗收，不強加身份鑑別能力；若宣稱私人tunnel可用，另補PIN正負向實測。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。

2026-10-23 發布授權更新：owner 明確要求提交本項目、發起 PR 並在必要檢查通過後合併。已從最新 main 建立獨立分支並通過 hosted CI，產品檔案與既有驗收 hash 一致；此授權不含 tag、release 或部署。
