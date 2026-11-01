# XR：跨快照隔離還原證據

範圍：[XR01–04](../restore-qualification.md)、T-0035；2026-11-01完成source/local qualification。實際使用既有Miniflare 5.20261019.2-beta的workerd/D1、真Python runner子程序與SQLite online backup。不是mock runner，不是遠端export/import或正式failover；完整mainline仍incomplete。

## 六種實際情境

| 情境 | 恢復後結果 |
| --- | --- |
| started後子程序終止 | 新reconcile_only fence，保留started journal，control unknown／active1。 |
| 明確unknown | 原unknown journal保持，control仍reconciling／active1。 |
| completed但回報未到達 | 回傳原artifact bytes／SHA256及原started_at／finished_at，result_recorded／active0。 |
| 較舊journal缺row | D1已有attempt，只記unknown且active1；獨立計算identity一致，不重新採集。 |
| identity不一致 | runner非零退出且沒有回報；目的地journal保持，control active1／result null。 |
| 較舊accepted D1／較新completed journal | 無dispatch權限，claim403 SCOPE_DENIED；命令整列與journal保持，不自動補attempt。 |

六案source各採集一次、restore均零次；source完整應用schema／所有列及journal保持。除accepted-control沒有領取外，均驗新fence、原external_ref、舊fence409與稽核request_id對帳。完整還原先驗六表／四index、逐列相等、quick_check與foreign_key_check；再另記目的地撤submit、reconcile/report-only及schedule停用的quarantine。兩個D1 binding／持久目錄不同。

[原始工具產生的摘要](m1-restore-qualification-workerd.json)逐byte複製，含六案及九個來源SHA256。原snapshot、journal、子程序log和完整artifact只保存在受保護的launcher evidence，不公開主機採集內容。

## 驗證及失敗紀錄

- WAL online-backup測試：先以未實作stub得到4個NotImplementedError（RED），實作後4passed。真開啟WAL、關閉autocheckpoint、已提交row及BLOB原bytes、目的地0600與重開獨立性；拒絕既存／symlink目標、缺source不建立檔案。
- 完整回歸：130 Node＋308 Python＝438 tests，零失敗／skip；Node24.14.0／Python3.13.5。既有SQLite ResourceWarning及Node experimental warning保留。
- XR1初次workerd失敗：11 != 10，沒有completed case；本機D1自建_cf_METADATA被錯算為應用表。核對已安裝Miniflare explorer的明示排除後，只加該平台表與既有_cf_KV排除；不讀metadata內容、不排除整類未知表、不放寬應用逐列比較。XR2六案全過。
- XM1隔離副本移除runner的dispatch模式判斷：missing-journal真的再次採集，qualifier以「restoration must never call the collector」拒絕，退出1；mutation被偵測，原產品runner hash未變。
- XM2隔離副本略過identity比較：mismatch錯誤地退出0，qualifier要求拒絕而失敗／退出1；mutation被偵測，原產品runner hash未變。
- T860首輪REWORK指出XR1尚無完成證據；修正後以XR2、XM1／XM2及438tests提交一次集中複審。最終獨立審查ACCEPT，九份hash及公開摘要逐byte核對；Git／CI狀態見任務板與team report。

受保護證據任務：XR-red、XR-green、XR-full；短路徑workspace中的XR1、XR2、XM1、XM2。命令、失敗收據與detected.json均保留；不自動刪除。產品Worker／auth／protocol／migrations／runner／看板未改，只有qualification工具、fixture及四個測試。

## 限制與接續

本輪只證明合成source/local條件下的隔離恢復。舊grant不得作為正式現行授權；兩份快照不原子，皆過舊而遺失同一execution時不能證明從未執行。accepted-control保守拒絕，沒有自動修復或切換介面。官方遠端unknown/in-flight export/import與完整failover另須方案及驗證。

沒有連線或變更原服務、D1、Access、secrets、授權期限、runner或付費方案；沒有真人／手機重測。Provider用量／帳單未知仍未知。接續對齊事件seq／通知原契約與現有輪詢模式，並保留F14遠端恢復缺口。

文件gate：50個success contracts、8份llms索引、task/report格式、qualifier語法、staged diff及397個相對連結通過；67份runtime/test/tool inputs固定，九份XR來源相符，產品runtime對baseline未變。首次索引檢查在新文件尚未git add時報兩個連結不存在；納入index後重驗8份零錯誤，原失敗log保留，未改validator。
