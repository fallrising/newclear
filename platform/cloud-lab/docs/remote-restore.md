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

## 當前結果及可重用流程

[RX實際證據](evidence/m1-remote-restore.md)：owner明確批准後已完成官方export/import、四方完整schema/data對照與三份journal online backup。歷史審批拒絕保留；不再等待同一批准。新D1只保存隔離資料，沒有入口或有效新授權。四Worker bindings回讀無匹配；額外Pages全域清單因缺page.read回403，該盤點未知，不擴權。

1. 保留具體payload／私人目的地／最多一個新D1的批准，fresh查RF來源與inventory；確認grant到期、test token停用、Cron空與schedule關閉。
2. 官方export使用output_format=polling；最多6輪，沿at_bookmark繼續，不重新起任務。signed URL只進私人檔案，下載上限10MiB；0600排他寫入／fsync，保存SHA256與MD5。
3. SQL載入新本機SQLite，integrity／FK檢查；與source每表每欄每列比較，schema只明列排除_cf_KV，不能寬泛略過其他表。
4. 只建立一次新D1，先確認空schema；init→signed PUT→核對ETag→ingest／至多6輪poll。未知回應先對帳，不盲目重建／重上傳／重匯入。
5. 回讀remote restore、source-after、quick_check／FK，四方schema／資料必須相同；expired grants不能重新生成。核對inventory只多一個DB、沒有綁定寫入，回讀Worker settings。
6. 用tests/fixtures/restore_journal.py的SQLite online backup至新檔；比原BLOB rows、source-before/after與main hash。用tools/restore_audit.py比restore commands與backup journals，所有結果必須dispatch_allowed=false；不啟動runner。
7. 保存原始private receipts與redacted evidence；列明權限不足、未測failover／執行對帳與帳單unknown。核對已測source hashes，獨立審查／正常Git交付；不自動清除DB或備份。
