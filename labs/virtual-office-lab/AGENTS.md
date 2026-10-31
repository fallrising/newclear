# Virtual Office Lab 任務合約

先讀 [SUCCESS.md](SUCCESS.md)、[SDD.md](SDD.md)、[驗證紀錄](docs/evidence/m0.md) 及 [BOARD](docs/tasks/BOARD.md)，並遵守根 AGENTS.md。實作前更新當次目標、範圍、AC與預定驗證，不能擅自縮小完整主線。

本輪 owner 授權為設計、office-report、Workers骨架、Grok提示詞與 Draft PR，不包含 merge/deploy/release。參考共用交付政策時保留此當次停止條件。

- Node核心無第三方依賴。最少執行 `npm run check`、`npm test`；Worker adapter變更還要 local workerd smoke，真 provider/前端/公開部署分開驗收。
- 工作前在 BOARD 認領，每次 push 更新 last_activity；合併前不標 done。不加入私人內容、真實token、主機名、帳號、任務原文或provider憑證。
- 保留 public metadata allowlist、固定摘要、per-agent token、transactional state/CAS、有限去重與限流。不能為了方便debug紀錄 request body 或改用共享token。
- 不把 stale/fake/demo/人工curl 冒充新鮮真實agent工作。done只代表上報者狀態，不是 HAI 驗收、merge或deploy。
- 後續 Three.js 用固定依賴＋lockfile，獨立靜態輸出目錄；禁止 repo root assets。reduced-motion、文字fallback、斷線標示與XSS回歸是必要驗收。
- 收尾補實際證據、缺口、索引與版本。repo `python3 scripts/check_indexes.py` 為必要檢查；無完整checkout時不能宣稱本機全倉通過，使用CI且記錄限制。

沒有全主線AC、必要CI／審查、合併及owner release批准，不建立usable tag。
