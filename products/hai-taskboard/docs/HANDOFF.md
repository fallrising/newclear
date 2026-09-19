# HAI Taskboard Handoff

Updated: 2026-09-16
Authority: `.team/PLAN.md` until the explicit dogfood migration

## Current checkpoint

- Branch: `agent/hai-taskboard-p0a`
- Worktree: `/home/ckc/test/codex/worktrees/hai-taskboard-p0a`
- Baseline: `newclear/main@3ad5533d8148a84ab19145fbee92306d1b69941b`
- Phase: G0 plus the domain kernel, static web fixture shell, SQLite foundation, T-044/T-066
  application-command slice, T-045/T-069/T-075 deterministic Fake, T-046/T-078/T-080 HTTP/SSE
  boundary, T-047/T-087 vertical integration, T-090 pre-push authority repairs and the
  T-091/T-093 runnable local Fake/SQLite bootstrap are accepted.
- Persistence foundation: T-043/T-054/T-056/T-058/T-061/T-063 is accepted by the fresh T-064
  report-only review. T-062 remains a historical FAIL documenting the allocator/result ordering
  defect; the accepted repair uses commit-deferred transaction-local result references.
- Runtime authorization: deterministic Fake only; no provider credentials, shell or network.
- Fake checkpoint: T-073 independently passed the repair/lifecycle half; T-076 independently passed
  the final exact-parent, determinism, alias, staging, fence and security half. The orchestrator's
  separate pinned full/race evidence gate also passed.
- HTTP/SSE checkpoint: T-077 and T-079 remain historical FAIL reports; T-078/T-080 repaired their
  canonical-result, replay/data-shape, Origin and revocation-order findings. T-081 independently
  passed the final exact bytes and the orchestrator's separate pinned full/race evidence gate passed.
- Vertical checkpoint: the original T-047/T-082 evidence remains PARTIAL/FAIL. Separately bounded
  T-083/T-085 predecessor repairs are accepted by T-086; T-084 remains their historical FAIL.
  T-087 implemented only the integration retry, T-088 remains a read-order process FAIL, and fresh
  T-089 plus the orchestrator's pinned gate accepted all three exact vertical oracles without skip.
  Fresh pre-push T-090 then repaired artifact-verification transaction boundaries, stale-version
  classification and current-subject Approval binding; its report and a separate orchestrator gate
  passed all final required checks.
- Runtime checkpoint: T-091 made the accepted slices runnable as a loopback-only local process with
  strict token/Origin authority, private effective-UID-owned storage, descriptor-confined artifacts,
  graceful shutdown and SQLite restart persistence. T-092 remains historical FAIL evidence for four
  configuration/confinement findings; T-093 repaired them, and fresh T-094 plus a separate
  orchestrator Go 1.27.1 full/race/build gate accepted the repaired candidate.

## Read first

1. `.team/PLAN.md` and `products/hai-taskboard/AGENTS.md`.
2. `docs/SDD.md`, every accepted ADR and the relevant mini-SDD.
3. `docs/traceability.md` and the exact `.team/tasks/T-*.md` envelope.
4. Existing report evidence, remembering that a report does not accept itself.
5. Before issuing the next child, read the complete T-047/T-082 through T-090 lineage, including all
   retained PARTIAL/FAIL evidence, and verify the separately accepted predecessor and integration
   hashes recorded there.

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
- T-077 report SHA-256
  `230aa4abce221e5bca0601377c3eec87b1db24992eb1ad1677aead066c9ab944` and T-079 report
  SHA-256 `84e01d1b3f6a150841dc7a7e358157f9c991844d0b781dbfd01fbdbd818b8e68` remain historical
  HTTP/SSE FAIL evidence. T-078/T-080 repaired their exact findings; T-081 report SHA-256
  `6b5aedcefe6f0e466ab05869761038f8f27768f847652a8903debe754ba4e9eb` independently passed
  canonical stored results, contiguous/cursor-bound SSE, exact Origin, revocation/epoch ordering and
  both bounded queue limits. The separate orchestrator pinned full/race gate also exited 0.
- The original T-047 report SHA-256
  `5a47910d0600f0d7ecd40bf5da05d7ac9e5cd7d837716166e731d6072c00f064` is historical PARTIAL,
  and T-082 report SHA-256
  `cacfed101ba6ac56d5a62943ef76f3cd494e3b86b7de40d598d82eb776e151ab` is historical FAIL:
  all three exact integration tests stopped at explicit legal NotRun boundaries. T-083 then added a
  separately scoped predecessor authority surface; T-084 report SHA-256
  `3916da8ef9d9a9f746018bb4c100c8dee4d5d329940dcf40651eb8b33d902fe3` remains FAIL evidence
  for its digest, causal-lease and transaction-boundary findings. T-085 repaired only those findings,
  and T-086 report SHA-256
  `a5dfc67709983871ab4042a825d9b8bbf5e425cc296723afab58cd715bf15b23` independently passed.
- T-087 report SHA-256
  `5aba83869ed8030a04ef2b2fda1680a780fc6205998826a0001fea8f813b3eb9` binds integration
  candidate SHA-256 `94f3fc807eb4686b4273abb3f1390625147bc07ed3cc1d95383d7afbd39063ea`.
  T-088 report SHA-256
  `1556eb34c160efc8655475572d094bcb705dd6487fb6595b74eb8ed3808d6368` remains process-FAIL
  evidence because testing preceded its complete read checkpoint. Fresh read-first T-089 report
  SHA-256 `699d117f53e06f6149c2eb3402bd1ce81a42154a04fda6ca7ca1d8322ba11394`
  and the orchestrator gate passed exact-name, ten-repeat, complete backend, race, inventory and
  adversarial checks with no required failure or skip.
- T-090 report SHA-256
  `9f52dd6d1b0764b69989544cc7bc7e2f1a3ef66a8b3bb70125d34b6465704f82` retains the fresh
  pre-push findings and intermediate diagnostics. The accepted repair verifies Candidate/Evidence
  objects outside SQLite write transactions after authentication/replay lookup, returns exact
  version conflicts separately from fence rejection, and requires Approval to bind and recompute
  the named current WorkItem/Candidate subject. Current integration SHA-256 is
  `e25e6bad0618edfc083168a7fe0ed798c9beac30677d05820b41cb541c3644b4`.
- T-092 report SHA-256
  `461629aec0376aecb2b1d9e1c9ce6d8c328f0837fb659673c550dce357cb6d5f` remains historical FAIL
  evidence for broad root acceptance, noncanonical Origin aliases, predictable token material and
  artifact-root replacement. T-093 repaired exactly those findings; fresh T-094 report SHA-256
  `bce386d1146ecf3c37fa3eef74854a452fd4eff33056b57e8be62e15fd027cac` and the separate
  orchestrator evidence gate passed configuration attacks, descriptor lifecycle, two-start process
  restart, exact tests, full tests, race, build and offline module inventory without a required
  failure or skip.
- Automatic persistent outbox/worker polling, root CI execution, restore/backup and broader evidence
  remain NotRun; T-047's deterministic manually driven vertical integration does not imply them.
- Browser Playwright/contrast/zoom/coarse-pointer evidence is also NotRun.
- The forward-only reviewer contract is accepted by T-013. Historical PASS/PARTIAL/FAIL reports
  remain immutable process evidence; later repairs and acceptance do not rewrite them.

## Safe next action

Preserve this accepted checkpoint. The next bounded feature slice should add automatic persistent
outbox/Fake execution and persisted projection reads to the runnable local process, with an explicit
task/review boundary. T-050 reconciliation/restore/handoff follows only after that remaining T-040
runtime gap is accepted. Real-provider work remains outside P0-A.

## Restore invariant

A resumed agent MUST verify the branch/baseline and actual diff before trusting this handoff. If the
files disagree, `.team/PLAN.md` plus Git/SQLite authority rules win; record the discrepancy rather
than silently repairing history.
