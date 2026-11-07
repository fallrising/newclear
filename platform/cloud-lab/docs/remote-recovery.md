# M1 remote isolated recovery and revocation

Owner批准接續遠端隔離故障及撤權驗收。本輪沿用codex-team-delivery：先完成可審閱工具／測試，再在新建的短期隔離Worker、D1及Access入口演練；不更動原Lab或其他產品。Python3.11標準庫，既有Worker／migration／runner原樣部署，產品不加入fault hooks。

| AC | 驗收 |
| --- | --- |
| RF-01 | 新Worker／D1／精確hostname／Access app與短期獨立token，workers.dev及preview關閉，Cron／內部schedule關閉；核對不覆寫既有資源 |
| RF-02 | 真實CF上回報送達前遺失、保存後ACK遺失、started後程序中斷；重啟不重新採集，已完成結果精確補報，unknown保持未解決 |
| RF-03 | 撤銷僅本次測試submit／runner grants，原身份HTTP403；獨立有效且無dispatch能力的reconciler只取reconcile_only並補報原結果；不得復活舊grant |
| RF-04 | 停用僅本次Access service token後，新請求被拒；保留隔離證據與unknown，不刪DB或放寬入口；驗證原資源binding／排程不變 |

成本上限是Workers Free／零新增付費，不升級；遇到配額即停止。最多新增一組Worker／D1／Access app／service token；grant有效窗口不超過2小時，且早於token到期。此授權不延長原常駐runner的grant、不啟用linger或排程。對帳、撤權與故障只在本次新資源執行；一切真實ID、域名、密鑰、設定及完整receipt保存私人持久目錄。

撤權測試分層：D1 Lab grant撤銷不等於Access token撤銷；Access token停用不等於已驗證所有瀏覽器session撤銷。中斷只終止本次建立的測試子程序，不模擬整台主機斷電。手機、quota耗盡、長期觀察及完整AC-06～08仍待驗收。

狀態：RF-01～04遠端子集已通過；[115項測試、三個真實CF案例及撤權證據](evidence/m1-remote-recovery.md)。完整主線仍未完成。

## 工具與執行邊界

`tools/remote_recovery.py`是供可信私人operator載入的函式庫，沒有部署／撤權API。`run_case(profile, evidence, after_fault=None)`每次只跑before、after或started之一。profile必須明示isolated=true，workspace以recovery-開頭；四個角色observer／submitter／runner／reconciler必須有相同HTTPS origin、audience及resource／recipe scope，runner與reconciler不能共用credential ID。先由observer驗證bootstrap與既有命令數，且既有命令全為terminal，再提交新命令。

證據目錄必須在Git外，父目錄由owner持有且不可group/world寫入；新目錄／檔案排他建立，保留intent、admission、故障及恢復快照。工具不接受既有journal，測試runner及reconciler共享此次新建journal。loopback代理只接兩條runner POST路徑，body≤32768bytes、最多8requests；HTTPS固定origin／路徑，不跟redirect，不使用環境proxy。每個遠端請求有6秒總期限，逾時中止已連線socket，不自動重連或重送。子程序回收及代理關閉有界；operator仍以外層host timeout包住整次演練。

after_fault hook由operator私下提供，僅用於已批准的新測試grant撤銷；函式庫本身不持有provider管理權限。hook失敗就保留失敗證據，不重播撤權或命令。before案例在本地completed持久化後撤銷原submit／runner grants，再以獨立reconciler原樣補報。after與started案例使用另一組尚有效的測試角色。最後只停用本次Access token，完整API／D1及入口readback均留私人receipt。

此隔離Worker只用機器API，未部署ASSETS／human入口；不把這次通過當成手機或看板驗收。已有live服務不使用這組設定。
