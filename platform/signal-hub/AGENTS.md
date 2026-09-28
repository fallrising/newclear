# Signal Hub 開發約定

## 範圍

本檔只適用於 `platform/signal-hub/`。先讀 repository 的 README、PORTFOLIO、docs/taxonomy.md、docs/portfolio-doc-tiers.md、docs/specs/monorepo-ci.md，再完整閱讀本專案 SDD、docs/sdd/ 全部文件與 docs/STATUS.md。

目前只有文件。看到下一個里程碑，不代表取得實作、部署或主機變更的授權。使用者只要求設計時，停在設計 PR。

## 不變量

1. 中樞只存事件、算指標、投遞；不執行任何動作，不理解決策語義。決策系統與執行器是另外的元件。
2. 契約先於實作。事件 schema、設定 schema、API 與 fixtures 在 M0 定下後，實作不得自行發明欄位、狀態或錯誤碼；需要改就先改契約。
3. 事件 append-only。只有封存流程在驗證成功後可以刪除；不得提供修改事件的 API。
4. 投遞是 at-least-once。不得宣稱 exactly-once；接收端去重是契約的一部分。
5. 只在 tailnet 內提供服務。不得新增公網入口。
6. 不將真實主機名、IP、tailnet 名稱、token、webhook 網址或私人事件內容提交到本 public repository。範例使用 `example.invalid` 與合成 ID。
7. 規則與訂閱設定以 git 管理；中樞 UI 在 MVP 維持唯讀。

## 交付

PR 只改本目錄，以及必要的根目錄索引與本專案專屬 CI。本專案以 `docs/STATUS.md` 為唯一進度權威；SDD 保存契約，不記錄易過期的進度。

每個里程碑提交：固定 commit、實際執行的測試與環境、未執行項目與原因、風險、待核准項目、下一個最小切片。自行審查不得標成獨立 reviewer 已通過。設計接受、合併、驗收、部署、實際運行是不同狀態。

第一個含可執行程式碼的 PR 才加入根 `.github/workflows/signal-hub-ci.yml`：path-scoped、`contents: read`、timeout、concurrency、checkout 不保留 credentials、第三方 actions 固定到核對過的 SHA；不部署、不發布、不讀 production secret。
