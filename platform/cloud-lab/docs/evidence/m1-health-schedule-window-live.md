# Corrected-window health schedule live continuation — HL01–04

[第一次真實觸發](m1-health-schedule-live.md)因派送窗口不足而過期，已補償；這份證據記錄已合併[HW修正](m1-schedule-window.md)後的獨立新窗口，不能覆寫第一次失敗。

## 固定來源與批准邊界

[PR809](https://github.com/fallrising/newclear/pull/809) head `40e30aeabf9b6e5801208350ae3de4bd68fb22de`通過三項必要CI及T848sourceACCEPT，於2026-10-30T04:00:13Z合併為`f3d08f90d2018115c296fc3e09375dda5c3e6df1`。本機／遠端tree相符，三modules／三assets候選逐檔hash與remote一致；相對已審HS候選，runtime唯一差異為callback-relative時間修正。

沿用原HL批准：原Worker、原D1／domain／Access與secrets、原15分鐘頻率、原runner及其他roles截止、零新增付費。修正未擴大一般API60／120秒上限或總授權窗口；不重啟runner、不重播原過期命令。新的UTC起點與revision只在fresh核對後固定。

04:01:24Z fresh九項管理讀取及原runner／bot self／resident通過：六commands、四journal completed、active0、schedule disabled revision3、Cron空、一筆先前失敗firing保留；原BT active版本與補償後latest-upload設定對齊。新session200、原assets manifest相同，使用新completion JWT；不重用舊JWT或舊secret快照。

## 新版本啟用

資產完成後再次核對版本／settings／D1／service與完整grant來源，scheduler-only CAS revision3→4，原disabled schedule CAS revision3→4。發布固定六檔、保留現有secret bindings、以新HEALTH_SCHEDULE取代先前inactive政策；回讀100%版本與設定，只有預期policy及provider annotations變化。

policy為revision4、interval15、not_before2026-10-30T04:30:00Z、expires_at2026-11-05T07:24:25Z；scheduler grant截止仍為批准上限07:24:26Z。04:02:35Z啟用完成時仍餘1644秒；實際Cron寫入前再次確認至少15分鐘餘裕，Cron為`*/15 * * * *`。新命令deadline須按handler時間計算，且仍不得越過policy／原resident截止。

04:04:31Z九項管理回讀、實際機器schedule API200及self／resident通過：waiting、next_due04:30、當revision無firing、沒有latest_result；舊失敗firing仍保留。六筆原commands、四筆原journal及bot config／policy／client／ledger不變；原runner同PID／NRestarts0，其他grants與Access期限保留，三個匿名入口302。API cron_verified=false保留，管理回讀另證Cron存在；沒有真人Access驗收。

## 首次新窗口觸發與最終核對

新窗口已通過實際閉環：七次有界D1觀測從零新firing到accepted再到result_recorded。due04:30:00Z、實際admitted_at04:30:29Z；新dispatch_deadline04:31:29Z、execution_deadline04:32:29Z，均由實際handler時間算起且未越過總截止。原runner於04:31:06Z完成，owner_outcome=succeeded、validation=passed、health=healthy；04:31:13Z首次讀到terminal，當時觀測年齡7.67秒。

04:31:44Z完成最終九項管理回讀及本機核對：新增一筆revision4 firing與同一command，原journal只新增一筆completed；D1 result、原journal artifact bytes／SHA256／identity digest／external_ref及API latest_result逐項相符。schedule API為ready、next_due為下一slot；API cron_verified=false仍保留，管理回讀另證15分鐘Cron存在。未模擬事件、手動插firing或另行執行collector。

原六commands及四journal rows完整保留，其中第一次expired_before_dispatch與revision2 firing原樣保留；目前七commands、五journal completed、兩firings、active0。原unit／policy／config、bot config／policy／client／ledger hash均不變；runner同PID、NRestarts0、self／resident通過，bot self仍到2026-10-30T18:00:27Z，runner與Access期限不變，非scheduler grants保持。三個匿名入口仍302至Access；secret bindings沿用且兩機器self驗證成功。保留revision4排程與原服務，不再延長權限或追加測試命令。

04:31:44Z的最終核對已距完成38秒，不能再把該歷史healthy觀測當成當下新鮮健康；原30秒UI freshness不延長。這證明一次真實成功，不證明未來uptime或每次due必定完成。

完整M1仍須[其餘門檻](../remaining-work.md)，沒有usable tag。到期停止新命令不會自動移除provider Cron；未來uptime、自然到期、實際帳單與模型對話仍未驗。


## HL驗收與交付

| AC | 本輪證據 | 狀態 |
| --- | --- | --- |
| HL-01 | 已合併固定候選、fresh補償後原資源、self／resident與剩餘期限 | passed |
| HL-02 | scheduler／schedule CAS3→4、100%發布、原Cron及>=15分鐘傳播餘裕 | passed |
| HL-03 | provider延遲29秒仍由原runner完成，同一firing／command／journal／artifact／API鏈 | passed |
| HL-04 | 歷史／原角色／Access／secrets／service保全；獨立審查與Git交付 | 保全與T849審查passed，Git交付待完成 |

本輪沒有再改runtime source；362tests、T848及source CI證據沿用固定PR809，沒有宣稱重跑完整suite或真人瀏覽器。[T849獨立審查](../../../../.team/reports/T-849.md)已ACCEPT，只讀公開證據與主導去敏摘要；raw receipts由主導核對。任務板須等本輪證據PR合併才關閉HL。

文件／索引47project contracts及8llms、task／report validator、staged diff與9項私人literal檢查通過；Git交付走正常PR／必要CI／merge／remote readback，不直接推main。
