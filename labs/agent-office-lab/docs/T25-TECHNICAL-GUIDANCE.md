# T-0025 技術指導與分工

Owner 要求維持 Claude 技術指導、Pi 實作、主導 agent 整合審查與交付。此次實際呼叫 Claude Code／`claude-opus-5-5`，工具關閉，只提供六個已核對公開主線來源及一個固定上游來源。單次 CLI 調用成功，回報 2 turns、131.31 秒、清單價估算 0.539519 美元；這不是實際訂閱帳單。

Claude 建議在真實 Pi 指令處理器內使用 `ctx.ui.confirm`，驗證拒絕、接受及逾時，並明確排除模型推論。主導 agent 已核對 pinned Pi 1.4.0 的 command context、UI event wrapper、確認選單與 timeout，以及 Office 的既有 `worker.attach`／`term.input`；沒有修改 vendor 或猜測按鍵。

重要修正：`before_provider_request` handler 的例外會被 Pi 捕捉，所以偵測器不能宣稱阻止請求。實際驗收要求無 owner key、本機 relay、既有 OS 網路限制及 Python 計數為零；任何意外本機請求都判失敗。原生 UI 結束後可能回報 `done`，也不能據此宣稱模型成功。

## 平行實作契約

- Pi A：測試專用 extension、原生 Office harness、固定 launcher 與 runner、純證據校驗及測試。
- Pi B：dispatcher 模式互斥、操作台選項／結果、結果白名單及測試、Chrome 驗收腳本。
- 主導 agent：凍結共同欄位與模式、獨立審查整合、執行離線及原生驗收、公開證據與 GitHub 交付。

兩個實際 Pi CLI 沿用 `openai/gpt-5.5`，使用獨立工作區及互不重疊的可寫檔案；只有 read／edit／write，無 shell、MCP、產品執行、vendor 或 Git 修改。各最多 24 次請求、80 次工具、每回應 6000 output tokens、12 分鐘，回報成本達 3 美元後停止，最後一個回應可能超過門檻。Owner 本輪指示維持原協作模式及既有費用條件；產品付費驗收沒有取得新授權。

## 固定驗收契約

只有 Pi 的獨立 `--check-question` 可執行；不能搭配遠端、grant、retry 或其他檢查。以無 prompt 的真實 Pi 啟動，附接後送固定 `/lab-office-question`，確認原生等待再送 Escape、Enter，第三次等原生 timeout。整段保持同 session，拒絕無 marker、接受一次寫入、逾時／重複指令不改 marker；不產生模型 result.json。

Runner 獨立核對事件、嚴格型別、nonce／session、marker hash、檔案權限及無連結、零請求與所屬程序清理。結果白名單只顯示固定測試情境及驗收結果，不洩漏 nonce、session 或原始日誌。問答驗收通過保持 stopped，模型推論為 false；不自動重試。

操作與範圍見 [PI-QUESTION](PI-QUESTION.md)。完整模型工具權限、其他 provider 問答、遠端付費端到端及完整 MVP 仍 pending。

## 實際交付

兩個 Pi worker 各送出 24 次請求、到達上限後停止（exit 77）；runtime／integration 分別交付 6／9 個檔案、23／35 次工具、198.69／144.02 秒，回報費用估算 1.068349／1.373122 美元。主導 agent 保留原始檔案 hash，接手補完原生 hook 名稱、嚴格證據校驗、結果分類與標準 unittest；臨時憑證副本已移除。加上 Claude 的回報估算合計 2.98099 美元，不是實際帳單。248 tests、兩輪真實原生介面及 67 筆結果回歸通過，產品模型請求仍為零。[證據](evidence/pi-question-2026-11-07.json)。
