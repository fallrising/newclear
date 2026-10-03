# ERU-008：worker-2／3 元件重裝與恢復執行器

更新：2026-09-24 00:58 UTC。**本機程式與故障測試已完成，實機驗收尚未開始；ERU-008 仍進行中。** 目前 01–03 的 24 小時觀測仍在執行，既有 02／03 nginx 使目標非空；不能使用先前唯讀計畫執行重裝。

`rebuild-node --node worker-2|worker-3|worker-4` 現在依計畫所選節點綁定 SSH alias、ownership manifest、空節點／runtime、遠端 machine ID、元件 payload、排程 fence、服務停止／啟動、smoke 和元件 revision。所選目標之外的 worker、core、共享 runtime 與保留服務仍在隔離比較之內。`canary-start --exclude-node TARGET` 建立在另外兩台的精確 run-owned HTTP 守護；重裝 plan 與 execute 都必須核對 guard pair、健康、core patch、ownership 與當下狀態。`provider-reimage` 仍唯讀，非空 worker 不提供隱性 drain。

遠端 quarantine／installer journal 新增 node 身分，恢復時拒絕跨 worker 使用備份；歷史未帶 node 的 worker-4 journal 仍可核對。`recovery.py` 的新 source-bound plan 可對選定 worker 做 restore 或 resume，維持 checksum／未知資料拒絕、連續 HTTP 與回覆遺失後 corrective fence。恢復不增加成功重裝計次；原 failed plan 不重播。有界 `--fault-after` 主動故障演練仍只開放 worker-4，peer 恢復分支已有本機模擬，尚未做實機故障注入。

本機測試覆蓋 02／03 正向目標綁定、04 revision 不變、跨節點 journal 拒絕、舊 04 journal 相容、恢復 alias／守護對應、node up 回覆遺失與 peer 計畫安全閘門。完整本機測試 196 項通過；CI 另行確認。實機先前唯讀 plan `20260924T004232Z-1354c947` 因觀測 nginx 存在而 `executable=false`，不在觀測結束後重播。

後續順序：ERU-002 完整回收與判讀 → ERU-003 依原 run 精確清理 → 新的 03／04 guard plan 與健康 evidence → worker-2 新重裝計畫／執行／HTTP／配額與隔離驗收 → 精確清理 → 新的 02／04 guard plan → worker-3 同樣驗收。每一輪使用當下新 plan/hash，若任何結果不確定，先 reconcile、保留隔離，按新 recovery plan 處理。完成兩台實機驗收後才可將 ERU-008 標完成。
