# Pi Office host 重啟驗收

這個固定驗收流程會啟動真實 Pi 1.4.0，向不含 owner key 的本機 relay 發出一次請求並收到 HTTP 429。待原生工位顯示 needs_input、錯誤歷史寫入 session 後，runner 核對已追蹤的 Office 主程序 PID／啟動時間並注入 SIGKILL。

從 lab 目錄查看計畫，再明確啟動：

```sh
python3 scripts/office_dispatch.py run pi --check-host-restart
python3 scripts/office_dispatch.py run pi --check-host-restart --execute
```

也可在[操作台](CONSOLE.md)選 Pi →「Office 重啟檢查」→ 查看計畫 → 確認並啟動。這會自動跑完固定驗收，包括啟動本機 Chrome；需要 macOS、已安裝的 Chrome、固定 Office build 和 Pi CLI。沒有模型推論，不需要 DeepSeek 登入或 Strata。

新 Office host 沿用同一工作區及保存的 session，停止舊 PTY、把未完成工位停泊為 offline／interrupted。觀察三秒後再正常停止並啟動第三個 host，確認工位、session、原始歷史仍保留；原生頁面呈現 interrupted，刷新不自動派工。恢復 adapter 不修改 vendor。

Pi 恢復與 OpenCode 的續做方式不同：Pi 必須有保存的 session，不能攜帶 prompt，也不補送 continuation 指令。固定流程透過私有 IPC 為指定 worker／session 開啟一次性許可，再由瀏覽器點擊中斷卡片，送出原生 worker.resume。未授權點擊、錯誤 session、已有 PTY、額外 prompt 或再次使用許可都不能啟動。已有恢復工位也不能再建立新任務。

重連須得到新的 Pi PID、相同 session、第二次 session_start；六筆原始歷史位元組保留，另觀察三秒不增加 assistant、tool 或請求。這個模式不提供一般 session 選擇或任務續做，也不能作為重試來源。它與遠端授權、其他檢查模式和保留終端互斥。

正常關閉後，runner 對仍存活且 PID／啟動時間符合追蹤紀錄的所屬背景程序送 SIGTERM，再確認所有後代退出。清理未確認時不釋放共用執行鎖。結果保持 stopped，另標示 host_restart_check_passed；不把重啟成功顯示為原任務完成。

[本輪證據](evidence/pi-host-restart-2026-11-06.json)：195 項離線測試、真實 Pi／三代 Office host／Chrome 首輪通過，runner 41.06 秒。外層追蹤 83 個程序全部退出；一次本機 429、六筆歷史保留、零外部請求及模型推論；操作台與 63 筆結果回歸通過。

此為 AC-08／09／11 子集，測試 crash 時機是在本機 429 後等待輸入；不代表進行中的遠端串流恢復或任務續做通過。其他 provider、權限互動及完整安全驗收仍待完成，沒有 release、部署或 usable tag。
