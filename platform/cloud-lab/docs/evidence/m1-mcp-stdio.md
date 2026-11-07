# MCP stdio tools — MT01–04

本輪交付本機固定MCP入口；不呼叫Grok模型、不寫入Kith／既有host設定、不續權／部署或新增付費。沿用BC資料與授權邊界，HL資產session500仍獨立未完成。

| AC | 實作與證據 | 狀態 |
| --- | --- | --- |
| MT-01 | 2025-11-25版本協商、initialize/initialized/ping/list/call、16KiB frame、通知不執行工作 | 本機通過 |
| MT-02 | 固定兩工具及UUID、預設只status、trusted CLI config/state/submitflag、每session一秒一次 | 本機通過 |
| MT-03 | 固定argv、15秒wait及8KiB stdout、過大／錯誤／identity drift去敏、子程序回收、未知保留ID | 本機通過 |
| MT-04 | RGR、實際stdio／HTTP／OS collector／撤權閉環、完整回歸與獨立審查 | 本機及獨立審查通過；Git結果見任務板 |

## 已執行

共用launcher的MT-red對實作stub執行13tests，1failure／28subtest errors；MT-green完成後13tests通過。MT-integration擴充至16Python tests，加1個Node真實stdio／HTTP案例全部通過；沒有skip。測試以臨時可信child測timeout／輸出與SIGTERM，不提供runtime自選shell或child入口。

整合案例：MCP initialize/list→check→真正Worker SQLite接受POST→在回ACK前延遲→MCP等待到期殺child並回unconfirmed→重啟server保留同state／ID→status不POST且不聯網→check重送原bytes回同command ID→原Python OS collector執行→status validated→bot grant撤銷→denied及health=null。全程只有一筆業務命令；isError與內容投影一致，stdout無secret/config/scope。每次重啟的MCP連線也驗證ping與EOF正常退出。

Fixture只忽略合成state外層的launcher Git metadata，以及在真實POST回應後注入延遲；沒有mock命令完成／健康終態或放寬產品權限。另一項測試直接啟動production MCP CLI，確認無效private config只回穩定工具錯誤、session仍可ping。SIGTERM測試確認活躍child被回收；timeout測試同樣驗證PID不再存在。

## 限制

這是自製合成MCP工具host協議驗證，不等於官方SDK相容性測試或Grok端接線。未跑真實模型、live bot授權、遠端Access、Cloudflare部署或新增瀏覽器測試。採標準庫Python3.11相容API；本機Python3.13.5、Node24.14.0，未跑Python3.11。

每session速率限制不跨重啟；host仍需有全域呼叫政策。串行stdio不承諾即時MCP取消已接受命令；停程序不等於撤銷遠端工作。partial輸入仍依host管理stdin生命週期，16KiB是記憶體／frame上限，不是idle deadline。子程序期限不保證不可中斷kernel I/O的硬即時上限。沒有自動state清理或備份，同OS使用者不構成sandbox。

MT-regression透過共用launcher執行`python3 platform/cloud-lab/tools/check.py`：**300tests（62Node＋238Python）全通過，零failure／skip**，包含既有BC／授權／runner／排程／看板回歸。本輪未修改既有runtime檔案，新入口重用BC；新測試16Python及1Node，原283項保持通過。

[T839獨立審查](../../../../.team/reports/T-839.md)ACCEPT，無必修問題；只讀source及62Node／238Python完整log，沒有自行重跑或碰private/live。主導已檢查實際diff與輸出，evidence gate接受MT01–04 source/local。可選後續增加child帶descendant的群組清理測試，現有直接child timeout／SIGTERM已通過。文件／索引／task／report／diff檢查與Git交付結果分別記錄，不以merge宣稱真實Grok或完整主線已完成。
