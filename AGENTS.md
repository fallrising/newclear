# AGENTS.md

大需求的流程依據：https://github.com/fallrising/desk 的 docs/operating-method.md §0（不變的節點）。做 desk 大需求卡時照 §0 的節點走；本檔不重述 desk 的規則或現況，只寫本 repo 的技術任務合約。
- 本 repo 的技術任務自行管理，規則見下方「技術任務合約」。不需要 `Desk-Task` trailer。
- 用戶可能會出錯。明顯錯誤或決策衝突時，毫不留情地直接指出，不要附和。你是同事，不是奴僕。
- 需要多個連鎖 PR 時，用 `gh stack`（GitHub 的 stacked PR 工具）建立與管理，不要手動串分支。
- 變更走 PR，不直接動 main。
- 只有不可逆或危險操作（刪除、發布、花錢、force push、繞過 CI、改授權、改本檔）才問 owner。
- 本檔以外的 repo 專屬規則（建置、測試、風格）寫在下方，不要複製看板規則。

## 技術任務合約

- **輸入**：desk 卡 id 與它的 SDD（§0 N3）裡的 AC 編號，SDD 預設放 `<項目目錄>/SDD.md`；或 owner 的直接指示；或本 repo 的 issue。
- **開始條件**：desk 卡的任務要等該卡已過 §0 N2、N3，並已登記在該項目的任務板。其他工作要有 owner 指示或 issue。
- **步驟**：
  1. 任務板放在 `<項目目錄>/docs/tasks/BOARD.md`。為這張卡開一節，標題寫 `T-####`；每條 AC 至少一列。欄位是 ID、任務、對應 AC、狀態（`todo`／`in_progress`／`done`）、`start`、`end`、`last_activity`，時間用 UTC RFC3339。
  2. 開工時把那一列改成 `in_progress` 並填 `start`；進行中每次 push 刷新 `last_activity`。
  3. 照該項目的 `SUCCESS.md` 與最近的元件 `AGENTS.md` 做，PR 內文寫對應的 AC 與證據。
- **結束條件**：PR 合併後，把那一列改成 `done`，`end` 填合併時間（在下一個 PR 一起補；最後一張用一個只改任務板的 PR）。關閉後留在板上，可以重開。
- **依賴**：元件 CI、`python3 scripts/check_project_success.py`，以及公開邊界：不寫私人內容、主機名、帳號。
- **合併門檻**：PR 無衝突、必要 CI 通過（desk 最低線）。元件 `AGENTS.md` 可以再加嚴。
- **進度與卡住**：一張 desk 卡在本 repo 的任務位置就是該任務板。沒有 `end`，而且 `last_activity` 早於 90 分鐘（預期 30 分鐘的 3 倍），就算卡住；任務欄註明「等 owner」的列不算。

## Repo 專屬

Component-specific engineering rules live in that component's own `AGENTS.md`
(for example `platform/edge-ops/AGENTS.md`, `products/kith/AGENTS.md`); follow the nearest one.

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
