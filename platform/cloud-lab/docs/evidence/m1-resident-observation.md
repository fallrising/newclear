# Resident observation evidence — 2026-10-28

[RO01–04](../resident-observation.md)完成Linux私人Unix socket即時觀測、runner CLI與來源驗證。這是source與隔離本機程序驗證；沒有讀取或重啟原Lab服務、沒有雲端請求、續權或部署。

## 驗證

共用launcher執行`python3 platform/cloud-lab/tools/check.py`：41Node＋151Python＝192tests通過，含16個新observation tests，無失敗或略過。

- 真實resident子程序透過合成loopback控制面常駐，觀測取得它實際採用的stop-at；kernel SO_PEERCRED、boot／start及fdinfo FLOCK吻合。
- SIGTERM正常退出移除自己的socket，查詢失敗；重啟沿用原journal inode，新的resident可重新觀測。
- SIGKILL留下socket；觀測不會通過，下次啟動也拒絕覆寫原socket inode。測試僅清理自己建立的fixture，不處理既有私人狀態。
- 已載入config與目前config digest不一致、查詢中設定改變、lock路徑被替換、錯challenge、模擬PID／start／boot identity不一致、過舊response及released lock均拒絕。這不是實際重開機或強迫kernel PID重用實驗。
- 既有路徑／symlink／非0700parent拒絕；正常socket0600。結束時若原socket被另一inode取代，replacement保留。
- observer CLI不建Runner／Journal；只讀既有lock與kernel資訊，不取得journal lock或dispatch。stdout不含secret、config path、PID、boot或digest。
- 緩慢未完成challenge在0.5秒server期限內關閉，後續正常觀測仍可用；trickle response的總讀取期限不會因收到一小段資料而刷新。
- 模擬較遠的wall stop-at與較短monotonic剩餘窗口，輸出採較早的保守期限。既有resident反向時鐘、訊號、重試及journal測試也保留在完整suite。

[T829獨立審查](../../../../.team/reports/T-829.md)ACCEPT，檢查source與lead產生的logs；未獨立執行測試或讀取原Lab狀態。Lead另核對diff與交付範圍。

## 原始失敗與限制

RO-red初始9tests以2failures／7errors失敗，原因是新CLI參數／API尚未實作；RO-unit第一輪9項通過，新增負向案例後RO-regression完整191GREEN。RED與回歸log保存在共用workspace相應task的protected evidence。Node SQLite experimental warning與既有Python測試unclosed SQLite ResourceWarning保留，不宣稱warning-free。

私人Unix socket只提供當時程序／設定／鎖的觀察，不是health、HMAC／Access有效性或未來持續運行保證。stop-at是停止新cycle准入，不是硬中斷正在進行的工作。觀測仍deadline_complete=false；同UID／root可修改程式與狀態，不能當作對惡意owner的attestation。/proc與同PID namespace是必要條件，缺失時拒絕。

## 交付與後續

[任務板](../tasks/BOARD.md)記錄Git／CI／合併回讀。本輪不改Worker／D1／Access、不啟用排程、不新增付費方案，沒有原服務安裝或重啟。SA self endpoint及本輪resident觀測都仍待實際部署；AS／AL沒有自動合併新來源。下一步是將有來源時間與identity證據的授權資訊整合，然後準備明確期限與回讀／回退的切換計畫。完整AC06–08保持pending，無usable tag。


Lead在初次ACCEPT後補查可選nofollow chmod平台支援，新增模擬該能力不存在的測試；RO-chmod-red以NotImplementedError失敗。改成O_PATH／O_NOFOLLOW固定socket inode後透過proc fd設定權限，RO-final-regression完整192GREEN。這是Python3.13上的可選功能缺失模擬；未執行Python3.11，沒有宣稱跨版本實測。最終文件與索引檢查使用新數字，原191GREEN仍保留為歷史紀錄。


Git交付尚未完成：feature commit已在本機，第一次SSH推送未完成，過早建立PR返回422 invalid head且未建立PR。確認遠端分支尚不存在後，只停止本次SSH子程序；Git退出128。帶連線期限的重試在啟動前被自動批准審查拒絕，原因是審查要求明確批准此次Git push。沒有替代推送或繞過CI／批准；等owner批准具體分支交付，任務列仍in_progress，不宣稱已合併或CI通過。

2026-10-28T17:04:03Z owner回覆「批准推送」，解除上述Git批准阻擋，恢復具體分支的正常push／PR／CI／merge與任務板收尾。保留原失敗與拒絕紀錄；此批准不涵蓋雲端部署或授權延長，實際Git結果見任務板。
