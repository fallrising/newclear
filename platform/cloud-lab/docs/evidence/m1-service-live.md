# Routine service activation — SL01–04

2026-10-29，owner明確批准[SP方案](../service-activation.md)，並再次確認帳號仍為Workers Free：原Lab runner7日／poll60秒，runner grant／HMAC＋10分鐘、原共用Access上限＋20分鐘，包含異常停止／回退。human／bot／scheduler grant與bot HMAC不續期；原資料、scope、ID／generation／secret保留，不開排程／業務命令／付費方案。

| AC | 實際驗收 | 狀態 |
| --- | --- | --- |
| SL-01 | fresh資源／身份／用量／主機journal核對，owner確認Free，固定T0及UTC期限 | passed |
| SL-02 | 原Access、runner-only HMAC／grant更新並逐步回讀；其餘執行設定／業務資料保持 | passed |
| SL-03 | 實際policy、unit更新與resident啟動；runner-only IA／socket與最終回讀，成功後保持運行 | passed |
| SL-04 | receipts、異常對帳、公開證據、獨立審查及Git交付 | 回讀／獨立審查通過；Git結果見任務板 |

## 前置來源與批准

第一次執行停在方案來源缺口：訂閱GET回403，MCP明示該端點沒有OAuth scope；不是自動批准審查拒絕，也不能由reconnect解決。未索取新token或繞過端點。owner回覆「還是免費的。批准。」後，重新執行全部十次原Lab管理唯讀請求及主機核對，沒有把舊observed_at改新。Free方案來源是owner本次確認，不冒稱Billing API已通過。

新鮮部署仍為原100%版本，settings、domains、Access app／policy及service-token身份／client綁定均與原收據相符。workers.dev／preview保持關閉、Cron空、active commands0、schedule未開；四個grant未撤銷且保持原expired前態。原unit bytes、inactive／MainPID0、journal lock可取得、device／inode及completed rows相等。六份固定SR source逐檔SHA256通過，來源PR738 head `e97199a6482b8693334ec68e3a25b34a7a1666be`。

更新前取得Workers／D1 GraphQL分析：UTC當日Workers合計5requests、0errors；D1讀取122rows、寫入37rows。前次觀察為113rows read／37rows written，兩次各自保留，不混成同一snapshot。分析資料可能延遲／採樣，不能當作實際帳單或完整quota證明；沒有零費用保證或自動用量熔斷。指標說明見[D1官方analytics](https://developers.cloudflare.com/d1/observability/metrics-analytics/)。

## 實際期限與變更

| 層 | UTC實際值 |
| --- | --- |
| T0 | 2026-10-29T07:24:26Z |
| policy service_until（T0＋7日） | 2026-11-05T07:24:26Z |
| resident保守觀測stop_at | 2026-11-05T07:24:25Z |
| runner HMAC／grant（＋10分鐘） | 2026-11-05T07:34:26Z |
| 原共用Access實際expires_at | 2026-11-05T07:43:27Z |
| 批准Access上限（＋20分鐘） | 2026-11-05T07:44:26Z |

Access只更新原token custom duration，按絕對上限減執行時間及60秒餘裕；沒有一年refresh。回讀原ID、name、client ID、enabled、secret version及前版secret到期欄位不變。bot／runner共用這個入口token，因此外層入口期限一起延長；bot HMAC和grant仍過期，不能因此提交工作。

在runner grant仍過期時，以原MACHINE_KEYS為基礎只改runner expires_at。更新前逐欄驗證其他key metadata及原兩份config的generation／secret匹配；bot entry完全相等。使用原script secret PUT，未重新上傳modules或assets，未重寫其他secret。更新後新Worker版本100%，完整version resources（script etag、handlers、bindings、runtime／assets設定）與原版本相等。管理API不能讀secret值，不能宣稱server-side逐值回讀；後續原runner config的self驗簽及到期回讀提供實際支持。

settings嚴格相等斷言曾失敗：唯一差異是provider自動生成的`annotations.workers/triggered_by`從`upload`改為`secret`。保存失敗後逐欄對帳，其他settings及完整version resources相等，未重播secret更新；此部署來源metadata差異明示保留，不記成全部settings逐byte相等。

fresh AS五次管理讀取後，只為runner生成AL續期CAS，meta.changes恰為1，revision由2變3；policy語義只有expires_at改變。其餘human／bot／scheduler grants、commands／schedules／firings逐欄相等；沒有改已有command deadline或擴張capability／scope。

## 服務、來源整合與回讀

使用原config完整digest、實際Access到期與固定service_until生成四欄SR policy，0600／exclusive保存。候選unit通過systemd-analyze verify，原unit原子替換，daemon-reload並啟動一次。poll60秒、原Restart政策、原config與journal；沒有enable／linger變更。啟動時由runner自身驗證HMAC／grant，使用四層deadline的最小值和保守monotonic時間；不是從啟動或重啟再算7日。

IA於`2026-10-29T07:27:37Z`完成：10次管理唯讀請求、runner self及resident socket觀測。僅傳runner config，source_outcomes為runner=verified、resident=verified、bot=not_configured；runner deadline_complete=true，實際HMAC／grant到期相符。程序觀測期限比policy早1秒，符合保守取整；沒有要求bot verified而偷續bot。私人snapshot／provenance／manifest及0700／0600、內容雜湊均通過核對。

IA維持live_verified=false，因這個工具不獨自驗證route／Access policy／部署版本；本輪另做管理與入口回讀。不能把保存的snapshot當成持續liveness監控。

最終回讀於`2026-10-29T07:28:20Z`完成：原執行設定、domains、Access app／policy、token身份／到期、Cron空及關閉的preview維持；新Worker100%、active0、schedule off、業務rows及journal device／inode／rows相等。五個匿名入口回302到HTTPS Access登入域，未帶credentials／未跟redirect。resident active/running、NRestarts0、自己的socket0600，成功後**保留運行**，沒有沿用短驗證的finally stop。

## 失敗與驗證歸屬

前次preflight保留兩個operator錯誤：歷史receipt名稱前綴造成FileNotFoundError；version API資產路由欄位沿用舊名稱造成KeyError。修正為實際receipt名稱及raw_run_worker_first後完成唯讀核對；這次Free確認後全部fresh重採。另保留OpenAPI搜尋函式語法錯誤，修正為工具要求的函式格式；沒有對雲端變更的影響。secret更新後的部署來源annotation差異亦已對帳，不重播mutation。全部原始收據與失敗腳本留在私人持久目錄，未放Git。

主導檢視實際私人receipt與雲端／主機結果；獨立審查限公開文件及去識別摘要，不冒稱reviewer讀過private data或重新查過live。沒有runtime source變更；SP的249項本機測試是歷史證據，本輪新增為實際操作驗證及文件檢查，CI結果另記任務板。Python3.11本機未測的限制仍保留。

本次未觸發停止／回退補償，不能宣稱已演練；沒有新增paid plan或實測帳單。HMAC self／空閒claim會寫防重播nonce，沒有提交業務工作不等於D1零寫入。未觀察自然到期或7日連續uptime，主機／user manager停機仍會中斷；不自動續權。真人Access、低頻排程、Grok／agent平台、配額耗盡及完整AC06–08仍pending，沒有usable tag。

[T835獨立公開證據審查](../../../../.team/reports/T-835.md)ACCEPT；主導核對原始收據、文件與實際diff。本機project-success、llms索引、Cloud Lab連結／範圍、task／report合約及git diff檢查通過；無runtime source變更，未重跑本機249項suite。正常PR／CI／合併及回讀結果由[任務板](../tasks/BOARD.md)記錄。

本機llms validator首次執行時，新證據檔尚未加入Git index，故以git ls-files為依據回報broken in-repo link；加入本次明確scope的檔案後重跑，不改validator或移除連結，原失敗log保留。
