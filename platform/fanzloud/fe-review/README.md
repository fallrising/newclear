# fe-review — fanzloud

這個目錄是給 LLM agent 用的前端 review 工作包：定義如何檢查 fanzloud 的 UI、如何產生 headless 截圖，以及報告放在哪裡。它不是給人的操作教學，也不改變元件的文檔檔位。

**狀態：** 第 2 輪已交付（[R2 報告](tasks/round2/report.md)）：合成 HTTPS/WSS review harness、M2 修正與 M3 擷取均已實跑並經獨立審查；`targets.json` 為 `verified: true`。真實後端與 Cloud 整合、第 3 輪不在範圍內。

| 檔案 | 用途 |
| --- | --- |
| [PROMPT.md](PROMPT.md) | 給 agent 的專案專屬指令 |
| [REVIEW.md](REVIEW.md) | 活文件：目前輪次、矛盾點、需要放開或決定的點 |
| [targets.json](targets.json) | `capture.mjs` 的擷取設定：review harness origin `https://127.0.0.1:8443`、唯一頁面 `/`，無 start；只由 `shared-capture.mjs` 在隔離容器內提供服務 |
| [DESIGN.md](DESIGN.md) | 第 2 輪 M1–M3 修改範圍 |
| [tasks/round2/report.md](tasks/round2/report.md) | 第 2 輪結果、命令、證據與限制 |
| `runs/` | 每次執行一個以 run id 命名的私有子目錄；結果、截圖與收據不提交，備份另存 |

共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)；截圖腳本：`docs/fe-review/capture.mjs`。
