# 低頻健康檢查與看板 — HS01–04

Owner確認開發低頻健康檢查排程與看板結果展示。本輪交付source／測試／文件，沿用原單節點、固定collector及D1 outbox。實際部署、scheduler grant期限及Cron具體啟用方案在候選完成後列明；本輪開發不改正在運行的七日runner。

| AC | 驗收 |
| --- | --- |
| HS-01 | HEALTH_SCHEDULE嚴格四欄policy：revision、interval_minutes（15／60／1440）、not_before、expires_at；窗口最多7日、與D1 row revision綁定。缺失／無效／過期不提交；以UTC起始分鐘為錨點的間隔、錯過skip、重試去重、unknown占用容量、dispatch重驗 |
| HS-02 | commands:read及scope保護的GET /api/health-schedule；狀態／下次符合政策時間／最近firing／最近完成結果。無secret、無寫入、無管理操作，不把policy有效當成Cron或runner在線 |
| HS-03 | 看板顯示頻率、截止、最近觸發及觀測時間／結果；沿用30秒freshness，舊healthy不維持綠色；401／403清除排程資料，失聯顯示未確認，不展示已過去時間為下一次 |
| HS-04 | Red-Green、SQLite與真實HTTP Python閉環、看板瀏覽器／session回歸、獨立審查、索引及Git交付；保留未驗live項 |

建議首輪每15分鐘（每日96個due、7日最多672個），仍受單active、grant及每日／總command上限限制；不保證帳單0。原health-minute ID保留為資料識別，不再代表頻率。沒有任意cron parser／catch-up／新schema migration；HEALTH_SCHEDULE與schedule revision必須一起提升，舊部署無policy時fail closed。上線須確保命令execution_deadline不晚於policy期限，且policy期限不晚於實際runner服務期限。

API的next_due_at只是依policy及grant計算的候選時間，cron_verified=false；實際Cron設定由部署驗證。UI明示等候觸發不是服務在線證明。Cloudflare Cron使用UTC，設定傳播可能最多15分鐘：[官方說明](https://developers.cloudflare.com/workers/configuration/cron-triggers/)。

not_before必須整分鐘，interval從此起點計算；provider Cron須匹配這個分鐘偏移。建議部署把起點對齊UTC四分之一小時，再用`*/15 * * * *`，不能任意起點卻聲稱Cron會匹配。

## 設定與讀取契約

HEALTH_SCHEDULE是私人部署的plain-text JSON設定，不含憑證。例如合成policy：

```json
{"revision":2,"interval_minutes":15,"not_before":"2026-11-01T00:00:00Z","expires_at":"2026-11-02T00:00:00Z"}
```

不得照抄日期或revision到真實環境。Schedule變更要CAS並提高revision；新版policy與資料列的revision不符期間停止新提交／dispatch。已有attempt到租約結束後仍可reconcile，不能把停用當成可重新執行unknown。沒有自動續權、補跑、retention刪除或管理HTTP API。

GET /api/health-schedule回schema_version、now、request_id、cron_verified=false與schedule。沒有row時schedule=null；有row時先以scheduler grant的workspace/resource/recipe檢查caller scope，再投影id／revision／enabled／status／interval_minutes／not_before／expires_at／next_due_at／last_firing／latest_result。Grant過期／撤銷仍可由獨立有效reader看見不可用狀態，不會借scheduler授權讀取。

last_firing屬目前schedule revision，含due_at、outcome、command_id；submitted只證明命令已保存，不是完成。latest_result從持久firings→commands關聯找最近有result的同scope紀錄，最多掃描20個候選，可跨revision；回public command，不帶artifact bytes／holder／report_digest。最近觸發跳過和上次完成觀測分開顯示，不以舊成功蓋過目前未知。回應有界；HTTP讀取本身不改業務表，HMAC認證仍可能寫nonce。

next_due_at依policy／目前grant窗口及已存在的firing計算，並要求完整120秒命令窗口，不保證provider Cron存在、下一次一定執行、quota足夠或runner在線。錯過poll導致下次時間已過時，UI顯示等待更新；觀測仍依原30秒budget變stale，低頻排程不延長健康有效期。

## 具體後續啟用範圍

將已合併HS source的原Worker三個modules及三份assets作為發布候選；沿用原D1、Access app／policy、所有secret值、domain及runner，不seed／不migration／不新增資源或付費。先重新核對active0、原schedule disabled、Cron空、原runner健康與剩餘期限。

只續原scheduler grant至不晚於現有runner policy的2026-11-05T07:24:26Z，capabilities／scope／principal不變；不續human／bot，不延長runner或共用Access。HEALTH_SCHEDULE採15分鐘、UTC下一個適合的四分之一小時起點與同一截止；起點預留Cron傳播時間，實際UTC值在執行前固定保存。原schedule以CAS提高revision，保持disabled發布新policy，再CAS啟用及設定原Worker Cron `*/15 * * * *`。新舊policy與revision不匹配時fail closed。

首次真實Cron命令須經現有runner回報，驗D1 firing→command→result同一鏈及有效時間，保留nonce與新業務紀錄；不得以手工插入結果或模擬Cron替代。最終確認未影響Access入口、原runner政策／journal及非scheduler授權。看板資產發布不等於已通過真人Access；human目前過期，該驗收仍單獨列缺口。

失敗先停止新schedule並提高revision、移除本次Cron，查明有無在途命令後依原journal對帳；不刪除紀錄、不重做unknown。以新CAS還原原scheduler expired policy（revision不倒退），必要時還原原Worker版本／設定。Cron移除有傳播延遲，D1 disabled／revision護欄仍須維持。這份範圍包含停用／補償；原方案撰寫時尚未執行live變更，後續批准與2026-10-30接續實際結果以[HL證據](evidence/m1-health-schedule-live.md)為準。

每15分鐘最多96個due／日，單次最多一筆命令；D1 rows與帳單不是依request數保證。新snapshot在既有看板每5秒refresh中增加一次API讀取；SQL LIMIT20僅限制候選回傳，不保證只掃描20列。長時間開看板、其他流量、nonce、join／sort與retention成本須看實際analytics，未新增付費升級或自動熔斷。
