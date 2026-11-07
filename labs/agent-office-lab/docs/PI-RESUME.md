# Pi 同 session 重新連接驗收

使用固定 Pi 1.4.0 與原生 Office PTY，先向無 owner key 的本機 relay 發出一次請求並收到 HTTP 429。真實 Pi 將使用者訊息及 assistant error 寫入自己的 session JSONL；核對錯誤與持久化歷史後，才對本 run 已追蹤且 PID／啟動時間相符的 CLI 注入 SIGKILL。

從 lab 目錄查看計畫，再明確執行：

```sh
python3 scripts/office_dispatch.py run pi --check-resume
python3 scripts/office_dispatch.py run pi --check-resume --execute
```

也可在[操作台](CONSOLE.md)選 Pi →「原生 session 重新連接檢查」→ 查看計畫 → 確認並啟動。這會自動跑完固定驗收流程，不接受任意 session、prompt 或私人任務。

原生工位須先呈現 exited，三秒內沒有自動恢復，才給指定 worker／session 一次性許可並送出原生 `worker.resume`。許可只接受固定 Pi／模型、已退出且無 PTY／daemon、非 host interruption 的工位；不能夾帶 prompt，啟動前即消耗，失敗也不自動重試。核對新 PID、相同 session、更新後的 authenticated hook token，以及 session 原始歷史位元組完整保留。再次 resume 不可產生第三個 session_start，另觀察三秒無新 assistant／tool／請求。

Runner 完整清理所屬程序後才釋放共用鎖。原生 host 關閉後仍存活的已追蹤後代，僅在 PID／啟動時間仍相符時送 SIGTERM。清理未確認會阻擋後續派工，不自動解除。

檢查通過時 runner exit 0，任務仍為 `stopped`，另標示 `resume_check_passed`；原任務未完成，沒有產物或模型推論。此模式不建立 retry lineage，也不能作為失敗任務重試。與遠端授權、其他檢查、保留終端互斥；不讀 owner key、不呼叫 DeepSeek、不載入 Strata。

[實測證據](evidence/pi-resume-2026-11-02.json)：177 項離線測試、真實 Pi、操作台及 57 筆唯讀結果驗收通過。最終 runner 17.72 秒，六筆歷史保留，外層追蹤 30 個程序全部退出、鎖釋放；一次本機 429、零外部請求。首輪原生驗收通過，但瀏覽器測試欄位名稱筆誤造成斷言失敗，原紀錄保留；修正後整輪重驗通過。

這是同一個 Office host 內的 CLI 重新連接子集，不代表 Office host crash 恢復、中斷任務續做、遠端推論或完整 AC-08／11 通過。Grok／Cursor 恢復、Pi 權限互動與完整四工位流程仍待驗。沒有 release、部署或 usable tag。

後續 T-0023 已另驗證 [Office host 重啟與無 prompt 重新連接](PI-HOST-RESTART.md)；本頁保留同 host 內 CLI 退出的驗收範圍。
