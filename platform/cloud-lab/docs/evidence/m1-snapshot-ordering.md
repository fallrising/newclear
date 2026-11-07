# PS：輪詢快照順序與持久outbox

範圍：[PS01–04](../snapshot-ordering.md)、T-0036。沿ADR-03／08的完整snapshot profile，修正看板舊版本倒退與scope改變後舊資料殘留；不新增事件平台、通知通道或第二套執行權威。本輪source/local驗證，未部署原看板。

## 實際驗證

- 新增7個看板測試：相同版本重讀／跨版本完整snapshot、低revision與同revision衝突整批拒絕、最多20筆且ID唯一／revision為正安全整數、lease到期合法投影、掛載UI保留原資料並阻擋操作後恢復、scope變化即使新read失敗仍清舊資料、401/403後重新建立基準。
- 真RED：6fail／1pass，其中掛載UI確實把revision5結果倒退為revision4未知，以及改scope後仍保留舊資料；另外4fail是尚未實作helper。GREEN：看板52tests全過，未減少斷言。
- 新增file-backed SQLite outbox測試：提交transaction成功後丟棄ACK，關閉並重開DB，逐列保持；runner領取同一command，同key重送保持claim整列，完成後再重開仍保留結果且無第二次assignment。此為真SQLite／Worker handler邊界，非通知服務故障或整機斷電。
- 完整回歸PS-full-network：138 Node＋308 Python＝446tests，全過、零fail/skip；Node24.14.0／Python3.13.5，既有SQLite ResourceWarning／experimental warning保留。
- 真本機workerd/D1＋Chromium＋Python collector：16checks／114API calls／零browser error。新增兩種GET回應注入（低revision、同revision不同result），真瀏覽器保留已保存結果、停用操作，fresh polling恢復；D1 command row完整不變。既有真HTTP admission ACK遺失→相同bytes重試→collector結果及artifact bytes下載亦通過。

[工具原始browser摘要](m1-snapshot-ordering-browser.json)逐byte複製，含三asset hash；實際Chromium154.0.8037.57／Miniflare5.20261019.2-beta。原始log、screenshots及collector artifact只存launcher evidence，不發布主機採集內容；手機viewport只是既有自動回歸，不要求owner測手機或Safari。

## 保留的失敗與限制

首次PS-red使用Node預設隔離模式只得到test-file失敗，不能算行為RED；改用repo既定--test-isolation=none後取得上述6個實際測試失敗。PS-full受sandbox loopback socket EPERM影響，Python35errors、Node原生async-id assertion，沒有當作通過；走正常escalation核准執行同一套PS-full-network，不改產品或跳過網路案例。

比較基準只限目前20筆、同scope與當前頁面；缺席／重開頁面不證明歷史未變。revision是command版本，不是source_seq；完整snapshot可跳版，不能冒充delta gap恢復。lease到期是既有Worker衍生投影，正規化後比較而不偽造DB revision。M0 Event inbox／seq／cursor／covered-through snapshot仍未實作，原契約保留；本輪只說明ADR-08 profile的適用範圍，不把事件串流驗收寫成passed。

正式看板尚未更新；Worker／runner／D1 migration、Access、secrets、期限及免費方案未改。沒有private state讀取或live mutation；provider費用仍unknown，完整mainline incomplete／usable_tag none。遠端unknown/in-flight restore與完整主線其他門檻仍見[剩餘工作](../remaining-work.md)。

最終T861獨立審查ACCEPT；主導evidence gate核對446tests、browser原收據及三asset hash、67份runtime/test/tool inputs。50contracts／8indexes／task-report／syntax／diff及437相對連結通過；Git／CI與結案以任務板為準。

後續[PSL原看板更新](m1-snapshot-rollout.md)已完成；PS階段「未部署」為歷史界線，不代表目前仍未接入。原服務、資料、權限與截止保持，未新增真人驗收。
