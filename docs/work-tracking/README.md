# Issue-task contract — bounded phase 1 and phase 2

This contract applies to every component in this public repository. One issue is one piece of work, delivered
by one PR. There is no private-ledger claim and no `Desk-Task:` commit trailer. The root orchestrator assigns
work serially; an assignee or an early draft PR is how others see a claim. The manual dispatcher and receipt
gates below are optional tools for unattended workers.

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
or the issue. The orchestrator owns routing, review, and acceptance of worker output.

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
and its comment link in the component task. Re-read the issue before each commit.

## Labels and requests

[labels.json](labels.json) is a versioned manifest, not a service or automatic synchronizer.
The orchestrator applies labels manually under its authorized scope. Provisioning is idempotent and
add-only: create missing labels, preserve existing labels' colors/descriptions (including `duplicate`),
and do not delete or rename labels. Manifest values describe defaults for missing labels:

- `ready`: task is scoped and permitted; dispatch also requires no assignee, active/merged PR, or blocking overlay.
- `blocked`: a dependency or missing required evidence prevents progress; explain how to unblock.
- `needs-owner`: an owner judgment or acceptance is pending; state the requested decision.
- `duplicate`: link the canonical issue; agents do not close it as owner acceptance.
- `project:<component-slug>`: stable component identity, derived from the exact indexed path by replacing `/` with `-`.

The [request form](../../.github/ISSUE_TEMPLATE/task-request.yml) collects summary, component, and outcome.
Selecting a component does **not** apply its project label. The manifest/form include indexed components
for routing. Paths are authoritative; display text may change. Mark an issue `ready` only after its
task directory defines scope, authority and verification.

## Phase 2 manual dispatch and claims

Manual intake remains limited to the existing pilot and uses the approved dispatcher through a private
control location. Compare concrete issue/task outcomes before recording new, duplicate, split, or needs-owner
decisions. Public decisions contain sanitized reasons and abstract private-config/evidence references only;
do not copy private control policy, receipts, content, names, paths, links, or account details here.

Before every authorized triage metadata write, the orchestrator inspects a held singleton receipt and
matches its exact current head and claim ID. Historical receipts do not grant current authority. Before
product edits, require an eligible issue claim receipt plus bounded task scope and explicit action authority. Ready, assignment and draft PR alone do not lock
work. Eligibility excludes blocked/needs-owner/duplicate, assignees, component mismatch and open/merged linked
PRs. Canonical issue identities prevent case-alias claims; control storage must be private before writes.

Issue/PR checks and control updates are not a cross-resource transaction. Honor owner changes and re-check
snapshots at work checkpoints; the protocol coordinates cooperating callers, not malicious shared-credential
actors. Release only a held generation with matching claim ID and expected head; no force/delete, takeover,
automatic expiry, retry of uncertain mutations, daemon or scheduler. Denied/unknown outcomes grant no work.
Integration evidence and owner fixture judgment are separate acceptance gates. Existing enrollment,
Refs links and owner-only closure remain in force. No phase 3 migration, broader enrollment
or deployment follows from phase 2.

## Public information boundary

Sanitize repository files, issue bodies/comments, PR descriptions/comments, commits, and evidence before publishing.
Never copy private-ledger contents or links, private repository names/paths, personal filesystem paths,
host names, IP addresses, domains, accounts, or credentials. Use abstract private-config location names only.
Keep any private source and detailed coordination reports outside this public repository. Public evidence must be
safe to share; identify restricted evidence abstractly rather than linking it. Privacy review is required
for requests and reports as well as code changes.

## Execution records (replaces the separate journal repository)

The execution record of a piece of work lives in its task directory, in the same PR as the code, so nothing is
written to another repository: `log.md` (optional, append-only) holds one entry per run or attempt — who or which
agent and model ran it, start and end, usage or cost when known (state "unknown" otherwise), and where the
evidence is; `report.md` holds the delivery result. Temporary artifacts are named there with purpose, location and
whether they must be kept. The old separate execution-ledger repository takes no new records. Keep public records free of private details.

## Evidence and manual validation

Reports name commands that actually ran, outcomes, immutable evidence links/paths, and failed or skipped
checks with reasons. Required failures/skips mean `PARTIAL` or `BLOCKED`, never `DONE`. Record local checks
separately from remote CI; a local pass does not show that GitHub CI ran. Owner-authorized substitutes
must be explicit in the task and report. Independent review and owner acceptance remain separate gates.

Before publishing, the orchestrator checks:

1. Issue URL/number, component, directory name, and task/report/PR backlinks agree; local links resolve.
2. Task scope, authority, budget, stop conditions, DoD, and runnable checks are concrete; report evidence supports its result.
3. Form required fields/options agree with the manifest; label names are unique and mapped to real indexed paths.
4. `Refs` syntax cannot auto-close the issue; serial assignment remains in force.
5. Files, issues, PRs, commits, and evidence obey the public information boundary.
6. Changed paths match scope; `git diff --check` and JSON parsing pass; the owner acceptance gate remains open.

These are manual contract checks. Phase 2 adds bounded explicit coordination through the dispatcher;
no new workflow, runtime dependency, automatic status ledger, or history migration is introduced.
Later planning and migration phases require separate authorization.
