# QV 應用配額隔離驗收證據

日期2026-10-30。範圍為[QV01–04](../quota-qualification.md)，原Worker不變；新增tests/quota.test.mjs及文件。使用真實Worker.handle／scheduled、HMAC與本機SQLiteD1，不是workerd、遠端D1或provider壓測。

## 實際結果

| AC | 證據 | 結果 |
| --- | --- | --- |
| QV-01 | API在1439／9999筆接受最後一格，取消後仍429 QUOTA_EXCEEDED；既有行逐欄相等 | focused passed |
| QV-02 | exact now−24h排除、一秒較新仍計入；24h後總數10000仍拒絕；舊payload重送、衝突與讀取不改原命令／期限 | focused passed |
| QV-03 | Cron兩種滿額均skipped_quota，無command／result孤兒，snapshot明示skip；原due重送保留、新due恢復；API／Cron交錯最多一個新command | focused passed |
| QV-04 | 8focused測試；三組副本mutation分別觸發3／5／2個測試失敗，source hash不變 | 8focused及370fulltests、T850獨立ACCEPT；Git狀態見任務板 |

完整回歸QV-full實際執行python3 platform/cloud-lab/tools/check.py：75Node＋295Python＝370項全通過，無skip。沒有runtime缺陷修正、部署、live請求、續權、清空歷史或付費操作。

## 測試鑑別力與原始失敗

新增案例驗證既有行為，沒有捏造產品RED。最初focused命令省略既有--test-isolation=none，僅得到子程序test failed而無內部結果；保留QV-focused。改用repo既有方式後8項有3項fixture失敗：錯用error.code及非整秒的公開時間。修正error欄位後仍有一項失敗，原因是Worker把now截至整秒，原fixture的毫秒created_at和真實API產生的一筆不一致；改為相鄰一秒，並斷言seed原始created_at。最終QV-focused-final為8pass／0fail／0skip，這些是測試fixture修正而非產品bug。

最初mutation跑在尚有fixture失敗的版本，QV-mutations保留但不採作最終證據。QV-mutations-final在GREEN基線副本改兩個准入SQL中的條件：<10000→<=10000得3失敗；<1440→<=1440得5失敗；created_at>?→created_at>=?得2失敗。預期assertion失敗證明邊界測試能抓到回歸。副本在共享build目錄，原6份source hash前後一致；沒有改正式Worker再還原。

批量歷史由一筆真實API提交／取消的record複製，補相符id、body、digest與record；不是10000次遠端執行。Promise.all只驗同程序SQLite交錯與SQL護欄，不能證明多isolate或遠端負載行為。命令保全不表示nonce表完全不變，正常HMAC認證仍會記nonce。

原始日誌在共享workspace project cloud-lab的QV-focused、QV-focused-no-isolation、QV-focused-green、QV-focused-final、QV-mutations、QV-mutations-final及QV-full任務preserve/evidence中。Python3.11本機未執行；provider配額耗盡、實際用量／帳單、retention刪除與完整AC-08尚未驗收。

## 審查與交付

[T850獨立source審查](../../../../.team/reports/T-850.md)ACCEPT，主導逐一核對diff、focused/full/mutation日誌、公開邊界與所有AC後接受此隔離驗收。三個文件／索引檢查、task／report及diff檢查結果保存在QV-docs與QV-final-docs。BOARD只有Git合併後關閉，交付狀態見[任務板](../tasks/BOARD.md)。完整mainline維持incomplete、usable_tag none；後續真人Access需要owner本人登入，具體限時human-only窗口另行準備，手機選測。
