# 常態服務啟用準備 — SP01–04

本輪交付離線啟用proposal產生器、固定source候選及原Lab唯讀盤點。沒有續權、部署、unit安裝或啟動。沿用SR服務模式、AL授權變更與IA來源核對，不新增權限系統。

| AC | 驗收 |
| --- | --- |
| SP-01 | 私人snapshot／runner config綁定scope及已知credential；產生獨立proposal而非可執行policy／SQL。已知revoked、busy、enabled schedule、錯誤scope拒絕；缺失／過舊來源明示未知，部署前須重新採集 |
| SP-02 | 明確指定1～7日服務窗口與5～60秒輪詢；相對T0服務截止、runner HMAC／grant＋10分鐘、Access＋20分鐘。列出單程序空閒／每cycle一report估算，重啟、其他caller與D1用量另列未知，無零費用保證 |
| SP-03 | 私人0600／no-follow／outside-Git／exclusive輸出、無secret stdout；固定已合併SR source與原config／journal引用，準備啟停／回退順序及具體待批方案 |
| SP-04 | Red-Green、真實私人CLI、回歸、獨立審查、公開／私人邊界及Git交付；本機準備與真正常態運行分開 |

建議首輪7天、poll60秒。角色只延長runner；原共用Access service token的到期會一併改變，但不延長human／bot／scheduler grant或bot HMAC。No Cron／自動提交；runner只有既有claim／report／reconcile權限，不等於已有每日健康檢查排程。

工具只產生 `cloudlab.service-activation-plan.v1`，`approval_required=true`、`applied=false`、`activation_ready=false`。T0尚未綁定，沒有可直接給runner的四欄policy或provider request。生成snapshot狀態時使用真正now，過舊保留stale，不把觀察時間改新；重新採集、身份與Access client綁定／版本／主機檢查在實際啟用前完成。

## CLI與私人邊界

```sh
python3 platform/cloud-lab/tools/plan_service.py --snapshot /private/current-snapshot.json --config /private/runner.json --output /private/activation-proposal.json --days 7 --poll-seconds 60
```

Snapshot沿用AL嚴格schema；config沿用runner完整schema。known credential的ID／generation與grant principal必須一致；runner grant須具原三項capabilities與相同workspace／resource／recipe。未知credential或過舊snapshot可供**規劃**，但保留unknown／stale、`activation_ready=false`及重新採集要求；不把本工具當作部署前核准器。已知撤銷、非零active、enabled schedule或未生效grant拒絕。

檔案均在Git之外，拒絕祖先／末端symlink、非owner／非0600／hardlink／超過32KiB輸入；輸出exclusive0600並fsync，不覆寫、清理或重播。stdout只有saved／applied／digest，不輸出config、token client ID／secret、scope或私人路徑。讀取與寫入使用既有private-file邊界，純函數`make_plan`不碰網路或服務。snapshot雜湊只識別輸入，並非來源簽章；Access client綁定永遠由後續fresh管理讀取另驗。

## 請求與用量

7天／60秒的單次連續程序模型：`ceil(604800/60)=10080`個cycle，加一次startup self，空閒共10081個請求；若每cycle都有一次report則20161個請求。每24小時穩態空閒claim約1440次。模型以cycle耗時為零估算，實際collector／HTTP時間及退避會降低頻率；重啟額外self／立即claim、真人／bot／看板與其他帳號流量不包含在內。這不是實際量測或強制配額。

截至2026-10-29官方文件，Workers Free為每日100000 requests；此限額屬帳號層，不能視為本服務專用預算。[Workers limits](https://developers.cloudflare.com/workers/platform/limits/)

D1 Free為每日500萬rows read、10萬rows written與總5GB儲存；超過每日限額會拒絕查詢。rows包含掃描及索引寫入，不能把一個HTTP request當一列。實際值應取D1 meta／analytics；帳號其他用量及帳單本輪未驗。[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/)

現有HMAC驗證包含nonce插入與過期刪除，即使空閒claim也有D1寫入；既有nonce_expiry索引不等於已取得D1成本證據。proposal的D1讀寫與bill固定unknown。維持Free／不新增付費；本輪沒有新增自動用量熔斷、保留政策或配額耗盡驗收。遇到限額／異常量時停止服務並對帳，不升級付費；429／5xx目前仍按既有有界退避，不能宣稱會自動永久停止。

## 固定候選與待批准方案

來源固定PR738 head `e97199a6482b8693334ec68e3a25b34a7a1666be`：runner、service unit模板，以及IA／AS／AL／private-file四份工具，共六份Git blob。私人manifest逐檔核對SHA256；config／journal保持原路徑。已生成填好路徑及poll60的unit候選，service-policy檔仍不存在；沒有偷偷產生可啟動授權。原unit bytes與journal metadata／rows保留，候選unit只驗證未安裝。

後續具體批准範圍：原Lab、原runner身分與同scope；T0是重新驗證完成後持久保存的實際開始時刻。service_until=T0＋7日，runner HMAC／grant=T0＋7日10分鐘，原共用Access token不超過T0＋7日20分鐘。只有expires_at與grant revision可改；不輪替ID／generation／secret，不延長bot HMAC、human／bot／scheduler grant，不開Cron／schedule、不提交業務命令、不新增付費。成功驗證後**保留runner運行**，到service截止停止新cycle；7日是上限，不保證主機／user manager在線7日，也不改enable／linger。

1. 重新核對目前Worker版本／設定／D1／domain／Access app與policy、原token身份／client綁定、四個grant、當前帳號Free與用量。fresh採集不能以本輪baseline替代；設定或scope漂移、token被停用／撤銷、active非零／排程開啟、journal started／unknown未對帳或服務不inactive均停止。
2. 固定T0與全部絕對期限；保存intent／原值／request後才更新。先延長原Access token到不超過外層上限（custom duration扣除執行時間及60秒buffer，不使用一年refresh）；回讀實際expiry，若不能覆蓋內層或超界，停止並依批准補償，不能反覆試期限。
3. 在runner grant仍過期時，只更新原MACHINE_KEYS的runner expires_at，其他角色、ID／generation／secret逐欄相等。Worker modules／assets／bindings／Access設定與原部署保持；若秘密更新產生新version，回讀100%版本與保留設定。不是重新seed或重做部署bundle。
4. fresh AL runner-only CAS延長grant，affected rows必須恰為1；原revision／policy、active0／schedule off任何漂移均停止。不重播未知結果，不改已有command期限。human／bot／scheduler grant及bot HMAC逐欄回讀不變；共用Access到期變更另記。
5. 由**實際回讀期限**及再次核對的config digest產生SR四欄policy；必須能覆蓋批准的service_until，不能拿proposal的假設代替。保留原journal／lock，替換為已驗證candidate unit，daemon-reload後啟動一次，poll60、原Restart政策、無enable／linger改動。
6. 驗證startup self、runner-only IA及resident程序／socket。bot config不參與IA self，因bot授權保持過期；不能要求兩個機器都verified而偷偷續bot。核對Worker、Access、grant、commands／schedules與journal，確認程序運行及真實停止期限。成功後保留服務運行；公開結果不含私人IDs／receipt。

## 停止、異常與回退

本方案需連同補償一起批准。失敗／未知回覆先保存receipts並查實際狀態，不自動重試mutation。停止新resident並確認inactive／MainPID0及socket清理，還原原unit但保持inactive；原journal不清空、不搬移、不重做unknown。Worker若已變更則還原原secret期限／原已驗證版本，核對modules／settings；runner grant用新CAS恢復原過期policy並再增加revision，不能倒寫revision。原共用Access若不能精確還原過去期限，停用同一token並記錄對共享入口的影響，不改Access policy。任何在途工作／併發授權變更均先對帳，不直接覆蓋。

自然到期後沒有自動續權。若仍需服務，重新確認範圍及期限，不把重啟視為新7日。只有一個仍無提交來源的runner不會自行生成健康檢查；低頻排程、真人登入／短期操作授權及保留／配額是後續任務。準備證據見[SP本輪證據](evidence/m1-service-activation.md)。
