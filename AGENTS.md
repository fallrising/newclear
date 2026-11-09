# AGENTS.md

大需求的流程依據：https://github.com/fallrising/desk 的 docs/operating-method.md §0（不變的節點）。做 desk 大需求卡時照 §0 的節點走；本檔不重述 desk 的規則或現況，只寫本 repo 的技術任務合約。
- 本 repo 的技術任務自行管理，規則見下方「技術任務合約」。不需要 `Desk-Task` trailer。
- 用戶可能會出錯。明顯錯誤或決策衝突時，毫不留情地直接指出，不要附和。你是同事，不是奴僕。
- 需要多個連鎖 PR 時，用 `gh stack`（GitHub 的 stacked PR 工具）建立與管理，不要手動串分支。
- 變更走 PR，不直接動 main。
- 只有不可逆或危險操作（刪除、發布、花錢、force push、繞過 CI、改授權、改本檔）才問 owner。
- 本檔以外的 repo 專屬規則（建置、測試、風格）寫在下方，不要複製看板規則。

## 交付與對人回報

已授權里程碑的 Git 交付與向 owner 收尾，依[共用規則](https://github.com/fallrising/desk/blob/main/docs/delivery-and-handoff.md)。本 repo 與元件入口沿用此規則；專案另有的必要檢查、審查與當次明確停止條件仍保留。內部 worker／驗證報告遵守各自格式，不作為對人回覆的固定格式。

## 技術任務合約

- **輸入**：desk 卡 id 與它的 SDD（§0 N3）裡的 AC 編號，SDD 預設放 `<項目目錄>/SDD.md`；或 owner 的直接指示；或本 repo 的 issue。
- **開始條件**：desk 卡的任務要等該卡已過 §0 N2、N3，並已登記在該項目的任務板。其他工作要有 owner 指示或 issue。
- **步驟**：
  1. 任務板放在 `<項目目錄>/docs/tasks/BOARD.md`。為這張卡開一節，標題寫 `T-####`；每條 AC 至少一列。欄位是 ID、任務、對應 AC、狀態（`todo`／`in_progress`／`done`）、`start`、`end`、`last_activity`，時間用 UTC RFC3339。
  2. 開工時把那一列改成 `in_progress` 並填 `start`；進行中每次 push 刷新 `last_activity`。
  3. 照該項目的 `SUCCESS.md` 與最近的元件 `AGENTS.md` 做，PR 內文寫對應的 AC 與證據。
- **結束條件**：PR 合併後，把那一列改成 `done`，`end` 填合併時間（在下一個 PR 一起補；最後一張用一個只改任務板的 PR）。關閉後留在板上，可以重開。
- **依賴**：元件 CI、`python3 scripts/check_indexes.py`（含 project-success 與 llms 導航檢查），以及公開邊界：不寫私人內容、主機名、帳號。
- **合併門檻**：PR 無衝突、必要 CI 通過（desk 最低線）。元件 `AGENTS.md` 可以再加嚴。
- **進度與卡住**：一張 desk 卡在本 repo 的任務位置就是該任務板。沒有 `end`，而且 `last_activity` 早於 90 分鐘（預期 30 分鐘的 3 倍），就算卡住；任務欄註明「等 owner」的列不算。

## Repo 專屬

Component-specific engineering rules live in that component's own `AGENTS.md`
(for example `platform/edge-ops/AGENTS.md`, `products/kith/AGENTS.md`); follow the nearest one.

## 工程執行與驗證

- **來源與適用範圍**：先讀根 README 與修改路徑適用的 AGENTS；涉及元件時再讀其 README、SUCCESS、相關 SDD／contract 與必要引用。連結不等於已讀；必要內容須讀至末尾，截斷就分段續讀。在既有任務紀錄或 PR 記下來源 repo／路徑、完整 commit SHA（非 Git 來源記查核時間）；來源缺口依共用契約處理，不以摘要冒充全文。
- **有界協作**：先確定修改路徑；只處理本任務必要變更。並行寫入各用獨立分支與 worktree／checkout；API／App 通道也使用獨立分支並核對預期 head。保留他人未提交內容，共用檔案由主導整合；局部下載或單一 worker 的證據不得宣稱覆蓋整個 repo。
- **架構與生成物**：遵守元件既有依賴方向、API／schema 與錯誤契約；改契約時核對實作、消費端與驗收的相容性。標示為生成的檔案須依該元件的產生器重建並檢視 diff，不手改輸出，也不順帶重構其他元件。
- **風格與錯誤邊界**：沿用元件既有風格與格式工具，抽象須有清楚概念或實際重用需求。未知資料在入口驗證，新的信任邊界再驗證；保留必要錯誤處理，不用空 catch 或靜默 fallback 把失敗變成成功。
- **測試邊界**：由 AC 與可觀察行為設計測試，執行實際被測程式，不在測試內重寫實作。外部 API、時鐘等邊界可用 fake／mock，但須標明替代範圍；替身通過不能代替 SUCCESS 要求的真實整合證據。

驗證入口以[Monorepo CI](docs/specs/monorepo-ci.md)、根 `.github/workflows/` 和元件現行規範為準；元件內保留的舊 workflow 不視為已接線 CI。執行前核對命令、工作目錄、runtime／依賴版本與適用條件。

| 適用條件 | 工作目錄 | 命令／入口 |
| --- | --- | --- |
| 每次提交前；完整 checkout，新檔已加入 Git index | repo 根目錄 | `python3 scripts/check_indexes.py`；唯讀檢查工作樹的契約、索引及導航 |
| 修改共享索引／契約檢查器或其測試 | repo 根目錄 | `python3 -m unittest discover -s scripts/tests -v` |
| 修改元件程式、設定或契約 | 元件規範與根 CI 指定的目錄 | 執行對應 lint／typecheck／test／build 與 AC 驗證，不猜測通用根命令 |
| 每次提交前，包含新增檔案 | repo 根目錄 | `git diff --cached --check` |

`check_indexes.py` 不驗證 staged bytes；部分 staged 時先對齊 index／工作樹，或驗證預定 candidate commit 的乾淨 checkout。依 [project-success](docs/project-success.md) 需要重建索引時才執行 `python3 scripts/check_project_success.py --write-index` 並審查差異，不能把修補動作當作唯讀檢查。

在既有任務紀錄或 PR 分開記錄本地檢查、CI、獨立審查及 runtime 驗收，附命令、cwd、版本與結果。失敗、未跑及環境限制如實保留；只有部分檔案或測試資料時不宣稱全量通過，交由完整 checkout／CI 補足必要證據。

## Writing Go

Before writing, modifying or refactoring Go code anywhere in this repository, use the shared
[`use-modern-go`](.agents/skills/use-modern-go/SKILL.md) skill (JetBrains Modern Go Guidelines). Agents with skill
support discover it in `.agents/skills/` or `.claude/skills/`. Other agents run it directly from the repository root
and follow [`SKILL.md`](.agents/skills/use-modern-go/SKILL.md):

```sh
sh .agents/skills/use-modern-go/scripts/run-tool.sh list --file-path path/to/file.go
```

It reads the Go version from the nearest `go.mod`, so each module only gets idioms its version supports.

## 項目完成度與可用版本

所有第一方項目遵循[主線與驗收規範](docs/project-success.md)。接手先讀項目 SUCCESS.md，實作前更新範圍與 AC，收尾補證據、缺口及索引；新增項目也須納入 inventory。只有原定主線全部驗收、必要 CI／審查通過且合併後，才建立 annotated usable tag 並回讀遠端。不得以版本號、測試替身或本次文件盤點冒充可用驗收。
