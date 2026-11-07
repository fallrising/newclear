# PS：M1輪詢快照順序與恢復

延續已授權ADR-03／08：command row是持久outbox，runner與看板讀完整snapshot，不依賴通知。M0通用Event／source_seq／cursor仍是不同協定，不能把本輪測試冒充事件串流相容驗收或默默刪去原要求。此輪修正M1看板快照倒退，並補F04／F11在現有profile中的具名證據；完整AC-07仍pending。

| AC | 驗收 |
| --- | --- |
| PS-01 | 明列M0事件／通知與ADR-08 snapshot profile的差異；不建立第二套執行權威，不新增Queues或付費服務。 |
| PS-02 | 同scope與目前保留的命令ID，較低revision或同revision不同內容拒絕整批更新；重複snapshot可讀，較高revision的完整snapshot可跨過中間版本。保留原資料但標未確認、停用操作；下次正常輪詢可恢復。 |
| PS-03 | 命令成功commit後丟失HTTP ACK，重新開啟SQLite仍可claim；同key重送不另建工作，原結果／未知以持久資料為準，不宣稱注入未存在的通知通道。 |
| PS-04 | RED/GREEN、完整回歸、真本機browser／workerd、獨立審查與Git交付；不要求owner重測或改live授權。 |

看板只保存目前最多20筆命令的比較基準，不保存無界歷史。scope變動／失去read權限／session401或403清除舊基準；頁面重新載入亦重新建立。列表缺席不表示刪除或執行終止，不能推論未讀到的歷史。revision是command row版本，並非executor source_seq；跳號的完整snapshot不需要重播中間事件，原時間及unknown語義保持。

Worker會在lease到期時把非終局delivery投影為reconciling但不增加DB revision；比較前依原lease與當前server估計時間作同樣投影，避免把合法到期誤判為衝突，也不把未知倒退為執行中。相同版本其他欄位不同則拒絕。不存在通用seq gap buffer、通知服務或cursor recovery；若未來採事件協定，必須另驗原Event去重、gap與snapshot covered-through，不沿用本輪代替。

本輪不部署、不改Worker／runner／D1 schema／授權期限／免費方案。看板source更新與live部署分列；本機驗證不是原Safari或遠端恢復證據。

## 契約對齊與重現

F04在M1的故障點是commit後HTTP ACK遺失：持久command本身可再被poll，不需要傳輸提示才能領取。F11在M1接收的是有revision的完整record：重讀不推導新執行、舊版不覆寫、相同版本矛盾拒絕，下次定時或手動讀取重新對帳。這兩項對映依既有ADR-08；M0 Event服務不是已實作功能，原場景保留待採該協定時驗證。

透過shared launcher執行`python3 platform/cloud-lab/tools/check.py`。真browser沿既有`tools/qualify_dashboard.mjs`與已安裝Chromium／Miniflare，使用短私有task路徑、保存證據；不另裝依賴。實際結果及初次失敗見[PS證據](evidence/m1-snapshot-ordering.md)。
