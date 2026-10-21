# dim-gate 開發約定

適用範圍：`platform/dim-gate/**`。先讀 [SDD.md](SDD.md)、[STATUS](docs/STATUS.md)、本次任務相關的 [專題規格](docs/sdd/README.md)。開發及接手入口為 [DEVELOPMENT_PROMPT](DEVELOPMENT_PROMPT.md)，依 [開發恢復協定](docs/DEVELOPMENT_PROTOCOL.md) 核對狀態；不可把聊天記憶當成目前進度。

## 工作邊界

- 依 SDD 做 React 前端與有狀態的模擬 API；尚未另行立項前，不實作雲資源 provisioning、CI runner、telemetry collector 或 SSO backend。
- 三中心共用 entity IDs、API client、授權判斷與狀態機；不得為每頁另造互不相干的 fake data。
- 不將真實 IP、帳戶、憑證或私有環境資料放入公開 fixtures。示範模式清楚標記。
- 不挪用 sibling component 的 AGENTS、依賴或工作流程；root CI 約定見 [monorepo-ci](../../docs/specs/monorepo-ci.md)。
- 不更動其他 component；root README 的項目索引、未來本項目的 root CI workflow，以及 root `.team/PLAN.md` 的dim-gate區塊與相應task/report是必要例外。不得覆寫其他program的ledger。

## 協作與恢復

- SDD定義產品，prompt定義啟動，[PLAN](../../.team/PLAN.md)保存任務與接受決策，STATUS只是摘要；Git／PR／CI用來核對實際事實。
- 每variant一個主控；worker獨立worktree、bounded scope，不遞迴委派、不自驗收、不commit/push。主控取得結果後自行驗證與整合。
- 依kernel contract採用可用路由，Codex主控／Claude獨立reviewer為偏好，具體model ID必須實查。不能聲稱執行過不可用模型或未跑過的review。
- Implementation milestone的最終gate包含獨立唯讀review；小型文件維護按現有文件檢查，不冒稱已完成產品驗收。
- 證據綁定被測commit；同一task重試保留ID並增加attempt。接手先查已有branch/PR，不重複建立。
- 交接前保存resume與remote durability；accepted、merged、產品完成分開判斷。不自動merge或部署。

## 文件先行

- 更動 domain 欄位、關係、狀態轉移、權限或 API 時，在同一 PR 先更新對應規格與驗收案例。
- 詳細規格定義行為；roadmap 只描述依賴與交付順序，不能默默刪減規格。
- 狀態報告區分「已定義／已實作／已驗證」，缺少實測證據不得標記完成。
- 使用者已確認 `dim-gate` 名稱、單企業多團隊、Mock-first 與主展示流程，不需反覆請求相同確認。

## 驗證與交付

M0 已建立 component-local commands：`pnpm install --frozen-lockfile`、`pnpm lint`、`pnpm typecheck`、`pnpm test`、`pnpm check:docs`、`pnpm check:contracts`、`pnpm check:ci`、`pnpm build --mode demo`、`pnpm test:e2e`。瀏覽器依賴由 `pnpm exec playwright install --with-deps chromium` 安裝。命令存在不表示已通過；每輪仍需保存實際結果与被測 commit，文件變動另做 `git diff --check`。

M0 起依 [交付與驗收](docs/sdd/07-delivery-validation.md) 建立 component-local commands；CI 放在 repository 根 `.github/workflows/`，使用 path filter、唯讀權限及固定 action SHA。不要在子目錄新增無法執行的 nested workflow。

每個實作 PR 附需求 ID、行為改變、實際測試證據與限制；更新 STATUS 的里程碑和 commit／PR 連結。不自動發布或執行真實基建變更。

## 主線與驗收文件先行

- 接手前先讀 [SUCCESS.md](SUCCESS.md)、相關規格與最近驗證紀錄，核對目前主線及缺口。
- 實作前先更新 SUCCESS 的本次目標、範圍、AC 與驗證計畫；不得為了完成而縮小已承諾主線。
- 收尾逐項記錄實際命令、結果、來源版本與未通過原因，同步 README 必要入口及項目進度；未跑不可寫通過。
- 主線全部驗收、必要 CI／審查通過並合併後，按 repo 共用規範建立 annotated `usable/<slug>/vX.Y.Z`，回讀遠端並更新索引。現行 owner 授權適用；本規則不授權部署或付費服務。
- 參考／封存項目保留其結束條件，不以新增文件當作可執行版本，也不因此恢復開發。
