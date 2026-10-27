# M1 resident runner

Owner 指示繼續開發；本輪將既有固定唯讀 node-health runner 交給 Linux user service 常駐。Python 3.11 標準庫；沿用同一私人設定、journal、Access／HMAC grant，沒有新的執行能力。

## 範圍與驗收

| ID | 可驗收行為 | 驗證 |
| --- | --- | --- |
| RR-01 | 同一 canonical journal 只有一個 CLI runner；程序退出釋放鎖，保留 journal 與鎖檔 | 真實子程序競爭／退出後重新取得 |
| RR-02 | 正常每30秒輪詢；暫時性傳輸／408、409、429、5xx錯誤退避至最多120秒；成功後重設；401／403與協定、journal錯誤停止 | HTTP 邊界與可控時間測試 |
| RR-03 | 常駐必須指定 UTC stop-at；不在截止後開始新 cycle；SIGTERM／SIGINT中斷等待並關閉 journal | 期限測試與真實程序訊號 |
| RR-04 | 重啟沿用 journal；已完成結果原樣重報，started未知不重採集 | journal／斷線回報回歸 |
| RR-05 | 指定主機服務自動拾取一筆新健康檢查；重啟後既有 journal不變；入口受保護且CF排程保持停用 | 私人實機證據；未執行前保持pending |

不新增付費方案、Cloudflare Cron、Queues、Grok、任意 shell、grant續期或舊專案封存。完整 AC-06～08 仍待驗收。30秒空閒輪詢約2880次claim／日，另有回報／看板請求；這是請求量估算，不是帳單或免費額度保證。

## 操作契約

常駐命令使用 `runner.py --config /private/runner.json --stop-at 2030-01-01T00:00:00Z`；範例日期必須替換為所有必要 grant／Access token 最早到期時間，不能靠未驗證的新日期延長授權。`--once`仍可用；所有CLI模式都取得journal旁的`.lock`，直接匯入Runner類別的工具需自行避免競爭。私人設定／journal所在目錄只允許owner存取，不能用硬連結別名啟動同一journal。

預設輪詢30秒，可用`--poll-seconds`設定5～60秒。退避會延遲拾取，短命令可能依原deadline到期；runner不刷新期限。到stop-at時不再啟動cycle；正在進行的固定採集／回報會完成，HTTP每次timeout5秒，這不是硬截止或任意阻塞I/O的超時保證。啟動時把截止時間轉為monotonic上限，時鐘向後調整不延長本次執行窗口。

參考unit見adapter內的`cloud-lab-runner.service.example`。填入私人絕對路徑及到期時間後，先`systemd-analyze --user verify`，再安裝成user service。`Restart=on-abnormal`僅處理意外訊號退出；授權拒絕／協定錯誤／期限正常停止不重啟。日誌只有固定事件及時間／等待秒數，不輸出URL、憑證、request或exception內容。更換版本先停止服務；單次人工執行也必須先停服務。不要刪除lock檔或清空journal來繞過錯誤。

停用／回退：停止user service，保留現有journal，回到已驗證的上一版程式；不得並行執行舊版未持鎖runner。啟用user service不等於登入前／登出後持續執行，必須另驗證user manager與linger；本輪不默認修改主機linger政策。

RR-01～05已完成本輪有界驗證；詳見[98項測試、獨立審查與實機證據](evidence/m1-resident.md)。登入前／登出後持續運作、強制中斷與完整主線驗收仍待完成。
