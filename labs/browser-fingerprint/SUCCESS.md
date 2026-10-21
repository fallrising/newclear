---
project: labs/browser-fingerprint
purpose: 觀測瀏覽器設備訊號與任務操作事件以比較測試環境
kind: lab
mainline: incomplete
usable_tag: none
reviewed: 2026-10-21
source_commit: b97319d74f8442b5173ef42be72a0aa757d87df0
---

# browser-fingerprint 成功契約

## 主線與範圍

[Daylight README](README.md) 定義繁體中文任務工作台、Go記憶體CRUD與本機JSONL觀測。
主線是新增→編輯→完成→搜尋→刪除，核對本輪設備與事件是否完整記錄。
指紋是實驗摘要，sample是操作者標記；兩者都不能證明個人身分或真人／AI。
任務資料重啟後回六個seed，未承諾永久任務儲存或生產多租戶。
Quick Tunnel為可選外部測試路徑，私人PIN流程尚無實測。

## 驗收條件

passed 僅表示本次已核對的靜態條件；historical 表示具日期的既有結果。
沒有 runtime 重跑的項目不以文件檢查代替；pending／failed 保留原缺口。

| AC ID | Given／When／Then | 狀態 | 證據或缺口 |
| --- | --- | --- | --- |
| AC-01 | Given 本機服務與新訪客，When 完成五步教學，Then CRUD成功且本輪事件完整或清楚提示記錄缺漏。 | pending | [main.go](main.go)、[public](public/) 有實作；缺指定瀏覽器的完整操作／日誌對照證據。 |
| AC-02 | Given 設備與操作資料，When 寫入與分析JSONL，Then 只記白名單欄位，且不把fingerprint當身份。 | pending | [fingerprint.go](fingerprint.go)、[tests](main_test.go) 與README；本次未重跑測試或真瀏覽器採集。 |
| AC-03 | Given LOG_DIR與log請求，When 嘗試將日誌置於public內或讀取private資料，Then 不公開觀測檔。 | pending | [main.go](main.go) 有validateLogDestination；需當前native回歸與HTTP負向證據。 |
| AC-04 | Given 說明頁與分析用途，When 判讀轉送header及fingerprint，Then 明示來源未驗證、無JA3/JA4且不能分類真人。 | passed | [README](README.md) 的觀測限制；本次已核對。 |

## 現況與缺口

不是空殼：Go server、UI、CRUD、JSONL與分析器均已存在。
本次沒有可引用的完整瀏覽器旅程重跑結果，因此主線保持incomplete。
失敗的log寫入不能讓已成功的CRUD被誤報成取消；驗收應同時檢查資料與提示。
Cloudflare只暴露origin轉接層，不能把其HTTP/TLS資料當瀏覽器原始handshake。
私人tunnel登入是額外未驗證路徑，不能由本地CRUD測試推論。

分析器只能比較這些觀測欄位，不能由相同摘要推導同一個人。

## 啟動與驗證

依 [README](README.md) 在本目錄 `go run .`，使用 `http://127.0.0.1:4173/`。
`PORT`、`LOG_DIR`、`DEMO_RUN_ID` 分別選埠、日誌目錄與本輪標記。
原生檢查是 `go test ./...`、`go vet ./...` 與 `go build -o .runtime/daylight-server .`。
[package.json](package.json) 只是Go命令捷徑；服務不需Node，分析器才需Node18+。
[analyze-observations.cjs](analyze-observations.cjs) 讀取本機JSONL；分享證據前排除敏感session資料。

本次只核對文件、入口與證據，未執行產品建置、服務或外部整合。
歷史結果的範圍、來源與未執行項均須隨交接保留。

## 可用版本

目前 `usable_tag: none`。
須補當前native檢查與指定瀏覽器五步旅程、JSONL對照及錯誤路徑證據。
限定local lab即可驗收，不強加身份鑑別能力；若宣稱私人tunnel可用，另補PIN正負向實測。

後續標記須綁已合併的目標 SHA、必要 CI／審查及該範圍核心流程證據。
沿用歷史結果前須比較其後程式與設定差異，相關改動要補驗。
