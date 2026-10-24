# fe-review — hai-taskboard

這個目錄是給 LLM agent 用的前端 review 工作包：定義如何檢查 hai-taskboard 的 UI、如何產生 headless 截圖，以及報告放在哪裡。它不是給人的操作教學，也不改變元件的文檔檔位。

**狀態：** 第 2 輪原批准範圍本機驗證通過（PR586），待最終獨立複審／CI／交付。真實 ConnectedApp 同源 session／admission／Fake 與30張有界畫面已實跑；保留既有投影／回饋限制，不代表完整產品或第3輪驗收。

| 檔案 | 用途 |
| --- | --- |
| [PROMPT.md](PROMPT.md) | 給 agent 的專案專屬指令 |
| [REVIEW.md](REVIEW.md) | 活文件：目前輪次、矛盾點、需要放開或決定的點 |
| [DESIGN.md](DESIGN.md) | 活文件：第 2 輪的修改項目、啟動方式與第 3 輪驗收條件 |
| [targets.json](targets.json) | `capture.mjs` 的擷取設定（啟動指令、port、頁面；`verified: true`，僅原R2本機證據） |
| `runs/` | 每次執行一個 `<YYYY-MM-DD_HHMM>/` 子目錄：`REPORT.md`、`capture.json`；截圖不提交 |

共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)；截圖腳本：`docs/fe-review/capture.mjs`。

執行說明：[RUNNER](RUNNER.md)；本輪結果與歷史失敗：[報告](tasks/round2/report.md)、[去敏驗證索引](tasks/round2/verification.json)。
