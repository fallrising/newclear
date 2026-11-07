# M1 首次隔離還原 — 2026-10-27

接續 [首輪真實閉環](m1-first-live.md)／PR #682。Owner 已明確批准先前被自動審批擋下的動作：只匯出新建 Lab D1 到指定的私人持久位置，再還原到另一個未綁定入口的 D1。此次授權不包含既有產品資料庫、付費升級、正式切換、排程啟用或刪除。

本輪完成 **快照還原與已完成／未派送命令對帳**。不是執行中失聯、unknown 恢復或正式故障切換驗收，AC-06～08 維持 pending。

## 實際驗證

| 項目 | 結果 |
| --- | --- |
| 匯出 | 官方 export API 開始後立即 bounded poll，第二次回 complete；signed URL 下載9962 bytes，檔案0600、父目錄0700，file／directory fsync，SHA-256私存 |
| 本機快照 | SQL 載入記憶體 SQLite，integrity_check=ok、foreign_key_check 無違反；不輸出實際 rows／credentials |
| 隔離目的地 | 名稱查無既有資源後建立新 D1，UUID與source不同、read replication disabled；未建立或綁定Worker／hostname |
| 匯入 | 官方 import init→signed PUT→ingest，PUT回傳ETag與原檔MD5一致；ingest回complete。MD5只用於官方傳輸協定，備份另存SHA-256 |
| Schema | 六張應用表與三個具名索引定義，與載入該SQL的本機schema完全一致；只明確排除平台內部 `_cf_KV`，未讀取其內容 |
| 資料 | 六張表逐列canonical JSON比較一致；commands=2、grants=4、nonces=12、schedules=1、firings=0、qualification_probe=1；各表digest私存 |
| 遠端檢查 | D1 `PRAGMA quick_check`=ok；`PRAGMA foreign_key_check`無違反 |
| Journal | 先前的SQLite online backup與目前journal的所有execution rows一致；已完成命令的identity digest、external reference、artifact exact bytes、outcome及開始／完成時間均吻合 |
| 未派送命令 | 快照另有一筆accepted／active=1，attempt、external_ref、result均空，journal無對應紀錄；完整保留，沒有啟動runner或重新採樣 |
| 隔離回讀 | 列出並檢查目前三個Worker的D1 bindings，沒有任何一個指向restore；live Worker仍指向原source DB。Cron空、schedule disabled、firings=0 |

所有SQL、signed URLs、完整request／response與原始資料都留在批准的私人位置，沒有進Git。source DB本輪只做export及readback；沒有用restore覆蓋它。還原DB與備份保留，沒有清理。

## 新發現與保留的失敗

1. 前一輪只知道一筆已完成command，本次快照已有第二筆新accepted命令。初次「active必須為0」斷言失敗，當時還沒建立restore DB；核對後改成明確驗證已完成＋未派送兩種狀態，不忽略或刪除新增命令。備份及journal不是原子跨系統快照，必須以command／immutable identity對帳，不能只比筆數。
2. 首次把 `PRAGMA integrity_check` 放入遠端批次，D1回SQLITE_AUTH；保留失敗。依[官方相容PRAGMA](https://developers.cloudflare.com/d1/sql-api/sql-statements/)改用支援的quick_check與foreign_key_check，均實測通過；沒有將未通過的遠端integrity_check說成成功。
3. 第一次schema比較包含D1自建 `_cf_KV`，與export不一致。依[官方匯入／匯出文件](https://developers.cloudflare.com/d1/best-practices/import-export-data/)確認它是不可查詢的平台保留表；只將該表從**應用schema比較**明示排除，其他表、索引與全部應用rows仍精確比較。
4. 前一輪delayed export poll失敗及自動審批拒絕保留在[前次紀錄](m1-first-live.md)。本輪取得指定動作／目的地的明確批准後才下載，沒有以其他通道繞過拒絕。

## 證據定位與界限

私人順序receipt 037～038記export／下載，039保留原active斷言失敗與新快照分類，040～045記目的地不存在檢查／建立／匯入，046保留拒絕及schema差異，047～048記精確比較與D1檢查，049～055記journal／identity／binding／排程回讀。公開報告不包含實際目標識別資訊。

操作是有界的一次匯出／一次新庫匯入，不是備份排程或正式切換；沒有延長任何grant／Access token。原先24小時窗口仍有效，恢復時須重新查有效期。人機操作、撤權／輪替、執行中／unknown故障恢復、quota與長期觀測仍待驗收。此次沒有runtime source變更，正常89項測試的先前證據不冒稱本輪重跑。

## 審查與文件檢查

[獨立審查T-819](../../../../.team/reports/T-819.md)對限定文件／證據邊界給出ACCEPT；read-only、單次180秒host上限、無cloud／private data存取，沒有把主導的live操作說成reviewer複現。主導已驗證上述private receipts、44專案契約、7 llms、29份文件連結／來源及diff；此次runtime source未變，沒有宣稱重跑本機runtime suite。
