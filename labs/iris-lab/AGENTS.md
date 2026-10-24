# iris-lab 工作入口

沿用根 [AGENTS.md](../../AGENTS.md)。先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[最新文件證據](docs/evidence/m0-document-review.md) 與[任務板](docs/tasks/BOARD.md)。

- 本輪 T-0402 僅交付 M0 文件。後續實作先更新本次目標、範圍與實機驗收計畫；保留既有 AC 及未通過缺口。
- 上游版本以 [upstream.lock.json](upstream.lock.json) 為準。引擎 commit、模型 revision、下載內容摘要與建置環境分開記錄；不能把固定引擎誤寫成權重已驗證。
- 原生推論、下載準備、上游 Python 測試工具分開宣告依賴。不得把 mock、文件 CI、編譯成功或程序 exit 0 當成真實出圖驗收。
- 新增 backend／模型要有對應環境與實際證據。未觀測的 effective backend、記憶體、畫質與速度寫 unknown／未驗，不推算為通過。
- 上游 source、模型與 run outputs 留在獨立工作目錄；不提交權重、個人 prompts、tokens 或機器識別。正式證據只保留可公開的版本、命令、結果與限制。
- 若後續採用 SDD 規劃的 Go wrapper，寫 Go 前依根規則使用 `use-modern-go`；本輪沒有 Go 模組或實作。
- 收尾同步 SUCCESS、README、任務板與根索引；必要 CI、獨立審查及真實主線驗收完成前不宣稱可用版本。
