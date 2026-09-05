# HAI Taskboard Handoff

Updated: 2026-09-05
Authority: `.team/PLAN.md` until the explicit dogfood migration

## Current checkpoint

- Branch: `agent/hai-taskboard-p0a`
- Worktree: `/home/ckc/test/codex/worktrees/hai-taskboard-p0a`
- Baseline: `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`
- Phase: G0 plus the T-020/T-022 domain kernel and T-030/T-032 web fixture shell are accepted.
- Persistence candidate: T-043/T-054/T-056 plus T-058/T-061 worker repairs are complete and all
  reported pinned gates pass, but they remain unaccepted until the independent T-062 combined review.
- Runtime authorization: deterministic Fake only; no provider credentials, shell or network.

## Read first

1. `.team/PLAN.md` and `products/hai-taskboard/AGENTS.md`.
2. `docs/SDD.md`, every accepted ADR and the relevant mini-SDD.
3. `docs/traceability.md` and the exact `.team/tasks/T-*.md` envelope.
4. Existing report evidence, remembering that a report does not accept itself.
5. For the immediate next task, read `.team/tasks/T-062.md` and T-053/T-057/T-058/T-061 reports.

## Authoritative design decisions

- Board/SSE/Attention are projections; SQLite normalized state is the operational authority.
- Git owns immutable spec bytes; SQLite owns accepted bindings.
- Successful Run produces at most a Candidate; Done requires subject-bound evidence and an atomic
  CompletionRecord.
- Dispatch uses a transactional outbox, start acknowledgement and fenced leases. Expiry or cancel
  timeout may become `OutcomeUnknown`; unknown work is not automatically retried.
- P0 reconciliation uses deterministic accepted graph edges and old+new reverse closure.
- Web is the primary control surface. Slack/Lark/chat and a real provider are outside P0-A.

## Unresolved/blocking

- The final SQLite candidate has worker evidence but no independent acceptance decision after its
  last two repairs. Do not begin T-044 or describe the persistence foundation as accepted until a
  fresh T-062 PASS is inspected and recorded by the orchestrator.
- Application commands, HTTP/SSE, Fake executor, root CI, restore and broader failure-injection
  evidence remains NotRun. Browser Playwright/contrast/zoom/coarse-pointer evidence is also NotRun.
- The forward-only reviewer contract is accepted by T-013. Nineteen historical report bytes remain
  immutable; their recorded 11-pass/8-fail validator compatibility inventory is process metadata,
  not task acceptance evidence.

## Safe next action

Execute `.team/tasks/T-062.md` as a report-only independent review. If it returns PASS, inspect its
scope and evidence, record acceptance of the combined T-043/T-054/T-056/T-058/T-061 candidate, then
authorize T-044. If it returns FAIL, route one narrow repair and a fresh review; never repair inside
the reviewer task.

## Restore invariant

A resumed agent MUST verify the branch/baseline and actual diff before trusting this handoff. If the
files disagree, `.team/PLAN.md` plus Git/SQLite authority rules win; record the discrepancy rather
than silently repairing history.
