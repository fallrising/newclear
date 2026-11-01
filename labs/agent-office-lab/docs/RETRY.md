# Pi 的明確重試

同一任務最多兩次重試（初次 `attempt: 0`，再加 `1`、`2`）。沒有自動重試或排程。重試必須指定本 checkout 最新且失敗、完整清理的 Pi run；每次建立新 workspace／session，沿用同一份合成 input，保留所有原始報告、事件與產物。

```sh
# 用新版本建立本機 429 原始 run；不呼叫遠端模型
python3 scripts/office_dispatch.py run pi --execute --check-failure 429

# 使用上一步輸出的 pi-work-... 名稱；預設只顯示計畫
python3 scripts/office_dispatch.py retry pi-work-REPLACE_WITH_RUN_ID

# 明確執行一次重試；下一次須指定這次產生的新 run
python3 scripts/office_dispatch.py retry pi-work-REPLACE_WITH_RUN_ID --execute
```

只接受 `runs/` 下的單一 `pi-work-...` 名稱，不接受路徑、結果聚合前綴 `1:` 或其他 checkout 的 run。Pi 的固定合成任務、HTTP 401／429 與 CLI crash 模式均可建立紀錄。重試模式由原紀錄決定，不能在重試命令切換 provider、模型或故障類型。其他 provider 尚未接入。

遠端任務每次重試仍須 `--execute --allow-remote`，並取得當次實際付費授權；登入、先前成功或重試尚有次數都不代表已授權。故障模式不可加 `--allow-remote`。每次沿用固定 runner 的原有上限；兩次重試上限不是帳號或全域費用上限。

原始 run 保存 `attempts.json`，每個 run 保存不可覆寫的 `attempt.json`，記錄 root、parent、attempt、模式、受測執行程式與 fixture 摘要。更新使用私有檔案、fsync 與原子替換，完整預約在原生 CLI 啟動前落盤。派工與直接 runner 共用執行鎖；跨 exec 從同 PID 的受保護 journal 傳遞 parent，執行時重新檢查計畫，防止過期計畫與重複派工開出分支。

以下情況會拒絕：第三次重試、重試舊分支、完成／取消／啟動檢查、尚未產生最終報告、清理未確認、損壞或不一致的歷史、符號連結／路徑逃逸、fixture 或受約束執行程式已改變。升級前沒有 attempt 紀錄的歷史 run 不會自動匯入，以免猜測先前重試次數。

中斷後的處理採保守原則：如果已預約新 run 但尚未留下可靠結果，不會回退計數或重試舊 parent。`acknowledge-interruption` 只解除已核對清理的執行阻擋，不重設次數、補造結果或自動繼續。這個版本不提供修復損壞 ledger 的命令。

這是單 checkout、受控入口的合作協定；新建獨立任務、直接啟動原生 CLI、手改檔案或其他 checkout 不受同一個任務計數約束。不能把它宣稱成防惡意操作者的安全界線。新 `run` 是另一項任務，不能用來冒充同一失敗任務的第三次重試。

[結果頁](RESULTS.md) 顯示首次執行／明確重試 1 或 2、原始紀錄及前次紀錄；顯示關聯不會執行命令。故障驗收通過的 run 仍顯示失敗；重新整理不觸發重試。

[本輪驗收](evidence/pi-retry-2026-11-02.json)：真實 Pi 以本機 HTTP 429 執行初次、明確重試 1、明確重試 2；三個 session、相同 fixture、每次一個本機請求及完整清理。第三次及兩個過期 parent 的 plan／execute 共六項均拒絕，沒有新 run；原報告／事件 hash 保持不變。152 項離線測試、46 筆結果的瀏覽器重試關聯與刷新通過。沒有載入本地模型或呼叫遠端模型。

Pi task／401／crash 的重試模式選擇與授權限制已離線覆蓋；本輪真實重試鏈只驗證 429。跨 provider、同 session 恢復、UI 派工及完整 AC-07 仍待驗。
