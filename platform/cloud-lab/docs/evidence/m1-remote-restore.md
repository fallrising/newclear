# RX：還原對帳器與遠端前置核對

目前為 **partial**；[計畫](../remote-restore.md)的RX-01已實作，RX-02／03遠端還原未執行。不是remote restore完成或正式failover證明。

- 純Python工具逐筆核對raw body SHA-256、record／row身份與revision／active、runner immutable identity／external_ref、completed原artifact bytes／digest與原outcome／時間。缺journal、孤立journal、跨快照落後與不一致隔離；started／unknown與reconciling保持未知。輸出所有dispatch_allowed=false，不輸出payload、不寫DB、不呼叫網路／runner。
- RGR：新增測試先因工具不存在RED，實作後16案通過；檢查實際Worker狀態後補dispatching案例並對齊strict integer JSON，最終17案。最終完整回歸138 Node／325 Python＝463 tests通過；既有Node SQLite experimental及Python未關閉SQLite ResourceWarning留在日誌，不隱藏。
- 新鮮管理面唯讀preflight：5個D1；RF來源3commands（2result_recorded／active0、1reconciling／active1）、6grants、32nonces、1disabled schedule且last_due=null、0firings；來源Cron空，原test service token disabled。未以本輪preflight證明所有grant到期，原到期資訊仍屬RF歷史證據。
- 以本輪唯讀source query與三份原journal檢查，得到2completed_preserved、1unknown_preserved，無source／journal寫入。這是現存來源對帳，**不是新目的地還原後對帳**。
- 自動審批拒絕完整D1匯出下載，理由為需明確批准grants／nonces／policy／commands完整payload與本機私人目的地；整段命令未開始，沒有export／create／upload／import／journal backup。已向owner提出具體批准問題，不換路徑或間接執行。

公開[JSON](m1-remote-restore.json)只保留非敏感摘要與source hashes。原始source query／管理面收據存在私人RX目錄；檔案0600、目錄0700，不進Git。只讀本機對帳收據在launcher `RX-current-readonly/preserve/evidence/source-audit.json`；RED與早期GREEN在`RX-red`／`RX-green`，最終fullsuite在`RX-final-full/preserve/evidence`。

沒有新Worker、入口、Access、有效grant、Cron、付費升級或原Lab變更；DB仍5個。沒有新版部署、runner執行、fence補報、原子跨系統快照或完整主線驗收。兩個同樣太舊的快照仍不能證明未發生後續執行。對帳器不重新判定health／schema／時效，也不接受它作為執行授權。歷史XR六案runner執行證據保持獨立。

T863獨立唯讀審查ACCEPT本輪對帳器與partial證據描述；主導接受RX-01 source/local，遠端RX02／03未通過。52project contracts／9llms索引／432relative links／diff檢查通過，69個runtime/tool/test/recipe檔案凍結；正常Git CI／merge／readback另記任務板。
