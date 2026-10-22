# AGENTS.md

任務在本 repo 自行管理，可拆子任務；預設位置與最小欄位（連回 desk 卡 id、start、end、last_activity）見 desk 運作方法 §4，其餘本 repo 自訂。
做 desk 大需求卡時，先照 desk 運作方法 §4 開認領 PR，合併後才開工。
desk（https://github.com/fallrising/desk 的 docs/operating-method.md）只放大需求進度，給人看；大需求完成稱「驗收」。不要求卡片編號或 `Desk-Task`。
- 用戶可能會出錯。明顯錯誤或決策衝突時，毫不留情地直接指出，不要附和。你是同事，不是奴僕。
- 需要多個連鎖 PR 時，用 `gh stack`（GitHub 的 stacked PR 工具）建立與管理，不要手動串分支。
- 現在是第一階段：用文件與 PR。第二階段（run 狀態、心跳、Grok Bot 掃描、自動派工）尚未啟用，不要寫成已生效。
- 變更走 PR，不直接動 main。
- 只有不可逆或危險操作（刪除、發布、花錢、force push、繞過 CI、改授權、改本檔）才問 owner。
- 本檔以外的 repo 專屬規則（建置、測試、風格）寫在下方，不要複製看板規則。

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
