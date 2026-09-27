# fe-review — fleet

這個目錄是給 LLM agent 用的前端 review 工作包：定義如何檢查 fleet 的 UI、如何產生 headless 截圖，以及報告放在哪裡。它不是給人的操作教學，也不改變元件的文檔檔位。

**狀態：** 只建立了執行前的目錄與文件，尚未執行任何測試或截圖。

| 檔案 | 用途 |
| --- | --- |
| [PROMPT.md](PROMPT.md) | 給 agent 的專案專屬指令 |
| [targets.json](targets.json) | `capture.mjs` 的擷取設定（啟動指令、port、頁面；`verified: false`） |
| `runs/` | 每次執行一個 `<YYYY-MM-DD_HHMM>/` 子目錄：`REPORT.md`、`capture.json`；截圖不提交 |

共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)；截圖腳本：`docs/fe-review/capture.mjs`。
