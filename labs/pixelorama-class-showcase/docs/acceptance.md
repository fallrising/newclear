# 驗收紀錄

## 2026-10-31：SDD 基線

- 需求：issue #834；範圍為 owner 允許先寫 SDD 的文件里程碑。
- 基準：newclear `427f557b94ce56a97a0daa9427d894dae64fc8fe`。
- 已讀：根 AGENTS.md、docs/project-success.md、現行 inventory 與 PROJECTS；共用契約來源及認領詳見 issue。
- 官方文件：Pixelorama repository、CLI 與 Save and Export，查核日 2026-10-31。

| 檢查 | 結果 | 邊界 |
| --- | --- | --- |
| 規格交叉核對 | 已定義四職業、6 指標、等級公式、素材與 AC-01–07 | 設計結果，不是產品測試 |
| 能力 oracle 算術與尺度 | passed：80 組職業／等級向量未超尺度、4 組 oracle 及動畫時長算術吻合 | 不代表尚不存在的 stats.ts 已通過 |
| 元件 SUCCESS／導航與索引 | 局部 AC 對照、必要 heading、lab 內連結與 whitespace 通過；完整官方檢查待 CI | 不冒充完整 runtime 驗收 |
| Pixelorama 安裝、GUI 開檔、CLI 匯出 | 未執行 | 此輪只建立 SDD；沒有原生素材 |
| 瀏覽器 Demo、build、E2E、視覺審查 | 未執行 | 前端尚未實作 |
| 獨立 review、合併、發布／部署 | 未完成／未執行 | 本輪 Draft-only，無 usable tag |

終端 clone 嘗試在 newclear 與 knowledge-base 均收到 `Could not resolve host: github.com`。GitHub App 讀取與 issue 寫入可用，文件透過 App 的 Git tree／commit 工作分支發布；不據此判定私人 repo 無法存取。完整 checkout 不可得的檢查與可執行的局部檢查必須分別記錄；完整 repo 檢查以 GitHub CI 回報為準。

目前所有產品 AC 維持 pending。下一個可驗收成果是魔法師真素材閉環，之後才補四職業與頁面細節。
