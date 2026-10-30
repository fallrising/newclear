# Health schedule live activation — HL01–04

Owner已明確批准[HS具體啟用／補償方案](../health-schedule.md)。2026-10-29首輪結果是 **PARTIAL_PROVIDER_BLOCKED**：資產session兩次回HTTP500／code10013，停在發布前；沒有上傳新版Worker、續scheduler grant、修改schedule row或啟用Cron。不是新一輪等待owner批准，也不是OAuth／自動批准審查拒絕。2026-10-30依原批准接續後資產session已恢復，但首次真實命令派送前過期，已停用Cron並補償回退；最新狀態為 **PARTIAL_DISPATCH_WINDOW_FAILED_COMPENSATED**，詳見下方接續證據；以下首輪紀錄保留，不作為最新部署狀態。

| AC | 實際驗收 | 狀態 |
| --- | --- | --- |
| HL-01 | fresh原資源、固定六檔source、active0、排程off、現有runner與journal | 前置及最終保留核對通過 |
| HL-02 | scheduler-only CAS、disabled revision／policy發布、啟用原Cron及回讀 | 資產session500阻擋；上述更新未執行 |
| HL-03 | 首次真實Cron firing→command→既有runner→result同鏈及有效期限 | 未執行，未模擬或手工插入替代 |
| HL-04 | Access／非scheduler授權／service保留、證據審查與Git交付 | 保留回讀通過；獨立審查／Git結果另記 |

## 批准與固定候選

範圍是原Worker三modules／三assets、原scheduler-only grant續至不晚於2026-11-05T07:24:26Z，15分鐘Cron與revision-bound政策。保留原D1、domain、Access app／policy／token期限、所有secret值、runner／human／bot期限與既有journal；不seed、migration、新增資源或付費方案。異常停用／原版本回退在批准範圍內。

固定source來自[PR750](https://github.com/fallrising/newclear/pull/750) head `1c7bbb0d186a7584777f58a8c46cc5b3feec57e5`，六份檔案與持久候選manifest SHA256逐檔相符。265tests／12browser checks是前輪HS source驗證，這輪沒有runtime source改動，未宣稱重新執行本機suite。部署腳本、兩次擬定開始時間及補償請求保存於私人0700／0600收據；未套用的開始時間不代表已啟用。

## 前置與兩次失敗

十項原Lab管理讀取及本機檢查核對原100%版本／settings／D1綁定、domains、Access app／policy、workers.dev及preview關閉、Cron空；四個grants與commands／schedule／firings保持前態，active0、schedule revision1且disabled。原unit／policy／config digest與journal inode／completed rows保留；resident active/running。

初始token全欄比對失敗，對帳唯一變化是既有runner使用導致last_seen_at推進；其他所有欄位包括身份、enabled、client綁定及expires_at完全相等。保留原失敗與reconciliation，沒有更新token或把使用時間當成授權漂移。

第一次POST原Worker的assets-upload-session回HTTP500／code10013，沒有成功session JWT。先以四次管理讀取重新確認部署、settings、D1業務資料及Cron未變，再僅對資產session作一次有界重試；第二次同樣500。兩份request及完整transport error收據都保存，沒有重播grant／Worker／Cron更新。

新manifest與前輪成功請求的method、target path及schema相同，三份小型asset使用既有hash計算，只有兩個已修改檔案的hash／size不同。這支持請求結構一致，**不能據此確定服務端根因**。Cloudflare官方repository有[相同endpoint／10013歷史issue](https://github.com/cloudflare/workers-sdk/issues/11153)，不把過去事件當作當前事故證明；未新建支援issue或對外傳送私人資料。

兩次API請求是否在provider內部留下暫存session未知，不能聲稱完全零副作用；已回讀證明原runtime／business配置未變，尚無可用JWT、asset上傳、發布或排程更新。沒有為繞過問題而另建Worker、改走付費方案、輪換憑證或放寬Access。

## 最終保留證據

2026-10-29T10:15:50Z完成九項fresh管理回讀，以及原runner self／resident、主機及匿名入口檢查：

- 原deployment、settings、domains、Access app／policy、subdomain／preview、四個grants、commands／schedules／firings與前態相等；Cron仍空、active0、schedule仍disabled。Token僅last_seen_at可前進，身份及期限不變。
- 原runner unit、config、service policy digest與journal device／inode／rows不變；active/running、NRestarts0。沒有重啟或停止原runner。
- 使用原config驗證Worker self，HMAC／runner grant仍到2026-11-05T07:34:26Z；kernel peer／process／lock關聯的resident觀測保守stop_at為2026-11-05T07:24:25Z，configured上限仍07:24:26Z。這是當時觀測，不是未來uptime保證。
- 三個匿名入口回302到HTTPS Access登入域；未帶credential、不跟redirect。包括新API路徑的外層攔截，但不表示該新endpoint已部署或真人登入已驗證。
- 私人操作目錄與檔案0700／0600通過；原始收據不進公開Git。self／既有runner可能寫nonce，不能把業務資料未變說成D1零寫入。

原runtime與授權從未更新，故沒有執行停止／回退；補償方案仍可審查，不冒稱已演練。Workers Free來源仍是owner之前確認；未新增付費、未查明實際帳單。Python3.11、真人Access、自然到期／七日uptime及完整主線保持未驗證，沒有usable tag。

## 接續條件

批准仍有效且受原截止約束；同一範圍內不重問發布／scheduler／Cron批准。下一次續行必須重新核對候選、原服務剩餘時間、active0／schedule off／Cron空與全部相關前態，重新固定有傳播餘裕的UTC四分之一小時起點，且在實際寫入Cron前再次確認至少15分鐘餘裕；不能重用這兩次未執行policy的not_before、舊fresh snapshot或過期upload token。HEALTH_SCHEDULE.expires_at取owner批准上限、原service policy及fresh resident保守runner_stop_at的最早值；scheduler grant可到批准上限，但命令execution_deadline仍不得晚於較早的實際runner／排程窗口。這次觀測兩者相差1秒，不可把07:24:26Z設定值代替07:24:25Z保守期限。

保存的執行順序是資產session／上傳成功後，fresh grant plan及CAS續scheduler，CAS提高原disabled schedule revision，發布同revision policy及六檔，回讀後啟用schedule與原Cron；首次**真實**觸發及原runner結果鏈仍是必驗。若再次500則保留錯誤並對帳，不能無限重試或把舊assets／局部發布當成完整HL完成。若已過原runner截止，原批准不允許自動延長服務。

任務板T-0015保持in_progress、end空白，明示等待provider恢復。此次Git交付只保存部分執行與保留證據，不關閉HL01–04。

[T837獨立審查](../../../../.team/reports/T-837.md)接受部分狀態與保留證據的表述，不接受為完成部署。Reviewer僅讀公開指定文件及主導去識別摘要，未查raw/live；主導補明一秒期限差與實際Cron更新前傳播餘裕，並保存未執行的operator v2供下次fresh審查。

## 2026-10-30接續範圍

Owner繼續開發並要求明示阻擋與全任務完成狀態。沿用原HL01–04批准與截止，先fresh核對最新BT後部署／D1及原Access／服務，再只做一次新資產session嘗試以觀測provider是否恢復。距原失敗已逾16小時；不把時間經過當成恢復證據。若再次500，停止重試、回讀保全並準備供owner向provider查詢的去敏資料，不自行發送issue或私人帳號資料。若成功，沿原順序fresh規劃與scheduler-only CAS／原Worker發布／Cron啟用／實際觸發驗證，既有bot／runner／Access不延期；操作前不得重用舊時間、JWT或秘密快照。


### 本次實際部署與啟用

2026-10-30T03:13:50Z fresh預檢通過：六份固定source逐檔hash相符；最新BT後原100%版本及settings、四個grants、五筆commands／active0、disabled schedule、零firings、Cron空均符合前態。原runner與bot self及resident通過；runner保守停止時間仍2026-11-05T07:24:25Z，bot截止2026-10-30T18:00:27Z，Access截止2026-11-05T07:43:27Z。沒有把BT前舊secret／版本當成保留基準。

本次唯一assets-upload-session請求回200，回傳兩個bucket，依固定manifest上傳所需bytes並取得completion JWT；JWT與原始收據只保存在私人目錄。這表示此次上傳成功，不證明先前500的服務端根因已查明。

資產完成後再次fresh核對版本／settings／D1／service及完整grant來源，再執行原scheduler-only CAS revision1→2，保留scope／principal／capabilities，截止2026-11-05T07:24:26Z。原disabled schedule CAS revision1→2，發布三modules／三assets與同revision policy，沿用當前secret bindings；100%新版本及全部runtime settings回讀相符，僅明示provider deployment annotations變化。沒有重用BT前MACHINE_KEYS。

2026-10-30T03:19:19Z完成schedule enable與原Worker Cron回讀：`*/15 * * * *`，HEALTH_SCHEDULE revision2／interval15／not_before2026-10-30T03:45:00Z／expires_at2026-11-05T07:24:25Z。實際Cron寫入前再次通過>=15分鐘餘裕，完成時仍餘1540秒。補償以此次fresh BT後版本為基準，未觸發回退。

03:20後九項管理回讀及實際機器GET /api/health-schedule200通過：狀態waiting、next_due為03:45、last_firing／latest_result空，API的cron_verified=false誠實保留（Cron存在由管理回讀證明）。五筆原commands、四筆原journal及bot ledger／policy／client/config不變；原runner同PID、NRestarts0且self／resident正常，其他roles與Access不延期。三個匿名入口302到Access登入；不等於真人登入／資產畫面驗收。HMAC self與API可寫nonce，不宣稱D1零寫入。

這次保留檢查末尾因新產生的operator Python快取目錄mode0775失敗；其私人父目錄一直0700，快取檔0600。保留失敗並只收緊該目錄至0700後完成權限核對，沒有刪資料、重播部署或重啟runner。03:23:53Z保存接續核對成功，尚未有排程command。

### 首次真實觸發

2026-10-30T03:45:23Z由provider建立due03:45的一筆命令；first observation從零firings到一筆accepted，03:46:00Z原runner的claim把它標為expired_before_dispatch。due-based dispatch_deadline為03:46:00、execution_deadline03:47:00，provider延遲23秒後只剩37秒派送時間。六次有界只讀觀測後停止，沒有手工觸發或重播。該筆attempt／external_ref／result全為null，原journal沒有它的execution；不能稱為健康檢查成功。HL03未通過。

### 已執行補償與最終保全

fresh版本／settings／D1／Cron確認後，CAS停用schedule並提高revision2→3、移除本次Cron；以新CAS將scheduler還原原過期policy，revision2→3而不倒退。保留新firing及expired command，active0，沒有collector重跑。原BT後版本100%回退成功。

回退後初次settings相等檢查失敗：GET script/settings仍帶最後上傳版本的HEALTH_SCHEDULE與provider annotations。沒有重播回退或貿然PATCH secrets；另查實際active version，確認ID與原BT baseline相同，該版本六個bindings逐欄等於原設定。latest-upload settings僅多inactive revision2政策，D1已disabled revision3；其餘runtime設定逐欄相同。公開證據保留這個視圖差異，不宣稱所有settings JSON完全相等。

2026-10-30T03:51:05Z九項管理回讀與原runner／bot self、resident、原API及三個匿名入口核對完成：Cron空、schedule disabled revision3、scheduler原過期policy revision3、其他三個grants及Access設定／期限不變；原五commands與四journal rows保留，新一筆expired command／firing保留，沒有新journal execution。原runner同PID／NRestarts0；bot config／政策／client／ledger hash不變，原API200能讀取該expired結果，匿名302仍受Access保護。未延長權限或新增付費。

[HW01–04修正契約](../schedule-window.md)針對此次時間窗口缺陷補RED/GREEN與獨立審查；source修正及未來新窗口驗證不改寫這次失敗。HL保持未完成，完整主線亦未完成。
