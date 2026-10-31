# M1 故障矩陣：證據與缺口

此表逐列對齊[原驗收矩陣](verification.md)，不是新增十四個產品功能。`local`指真實Worker handler配本機SQLite、Python／HTTP／子程序；`workerd`／`remote`只有歷史具名證據支持時才列。過去live結果不是本輪重跑，也不保證目前所有授權有效。FQ補強不自動把AC-07整體改為passed。

| 原列 | 已有可定位證據 | 層級／目前結論與缺口 |
| --- | --- | --- |
| F01 同key同payload | [control](../tests/control.test.mjs) `admission persists...`及FQ artifact expiry：同ID、相同整列／保留總數；[RF](evidence/m1-remote-recovery.md)原bytes重送同ID | local＋歷史remote子集；不主張所有並發拓撲已驗。 |
| F02 同key不同payload | control admission conflict、FQ artifact expiry改parameters後409及整列不變 | local；remote changed-payload對帳未補跑。 |
| F03 未授權caller/resource/recipe/revoked grant | control scope、grant revision、HMAC/replay/JWT guards；RF revoked submitter／runner403、Access token停用401 | local＋歷史remote撤權子集；request id／HTTP拒絕不等於持久拒絕稽核，也不證明所有真人session撤銷。 |
| F04 D1已保存但通知失敗 | [migration](../apps/control/migrations/0001.sql) command row即outbox；control admission／claim及schedule transaction rollback；[runner](../tests/test_runner.py) completed先持久化再回報 | 目前由runner輪詢，沒有獨立通知通道。持久列可領取不等於注入過「通知失敗」；原場景差異保留，不為驗收加Queues。 |
| F05 接收後／回報途中斷線 | runner `completion_persisted_before_failed_report_and_exact_retry`、`started_restart_never_recollects`；[FR](evidence/m1-recovery.md)及RF送達前斷線／ACK遺失／started後SIGKILL | local、歷史workerd及remote具名案例；整機斷電未驗。 |
| F06 stale fence／錯誤來源回報 | control stale fence與scope guards；FQ exact lease expiry在等號邊界409且整列不變；RF獨立reconciler舊fence409 | local＋歷史remote舊fence；完整wrong-holder／持久拒絕audit仍有缺口，不以HTTP回覆充當audit表。 |
| F07 submit撤權／到期、lease過期且run不明 | control revoked submit／reduced runner；runner `expired_reconcile_still_reuses_completed_evidence`；RF獨立reconcile-only grant與保留原時間／artifact | local＋歷史remote撤權reconcile；不可新增dispatch或刷新原deadline。[ULR](evidence/m1-unknown-resolution-live.md)是另外明確批准的unknown結案，不取代原run結果。 |
| F08 deadline後送達 | control原late case及FQ late delivery兩案例：完成恰好deadline可fresh/passed；完成超過一秒為incomplete/unknown；送達兩者皆late，原時間保留；payload自填late拒絕 | local；精確remote邊界未重演。late是接收metadata，不能把「晚送達」與「晚執行完成」混為一談。 |
| F09 deadline／取消／完成競爭 | FQ cancellation before/after completion、same-revision barrier競爭、unknown取消、兩種首次dispatch截止、exact lease expiry | local真SQLite交錯；一寫勝出、另一409，補報不覆寫成果；取消只是意圖，結果已完成可保留成功，unknown仍active。不是多isolate或實體停止證據。 |
| F10 artifact大小／digest／schema | control malformed artifact記validation failed；FQ rejected report payloads驗16385bytes拒絕且整列不變、改terminal bytes409；FQ expiry用獨立Node crypto算SHA-256並驗下載exact bytes | local；receiver計算digest，report無client digest欄。後續[DI](evidence/m1-artifact-integrity.md)新增client原bytes digest核對，真本機browser驗exact下載及空白篡改拒絕；remote／真人下載未因此自動通過。 |
| F11 事件重複／亂序／漏seq | control report重送、[dashboard](../tests/dashboard.test.mjs) session失效／舊inflight處理 | M1採輪詢快照，沒有seq事件consumer；原事件場景尚未實作／驗收。不能用report去重替代漏seq恢復，也不能靠本文件默默豁免原要求。 |
| F12 runner/control恢復與schedule重送 | [health-schedule](../tests/health-schedule.test.mjs) concurrent due／revision CAS、same due／misfire／rollback；[quota](../tests/quota.test.mjs)不補跑舊due；[service](../tests/test_service_runner.py)真程序restart journal；FQ expiry七天後原due不改firings | local；ULR歷史remote保留舊journal／firing且新Cron成功。不是遠端整個控制面故障切換或長期uptime。 |
| F13 瀏覽器離線／stale | dashboard freshness／unknown及[UI瀏覽器證據](evidence/m1-dashboard.md)真Chromium/workerd offline-stale；[UL](evidence/m1-usage-live.md)owner Safari登入／手動usage與D1相符 | local browser＋owner歷史功能讀取；不宣稱Safari重演全部故障。依owner指示不再要求Console hash／手機驗收。 |
| F14 隔離備份還原 | [首次D1還原](evidence/m1-isolated-restore.md)真export/import、schema/rows/artifact一致、completed及未派送對帳 | 歷史remote限定子集；unknown／in-flight跨D1與journal還原、正式failover尚未驗。RF與ULR不是restore測試。 |

## 接續順序

成果完整性下載已補DI source／local browser驗證，接續補拒絕稽核缺口，再設計unknown/in-flight的隔離還原演練；跨系統快照必須按identity對帳。事件seq／通知場景需先明確對齊M1輪詢設計與原契約，不能為填表加入未要求的事件平台。所有新live故障或資料處置另需具體可審閱方案；不再次打斷目前正常runner。
