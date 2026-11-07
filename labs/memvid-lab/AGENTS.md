# Memvid lab 工作規則

接手先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[任務板](docs/tasks/BOARD.md) 與最近證據。

- 本專案是 owner 直接要求的 Memvid 場景實跑。修改前更新範圍、AC 與驗證計畫；收尾逐項記錄實際結果及缺口。
- 使用真實 pinned Memvid SDK；fixtures 可以合成，但不能以 mock memory、隨機向量或預寫轉錄冒充 SDK／模型結果。
- 下載與 runtime 分開。不得自動使用環境中的雲端模型憑證；runtime 須有明確本地／無 embedding 設定。
- 每次 run 建立新的輸出目錄；不得覆寫使用者既有 `.mv2`。證據只保存公開或合成內容，排除機器名稱、絕對本機路徑與憑證。
- failed、blocked、not_run 不得視為 passed；完整命令應以非零結束表達未達驗收。
- 維持上游功能與本實驗應用邏輯的區別，特別是檢索 context 不等於 LLM 生成回答、session replay 不等於任意狀態還原。
- 必要 gate：元件真實 scenario suite、repo `scripts/check_indexes.py`、新增 workflow 的靜態檢查與獨立審查。
- 本次交付為 Draft PR；未取得另行授權不 merge、release、部署或建立 usable tag。任務板於合併前保持 `in_progress`。
