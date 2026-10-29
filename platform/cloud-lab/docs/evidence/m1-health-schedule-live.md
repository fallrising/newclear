# Health schedule live activation — HL01–04

Owner已明確批准[HS具體啟用／補償方案](../health-schedule.md)。本輪結果是 **PARTIAL_PROVIDER_BLOCKED**：資產session兩次回HTTP500／code10013，停在發布前；沒有上傳新版Worker、續scheduler grant、修改schedule row或啟用Cron。不是新一輪等待owner批准，也不是OAuth／自動批准審查拒絕。

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
