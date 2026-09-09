# HAI Taskboard Handoff

Updated: 2026-09-09
Authority: `.team/PLAN.md` until the explicit dogfood migration

## Current checkpoint

- Branch: `agent/hai-taskboard-p0a`
- Worktree: `/home/ckc/test/codex/worktrees/hai-taskboard-p0a`
- Baseline: `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`
- Phase: G0 plus the domain kernel, static web fixture shell, SQLite foundation, T-044/T-066
  application-command slice and T-045/T-069/T-075 deterministic Fake are accepted.
- Persistence foundation: T-043/T-054/T-056/T-058/T-061/T-063 is accepted by the fresh T-064
  report-only review. T-062 remains a historical FAIL documenting the allocator/result ordering
  defect; the accepted repair uses commit-deferred transaction-local result references.
- Runtime authorization: deterministic Fake only; no provider credentials, shell or network.
- Fake checkpoint: T-073 independently passed the repair/lifecycle half; T-076 independently passed
  the final exact-parent, determinism, alias, staging, fence and security half. The orchestrator's
  separate pinned full/race evidence gate also passed.

## Read first

1. `.team/PLAN.md` and `products/hai-taskboard/AGENTS.md`.
2. `docs/SDD.md`, every accepted ADR and the relevant mini-SDD.
3. `docs/traceability.md` and the exact `.team/tasks/T-*.md` envelope.
4. Existing report evidence, remembering that a report does not accept itself.
5. Before issuing the next child, read T-045/T-068 through T-076 and the accepted SQLite/application
   chain through T-067; no HTTP/SSE/T-046 or T-047 execution envelope exists yet.

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

- T-062 report SHA-256 `df9adfd90d1a3e72ade61f6ea98736680ce77c826a63c9a11b7607d5324829f4`
  remains an independent historical FAIL. T-063 repaired that exact defect and T-064 report
  SHA-256 `bdd7bfd9522d1cc7e488823ef3e3151b9852c1f036f9b8b9c7fd37f4e984dd8e` independently passed;
  the orchestrator inspected and accepted the combined persistence foundation.
- T-065 report SHA-256
  `fe49ad687ea743756bdba037fd7211f06883a6f8cfb3ca4a24aca5cdfc5fb7ec` independently failed real-
  Store completion ordering, executor declaration timing and canonical stored-result strictness.
  T-066 repaired those exact findings and T-067 report SHA-256
  `9ac88514c6a875d0ab1fa13897dd97a9a311054c1e86c41671db8d82d5241fa2` independently passed; the
  orchestrator inspected and accepted T-044/T-066. T-065 remains historical FAIL evidence.
- T-068 report SHA-256
  `883f9bc841cf4e630ac4cf70ab77be6e23609dfb82a22a8894c7634486f04f34` and T-074 report
  SHA-256 `41489bfb70b6b1cce3252877f23406ba097f192578e7d5913e01e5dfc783e366`
  remain historical FAIL evidence; T-070 remains historical PARTIAL evidence. T-069/T-075 repaired
  their findings, T-073 report SHA-256
  `390fe5dd13049b4f8e68fc4471840e6330bef8493cfe8dd4e9c16f9b6882d8ec` passed the lifecycle
  half, and T-076 report SHA-256
  `14a3e6832fdad1680173d7b6c05a2cfadd5d45107e66da8d984a204d64b33aaa` passed the final
  determinism/security half. T-071/T-072 were interrupted before probes and produced no reports.
- Fake-to-application persistence wiring, HTTP/SSE, T-047 vertical integration, root CI, restore and
  broader evidence remain NotRun.
- Browser Playwright/contrast/zoom/coarse-pointer evidence is also NotRun.
- The forward-only reviewer contract is accepted by T-013. Nineteen historical report bytes remain
  immutable; their recorded 11-pass/8-fail validator compatibility inventory is process metadata,
  not task acceptance evidence.

## Safe next action

Preserve this accepted checkpoint. Under a later authorized continuation, the next serial child is
a bounded HTTP/SSE T-046 envelope. Do not begin T-046, T-047 or real-provider work from this handoff
without that explicit task/review boundary.

## Restore invariant

A resumed agent MUST verify the branch/baseline and actual diff before trusting this handoff. If the
files disagree, `.team/PLAN.md` plus Git/SQLite authority rules win; record the discrepancy rather
than silently repairing history.
