# Graphify lab 工作規則

接手先讀 [SUCCESS](SUCCESS.md)、[SDD](SDD.md)、[任務板](docs/tasks/BOARD.md) 與最近證據。實作前更新範圍及 AC；收尾補實際結果、缺口與版本。

- 必須使用真實固定版本 Graphify；fixture 可合成，parser／graph／MCP 不可 mock 成成功。
- `--code-only`，不自動使用任何環境中的模型憑證。不執行被索引 reference 的建置腳本。
- source 為真實證據；graph 不取代 source，INFERRED 邊與完整程式語意不同。
- cache 留在 git 外，以明確 URL／SHA／版本隔離；重用前驗證，並行寫入有鎖，產物原子發布。
- 證據只包含公開／合成內容，不提交機器名稱、絕對本機路徑或憑證。實測與估算分開。
- 必要 gate：真 CLI/MCP scenario suite、cache 邊界測試、repo index/workflow checks 與獨立審查。
- 依本次授權交付 Draft PR，未授權不 merge／release／deploy；任務板合併前保持 `in_progress`。
