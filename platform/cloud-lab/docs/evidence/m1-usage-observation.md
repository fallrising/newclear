# UO 應用用量觀測證據

2026-10-30，[UO01–04](../usage-observation.md)source/local交付；原線上Worker資源、授權期限、排程、secrets與runner未改。沒有live部署或provider analytics查詢；不是新授權或免費帳單保證。

## AC與證據

| AC | 實作與驗證 | 結果 |
| --- | --- | --- |
| UO-01 | GET /api/usage：有效commands:read；單一聚合SELECT，零／terminal／unknown統計，業務行不變，錯誤503不填零 | focused passed |
| UO-02 | retained10000／rolling1440／active1；exact24h、已超10000仍顯示實際值／remaining0；workspace/resource/generation/recipe每欄與null混入均403；provider與billing固定未接線/null | focused passed |
| UO-03 | 手動唯一請求、現有poll不取usage；59／60秒界線、過期／失聯、schema／future／錯scope／billing0拒絕；401／403清除、遲到200／403不回填或撤銷新session | 387tests passed |
| UO-04 | RED→GREEN、完整suite、實際本機workerd/D1＋Chromium、獨立source審查與Git | 最終387tests、14browser情境及T851複審ACCEPT |

先有RED：UO-red 54tests為43pass／11fail（新API404、缺usage client／DOM行為）；既有撤權拒絕路徑原先就通過。實作後UO-green 53pass／1fail：過期fixture只改observed_at未同步rolling起點，被嚴格schema拒絕，修正fixture後54pass。再補超保留上限、quota滿額讀取、遲到拒絕及59／60秒界線。

UO-full為88Node＋295Python＝383tests passed。首輪UO1本機瀏覽器14組情境通過；後續加成功提示與移除每秒變動區的aria-live，以免頻繁朗讀。UO1僅代表當時資產；UO-final-full另存90Node＋295Python＝385pass。UO2在第七組前的用量1/10000斷言失敗，截圖顯示連線正常但快照時間拒絕；原failure.json／run.log及六組已通過結果保留。T851初審REWORK確認畫面時鐘從bootstrap整秒時間及收到回應時開始估算，會落後原server，正常跨秒usage因此可能誤判future。UO-clock-red可重現1.5秒bootstrap耗時＋3秒觀測偏移被拒絕；修正為有界monotonic耗時＋整秒容差（最多11秒），超出10秒請求不接受時鐘，超出容差future仍拒絕，顯示年齡不負數。UO-clock-green當時29項UI通過；後補慢bootstrap測試，最終UO3／UO-clock-full另存。沒有把fixture錯誤算成產品缺陷，也不以舊hash接受最後source。

共享workspace project cloud-lab的UO-red、UO-green、UO-focused-final、UO-full、UO-final-full保留tests／check日誌；既有短root的UO1、UO2保留browser.json、run.log、stderr及截圖。既有Chromium／Miniflare／字型，無新安裝。Synthetic JWT、loopback、CDP pipes；no-sandbox只用於本機合成內容，不是安全隔離。Python3.13.5／Node24.14.0；Python3.11未跑。

## 邊界與保留

單一SQL的global count只在全部保留命令屬caller scope時提供；不以局部資料冒稱global准入空間。HMAC仍寫nonce；命令、grant、schedule、firing不因usage改動。聚合可掃描全表；UI手動讀取減少額外輪詢，仍有查詢成本，無成本0宣告。

provider.status=not_connected與null是目前產品未整合來源，並非實際provider回覆空值或權限拒絕。Cloudflare掃描列數、儲存、請求／帳單須另期有來源時間與scope的採集。Retained到頂不自動刪歷史；retention具體方案、完整故障矩陣、真人Access／模型流程與mainline仍pending。

## 審查與交付

[T851初審REWORK／複審ACCEPT](../../../../.team/reports/T-851.md)已完成。最終UO-clock-full為92Node＋295Python＝387pass／0skip；UO3本機workerd/D1與Chromium14組通過、103次API、無JS／gateway error。主導與reviewer各核對三份資產hash和UO3一致，主導查看桌面截圖。project／index／llms／task／report／diff檢查及公開邊界通過；主導依實際diff、RED/GREEN、最終suite及browser證據接受UO source/local gate。BOARD在必要CI與實際PR合併後關閉。本機可見新面板不等於live Worker已發布，也不代表owner登入已驗；無usable tag。
