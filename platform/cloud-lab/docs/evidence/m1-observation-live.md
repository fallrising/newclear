# Bounded observation rollout — 2026-10-29

Owner在了解兩小時上限後明確批准[RP方案](../observation-rollout.md)。本輪執行OL01–04；runtime固定PR724來源，human／scheduler不續權，不提交工作、不啟用Cron、不新增付費。

| AC | 驗收 | 狀態 |
| --- | --- | --- |
| OL-01 | fresh部署／binding／Access／D1／service／journal前態及有界UTC窗口 | passed |
| OL-02 | Access期限與Worker／HMAC／兩個grant按順序更新、逐步回讀、scope不變 | passed |
| OL-03 | 真實resident／IA一次採集、來源及期限對齊、正常停止與journal保持 | passed |
| OL-04 | 完整readback、任何失敗補償、獨立審查與Git交付 | 回讀／審查通過；Git結果見任務板 |

所有實際操作與原始receipts由主導保存在私人持久目錄，公開證據只記錄必要結果；準備與實際成功分開。若任何階段無法符合批准窗口，停止後續動作、依已批准補償方案對帳，保留未驗收項。

## 實際窗口與變更

T0為`2026-10-29T03:24:04Z`。Access更新使用自訂剩餘duration並預留60秒傳輸餘裕，沒有使用延長一年的refresh。回讀到期`2026-10-29T05:23:05Z`，早於批准上限`05:24:04Z`；client ID、name、enabled、secret version及前版secret期限欄位相等。本環境這次過期token的更新成功，不推廣成其他更新或重試都會相同的保證。

bot／runner HMAC及grant到期為`2026-10-29T05:14:04Z`，resident stop-at為`05:04:04Z`。只修改兩個MACHINE_KEYS entry的expires_at，原ID／generation／secret／principal／grant引用不變。兩個grant使用新鮮AS snapshot產生AL CAS，逐筆meta.changes=1、revision從1到2；policy語義只有expires_at改變，human／scheduler grant原樣保持過期。沒有新的token、key輪替或scope／capability擴張。

Worker使用固定PR724 modules與原三份assets，重新取得assets completion；bucket清單空，沒有重傳已存在的資產。發布後新version100%，settings、binding metadata與script_runtime投影相等。Upload明確保留secret_text並只指定MACHINE_KEYS更新，ACCESS_CONFIG未被重新寫值。管理面不能讀secret值，因此沒有宣稱逐值回讀相等；後續兩個真實self請求以原config成功驗簽，支持其HMAC仍匹配。

## 真實整合與停止

原user service先確認inactive、MainPID0、journal鎖可取得且無started／unknown；journal依原config相對路徑解析。新unit通過systemd-analyze verify後原子替換，只更換固定runner來源、stop-at並追加私人socket；原config／journal、poll30秒、Restart政策、enable／linger維持。

一次IA採集於`2026-10-29T03:29:40Z`確認成功：10次管理面唯讀請求、最多兩次機器self請求與一次resident socket觀測。bot、runner、resident三個source_outcomes均verified；兩個機器的期限層齊全。採集保存私人snapshot／provenance及manifest，hash與0700／0600模式通過；self與resident使用已審查的身份／scope／config／kernel／FLOCK檢查。這是原Lab實際來源，不是合成管理envelope。

驗證結束立即停止本次resident，正常exit0、MainPID0、inactive，自己的socket移除；再查observer回固定不可用並退出1。這次預期拒絕是停止驗收，不是失敗重試。沒有等滿100分鐘或自行重啟，unit與journal保留，機器授權按批准期限自然到期。

最終回讀於`2026-10-29T03:31:06Z`完成：原domain／Access app與policy、subdomain／preview off、Cron空、settings相等；命令／schedules／firings相等、active0、schedule disabled；journal完整rows及device／inode相等。五個匿名入口回302，Location是HTTPS Access登入域，未跟隨redirect、未送credentials；這不是human登入或下載驗收。

IA仍輸出`live_verified=false`：各層期限齊全不涵蓋route、policy或部署版本驗證。這些部署與入口觀察由本輪獨立readback證據補充，不修改IA語義。已保存snapshot是當次觀察，runner停止後不能繼續用它聲稱目前仍在運行。

## 失敗、歸屬與限制

初次preflight把config的journal_path誤認為絕對路徑，在任何雲端請求前停止。查閱正式runner解析方式後，另存修正版檢查器，以config parent解析相對路徑；沒有搬動設定或journal。第二次preflight完成10次GET／SELECT及前態比較後，routing斷言讀錯欄位：version API使用raw_run_worker_first／serve_directly，而upload metadata使用run_worker_first。檢視已保存response確認前者true、後者false後完成核對，沒有重播請求或修改routing。原腳本、錯誤與對帳receipt均保留。

所有raw receipts、source／private hash、實際雲端與主機結果由主導檢視；獨立review只評估公開文件與去識別摘要，不宣稱reviewer自行驗證私人資料。沒有runtime source修改；214項測試是該固定來源的歷史證據，這次新增的是實際操作驗收，非重新執行本機suite。

本次沒有觸發補償或回退，回退request只是準備，不宣稱已演練。沒有新付費方案，未驗證實際帳單；沒有提交業務工作，正常HMAC／resident輪詢仍可能寫防重播nonce。沒有觀察到自然到期時刻，不能宣稱已驗到期撤權；只確認回讀期限及runner提早停止。human／scheduler仍過期、真人Access、常態服務、低頻排程、Grok／agent平台與完整AC06–08仍待驗收，無usable tag。

[T832獨立文件審查](../../../../.team/reports/T-832.md)ACCEPT，未發現與批准RP方案的矛盾；沒有讀私人receipts、跑測試或查雲端。Lead核對原始操作與本次文件／公開邊界，實際PR／CI／合併回讀由[任務板](../tasks/BOARD.md)記錄。
