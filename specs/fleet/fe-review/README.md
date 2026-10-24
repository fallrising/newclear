# fe-review — fleet

這個目錄是給 LLM agent 用的前端 review 工作包：定義如何檢查 fleet 的 UI、如何產生 headless 截圖，以及報告放在哪裡。它不是給人的操作教學，也不改變元件的文檔檔位。

**狀態：** 已批准第 2 輪 M1–M9 實作與限定驗證通過，`targets.verified=true` 僅指 R2。保留3個頁首對比 serious 與2個 node/service meta-refresh critical（4 desktop axe，incomplete0）；完整 R3 未通過。獨立最終審查／CI／發布由 root 收尾，Cloudflare OTP 與產品 mainline 仍未完成。

| 檔案 | 用途 |
| --- | --- |
| [PROMPT.md](PROMPT.md) | 給 agent 的專案專屬指令 |
| [REVIEW.md](REVIEW.md) | 活文件：目前輪次、矛盾點、需要放開或決定的點 |
| [DESIGN.md](DESIGN.md) | 活文件：第 2 輪的修改項目、對外契約與驗收方式 |
| [targets.json](targets.json) | `capture.mjs` 的擷取設定（啟動指令、port、頁面；`verified: true`，僅 R2） |
| `runs/` | 每次執行一個 `<YYYY-MM-DD_HHMM>/` 子目錄：`REPORT.md`、`capture.json`；截圖不提交 |

共用規範：[PROTOCOL.md](../../../docs/fe-review/PROTOCOL.md)；截圖腳本：`docs/fe-review/capture.mjs`。


本輪入口為 [run-review.mjs](run-review.mjs)，由 orchestrator 在隔離容器以已建置 `fleetd` 啟動。它建立私有 state、以既有 API seed、真表單登入，生成分離匿名登入與受保護頁面的 targets，呼叫未修改的共用 capture。`seed.sh` 是原設計候選名稱；實作集中於同一擁有者監督的 runner，沒有另加 Shell seed 或 npm runtime dependency。

容器內指令（由 root 建立唯一 state/evidence 掛載後執行）：

```sh
node /work/specs/fleet/fe-review/run-review.mjs final /fleetd /evidence/final-001
```

`/state` 必須是執行 uid 擁有的 0700 目錄，輸出子目錄不得已存在。`/work`、binary、observer modules、Chromium cache 均唯讀，只有私有 state/evidence 可寫；不掛 host Docker socket、不開 host port、network none。token 只在 RAM／child env／0600 私有 SQLite 與 storageState，清理後不保留。不得直接以舊 `go run` 或未知目錄 `mkdir` 代替這個生命週期。

安全摘要與限制見 [本輪報告](tasks/round2/report.md)；原始 PNG/logs 在 ignored `runs/round2-*`，由 root 保存。`targets.verified` 僅代表已批准 R2 範圍，不能代表 Cloudflare、工作負載、產品可用或完整 R3。
