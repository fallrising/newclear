# PSL：原看板快照順序修正已接入

Owner在PS交付後同意已提出的原看板更新；沿既有明確部署批准與[PSL01–04](../snapshot-rollout.md)邊界。固定已合併PR905 head `2c4a112351d77d40a2201044d3872fbaef7e7c22`，不是未審查source。2026-11-01T11:45:28Z完成收據核對，原Worker新版100%。

## 實際部署與保全

| Gate | 結果 |
| --- | --- |
| PSL-01 | 六份固定候選與git逐byte相同；active版本與上次RAL相符，三Worker modules等於候選；原193commands／222firings／186journal、active0、4grants。 |
| PSL-02 | 保存原100%版本回退request；三份asset manifest只有dashboard.mjs改變，session要求一個bucket／一份資產，實際上傳一次；Worker發布一次，secret_text用keep_bindings繼承，無runner暫停。 |
| PSL-03 | 回讀新版100%、三modules逐byte不變，settings除provider annotations外相同；D1應用schema／稽核歷史保持，原193commands整列、222firings與186journal全部保留；最終193commands／active0。 |
| PSL-04 | 原Access app／policies／token期限、4grants、Cron、domain routing保持；原runner同PID／NRestarts，本機unit/config/policy/Grok/bot ledger hashes及journal identity相同。原始私人收據由lead核對；公開審查與Git門檻另列。 |

[去識別收據](m1-snapshot-rollout.json)保留實際時間、六份候選hash與結果，不含account／domain／resource／command IDs或憑證。原管理、D1、service、journal、upload與publish receipts以具名exclusive-create保存在新的私人持久目錄；沒有覆寫舊證據。全程一次upload session、一個asset bucket及一次publish，無失敗或重播。

既有helper的發布收據欄位`assets_uploaded=3`實際指manifest條目數；最終驗證另從session buckets及upload receipt核對**實際上傳1份、manifest3份**，舊收據保留而未改寫。沒有把重用的兩份資產算成重新上傳。

## 驗證層級與限制

- [PS source/local](m1-snapshot-ordering.md)的446tests、16真本機browser checks／114API／零error及T861獨立ACCEPT是固定候選的歷史驗證；本輪沒有重新跑真人瀏覽器，也不把本機注入案例說成線上故障注入。
- 已上線asset由候選hash、manifest、bucket bytes／成功回應、completion token及publish／active-version回讀支持。版本resources不是原asset bytes下載；沒有真人session重新下載比hash，依owner要求不重開Console／Safari／手機驗收。
- 機器self與resident查詢通過只支持既有機器通路／期限，不能代替真人asset驗收。secret值沒有讀回；採繼承且secret binding metadata保持，不聲稱逐值比對。
- 原resident保守停止仍2026-11-05T07:24:25Z；runner HMAC/grant仍07:34:26Z，Access machine token仍07:43:27Z。過期human／bot沒有續期，Cron仍原15分鐘設定，沒有提交額外健康命令。
- 無D1 migration／歷史清理、服務重啟、權限輪替或付費升級。Provider用量／帳單unknown保持；本輪沒有實際帳單為零的證據。回退request已保存但未執行，回退只換原兼容Worker版本且保留D1全部歷史。

此次看板修正已部署；完整mainline仍incomplete／usable_tag none。後續遠端unknown/in-flight隔離還原與provider用量等缺口依[剩餘工作](../remaining-work.md)處理；不把部署成功當成所有主線驗收完成。

## 審查與文件gate

T862獨立公開證據初審要求修正四份入口的現在式「未部署」；改為PS當時狀態與後續PSL已接入後，集中複審ACCEPT。主導核對私人收據；審查者未讀private或重跑live。51contracts／9indexes／task-report／diff、402相對連結、67runtime inputs不變與8項私人literal未進公開diff通過。Git／CI與結案見任務板。
