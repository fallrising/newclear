# Pi 原生取消驗收

本輪補 Pi 在執行中被取消的生命週期子集。沿用固定 Pi 1.4.0 與原生 Office PTY，第一個請求留在無 API key 的 loopback relay；不呼叫 DeepSeek 或本地模型。

從 lab 目錄查看計畫，再明確執行：

```sh
python3 scripts/office_dispatch.py run pi --check-cancel
python3 scripts/office_dispatch.py run pi --check-cancel --execute
```

也可啟動 `python3 scripts/office_console.py`，選 Pi →「本機原生取消檢查」→ 查看計畫 → 確認並啟動。這是自動完成一次取消驗收的固定模式，不會保留互動終端。

Runner 等待原生 `working`、同 session 與本機請求確實到達，才透過 Office 的 `worker.kill` 發送取消並保留 workspace。固定上游會移除工位並關閉 PTY；本輪核對 `worker.remove`、原生 worker PID 在十秒內退出，以及三秒觀察期間沒有新 session／自動重跑。外層 runner 另外追蹤整棵所屬程序樹；原生 host 完成 shutdown 後，對仍存活且 PID／啟動時間均相符的本次後代送 SIGTERM。全部退出才釋放共用執行鎖，取消檢查另要求從取消到清理完成不超過十秒。這不宣稱遠端服務端已取消或計費已停止。

驗收命令退出碼 0 只表示取消檢查通過。任務保持 `cancelled`，沒有產物或模型推論；操作台與唯讀結果頁另顯示 `cancel_check_passed`。缺少原生事件、退出時間、零上游請求或完整清理證據，不標示通過。取消檢查不建立重試 lineage，也不能被當作失敗任務自動或顯式重試。

`--check-cancel` 與遠端授權、HTTP 故障、CLI crash、保留終端互斥；Grok／Cursor 不接受這個檢查模式。OpenCode 原有本地推論＋取消模式保持原行為。沒有沿用歷史付費額度、載入 owner key 或修改全域設定。

完整 AC-06 尚須 Grok／Cursor 與其他執行情境；Pi 的原 session 恢復、權限互動及真實遠端串流取消仍待驗。原生移除工位後不自動恢復舊 session。

[本輪證據](evidence/pi-cancel-2026-11-02.json)：163 tests、Chrome 派工與取消結果、55 筆唯讀結果回歸通過。最終原生工位 102 ms 退出，取消到整體清理 3.521 秒，外層追蹤 29 個程序全部退出。首輪總清理超時與第二輪背景子程序殘留保留；第二輪未確認鎖於事後逐一核對全部程序退出後才明確歸檔，沒有改寫原報告。
