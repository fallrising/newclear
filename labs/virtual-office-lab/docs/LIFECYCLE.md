# Opt-in 命令生命週期上報

`node bin/office-run.mjs AGENT -- COMMAND [ARGS...]`

由有權限執行 shell 的 Agent 或人類明確選用。使用與 office-report 相同的 OFFICE_URL、OFFICE_TOKEN_FILE（建議）或 OFFICE_TOKEN，憑證不放 argv。AGENT 必須使用 roster 已登記的公開 alias（例如 content），不是任意模型名稱。每個 alias 只能有一個 reporter，不支援同 ID 多個 session 併發。

例如在已設定本機 endpoint／專屬憑證後，由 Agent 執行無敏感驗證：

```sh
node bin/office-run.mjs content -- npm test
```

它在執行前上報 terminal，子程序 exit 0 上報 done，非零或啟動失敗上報 error。done 僅指這個命令成功，不等於整個 Agent 任務或 HAI 審核完成。不解析輸出、不推測 thinking/browsing、不呼叫模型、不讀原生宿主 session。

- 命令直接 spawn，不經 shell；需要 shell 的命令必須使用者明確指定 shell。
- stdout/stderr 留在本機終端，不擷取、不放入 HTTP。命令／參數可能仍出現在本機 process list，禁止把秘密放 argv。
- 子程序環境移除 OFFICE_*，防止意外繼承 reporter token；不是 sandbox，同一使用者仍可能存取 token 檔案。
- 起始上報失敗：退出 125，命令不執行。最終上報失敗：印固定警告，成功命令改回 125；失敗命令保留非零碼。
- 無法啟動命令：127；觀察到子程序自行因 signal 結束：128。命令執行期間 wrapper 收到 SIGINT/SIGTERM 時轉送至子程序（POSIX 為整個 process group），最多等 5 秒再 SIGKILL；分別退出 130/143 並嘗試回報 error，即使子程序自行 exit 0 也不報 done。取消的 group leader 提前退出時亦清理剩餘 group members；自行脫離 process group 的程序不在保證範圍。wrapper 自身被 SIGKILL／斷電或在 HTTP 上報期間被終止無法保證最終回報，公開狀態須靠 stale 提示，不假裝 done。長命令沒有 heartbeat，超過 30 分鐘會 stale。
- 不會重試命令本身；HTTP 重試沿用既有有界策略。單一命令消耗兩次更新配額。

## 證據邊界

`tests/lifecycle.test.mjs` 驗證實際 Node 子程序成功、失敗、環境隔離與報告失敗；其 reporter 是明示 test double。`tests/cli.test.mjs` 另使用真 loopback HTTP、真子程序、production CLI／handler，上報 terminal → done 並讀回 revision 3；storage 仍是記憶體替身，不冒充 workerd。

`tests/workerd-smoke.mjs` 亦以 content 公開別名，透過真 CLI → local workerd → SQLite 執行實際 `node --check`，讀回 done／revision 2；這是 opt-in 命令 adapter 驗證，不是模型 provider 或原生宿主 hook。

尚未驗證長期宿主 hook、真實 UI 觀察、崩潰後恢復與公開部署。AC-07 保留 pending。
