# T-0004 命令取消驗證

2026-10-31。Owner 明確更新交付授權為每個里程碑正常 PR 合併，取代歷史 Draft-only。

- `npm run check` 通過。
- `npm test`：39 passed，0 failed/skipped。本機 POSIX 真實子程序：SIGINT、SIGTERM、忽略 SIGTERM 後 5 秒強制終止，以及正常完成後 signal listener 清理。
- 子程序收到取消後即使 exit 0，wrapper 仍回 130/143，上報 error 而不是 done。取消測試 reporter 為 test double，不冒充模型宿主。
- 固定 Wrangler 4.156.0 真 local workerd／SQLite smoke 通過，涵蓋既有命令生命週期、重啟、CAS、去重與限流。
- 全倉 `check_indexes.py`（50 contracts、8 llms.txt）、`check_project_success.py`、`git diff --check` 通過。

作者自檢：沒有命令輸出捕捉、沒有憑證新增暴露、取消固定上報 error、不重試命令。無獨立 reviewer 通過聲明。Windows 的 POSIX signal tests 明確 skip，未宣稱 Windows process tree 終止已驗證。

仍不保證 SIGKILL／斷電、HTTP 上報階段被終止、自行脫離 process group 的程序；長任務 heartbeat、原生宿主 hook、瀏覽器和部署尚待驗收。AC-07 整體仍 pending。
