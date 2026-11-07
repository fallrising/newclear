# Grok 原生啟動驗證

本輪只檢查官方 Grok Build 1.0.70 的原生 Office PTY 啟動、登入等待與停止。固定上游、安裝方式見 [SETUP](SETUP.md) 與 [遠端 CLI 設定](REMOTE-SETUP.md)。原有 owner 登入檔不會被讀取或修改。

在 lab 根目錄執行：

```sh
python3 scripts/run_grok_startup.py
python3 scripts/run_grok_startup.py --check-startup
```

無旗標只列出計畫，不啟動服務。`--check-startup` 限 macOS，使用全新合成 workspace、HOME／GROK_HOME 與短路徑 Unix socket；Grok 子程序繼承 OS sandbox，外部網路遭拒，保留 Office loopback hooks 與本次 Unix socket。啟動前以保留測試位址確認外部 TCP 返回權限拒絕。這是外部連線拒絕子集，並非整棵 Office 程序樹的完整 egress／讀取隔離審計。

上游加入的 `--trust` 僅信任本次新建合成 workspace，明確保留這個行為；未使用 `--always-approve` 或 bypassPermissions。wrapper 精確驗證 argv 與 session UUID，拒絕 prompt、resume、其他模型或 socket；停用工具、subagents 與 web search。Office policy 同時封鎖後續 prompt、終端輸入、額外工位、帳號、worktree 與 repo。不能把這個 runner 當成任意任務入口。

驗收要求真正的 Grok 1.0.70 原生登入畫面，並收到 Office 的 `needs_input`；不只等待固定時間。`status=completed` 表示啟動檢查完成，`outcome=login_required`、`task_completed=false`、`session_hook_verified=false` 明確保留。未登入不會產生 SessionStart；不能以 Office 預先產生的 UUID 宣稱原生 session 已驗證。

最長 45 秒後停止；Office 先關閉自己的 PTY，再按本次程序祖先及唯一私有 socket 追蹤額外背景程序，發訊號前核對 PID 與 command。不按程式名稱批量終止。原始畫面／日誌只保存在忽略的 runs；公開證據使用白名單欄位，沒有 session ID、PID、路徑或登入連結。

2026-11-01 實測：12.83 秒，原生登入畫面、starting → needs_input、外部 TCP 拒絕及完整清理通過；額外停止一個本次背景程序。28 項 Node、19 項 Python 離線測試通過。[公開證據](evidence/grok-startup-2026-11-01.json) 同時保留第一次誤等 SessionStart 而超時的失敗紀錄。

後續仍須建立登入後的工具／請求限制與有界任務 runner，才安排 owner 授權的配額／付費驗收。本輪沒有遠端執行旗標，不需要 owner 重做登入；AC-03、Grok 的 session hook、模型來源、產物及其他生命週期都保持待驗。
