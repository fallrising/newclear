# RX：遠端D1隔離還原與journal對帳

沿owner同意的下一步，使用先前RF專用隔離資料庫及三份原journal；原Lab資料庫、runner、Access與期限不在操作範圍。來源保留兩筆completed與一筆control reconciling／journal started，並非製造新的故障或宣稱目前有程序正在執行。

| AC | 驗收 |
| --- | --- |
| RX-01 | 可測的純對帳器驗command raw body digest、immutable identity、external_ref、原artifact bytes/digest與時間；缺journal、identity不符或舊control快照保守隔離。所有結果dispatch_allowed=false，無管理／執行API。 |
| RX-02 | 唯讀核對RF來源無Cron、schedule disabled、原test token disabled與grants已到期；官方export有界poll、私人下載與hash，再官方import至一個新未綁定D1。來源不寫入，不刪除舊資料。 |
| RX-03 | 比較source前後、匯出SQL載入結果與remote restore完整schema／每表逐列；quick_check／foreign_key_check通過。SQLite online backup保留三份原journal，對帳completed原bytes與時間、unknown仍active1／started，沒有啟動runner或修復歷史。 |
| RX-04 | 本機正反例／完整回歸、真remote receipts、獨立審查與Git交付；分開資料恢復、執行對帳與正式failover，不增加paid方案或續權。 |

本輪最多新增一個D1；不新增Worker、入口、Access、service token、Cron或有效grant。備份只進新的0700私人持久目錄，檔案0600／排他建立／fsync；signed URL與完整資料不進Git。SQL匯入失敗或回應未知先對帳，不能重播、換標籤掩蓋或把source當restore。目的地空庫先確認，匯入後保持未綁定，原expired grants照原樣保存不復活。

源是歷史RF schema（五應用表／三index），不是原Lab目前新增audit schema；比較以實際export為準，不套新版migration。不以本輪證據覆蓋XR六案本機reconcile執行測試；本輪沒有呼叫restore runner，不能宣稱新fence補報或活躍程序切換通過。兩份快照非跨系統原子，皆太舊時無法證明未執行。

官方[Free D1上限](https://developers.cloudflare.com/d1/platform/limits/)與[匯出／匯入限制](https://developers.cloudflare.com/d1/best-practices/import-export-data/)於2026-11-01核對：Free最多10DB；當前唯讀inventory5個，計畫完成後6個。碰到free quota即停止，provider帳單未知不填零；export可能阻擋該DB請求，所以只用已停止接入的RF測試來源。

## 當前執行邊界

[RX部分證據](evidence/m1-remote-restore.md)：對帳器與唯讀來源核對已實作；完整export下載遭自動審批拒絕，等待owner批准敏感payload及私人持久目的地。尚未建立新D1或匯入，也未backup journal；RX-02／03保持未完成。
