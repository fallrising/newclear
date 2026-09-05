# HAI Taskboard Handoff

Updated: 2026-09-05
Authority: `.team/PLAN.md` until the explicit dogfood migration

## Current checkpoint

- Branch: `agent/hai-taskboard-p0a`
- Worktree: `/home/ckc/test/codex/worktrees/hai-taskboard-p0a`
- Baseline: `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`
- Phase: G0 plus the T-020/T-022 domain kernel and T-030/T-032 web fixture shell are accepted.
- Runtime authorization: deterministic Fake only; no provider credentials, shell or network.

## Read first

1. `.team/PLAN.md` and `products/hai-taskboard/AGENTS.md`.
2. `docs/SDD.md`, every accepted ADR and the relevant mini-SDD.
3. `docs/traceability.md` and the exact `.team/tasks/T-*.md` envelope.
4. Existing report evidence, remembering that a report does not accept itself.

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

- Persistence, HTTP/SSE, Fake executor, root CI, restore and failure-injection evidence remains
  NotRun. Browser Playwright/contrast/zoom/coarse-pointer evidence is also NotRun.
- Eight reviewer reports retain correct visible outcomes but do not match the current worker-oriented
  `teamctl validate-report` single-line evidence grammar; see `.team/PLAN.md` for the exact list.

## Safe next action

First decide whether to normalize reviewer reports plus their dependent hashes or add a distinct
reviewer-report contract. Then design T-040 child envelopes and implement the SQLite/application/
SSE/Fake vertical slice without crossing accepted domain or UI authority boundaries.

## Restore invariant

A resumed agent MUST verify the branch/baseline and actual diff before trusting this handoff. If the
files disagree, `.team/PLAN.md` plus Git/SQLite authority rules win; record the discrepancy rather
than silently repairing history.
