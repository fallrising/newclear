# M1 service runner evidence — SR01–04

2026-10-29；本輪依 owner 批准開發常態runner服務模式，契約見[SR](../service-runner.md)。只改公開source／合成測試／文件，不改真實Worker、D1、Access、憑證、期限、user service或付費方案；沒有自然到期的live驗證。

## 實作與本機證據

- SR01：嚴格0600／owner／single-link／no-follow／32KiB政策讀取，config canonical digest綁定；未知欄位、錯誤schema、重複key、錯誤時間、缺Access、漂移與互斥CLI模式拒絕。
- SR02：一次authenticated self query；四層最早期限、查詢耗時、server clock ahead、牆鐘倒退及monotonic上限。過期本機政策不發self；查詢用掉窗口不開journal；重啟不重置期限。
- SR03：claim／journal commit跨截止不採集，unknown保持；既有完成結果在停止准入後仍可回報。真實子程序／loopbackHTTP驗證SIGTERM退出、同一journal inode及結果重報、started未知不重採集、自然**本機政策**到期、相同政策過期後不能重啟、startup403不開journal、claim403無retry。
- SR04：`SR-regression`完整check.py通過42Node＋192Python＝234tests；Node24.14.0／Python3.13，Python3.11目前沒有可用執行檔，未實測。Node實驗性SQLite及既有Python SQLite ResourceWarning保留。其後新增服務socket實際觀測／清理assertions，`SR-observation-check`20tests通過。

## RED與失敗紀錄

`SR-red`先證明缺service介面／admission callback，1failure／23errors；當時重複繼承既有runner tests，後改只共用fixture，不重複計數。`SR-green`的backwards-clock fixture落在grant not_before之前而被正確拒絕，修正fixture開始時間後通過。`SR-local`四個loopback案例被sandbox禁止建立socket；正常提權執行`SR-local-sockets`後只剩unknown artifact fixture預期錯誤（協定用null，不是省略），修正assertion後完整回歸通過。沒有忽略錯誤或修改產品協定配合fixture。

## 獨立審查修正與最終驗證

T833初審REWORK指出server clock ahead只約束HMAC／grant，未約束service_until／Access。`SR-skew-red`實際重現四個subcase失敗；改為四層最早截止一律使用較保守的server／local時間，再扣除查詢耗時。`SR-final-regression`完整42Node＋194Python＝236tests通過，含新增的兩種政策期限最早／已在server時間到期負向案例；T833獨立複審ACCEPT，主導核對diff及原始測試輸出後接受本輪source／local範圍。

索引、project-success、Cloud Lab範圍／連結與T833 task validator通過。`SR-doc-checks`的systemd unit驗證被sandbox的SO_PASSCRED禁止；`SR-unit-verify`經正常提權只讀驗證同一合成unit通過，沒有安裝／啟動服務。最終文件／report gate與Git交付結果記於任務板及交付紀錄。

## 範圍與剩餘驗收

本機HTTP self payload是合成fixture；既有Node整合另驗真實Worker程式／HTTP／SQLite／HMAC，兩者不冒充Cloudflare上線證據。Access期限來自operator明確填入的私人政策，不是self推導；每次claim/report仍經伺服器授權。模板不等於已安裝服務，完整主線AC06–08仍pending、無usable tag。常態live期限／用量設定、真人Access、排程／配額及完整故障矩陣仍待接續。
