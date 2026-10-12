# newclear — repository-wide agent instructions

This file covers **work tracking** and the few engineering rules shared by every component. Component-specific
engineering rules live in that component's own `AGENTS.md`
(for example `platform/edge-ops/AGENTS.md`, `products/kith/AGENTS.md`); follow the nearest one.

## Work is tracked in the owner's private ledger

Whether something gets built, and how far it has got, is decided in the owner's private project ledger, not in this
repository ([`PORTFOLIO.md`](PORTFOLIO.md) is only its public summary). The ledger's contents are not published here.
If your session has access to the ledger, read its agent briefing before doing anything; the ledger's own rules take
precedence over this summary. In short:

1. **No task, no work.** Development starts from a ledger task (`T-####`). If you were not given one, stop and ask
   the owner to create or name one.
2. **Other agents may be working at the same time.** Claim the task in the ledger before editing here, and stay
   inside its scope.
3. **Every commit carries `Desk-Task: T-####`.** Commits without it are reported by the ledger's drift audit, and pull
   requests get a non-blocking reminder. Dependency bots, mirrors and owner-marked hotfixes
   (`Desk-Exempt: <reason>`) are the only exceptions.
4. **The owner steers by editing the ledger.** Before every commit, re-read your task and its discussion there. A
   task moved back to `todo`, `dropped` or `blocked` means stop.
5. **Report in the ledger, not to the owner.** Do not ask the owner about state the ledger already records.

This repository is public. Do not copy ledger contents, private repository names or paths, host names, or other
private details into commits, pull requests or files here.

`.team/PLAN.md` and `docs/HANDOFF.md` inside components are worker breakdowns and handoff notes, not investment
decisions; their `.team/T-###` numbers are a different layer from the ledger's `T-####`.

## Phase 1 issue-task pilot

Only `tools/codex-usage` is enrolled in this repository's pilot. Follow
[the issue-task contract](docs/work-tracking/README.md): an issue identifies the work; detailed scope and evidence
live in `<component>/tasks/<issue-number>-<slug>/task.md` and `report.md`. Use `Refs #N` in PRs; a merge delivers
the change, and the issue remains open until the owner accepts it and closes it.

The existing published private-ledger `doing` claim, Scope/`touches`, and `Desk-Task: T-####` commit trailer remain
mandatory. The root orchestrator assigns pilot work serially. An assignee or draft PR provides visibility,
not an exclusive lock. `.team` files still bound workers; a worker's `DONE` report is evidence, not owner acceptance.
Use abstract private-config authorization references; sanitize public files, issues, PRs, and evidence.
Do not roll this out to other components or migrate private history. Dispatcher/concurrent-claim guarantees and
later transitions require separate authorization.

## Writing Go

Before writing, modifying or refactoring Go code anywhere in this repository, use the shared
[`use-modern-go`](.agents/skills/use-modern-go/SKILL.md) skill (JetBrains Modern Go Guidelines). Agents with skill
support discover it in `.agents/skills/` or `.claude/skills/`. Other agents run it directly from the repository root
and follow [`SKILL.md`](.agents/skills/use-modern-go/SKILL.md):

```sh
sh .agents/skills/use-modern-go/scripts/run-tool.sh list --file-path path/to/file.go
```

It reads the Go version from the nearest `go.mod`, so each module only gets idioms its version supports.
