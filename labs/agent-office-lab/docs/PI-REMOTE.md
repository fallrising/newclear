# Pi + DeepSeek 有界工位驗收

此 runner 使用固定 Office 的原生 Pi PTY／extension／authenticated hook，只接一個新建的合成 workspace。現有 OpenCode demo 不變，不啟動 Strata；不是三 provider 完整產品入口。

## 命令

先依 [遠端設定](REMOTE-SETUP.md) 完成 Pi 1.4.0 與 DeepSeek key。從元件目錄執行：

```sh
# 只列出具體計畫，不開服務、不讀 key、不送模型請求
python3 scripts/run_pi_work.py
# 真實 Office／Pi 啟動及原生 session hook；relay 禁止任何遠端模型請求
python3 scripts/run_pi_work.py --check-startup
# 經 owner 授權才執行一次付費合成任務
python3 scripts/run_pi_work.py --allow-remote
```

需 macOS sandbox-exec、Node、固定 vendor build 和 lab 內 Pi 套件。既有 `requirements.txt` 的 psutil 不被本 runner 使用；系統 Python 3.11+ 即可。每次建立新的 `runs/pi-work-*`，失敗紀錄不覆寫，沒有自動重跑。

## 固定邊界

- DeepSeek endpoint 固定 `https://api.deepseek.com/chat/completions`，模型固定 `deepseek-flash`。本機 relay 最多轉送四次請求，並行請求拒絕；任何 provider 錯誤後停止轉送。
- 每次原始 JSON payload ≤32 KiB，relay 強制 `max_tokens=512`、`n=1`、thinking disabled。這是請求／token 限制，不是美元帳單上限；由 provider 按實際用量計費。SDK／agent 自動重試及 compaction 關閉，180 秒 runner 期限。
- DeepSeek 真實 key 只由 Python relay 讀取，不交給 Office／Pi。Pi 使用隨 run 產生的 loopback token；繼承的 provider keys、Node 注入設定及全域 home 不傳入。
- Pi 的 OS sandbox 限制網路為 loopback／本地 socket、寫入為本次 run，並拒絕讀取 lab `.local` 憑證目錄。不是完整 OS 讀取／egress audit，不宣稱 AC-11 已通過。
- 原生 Pi 只啟用 read/write，extension 只允許讀本次 `input.json`、寫 `result.json`；拒絕其他工具／路徑、symlink、非檔案及超過 4 KiB 的結果。這是 owner 授權的固定合成任務，不是一般任務自動批准。
- Office 工位僅允許一次 Pi spawn，固定模型，拒絕 shell／其他 provider／worktree／額外 repo／再次 prompt／resume。沒有 keep-open。

## 成功判定

必須同時具備：原生 Office session hook、Pi `agent_settled`、一致的 session/provider/model、實際 read/write 事件、正確 marker／sum 與結果 hash、relay 的真實成功回覆與 output usage。`agent_end`、CLI 啟動或單純產物存在都不算成功。成功後關閉 Office，驗證其 Pi PID 退出；強制停止或未確認清理會標失敗。完整取消／恢復仍需後續驗收。

原始 run 包含私密 session、終端及 fixture，不提交。公開證據只保存欄位白名單摘要與受測來源 hash。啟動測試及離線測試不代表付費推論已驗收；實際狀態見 [SUCCESS](../SUCCESS.md)。
