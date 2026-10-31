# UL：應用用量觀測部署與部分驗證

## 最新真人驗證

Owner於2026-10-31使用Safari登入，回報觀測時間12:18:35Z：保留122/10000（剩9878）、近24h84/1440（剩1356）、active1/1（剩0），畫面顯示快照約46秒、時間估計誤差2秒。主導另以唯讀D1聚合按同一24h窗口核對，三項數字相符，無觀測時間後新增command；不是同一transaction或獨立擷取的browser HTTP receipt。登入與手動用量功能驗證通過，unknown仍佔槽，不代表排程已恢復。

Owner指出驗收過細並要求加快；取消要求owner執行Console逐asset hash比對。這項額外技術檢查明確未做，不記為通過；以實際Safari功能回報加管理數字核對接受本輪真人讀取。Safari是正常支援客戶端，不需換瀏覽器、傳session或再做同一測試。後續優先處理unknown的可稽核處置，不擴大真人驗收流程。Human窗口仍固定12:08:10Z至12:38:10Z，不再續期。

以下保留早先部署階段的partial狀態與失敗紀錄；後續真人回報以上段為準。

## 原部署階段結論

2026-10-31原Worker已發布PR827固定候選，新版本100%；三個module管理下載逐byte相符，三份assets已由新session／bucket上傳並在同次Worker metadata附completion JWT。原D1／Access／secrets bindings／Cron／所有期限保留。**UL-03尚未完成**：runner不是human且沒有commands:read，靜態頁面及usage403；正向資產HTTP bytes、usage200及真人登入未驗，不能以成功上傳或拒絕結果代替。

[實際去識別核驗收據](m1-usage-live.json)時間2026-10-31T10:08:42Z。Raw management、upload、HTTP及本機證據在私人operator目錄0700／0600；未進Git。這輪沒有runtime source修改；[UO](m1-usage-observation.md)的387tests／14本機瀏覽器情境是來源證據，不冒稱本輪重跑或live畫面。

## 來源與操作

來源[PR827](https://github.com/fallrising/newclear/pull/827) head `98a0692e1883fdbac3b0a6f026c0223c05620461`，六檔固定候選與本機／main source相符。下載原live modules與HW候選逐byte相符；相對UO只有index新增usage函式／route，auth/protocol一致，claim／report／Cron沒有改動。部署前保存原active version100% rollback請求，尚未使用，不宣稱回退已演練。

單次assets session成功，所需buckets按三份候選byte/base64與manifest上傳成功，取得completion JWT；fresh再核對原deployment/settings／四grants／unknown immutable identity及同PID服務，才執行一次既有Worker upload。keep_bindings繼承secret_text，沒有以舊MACHINE_KEYS替換。新active版本100%，settings僅provider部署annotations更新；active version七bindings與目前settings相同。沒有secret值的公開回讀／相等宣告；runner self驗證當前runner key，過期bot401確認沒有默默續期。

## 前態發現的未知結果

完整preflight在部署前已發現due09:15（admit09:15:29、dispatch截止09:16:29、execution截止09:17:29 UTC）命令處於reconciling，本機journal同一identity為unknown、artifact／started／finished全null。09:30／09:45／10:00三次Cron為skipped_overlap。原runner仍active/running、NRestarts0，持續claim新fence並回報同一unknown，沒有重新採集。初始原因無法由現有journal／event log確定；不能斷言是網路、程序或collector故障。

先觀測並證明此次source不改派送／回報語義後，繼續唯讀看板更新。這符合UL「active非零先觀測、不取消／重放」邊界，**不是將active0檢查偽裝通過**。未知結果及active1完整保留；新版本沒有修好這個既有阻塞。後續需要獨立、可稽核的unknown處置設計，不能靠清DB、重建journal、標成功或重播解鎖。

## 實際保全與權限核驗

- 九項管理前後態：四grants、Access app/policies、token身份／期限、domain、workers.dev／preview關閉、Cron `*/15 * * * *`、HEALTH_SCHEDULE revision4及固定截止保持。Token只有正常last_seen_at推進。
- 122筆commands：121筆terminal逐欄相等；一筆unknown的immutable body／identity／active／無result保留，只允許原runner的attempt/fence／revision／updated_at正常推進。120筆firings全保留，核驗區間沒有新firing；沒有新command／cancel／清理。
- 本機118筆journal逐欄相等（含一筆unknown）；unit／config／policy／Grok client／bot ledger hash不變，journal device/inode不變。runner同PID、NRestarts0，self與resident成功；保守stop_at仍2026-11-05T07:24:25Z，runner HMAC/grant07:34:26Z，Access07:43:27Z。
- 三個module下載逐byte相符。帶runner憑證的根頁／styles／dashboard及GET /api/usage均403 SCOPE_DENIED；已過期bot GET /api/usage401 UNAUTHENTICATED。匿名根頁／dashboard／usage三處302到HTTPS Access，不跟redirect。
- HMAC檢查與常態runner會寫nonce／更新對帳；不聲稱D1零寫入。沒有手工觸發collector、停重啟服務、續角色、改Cron或新增付費。Workers Free依owner原確認，實際帳單仍未驗。

## 失敗及未完成項

1. 初次D1收據遭MCP預設截短，commands／firings混入string placeholder，摘要計算停止。當時只讀，未部署。helper設truncate:false將完整結果直接存私人檔，以新before2標籤重採；原失敗／收據保留。
2. 與昨日token回應全欄比較失敗：昨日無tags欄、今日為空object，last_seen_at推進。只在歷史對比確認兩者tags均空；身份、期限與其餘欄相等。當次before2／after仍除last_seen_at外逐欄相等，不忽略任意tags變化。
3. 初次資產讀回錯誤期待runner可讀頁面，實際403使驗證停止。原static route先要求ctx.human，再要求commands:read；runner先被human條件拒絕，不能只歸因於缺read scope，保留失敗。後續只驗證拒絕邊界，不把403降格當成UL-03正向asset成功；asset HTTP bytes與usage200均pending。

獨立審查另指出，403本身不能證明特定route存在；存在性由管理下載的module/source對照支持。有效read機器角色也不足驗證static頁面，必須有效human＋commands:read。原說明歸因不完整已修正，失敗保留。

T-0028保持in_progress／end空白，UL01／02部署及保全有證據，UL03 partial，UL04只交付這次部分結果。完整AC06–08/mainline仍incomplete、無usable tag；provider analytics、帳單、自然到期、真人／模型與unknown處置未完成。

## 具體後續與owner協助

已準備但未執行human-only提案：owner準備登入時fresh讀取原human grant，再以原revision/policy CAS續1800秒，截止不晚於原runner保守stop_at。保留原principal／scope／capabilities；原能力包含submit/cancel，但本次驗證只做頁面與usage讀取，既有unknown不得處置。其他角色、Access、secrets、Cron及付費方案都不變，不自動續期。這需要owner另外批准，原因是既有批准明確要求保留授權期限；不是重新索取已授權的Worker發布批准。

批准後才開窗口，owner正常在瀏覽器登入；不要求傳密碼／session token。若owner暫時忙，保持過期，lead可先開發unknown診斷／顯式處置契約與隔離測試，實際結案另核對具體命令與授權。

[T852獨立審查](../../../../.team/reports/T-852.md)初審及唯一focusedfollowup均要求REWORK：修正文案的human／read邊界與403推論，第二輪只剩兩處索引字串。主導已逐字修正並核對；reviewer明示修正後支持接受部分記錄，主導依此接受文件，不改寫其實際REWORK，也不宣告UL03完成。文件／索引／task／diff檢查及9個private literals零命中通過；Git／CI以後續交付回讀為準。
