# 本機操作台

從 lab 目錄啟動：

```sh
python3 scripts/office_console.py
```

開啟啟動時顯示的本機網址。啟動操作台不會載入模型或派工；先選工位、檢查環境、查看計畫，再按「確認並啟動」。若 Strata 不在預設位置，沿用 [SETUP](SETUP.md) 的 `STRATA_HOME` 設定。服務只監聽 `127.0.0.1`，預設隨機 port，可用 `--port` 固定。

## 本輪可操作範圍

- 四 provider 的固定 CLI／環境偵測與計畫。
- [單檔修改提案](LOCAL-FILE-PROPOSAL.md)：選擇目標、自訂修改、查看差異並下載替代檔案，原檔不套用。
- [本地文字任務](LOCAL-TEXT-TASK.md)：登記目錄、自訂要求、查看及下載 output.md，原目錄不變。
- 本地 OpenCode／Strata 合成檔案任務。
- 本地任務完成後保留原生 Office 終端，從操作台開啟／再次開啟，並停止所屬 runner 與模型。
- Pi [同 session 重新連接檢查](PI-RESUME.md)、[原生取消檢查](CANCEL.md)、本機 401／429／CLI crash 檢查，以及已有有效 lineage 的本機故障重試。
- 執行狀態、四 provider 歷史結果、已核對產物與 SHA-256。

Grok、Pi 正常任務與 Cursor 的遠端計畫可查看，但 HTTP API 不接受任何付費執行；仍使用 [DISPATCH](DISPATCH.md) 的 CLI 及當次授權流程。本地文字模式接受自訂要求與已登記來源；目前不支援直接修改任意專案或遠端付費派工。

「合成任務＋保留原生終端」會持續載入本地模型，直到按「停止執行」。原生終端沿用固定 Office 的 lite 頁面與本地 provider 限制；首次開啟需填顯示名稱。操作台不代理終端 keystroke 或原始日誌；互動交由既有原生 Office。終端可繼續操作合成 workspace，仍不能據此宣稱任意檔案／網路邊界已完整驗收。

關閉分頁不會停止工作。重新整理只查詢同一個 job，不會重新送 prompt。若要停止，按「停止執行」，等待 runner 完成清理後才可派工；正常關閉操作台也會中斷本操作台擁有的 runner。不要以 exit code 0 當作模型任務成功：Pi 故障驗收通過的 run 仍顯示失敗。保留終端模式的最終結果為已停止，產物另行核對。

## 登入與執行邊界

登入 token 位於啟動網址的 fragment；頁面載入後移除網址中的 token，存於該分頁的 sessionStorage 以支援刷新。啟動網址及含原生登入連結的回應都屬私人資料，不應分享。關閉並重啟操作台會產生新的 token。

API 要求 bearer token、精確 Host；寫入另外要求相同 Origin 與 JSON，拒絕跨站、過大 body、重複 JSON key、任意 argv／路徑及其他未定義欄位。靜態頁面與 API 使用 no-store、CSP、no-referrer，沒有外部資源或 CORS 授權。結果沿用 descriptor-relative／no-follow 的白名單讀取。原始 runner 輸出只留在私有 `state/console/`，不透過 HTTP 傳回。

每份計畫有效五分鐘，只能執行一次；執行時重新檢查，尤其不能用過期的重試計畫開新分支。操作台同時只啟動一個 job，既有 dispatcher／直接 runner 的共用執行鎖仍是最後一道 gate。任意 HTTP 請求不能選 shell、任意模型或改寫費用授權。

瀏覽器與 job 清單不是持久化排程。操作台重啟不接管／重跑舊 job，磁碟 run 紀錄仍可讀取；強制終止操作台或 runner 的清理未確認時，沿用 `cleanup_unconfirmed` 阻擋與人工核對流程。正常關閉等待最多 45 秒；若 runner 尚未退出會提示清理未確認，不按名稱批量 kill 或自動解除鎖。

## 跨入口與重啟後的執行狀態

頁面頂部顯示同一 checkout 共用的執行狀態。另一個 CLI 或操作台的工作也會阻擋派工；不以目前頁面的 job 清單為唯一依據。

| 狀態 | 頁面行為 |
| --- | --- |
| `available` | 可以查看計畫並明確啟動；實際執行仍重新取得全局鎖。 |
| `busy` | 已有程序持鎖，禁止啟動新工作；回原入口查看。此頁不接管其他入口的 runner。 |
| `cleanup_unconfirmed` | 鎖已釋放但仍有中斷紀錄，禁止派工；不假設 PID 消失就代表所有子程序已清理。 |
| `unavailable` | 狀態檔損壞、符號連結、非私有權限或讀取錯誤，保守阻擋；不回傳 PID、路徑或原始錯誤。 |

狀態檢查只開啟既有目錄與檔案，不建立 lock／journal，不改寫中斷紀錄。它短暫嘗試 shared lock 以判斷另一個程序是否持有 exclusive lock；快照不是執行保證，dispatcher 的最終互斥仍保留。API 在啟動 runner 前重查狀態，因此舊頁面或直接 HTTP 請求也不能略過已發現的阻擋。被共用狀態拒絕的計畫需重新取得，不會排入自動重試。

唯讀 CLI：

```sh
python3 scripts/office_dispatch.py status
```

此命令不探測 provider、不啟動模型、不停止程序，也不解除鎖。`unavailable` 回 exit 1；其他成功讀取的狀態回 exit 0，不能用 exit 0 判定可派工，應查看 `shared_execution.status`。

若為 `cleanup_unconfirmed`，先依原 run 的私有紀錄核對所有所屬程序已退出；只有完成這個核對後，才使用既有 CLI：

```sh
python3 scripts/office_dispatch.py acknowledge-interruption --confirm-all-owned-processes-stopped
```

確認會歸檔原紀錄；它不會替你停止程序。頁面沒有解除鎖的 API 或按鈕。不要直接刪除狀態檔，或僅靠重開分頁、重啟操作台來處理中斷。作業系統仍持鎖時，確認命令也不會繞過它。

[重啟與共用狀態證據](evidence/console-restart-2026-11-02.json) 使用隔離測試目錄、真實 helper 程序與 Chrome；驗證持鎖、SIGKILL 後中斷、兩次操作台啟動、刷新不改 journal、明確確認後恢復及損壞狀態阻擋。沒有執行 provider 或模型，不能代替各原生 provider 的 host crash／session 恢復驗收。

## 歷史結果與驗證

可用 `--runs-root` 加入其他明確指定、唯讀的歷史目錄。派工與重試仍只作用於本 checkout；額外歷史不會被執行。請保留私人 runs／state，不提交至 Git。

離線檢查包括授權、同來源、固定命令、一次性計畫、停止歸屬、白名單與既有回歸。真實瀏覽器驗收腳本為 `scripts/check_office_console_browser.mjs`；必須明示 `--local-acceptance`，它會執行一次 Pi 本機故障與一次本地 Strata 任務，不能把它當作無模型的 smoke test。

本輪 [真實驗收證據](evidence/console-2026-11-02.json)：159 項離線測試、Chrome 完整本地流程及 52 筆結果回讀通過；包含第一次表單等待失敗、第二次資源 guard 停止與最終成功紀錄。最終追蹤的 107 個程序全退出、鎖釋放，零付費呼叫。

完整四 provider UI 派工、跨 provider 權限／取消／恢復、一般程式修改及完整安全驗收仍待完成；本輪不建立 usable tag 或部署。
