# Agent Secrets 工程合約

遵守根 [AGENTS.md](../../AGENTS.md)，先讀 [SUCCESS.md](SUCCESS.md)、[SDD](docs/SDD.md)、[ADR](docs/ADR.md)、[交接](docs/HANDOFF.md) 與 [任務板](docs/tasks/BOARD.md)。

本輪授權只有文件里程碑 T-0959；不得因文件描述未來功能而開始實作、部署、呼叫付費服務、使用真實憑證或合併 PR。SDD 位於 owner 指定的 `docs/SDD.md`，不再建立另一份根目錄 SDD。

實作前先取得該里程碑授權，更新目標、範圍、AC 與驗證計畫；保留上游基線、修正項、Proposed 擴充的區別。規格與程式衝突時先修訂 ADR／SDD，不以程式偷偷改變安全契約。

每次 push 更新任務板 UTC RFC3339 `last_activity`。PR 合併前不得標 done 或填 end；本輪保持 Draft，沒有 merge／release／deploy 授權。交付須有實際 commit、PR、檢查與回讀證據；不得把本機片段檢查或 mock 當完整驗收。

禁止秘密出現在 prompt、MCP 結果、stdout、遙測、錯誤、測試快照、Git 或公開證據。Agent profile 不得暴露相容版 `hsm_get_key`；管理端匯出例外必須獨立授權。不得宣稱 Worker 看不到明文、AEAD 能阻止刪除／回滾、KV 支援即時一致撤權。

必要文件檢查為 `python3 scripts/check_project_success.py`、`python3 scripts/check_indexes.py`；新增 inventory 後以 `python3 scripts/check_project_success.py --write-index` 重建索引。離線或工具受限須記錄未跑項並由乾淨 PR checkout 的 CI 補驗，不偽造成功。新增能力檔再按根規範接入 llms 導航；目前不宣告可呼叫工具。

後續開發先核對上游授權；本輪僅獨立撰寫規格，不複製上游實作。安全功能涉及身份、撤權、重試或憑證交付的變更，需對抗測試與獨立審查；不能僅因一般 CI 通過就宣稱 production-ready。
