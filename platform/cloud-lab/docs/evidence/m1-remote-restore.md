# RX：遠端隔離還原與journal對帳

本輪**遠端資料還原已驗證**。先前PR925／927交付純對帳器與來源核對；自動審批曾在執行前拒絕完整敏感export下載，owner隨後明確批准payload、私人保存位置及一個新未綁定D1，才開始本輪操作。拒絕與批准收據均保留，沒有繞路執行。

| AC | 實際結果 |
| --- | --- |
| RX-01 | 純Python對帳器已在PR925交付。17focused cases；138Node／325Python＝463tests、T863獨立ACCEPT。此次69個runtime/tool/test/recipe inputs與原測試版本hash完全相同，未重跑完整suite或部署新版程式。 |
| RX-02 | 新鮮preflight確認6grants全部已到期、test token disabled、Cron空、schedule disabled／last_due=null、0firings。官方export兩次poll、16454bytes SQL私人下載；SHA256／本機SQLite integrity及foreign keys通過。新增一個空D1、一次signed PUT（ETag匹配MD5）、一次ingest即complete。D1清單5→6，其他5個ID保留。 |
| RX-03 | source-before、export SQL載入、remote restore、source-after四者應用schema與全部欄位／資料列一致：5tables、3explicit indexes、6implicit indexes。6grants／3commands／32nonces／1schedule／0firings共42列。唯一schema排除為平台`_cf_KV`。remote quick_check=ok、foreign_key_check零違規；3份原journal經SQLite online backup，schema／原BLOB欄位與來源逐列相等，source main bytes未改。 |
| RX-04 | 真remote收據與redacted摘要保存；T864獨立公開證據審查、文件／Git CI與merge-readback另記任務板。完整mainline仍incomplete，不建立usable tag。 |

### 原成果與未知狀態

還原資料與備份journal經同一純對帳器驗證：2completed_preserved，原artifact精確bytes／SHA256、owner_outcome、started_at／finished_at均吻合；1unknown_preserved，控制面仍reconciling／active1，journal仍started／result=null。所有dispatch_allowed=false。沒有啟動runner、重收集、fence補報、解鎖槽或重寫歷史。

匯入完成時間為2026-11-01T14:55:43.450360+00:00；逐列／journal對帳時間2026-11-01T14:57:28.561236+00:00。來源不套新版migration，還原的是歷史RF五表schema；不是原Lab目前的rejection-audit schema。expired grants照原樣還原，未續權。

### 收據與操作邊界

[公開JSON](m1-remote-restore.json)包含aggregate hashes、列數與非敏感結果。私有RX目錄內SQL／SQLite／API收據均0600、目錄0700、排他建立與fsync；signed URLs、完整payload、資源ID不進Git。105preflight、106export、107filehash、109export-equality、110create／112empty、113init／115upload／116ingest、118restore／119checks／120source-after、124bindings／125unbound、126journal／127audit／128equality／129boundary／130journal-schema是本輪收據序列。

主導已核對實際private收據；`RX-remote-audit/preserve/evidence/remote-audit.json`為可審查摘要，`RX-execute-inputs/preserve/evidence/inputs.json`保留69inputs相等。歷史RED缺module／16GREEN、最終17cases與463suite在RX-red／RX-green／RX-final-full；原Node experimental與Python SQLite ResourceWarnings均保留。

本輪管理寫入只有新D1建立與其官方import，所有query均唯讀。四個現存Worker settings皆不含新D1綁定；未修改任何Worker／Access／Cron／Pages設定，也未建立入口。額外Pages全域清單GET回403，因缺page.read；未重試、未reconnect／擴權，**Pages全域盤點不可聲稱已驗證**。新D1建立不含綁定且本輪沒有綁定操作，Worker面亦已回讀確認。

### 限制

這是歷史RF資料的實際遠端恢復及唯讀journal對帳。不是活躍程序failover、跨系統原子快照、新fence補報或當前健康重判；兩份同樣過舊的快照不能證明沒有後續執行。XR六案真本機workerd／runner執行證據仍獨立。沒有原Lab寫入、付費升級或授權延長；provider實際用量／帳單仍unknown，不能填零。

T864獨立公開證據審查ACCEPT本輪RX02／03資料還原，主導核對private receipts後接受；Pages盤點限制保留，不要求擴權。52project contracts／9llms索引／436relative links／9private-literals無命中及diff檢查通過；Git CI／merge／回讀證據見任務板。
