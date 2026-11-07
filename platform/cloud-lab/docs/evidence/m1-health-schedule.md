# Low-frequency health schedule — HS01–04

Owner確認開發[HS01–04](../health-schedule.md)。本輪是source／本機測試；未部署Worker、更新任何grant、啟用Cloudflare Cron或修改正在運行的七日runner。

| AC | 實作／證據 | 狀態 |
| --- | --- | --- |
| HS-01 | 四欄policy、UTC起始分鐘、15／60／1440分鐘、最多7日、revision／grant／dispatch護欄、去重／overlap／rollback | 本機通過 |
| HS-02 | 有scope的唯讀排程snapshot、持久firing關聯、最近完成結果、bounded response、cron_verified=false | 本機通過 |
| HS-03 | 看板政策／next slot／最近觸發與觀測、30秒stale、session清除及顯式恢復 | 單元／真實瀏覽器通過 |
| HS-04 | Red-Green、真實HTTP Python閉環、完整回歸、瀏覽器、獨立審查、Git交付 | 本機／審查通過；Git結果見任務板 |

## 實作與可觀察邊界

新Worker對缺失／無效HEALTH_SCHEDULE fail closed，舊health-minute row ID與D1 schema保留；沒有migration或第三方runtime。Policy必須與row revision一致，任何policy變更須同時增加revision。UTC整分鐘not_before是頻率錨點；deploy時Cron須對齊該偏移。命令execution_deadline必須落在policy與scheduler grant內；部署時仍須核對policy截止不晚於真正runner服務期限。

新讀取API只要求有效caller的commands:read及相同workspace/resource/recipe；排程grant撤銷／過期仍可顯示不可用狀態。最新firing與歷史完成觀測分開，資料關聯來自firings.outcome→commands.id。沒有管理／寫入API；HMAC認證本身仍會寫nonce。Snapshot不是跨所有查詢的原子快照，沒有Cron／runner liveness保證；最多20候選歷史結果並套scope，回應受限。

看板保留原命令卡與人工提交，新增排程區；next_due過去時等待更新，不虛構下一次成功。低頻不延長30秒觀測budget；unknown／stale／unverified不變綠。401／403清除舊排程資料並停止自動更新，恢復須明確refresh。

## 已執行驗證

- HS-domain-red：8項新增domain cases中7項如預期失敗，指出缺policy護欄、非低頻、API404與缺dispatch重驗；修正後HS-domain-green31項通過。
- HS-ui-red：4項新UI／client案例失敗；HS-ui-green19項通過，含原uncertain POST與obsolete artifact session競爭。
- HS-regression完整262項通過；補上hourly／daily錨點、strict policy、同due並行及寫入前revision／disable／grant變更、held lease／reconcile案例後，HS-final-regression **265項（58 Node＋207 Python）全通過**。使用共用launcher執行`python3 platform/cloud-lab/tools/check.py`，Node24.14／Python3.13；本機未執行Python3.11。
- 真實本機HTTP測試：scheduled handler保存命令，原Python CLI固定OS collector執行並回報，讀取新API得到同一firing／command及passed結果；同due再次觸發沒有第二筆。這是SQLite測試邊界，不冒稱遠端Cloudflare排程驗收。
- H2以180秒host timeout、既有Chromium與Miniflare執行qualify_dashboard.mjs，12組檢查通過，95次API請求、無JS exception／gateway error，三份資產hash與當前source相符。含actual workerd scheduled callback在未知工作占位／過期slot時的skip與唯讀瀏覽器顯示，未替未知工作清slot。[T836獨立審查](../../../../.team/reports/T-836.md)ACCEPT。所有測試使用合成identity及隔離資料，未讀私人憑證。

## 保留的失敗

初始測試把sign helper匯入auth而非protocol，先修正fixture；第二次Node預設isolation只回整檔失敗，沿用專案既有`--test-isolation=none`後取得真正7項domain RED。這兩個初始錯誤不充當behavior RED。

瀏覽器HS-browser的task ID使Chromium SingletonSocket路徑太長，尚未進入頁面即ECONNRESET；保留stderr／failure，改用既有short-root與H1短ID，沒有清理或重用失敗目錄。H1已有11組瀏覽器檢查通過，但最後把Miniflare本機scheduled HTTP控制路徑誤用於dispatchFetch，請求落入產品Worker而被403拒絕。改用官方getWorker().scheduled()事件入口，不放寬產品認證，H2十二組通過。[官方事件API](https://developers.cloudflare.com/workers/testing/miniflare/core/scheduled/)

## 限制與下一步

265tests及本機瀏覽器不代表目前live看板已更新、scheduler已獲授權或Cron已運行。完整AC06–08保持pending，沒有usable tag；實體手機選測狀態不變。實際費用、配額耗盡、自然到期與7日uptime不在本輪驗收。候選審查／Git完成後，需列明原Worker發布、原scheduler-only有界grant、policy／row CAS與Cron15分鐘、第一次真實結果以及停用回退的具體啟用方案；不延長現有runner服務期限或其他角色。

T836提出非阻擋的整合fixture分鐘末競爭：原測試在當前分鐘最後一秒啟動Python可能令dispatch到期。Lead在選定due前，若當前分鐘剩餘少於15秒就等到下分鐘，再讀真實clock；沒有改產品期限。HS-minute-boundary-check的5項整合全過（本次新測試實際等待後約7.4秒完成），focused review維持ACCEPT。主導查看H2的schedule窄畫面截圖，無橫向溢出。
