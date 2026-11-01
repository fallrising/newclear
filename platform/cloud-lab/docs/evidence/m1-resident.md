# M1 resident runner evidence — 2026-10-27

範圍是[RR-01～05](../resident-runner.md)，屬 T-0003-4／AC-06～08 的有界子集，不是完整 M1、登出／重開機或中斷副作用恢復驗收。

## 本機與審查

- RED：新增測試在原runner缺少InstanceLock、resident_loop、錯誤分類與新CLI參數時，出現8 errors／1 failure；修正後完整 suite 為31 Node＋67 Python＝98 tests，全部通過。新增9項涵蓋真實HTTP分類、跨程序鎖、symlink拒絕、SIGTERM、期限及退避政策；既有journal重報／started未知測試保持通過。
- 實作只改Python runner生命週期，沒有修改Worker、D1 schema或授權契約。非暫時性錯誤停止；暫時性錯誤退避；常駐要求明確stop-at；既有once也使用journal鎖。
- [T-820獨立審查](../../../../.team/reports/T-820.md)：初輪無程式阻擋，但找不到完整測試日誌，REWORK。提供確切的保護證據路徑後，唯一一次後續審查確認31／67結果，ACCEPT。原始缺口與本機wrapper語法錯誤保留；wrapper失敗發生於模型呼叫前。
- 私人生成的user unit通過 `systemd-analyze --user verify`；單一服務啟動為active/running，NRestarts=0。`Restart=on-abnormal`、SIGTERM與固定授權期限均保留，未修改linger。

## 實機證據

Private receipts056～065保存完整請求／回覆、來源hash、unit驗證、journal列與服務狀態；公開只列可重現的判定，不貼目標或憑證。

1. 啟動前讀取原D1與journal：一筆完成、一筆早已超過dispatch deadline的accepted命令；schedule disabled、firings0。
2. 服務使用現有私人config及原journal，沒有搬移或初始化空journal。原accepted任務經正常claim標為expired_before_dispatch；其attempt/result仍null，沒有journal列。
3. live probe提交一筆新的固定唯讀健康檢查，服務自行領取並回報。probe的匿名入口限制、授權bootstrap、命令讀取與新鮮結果驗證全部通過，execution=validated。
4. 新命令後journal新增一筆completed，所有原列原樣保留。正常systemd restart後服務active/running，journal逐列完全相同。
5. D1回讀3筆命令、active0：2筆result_recorded、1筆expired_before_dispatch。兩筆完成命令的immutable identity digest、external_ref、artifact完整字串與開始／完成時間均與journal相等，validation=passed。
6. Cloudflare Cron仍空，內部schedule enabled=0、firings=0。服務未延長任何grant、未新增雲端資源、未升級付費方案。

保留的操作修正：第一次只讀SQL誤用command_id欄位被D1拒絕，按既有id／record／body schema修正。最後artifact比較最初誤當物件，實際是字串；修正後只比對已保存receipt，不重播服務重啟、提交或雲端操作。這兩次是驗證腳本錯誤，不是通過的檢查。

## 限制與下一步

RR-01～05在上述範圍通過。服務只沿用目前短期授權，於最早grant到期時停止；沒有自動續權。主機linger未啟用，因此登入前／登出後持續運作及重開機尚未驗證；只有短時間運作與一次正常重啟證據。SIGINT與執行中強制中斷沒有專項實機證據。網路退避有本機HTTP／政策測試，沒有實機斷網演練。

下一個有界任務：在隔離環境注入「採集開始後中斷」及「完成後回報遺失」，驗證started→unknown不重做、completed原樣重報，以及控制面與journal對帳。再補human/mobile、撤權／配額與長時間觀察，才評估啟用定時調度。完整AC-06～08保持pending，mainline=incomplete，usable_tag=none。費用限制仍是owner確認Workers Free／零新增付費，不冒稱已讀取帳單或保證免費額度不超限。
