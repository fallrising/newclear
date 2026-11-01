# ULR：已批准的原 unknown 線上結案

## 範圍與結果

Owner 明確批准相容部署、短暫暫停原 runner、指定 unknown 單筆結案、恢復原服務及一筆新 Cron 驗證。沿用 PR850 head `d84934526c75029c74ba93b09057dd6f9c17871f` 的11檔固定候選；沒有新的 runtime 修改、授權延長、資源新增或付費升級。這次操作已完成；完整產品主線仍 incomplete，無 usable tag。

| AC | 實際結果 |
| --- | --- |
| ULR-01 | 前態9項管理讀取、原config/journal與11檔候選核對；仍為原09:15UTC unknown，122命令、151firings、118journal rows、active1。 |
| ULR-02 | 17:59:47Z確認runner inactive/MainPID0；17:59:53Z新Worker100%、3modules逐byte一致、原settings與secret bindings保留。fresh原journal及D1→真正CLI→60秒exact CAS；17:59:54Z changes1，closed_unknown/result null、resolution審計及原journal保留，active0。 |
| ULR-03 | 17:59:54Z原unit/config/journal恢復，暫停約7秒。18:00:00Z due的新revision4 Cron由原runner執行，18:00:55Z結果succeeded、validation passed、healthy；新journal completed。舊unknown未重跑。 |
| ULR-04 | 最後9項管理回讀及本機對帳：123命令、152firings、119journal rows、active0。原121terminal commands逐欄相同，151firings與118journal rows完整保留；4grants、Access、Cron、原unit/config/policies/client/ledger與journal identity不變。證據、索引、審查及正常Git交付分別記錄。 |

時間均為2026-10-31 UTC。原runner保守截止仍2026-11-05T07:24:25Z；其他角色期限不延長。主導檢查私人raw收據、原SQLite備份與SQL前後值；公開[精簡機讀證據](m1-unknown-resolution-live.json)只含驗證結果，不含帳號、domain、command id、憑證或原row。收據來源為實際線上操作，不是測試替身。

## 操作與驗證

私人operator腳本依序執行 snapshot.py before、assets.py、apply.py、snapshot.py after、verify.py、observe.py、snapshot.py final、verify-final.py，保留逐次request/transport/response、CLI輸出與SQLite備份。沒有重播結案SQL或清理資料；只執行一次精確UPDATE且changes1。服務停止確認後，部署及來源回讀完成才重採單筆row；finally恢復原unit。新Cron由原排程自然觸發，沒有手動造任務。

初次apply在任何服務停止／Worker發布／結案前，唯讀source回覆為raw multipart，舊receipt parser以JSON解析而失敗。保留原transport，修正私人parser，直接解析同一回覆，沒有重發該請求或掩蓋失敗；後續部署／單筆CAS／恢復與最終驗證全部通過。此修正不改產品runtime。

Source已由T854審查及400tests驗證；本次無runtime修改，不將歷史400tests寫成本輪重跑。新增文件依現有index/project/task檢查及獨立證據審查交付，實際Git／CI結果以任務板為準。未重測Safari、未續human窗口，也未宣稱新的瀏覽器資產byte驗證或實際帳單為零。

## 限制與後續

原unknown的執行結果與初始原因仍未知；結案只是控制面准入決議，沒有捏造成功／停止證據。結案後不可回退不支援closed_unknown的舊Worker；任何回退版本須保留terminal guard。相容bot源碼已存在，過期bot沒有在本輪重新啟用或續權。

一筆新Cron成功不保證後續uptime或自然到期；完整AC-07／08、provider用量／保留策略與Grok模型流程仍見[剩餘工作](../remaining-work.md)。無需owner追加瀏覽器操作。

## 文件審查

[T855獨立公開證據審查](../../../../.team/reports/T-855.md)ACCEPT；主導核對實際私人raw收據。`python3 scripts/check_indexes.py`通過50個project contracts及8份llms索引；T855 task validator與`git diff --cached --check`通過。六個真實私人識別值未出現在staged diff。原始400tests為先前source證據，本輪未本機重跑。
