# ERU local closeout — 2026-10-03

Baseline: `82cd9d8`. Branch: `agent/eru/local-closeout`. The orchestrator owns this plan and acceptance.

## Objective and boundaries

Audit local ERU-009/010/013/014/015 readiness, repair three reproduced release provenance/publication defects, and document exact local/live boundaries. Preserve 12 remaining formal tasks. No actual private data, VPS mutation, destructive executor, runtime dependency or unrelated component changes.

Owner explicitly authorized ledger registration/results and target branch commit/push/Draft PR; no merge, release or deployment. Registration completed before product edits. Parallel writers used isolated worktrees and disjoint code/document scopes.

## Bounded tasks

- T-201: read-only drain/loss/reimage audit; accepted, 147 focused tests passed. Local bounded behavior present; live acceptance remains outstanding.
- T-202: read-only release/fresh-planner audit; PARTIAL product-readiness report retained. Three defects reproduced; ERU-015 executor absent.
- T-203: implement three guard fixes plus regression coverage in five source/test files in an isolated worktree. Accepted for integration after diff review; 40 focused tests pass; two shipped manifests validate unchanged.
- T-204: independent fixed-diff review of integrated source/tests and documentation; final decision recorded below.
- Orchestrator: ledger synchronization, integration, documentation, full suite and exact CI gates, final diff review and evidence-based acceptance.

Worker contracts for implementation/review are in tasks/; audit and implementation reports are in reports/. Initial audit contracts and raw synthetic test logs remain in local evidence storage. No worker may delegate or mutate remote services.

## Verification gates

- Baseline full unittest: 429 tests, OK. Baseline CI parity: 88 Python, 2 JSON, 49 existing component Markdown plus this plan, 149 tracked paths; private exclusion and diff checks passed.
- Red: new focused assertions reproduce concurrent destination clobber, same-path/hardlink independent evidence reuse, and missing/failed/ambiguous independent compatibility. Historical red failures are retained as expected regression evidence.
- Green: release/publish/update/patch validation focused suite: 40 tests, OK; existing v0.1.5 manifests both validate.
- Integrated full unittest, exact workflow AST/JSON/Markdown/private-exclusion checks, compileall, independent review, diff check and ledger-native checks are required before delivery.
- Four authorized test-host SSH connections and the control-plane etcd health endpoint passed read-only checks. These do not count as E2E.

## Acceptance decisions and residual work

The three guard fixes are a bounded ERU-013 slice; they cannot complete all five local tasks or formal ERU acceptance. ERU-009/010/014 have fake-tested finite workflows. ERU-013 still needs a selected/pinned new stable build and compatibility evidence before live upgrade/rollback/interruption. Official v0.1.7 now exists, so waiting for a new tag is no longer the prerequisite. ERU-015 remains planner-only and needs a reviewed destructive execution/recovery design and implementation before its live gates.

The current five-task acceptance matrix is in docs/LOCAL-CLOSEOUT-2026-10-03.md. No formal ERU task count is reduced. Public artifacts contain summaries and synthetic fixture evidence, never real private inventory or raw host output.

## Final acceptance checkpoint

T-204 returned no blocking findings; T-203 code/tests accepted unchanged. Integrated full suite: 438 tests, zero failures/errors/skips. Compileall and exact workflow parity passed. T-205 records PASS for the bounded guard slice and PARTIAL for the broader five-task closeout. Unimplemented/new-version/live requirements remain explicit; no task count is reduced.

Final staged-file CI parity: `ast=88 json=2 docs=58 tracked=158 private_exclusion=pass diff_check=pass`. Latest upstream main advanced in unrelated components only; ERU sources and workflow are unchanged.
