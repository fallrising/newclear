# Bounded bot live validation — BL01–04

Owner在獨立工具端接線後同意繼續有界bot續權與一筆真實健康檢查。本輪已完成原bot-only窗口、原生MCP工具發現、真實Cloud Lab→常駐runner→結果閉環及原設定恢復；沒有Grok模型呼叫、其他role續權、Access更新或新增付費。

| AC | 實際證據 | 狀態 |
| --- | --- | --- |
| BL-01 | 原部署版本／settings與已保存秘密候選版本一致、active0／排程off、fresh Access及實際runner self/resident | 通過 |
| BL-02 | 只改bot key／grant expires_at；grant CAS changes1，更新後bot self驗證兩層相同期限，原程式／其他角色／業務保持 | 通過 |
| BL-03 | 原生Grok doctor發現2tools，registered argv只提交1次，10次status後取得fresh validated／healthy，原runner journal completed | 通過 |
| BL-04 | 原Grokstatus-only逐byte恢復、doctor回1tool；原資料／scope／期限／Access保持，私人回執與公開審查／Git收尾 | 保全與獨立ACCEPT；Git結果見任務板 |

## 有界窗口與實際結果

窗口在 **2026-10-29T16:29:16Z** 計算，bot HMAC與grant共同截止 **2026-10-29T16:59:16Z**（UTC+8為10月30日00:59:16）。最長1800秒，並受fresh runner實際stop與HMAC/grant/Access最早上限減60秒限制；本次最早限制是30分鐘窗口。原runner實際stop仍為2026-11-05T07:24:25Z，設定上限07:24:26Z，沒有延長。

原bot key只替換expires_at，secret／generation／其他key相等；管理API不能回讀秘密值，因此先核對active版本對應上次保存的MACHINE_KEYS候選，再以實際bot／runner self請求驗證。Secret更新產生新Worker版本100%，script etag、handlers、bindings、runtime及settings相等，未重傳assets；不代表HL部署已完成。Grant用原revision／policy／revoked與全局active0、排程off條件CAS更新，只改原bot期限及revision+1；changes1且回讀相等。16:29:25Z bot self顯示grant/HMAC同一截止。

暫時在原Grok固定argv加入allow-submit，保留其他TOML語義及permissions；`grok mcp doctor cloud-lab --json`真正握手並發現2tools。以從實際登記設定讀出的argv送一筆UUID health.check，原SQLite journal保存同ID，沒有重試POST或換ID。每5秒查詢一次、最多90秒；前9次accepted，第10次validated，**觀測finished_at為2026-10-29T16:31:08Z，health=healthy、verified=true**。原常駐runner採60秒poll，本次等待約50秒。

這是實際MCP/API/原runner驗證；操作端協議呼叫器發出tools/call，未讓Grok模型選工具。因此不能宣稱自然語言聊天端到端已驗收。healthy是該次時間點的觀測，不是持續健康保證；之後status應依30秒freshness呈現stale。

## 已執行與保全

- 私人preflight查詢原部署／settings／D1／Access／Cron／version；核對原秘密候選版本與本地bot／runner credential，並執行runner authorization-status及observe-resident。
- 寫入前重新採集授權與resident／self、部署與D1；既有AL產生CAS plan並在valid_until內執行。先secret回讀，再grant CAS，沒有Access／其他principal更新。
- Grok doctor在提交窗口為2tools；使用登記argv的check一次、status十次。finally將原client設定逐byte恢復，state保留；恢復後原生doctor為1tool。
- 最終D1原三筆命令逐欄相等，只多一筆指定command，active0、result_recorded、succeeded、validator passed／healthy；原schedules／firings相等。bot state只有同request_id／command_id一列，原runner journal對應completed。
- **2026-10-29T16:33:43Z** 最終settings／部署／D1／token／Cron／runner self及resident回讀通過；原其他roles相等、runner期限相同且仍可觀測。Access除last_seen_at使用量metadata外逐欄相同，未更新其授權；4份已安裝source hash相等，Grok原status-only設定保持。

第一輪最終回讀在唯讀SQLite open失敗：操作腳本把相對journal_path直接相對自身cwd開啟。核對runner main原有邏輯後，修正操作端為相對config目錄解析，另用新receipt標號080–087重跑唯讀保全。原失敗腳本／回執保留；沒有改runtime、資料庫或重做續權／提交。第二輪所有保全assert通過。

本輪產品source未修改；前次MT300tests為固定source來源證據，未在本機重跑整套。實際驗證包含native doctor、MCP呼叫、真實HTTPS/HMAC、原runner自動執行及SQLite回讀，不以舊測試冒充live結果。公開不包含私人scope／域名／account／token／command ID或secret，原始證據保留私人。

## 限制與後續

Grok現已恢復status-only。窗口到期由既有grant/HMAC檢查拒絕，沒有自動續權；本輪未等待自然到期，未驗Grok模型對話／常態bot服務／真人Access／帳單。驗證已由操作端完成，無須owner趕在窗口截止前再測。下一個日用階段需定義bot常態期限與提交政策；不把此30分鐘測試視為永久授權。HL assets-session500與完整主線仍獨立pending，沒有usabletag。

[T841獨立審查](../../../../.team/reports/T-841.md)ACCEPT，屬公開文件與去敏回執一致性審查；未讀private或重跑actual操作。主導已檢查原始請求／回應、單一submit呼叫、2tool/1tool doctor及保全assert，evidence gate接受BL01–04具體live子集，不接受模型或完整主線。

文件收尾的report validator首次因一列在passed後追加說明而拒絕；修正為既有報告格式並重跑，不修改validator或降低驗收。
