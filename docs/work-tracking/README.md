# Issue-task contract — phase 1

This contract applies only to the `tools/codex-usage` pilot in this public repository.
Other components retain their existing tracking rules. The published private-ledger `doing` claim,
Scope/`touches`, and `Desk-Task: T-####` commit trailer remain mandatory during the pilot.
The root orchestrator assigns work serially; an assignee or draft PR is not an exclusive lock.
Phase 2 dispatch/concurrent-claim guarantees and later migrations are not implemented.

## Identity and files

An issue is the work identity and queue. Keep its body short: summary, component, expected outcome,
then a link to the task directory once routed. Use `<component>/tasks/<issue-number>-<slug>/` with
required `task.md`, a required `report.md` at delivery, and optional append-only `log.md`.
Record the full repository issue URL and component path in both task and report; the directory's
number must match that issue. Do not maintain a second lifecycle status in these files.

Use the [task](task-template.md) and [report](report-template.md) templates. The task records outcome,
reason, exact inputs, bounded writable scope, exclusions, acceptance criteria, verification,
budget/checkpoint, stop conditions, and explicit action authority. Missing authority is not permission.
Workers still receive bounded `.team/tasks/T-###.md` assignments; those IDs do not replace issue identity
or the private-ledger task. The orchestrator owns routing, review, and acceptance of worker output.

## Lifecycle derived from GitHub

| Observable state | Meaning / next action |
| --- | --- |
| Open, unassigned, no active/merged PR, no `ready` | Request awaiting triage or clarification. |
| Open, `ready`, unassigned, no active/merged PR or blocking overlay | Scoped task eligible for serial assignment. |
| Open, assigned or linked draft PR | Work in progress; `ready` may remain as a scope marker. |
| Open, linked PR marked ready for review | Delivered for review; checks and independent review still govern merging. |
| Open, linked merged PR | Change delivered; awaiting owner acceptance. |
| Owner records acceptance and closes issue | Accepted. Only the owner performs this transition. |

Read the most advanced observable state first: owner-accepted/closed, merged/open, ready-for-review PR,
assigned/draft PR, eligible `ready`, then intake. A merged/open issue remains delivered even if it is
still assigned or carries `ready`. `blocked` and `needs-owner` are overlays: they pause dispatch/progress
where applicable, and comments explain the blocker or decision. They do not erase delivery; a merged
issue with `needs-owner` still awaits acceptance. Dispatch requires neither overlay.
An assignment without a PR is a dispatch transition, not a lock.
An incomplete report cannot establish delivery merely by opening a PR. A report's `STATUS: DONE`
means its implementation and required evidence are complete, not that the GitHub issue is accepted.

PR descriptions use `Refs #N` in the same repository (or `Refs owner/repository#N` across repositories).
Never use automatic closing keywords `Closes`, `Fixes`, or `Resolves` for tracked issues.
The PR links the task and report; the issue links the PR. Merge does not close the issue.
Owner decision requests use `needs-owner` and decision comments; record the final decision summary
and its comment link in the component task. Re-check private-ledger instructions before an authorized commit.

## Labels and requests

[labels.json](labels.json) is a versioned manifest, not a service or automatic synchronizer.
The orchestrator applies labels manually under its authorized scope. Provisioning is idempotent and
add-only: create missing labels, preserve existing labels' colors/descriptions (including `duplicate`),
and do not delete or rename labels. Manifest values describe defaults for missing labels:

- `ready`: pilot task is scoped and permitted; dispatch also requires no assignee, active/merged PR, or blocking overlay.
- `blocked`: a dependency or missing required evidence prevents progress; explain how to unblock.
- `needs-owner`: an owner judgment or acceptance is pending; state the requested decision.
- `duplicate`: link the canonical issue; agents do not close it as owner acceptance.
- `project:<component-slug>`: stable component identity, derived from the exact indexed path by replacing `/` with `-`.

The [request form](../../.github/ISSUE_TEMPLATE/task-request.yml) collects summary, component, and outcome.
Selecting a component does **not** apply its project label. The manifest/form include indexed components
for routing, but do not enroll them in the pilot. Paths are authoritative; display text may change.
Non-pilot issues are intake only: do not mark them `ready` under this contract or start issue-only work.
They continue through the existing private-ledger workflow until a separately authorized cutover; intake grants
no work authorization.

## Public information boundary

Sanitize repository files, issue bodies/comments, PR descriptions/comments, commits, and evidence before publishing.
Never copy private-ledger contents or links, private repository names/paths, personal filesystem paths,
host names, IP addresses, domains, accounts, or credentials. Use abstract private-config location names only.
The task records an abstract authorization reference confirming the published claim and scope; keep its
private source and detailed coordination reports outside this public repository. Public evidence must be
safe to share; identify restricted evidence abstractly rather than linking it. Privacy review is required
for requests and reports as well as code changes.

## Evidence and manual validation

Reports name commands that actually ran, outcomes, immutable evidence links/paths, and failed or skipped
checks with reasons. Required failures/skips mean `PARTIAL` or `BLOCKED`, never `DONE`. Record local checks
separately from remote CI; a local pass does not show that GitHub CI ran. Owner-authorized substitutes
must be explicit in the task and report. Independent review and owner acceptance remain separate gates.

Before publishing, the orchestrator checks:

1. Issue URL/number, component, directory name, and task/report/PR backlinks agree; local links resolve.
2. Task scope, authority, budget, stop conditions, DoD, and runnable checks are concrete; report evidence supports its result.
3. Form required fields/options agree with the manifest; label names are unique and mapped to real indexed paths.
4. `Refs` syntax cannot auto-close the issue; private-ledger claim/trailer and serial assignment remain in force.
5. Files, issues, PRs, commits, and evidence obey the public information boundary.
6. Changed paths match scope; `git diff --check` and JSON parsing pass; the owner acceptance gate remains open.

These are manual contract checks. No new validator, workflow, runtime dependency, claim service, or history
migration is introduced here. Later planning and migration phases require separate authorization.
