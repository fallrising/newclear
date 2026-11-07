# TokenEconomizer lab

先讀 [SUCCESS](SUCCESS.md)、[SDD](SDD.md)、[任務板](docs/tasks/BOARD.md) 與最近 evidence。改動前更新範圍／AC，收尾寫實測、缺口及版本。

- 只能從 lock 指定的 Microsoft upstream 執行；不可用重寫演算法或 mock 冒充真機制。
- 合成輸入必須標示。未驗證實際 provider savings、LLM judge/proposer 品質或 host 安裝。
- 不讀使用者 session／憑證、不全域安裝、不啟動 agent、不付費；runtime 維持 sandbox、網路與 subprocess 拒絕護欄。
- 必要 gate：`make check`、`python3 scripts/check_indexes.py`、workflow static validation 與獨立審查。
- 交付 Draft PR；未獲本輪特定 PR 的確認不合併／發 tag／部署。任務板合併前維持 `in_progress`。
