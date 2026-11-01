# Bounded bot live validation — BL01–04

Owner在獨立Grok接線後同意繼續下一步：bot有界續權與一筆真實健康檢查。採執行起最多30分鐘的驗證窗口，且早於既有runner實際stop、grant/HMAC及Access各期限；不續runner/Access/human/scheduler、不改範圍或新增付費。

| AC | 驗收 |
| --- | --- |
| BL-01 | fresh原部署／settings／D1／Access／Cron與實際runner self/resident；無在途工作、source及現有秘密候選來源一致，否則停止 |
| BL-02 | 僅延長原bot MACHINE_KEYS entry及原bot grant expires_at，grant用revision/policy CAS；保持secret/generation/其他role／scope不變，Worker source/config回讀 |
| BL-03 | 暫開已註冊MCP check，Grok原生發現；固定一個request_id提交一次，原常駐runner完成，同IDstatus取得新鮮validated結果；有界poll，未知不新建ID |
| BL-04 | 恢復Grok原status-only設定，核對資料／角色／期限保留、private回執與獨立審查及Git交付；不呼叫模型、不冒稱自然語言或自然到期驗收 |

## 執行護欄

30分鐘從實際寫入前計算，不因後續重試刷新。期限取「現在加30分鐘」與「fresh runner/self/resident/Access最早上限減60秒」的較早值；不足5分鐘不開始。原bot HMAC秘密值不可由管理API回讀：只在active版本與上次保存MACHINE_KEYS候選對應版本相同時使用私人候選，其他版本或本地secret/generation漂移必須停止。

Worker secret更新會產生部署版本；只提交MACHINE_KEYS secret更新，不上傳assets或更換腳本。驗證script etag、handlers、bindings、runtime與settings保持，其他key逐欄相等。D1只用原grant的CAS更新expires_at及revision；先回讀更新後self授權，再啟用check。管理metadata／bootstrap回應不能替代真實runner結果。

只允許固定node-health recipe的唯讀collector，一個durable request_id；未知／timeout保留state，不另建命令或自動重送。結果輪詢最多90秒、每5秒一次、僅GET；未得到fresh validated就保留未完成，不能改判passed。驗證完成或失敗都恢復原Grokstatus-only設定；若設定被別人改動，不覆蓋整份檔案，保留差異待處理。

窗口到期由原HMAC/grant判斷拒絕，沒有續期排程。失敗先停止新提交、恢復本機submit開關並讀回狀態；不盲目回滾共享MACHINE_KEYS或覆寫其他principal。若尚未更新grant而key已更新，原過期grant仍拒絕。任何不確定雲端寫入先讀回對帳再決定補償，不因通訊錯誤重做寫入。

本輪不接Kith，不執行Grok模型或驗自然語言選工具，不改原HL資產session500部署任務。結果見[實際證據](evidence/m1-bot-live.md)。
