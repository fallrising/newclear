# Cloud Lab 工作入口

沿用根 [AGENTS.md](../../AGENTS.md)。先讀 [SUCCESS.md](SUCCESS.md)、[SDD](SDD.md)、[契約](contracts/README.md)、[遷移計畫](docs/migration.md)、[任務板](docs/tasks/BOARD.md)與[最近證據](docs/evidence/m0-review.md)。

- M0 是文件與介面設計，沒有 runtime。後續實作先更新具名里程碑的目標、AC、scope 和驗證計畫；採 Red-Green-Refactor 驗證行為。
- 本專案的知識樹是能力導航，不是第二份產品狀態或私人知識庫；現有元件狀態以其 SUCCESS／狀態文件為準。
- 任何跨元件權責轉移先記 ADR 與遷移 gate。不得因共用目錄，讓聊天、看板或 Cloud Lab adapter 接管 host、workload、agent run 或工作驗收權威。
- 契約中的 API／設定範例是 synthetic proposal；不補真實帳號、網域、主機、憑證或私人 repo 路徑。不得由環境檔複製可疑內容到公開證據。
- 共享程式只抽取已證明相同的語義；不得搬動歷史證據、替換驗收 oracle 或隱藏 skipped／failed／unknown。
- M0 不新增套件管理器、依賴、lockfile 或外部 CDN。可執行驗證工具僅用 Python 標準庫與既有 repo validator；後續產品技術棧須在里程碑中明訂。
- worker 不委派、不 commit、不改 PLAN／routing。主導負責 diff、必要獨立審查與 evidence gate；Git 與部署依當次明確授權。
- 收尾同步 SUCCESS、README、根索引及任務證據。文件通過不等於已部署、可用版本或 owner acceptance。
