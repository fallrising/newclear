# Authorization collection evidence — 2026-10-28

[AS01–04](../authorization-collection.md)完成固定唯讀採集library、私人profile／snapshot／provenance及合成測試。沿用既有Cloudflare MCP操作端，沒有新增登入流程或產品對credential store的依賴。

## 驗證與獨立審查

共用launcher執行`python3 platform/cloud-lab/tools/check.py`：37 Node＋124 Python＝161tests通過，包含17項新collector測試；無失敗或略過。覆蓋固定SELECT／GET、target綁定、token去重、缺欄位／HTTP及D1失敗、settings／grants／counts漂移、來源時間、未知secret層、私人檔案與不完整輸出。Node既有SQLite experimental warning保留，不視為失敗。

[T827獨立審查](../../../../.team/reports/T-827.md)及一次focused review均接受source／synthetic範圍。初審指出parent fsync失敗時root descriptor可能洩漏；lead新增測試先見RED，再把parent fsync移到root open之前，最終完整回歸通過。Reviewer沒有讀私人資料或獨立驗證真實Cloudflare結果；以下實機證據由lead直接核對。

初始collector stub的16tests／28errors、descriptor leak RED與最終GREEN均保存在共用workspace的AS-red、AS-unit、AS-regression、AS-fd-red及AS-final-regression protected evidence。完整suite保留既有AL、Worker、runner與UI測試；這些產品程式沒有變更。

## 原Lab唯讀採集

2026-10-28T14:51:33Z至14:51:38Z，lead使用已測試／審查的相同source執行一次採集。5次請求全部HTTP200／success：settings GET兩次、固定三個SELECT的D1 POST兩次、明確選定且由兩個機器role共用的service-token GET一次。無retry、API寫入或續權。

- Worker的DB binding匹配所選DB，前後settings及D1投影相等。
- 四個role的grant均已過期；所選Access service token的已知期限也已過期。
- active commands為0，enabled schedules為0。
- HMAC credential及runner stop仍unknown；bot／runner的deadline_complete=false。Human session仍not_evaluated，live_verified=false。
- 私人profile與原始receipts留在repo外；snapshot／provenance／manifest為0600，輸出目錄0700。Lead核對manifest兩個digest、執行source hashes及固定read request receipts。

以上是當時的metadata觀察，不是端到端登入成功、原子snapshot或持續有效保證。Access policy及role→token關係沒有獨立回讀驗證；mapping仍是operator選定。未讀取秘密值或目前runner process，不以舊bundle期限補齊缺口。既有OAuth能完成本次讀取；沒有重新授權或建立API token。

## 範圍與後續

AS01–04 bounded驗收完成；Git合併／CI與任務收尾見[任務板](../tasks/BOARD.md)。本輪沒有續grant／token、secret輪替、服務重啟、Worker部署、Cron、付費方案或清理。主線AC06–08仍pending，無usable tag。

後續需設計當前HMAC與runner期限的可信metadata來源，再準備具體期限與回退步驟的受控輪替方案。AL工具不自動驗證provenance sidecar或套用計畫；採集成功不授權變更期限。
