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
