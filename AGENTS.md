# AGENTS.md

任務管理唯一依據：https://github.com/fallrising/desk 的 docs/operating-method.md。
- 無對應卡片（desk T-####）不動工；commit message 帶 `Desk-Task: T-####`。
- 只改卡片 Scope 內的檔案；變更走 PR，不直接動 main。
- 只有不可逆或危險操作（刪除、發布、花錢、force push、繞過 CI、改授權、改本檔）才問 owner。
- 卡片被 owner 改成 todo / blocked / dropped 就停。
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
