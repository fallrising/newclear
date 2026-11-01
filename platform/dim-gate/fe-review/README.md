# fe-review — dim-gate

這個目錄是給 LLM agent 用的前端 review 工作包：定義如何檢查 dim-gate 的 UI、如何產生 headless 截圖，以及報告放在哪裡。它不是給人的操作教學，也不改變元件的文檔檔位。

**狀態：** 第 2 輪（已批准 DESIGN M1–M3）：review-only 擷取工具與隔離實跑已完成；原生 E2E100案與單頁主題補證已通過，獨立複審已接受，等待 CI 與交付。見 [本輪報告](tasks/round2/report.md)；不代表第 3 輪驗收。

| 檔案 | 用途 |
| --- | --- |
| [PROMPT.md](PROMPT.md) | 給 agent 的專案專屬指令 |
| [REVIEW.md](REVIEW.md) | 活文件：目前輪次、矛盾點、需要放開或決定的點 |
| [DESIGN.md](DESIGN.md) | 活文件：第 2 輪的修改範圍與第 3 輪驗收方式 |
| [targets.json](targets.json) | `capture.mjs` 的擷取設定（啟動指令、port、頁面；`verified: true`，僅原批准R2本機驗證） |
| `runs/` | 每次執行一個 `<YYYY-MM-DD_HHMM>/` 子目錄：`REPORT.md`、`capture.json`；截圖不提交 |

共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)；截圖腳本：`docs/fe-review/capture.mjs`。
