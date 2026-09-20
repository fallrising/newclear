# dim-gate 開發約定

適用範圍：`platform/dim-gate/**`。先讀 [SDD.md](SDD.md)、[STATUS](docs/STATUS.md)、本次任務相關的 [專題規格](docs/sdd/README.md)。本文件不要求使用特定模型、外部 reviewer 或多 agent。

## 工作邊界

- 依 SDD 做 React 前端與有狀態的模擬 API；尚未另行立項前，不實作雲資源 provisioning、CI runner、telemetry collector 或 SSO backend。
- 三中心共用 entity IDs、API client、授權判斷與狀態機；不得為每頁另造互不相干的 fake data。
- 不將真實 IP、帳戶、憑證或私有環境資料放入公開 fixtures。示範模式清楚標記。
- 不挪用 sibling component 的 AGENTS、依賴或工作流程；root CI 約定見 [monorepo-ci](../../docs/specs/monorepo-ci.md)。
- 不更動其他 component；root README 的項目索引與未來本項目的 root CI workflow 是可預期的必要例外。

## 文件先行

- 更動 domain 欄位、關係、狀態轉移、權限或 API 時，在同一 PR 先更新對應規格與驗收案例。
- 詳細規格定義行為；roadmap 只描述依賴與交付順序，不能默默刪減規格。
- 狀態報告區分「已定義／已實作／已驗證」，缺少實測證據不得標記完成。
- 使用者已確認 `dim-gate` 名稱、單企業多團隊、Mock-first 與主展示流程，不需反覆請求相同確認。

## 驗證與交付

目前為純文件階段：檢查相對連結、Markdown、模型／API／流程／驗收一致性與 `git diff --check`。不可宣稱跑過尚未存在的應用測試。

M0 起依 [交付與驗收](docs/sdd/07-delivery-validation.md) 建立 component-local commands；CI 放在 repository 根 `.github/workflows/`，使用 path filter、唯讀權限及固定 action SHA。不要在子目錄新增無法執行的 nested workflow。

每個實作 PR 附需求 ID、行為改變、實際測試證據與限制；更新 STATUS 的里程碑和 commit／PR 連結。不自動發布或執行真實基建變更。
