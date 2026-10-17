# newclear — repository-wide agent instructions

This file covers **work tracking** and the few engineering rules shared by every component. Component-specific
engineering rules live in that component's own `AGENTS.md`
(for example `platform/edge-ops/AGENTS.md`, `products/kith/AGENTS.md`); follow the nearest one.

## Work is tracked in GitHub issues

An issue in this repository is the identity and queue of one piece of work. There is no separate ledger to claim
in, and no commit trailer is required. The contract is [docs/work-tracking](docs/work-tracking/README.md); in short:

1. **No issue, no work.** Work starts from an issue here. If you were given none, open one with the
   [request form](.github/ISSUE_TEMPLATE/task-request.yml) or ask the owner.
2. **Claim before editing.** Check the issue is open with no blocking label, no other assignee and no linked PR from
   another session, then assign yourself and open a draft PR early. The root orchestrator assigns work serially;
   an assignee or draft PR is how others see the claim.
3. **One issue, one PR.** Detailed scope, evidence and the delivery report live in
   `<component>/tasks/<issue-number>-<slug>/task.md` and `report.md` in the same PR as the code. Stay inside the
   task's writable scope.
4. **`Refs #N`, never `Closes`.** A merge delivers the change; only the owner accepts and closes the issue.
5. **The owner steers through the issue.** Before each commit re-read the issue and its comments. `blocked`,
   `needs-owner`, `duplicate`, a closed issue or an unassigned issue means stop.
6. **Report in the task directory and PR**, not to the owner. Use `needs-owner` and a comment only when a
   judgment is needed.

This repository is public. Do not copy private notes, private repository names or paths, host names, accounts or
other private details into commits, issues, pull requests or files here. Old `Desk-Task:` trailers in history are
historical and need no change.

`.team/PLAN.md` and `docs/HANDOFF.md` inside components are worker breakdowns and handoff notes, not work
identity; their `.team/T-###` numbers are a different layer from issue numbers.

The manual dispatcher and private control receipts described in the contract are optional tools for unattended
workers. Ordinary work needs only the rules above.

## Writing Go

Before writing, modifying or refactoring Go code anywhere in this repository, use the shared
[`use-modern-go`](.agents/skills/use-modern-go/SKILL.md) skill (JetBrains Modern Go Guidelines). Agents with skill
support discover it in `.agents/skills/` or `.claude/skills/`. Other agents run it directly from the repository root
and follow [`SKILL.md`](.agents/skills/use-modern-go/SKILL.md):

```sh
sh .agents/skills/use-modern-go/scripts/run-tool.sh list --file-path path/to/file.go
```

It reads the Go version from the nearest `go.mod`, so each module only gets idioms its version supports.
