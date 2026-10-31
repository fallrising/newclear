# M1c human reports — review and verification

Status: local ACCEPT for REPORT-AC-01..05; final-head PR CI and remote delivery tracked in BOARD. [Plan](../plans/m1c-human-reports-20261031.md),
[BOARD](../tasks/BOARD.md#t-0339--m1c-sealed-human-reports). Source9e536de1dc1a532c8e3d78355e770bc757e190da.
Desk T-0339 continuation PR334 merged; Session/provider proposals do not change current Fake-only authority.

## Plan review

Claude Code2.1.312, requested and observed claude-opus-5-5/high, installed safe-mode/no tools/MCP/
session persistence. Host process-group deadline480s per call, one revision follow-up; no denied tools,
spawned agents, authentication/config changes or fallback. Reviews inspected supplied public sources.

| Finding | Disposition |
| --- | --- |
| B1 human authorization | Exact independent human rule/nonzero environment/recipe and prohibited actor/role guards before Put and final commit. |
| B2 exact text | Original concern assumed JSONv1; actual pinned JSONv2 rejects raw-invalid UTF-8 and lone surrogates. Explicit NUL rejection plus actual HTTP tests required. |
| B3 failure replay | Preflight/external-I/O failures unrecorded; final execute decisions use existing recordableFailure; late mutations roll back all rows. |
| B4 immutable capacity | Metadata-only prospective collection/object/50MiB admission mirrors completion sets, checked before Put and commit; Done predicates unchanged. |

Original REWORK retained, revised ACCEPT with no blocker. Six optional points addressed: deliberate
immutable MIME conflict, semantic-ID collisions, per-operation result fields/phases, exclusive FKs,
Evidence column mapping and fixture-compatible projection refresh. At the plan checkpoint these were implementation conditions; actual implementation and final
verification are recorded below.

Implementation inspection corrected one reviewer/root assumption before the fault tests: existing
recordableFailure records only version_conflict/stale_subject/lifecycle_rejected/done_gate_unsatisfied.
Final storage_corruption and idempotency_conflict remain unrecorded; the plan now states that exact
predicate. No shared execute/fixture semantics were broadened, and original review text is retained.
Final code review must verify the actual predicate and its test evidence.

## Observed checks and accounting

- Root pure standard-library probe on pinned Go1.27: raw invalid UTF-8/high surrogate/low surrogate
  rejected; valid pair decoded exactly; NUL accepted by JSON and therefore requires explicit content check.
- Initial `go doc` inside the module attempted unavailable offline transitive metadata; moved the same
  standard-library check outside the module. No dependency, network or product-source change.
- Native audit inspected source only; compiling implementation Red reports unsupported command400
  versus expected capability503 and missing human_reports table. No production behavior existed then.
- Worker final focused/race and full five-package tests passed on17 frozen backend files. Root
  inspected the actual changes, verified all17 SHA-256 values and copied only the assigned paths.
- Root web gate passed30tests/nine files plus format/lint/type/build; all39 web inputs still match.
  Fixed Redocly2.51.2 lint passed with zero warnings after the equivalent closed-union expression
  replaced the initial two undefined-property warnings. The same pinned image was fetched on cache miss.
- Old migrations0001..0004 remain byte-identical. Initial full backend gate passed (442.419s,168 inputs unchanged). After code-review correction,
  the final full gate passed again (367.911s,168 revised inputs unchanged); final-head PR CI and remote
  readback remain required before delivery.

Two observed plan subprocesses:91.818s and59.343s, exit0, one reported turn each, no tools/denials/children.
Provider-reported list-price estimates0.3542778 and0.238677USD are not actual bills. Original JSON
retains exact per-call token/cache telemetry; aggregate orchestrator/nested/provider calls, actual
billing and precise active/wait remain unknown/null. One native agent performed the audit and then
received a separate bounded implementation assignment; no recursive delegation.

No browser, real provider adapter, UI, M2, release or deployment acceptance is claimed.

## Acceptance evidence

The following real oracles passed the worker's focused/race and full affected-package gates.
Root final acceptance and delivery are recorded separately below; full product ACs are unchanged.

| Fixed AC | Executable evidence |
| --- | --- |
| REPORT-AC-01 | `TestHumanReport_CommandBoundary`, `TestHumanReport_StrictHTTPBytesAndFields`, `TestHumanReport_PreflightGuards`: strict decoded bytes/union/auth/policy/subject/fence and no Put on refusals. |
| REPORT-AC-02 | `TestHumanReport_SealReplayAndScope`, `TestHumanReport_ConcurrentReplay`, `TestHumanReport_IndependentScopesAndPhases`, `TestHumanReport_CanonicalReplayAndResultCompatibility`: real SQLite/HTTP/confined-store Review and Evidence, exact restart replay, concurrent intent, historical replay and no phase/version/outbox/Done change. |
| REPORT-AC-03 | `TestHumanReport_StorageFaultsAndRollback`, `TestHumanReport_AdmissionBudgets`, `TestHumanReport_CapacityRaceAndReplay`, `TestHumanReport_IntentSnapshotAndOutsideTransactionIO`: transient and late faults, current recordable-failure semantics, retry, capacity races, exact intent across external I/O and orphan non-authority. |
| REPORT-AC-04 | `TestHumanReport_ReadAndDownload`, `TestHumanReport_ReadHTTPBoundary`, `TestHumanReport_ReadSnapshotAndCancellation`: historical scoped reads/reopen, all safe headers, missing/tampered/symlink objects, closed response validation, final association/cancellation/session checks and unchanged database/object entries. |
| REPORT-AC-05 | `TestHumanReport_Migration`, `TestHumanReport_MigrationUpgradeAndRollback`, `TestHumanReport_ImmutableProvenanceConstraints`: fresh/v4-prefix upgrade, original schema/history preservation, failed upgrade rollback, valid semantic controls for one-field provenance failures, positive Review/Evidence, immutable replacement and exclusive-kind checks. |

Root inspection found that the first provenance-negative test draft lacked matching semantic rows,
so an unrelated FK failure could satisfy its assertion. The final tests seed valid counterpart rows,
assert the intended provenance trigger, and accept the otherwise-identical corrected control.
No production defect or weakened constraint was used to repair those tests.

## Retained diagnostics and limits

Worker `first-green.log` contains a shell brace-expansion formatting failure masked by a later test
exit0; it is not formatting proof. Final explicit gofmt checks passed. `focused-1.log` retains a
surrogate expectation escaping mistake and a test fixture querying legacy rather than current AC
requirements; corrected focused tests passed. `packages-1.log` retains synthetic future migration
numbers colliding with new version5; only those future probe versions/latest-version expectations
were advanced, and complete package gates then passed. Initial missing-file Modern Go lookup and
sandbox Docker socket denial were corrected before accepted execution. No automatic approval review
rejection occurred. The Red wrapper's exit0 is not a Go-test pass; its intended failures remain visible.

Report text is bounded to64KiB, and each immutable subject/material collection has bounded admission.
SQLite and file publication are not one transaction: unbound sealed objects may remain after refusal,
grant no authority and are retained for future explicit GC. Metadata/replay does not prove current byte
availability. Evidence bytes retain the existing completion integrity checks; Review report bytes do
not add a new Done predicate. Reads retain existing short writer transactions. Restart here means
real SQLite close/reopen, not a process-kill or verified backup/restore claim. Migration preservation
uses complete v4 schema/history and populated legacy rows; M6 recovery is still pending.

The machine-readable [receipt](m1c-human-reports-20261031.json) records the source hashes, both
full-gate passes and all four observed review calls; Git delivery remains in BOARD.

## Initial code review and correction

Claude initial code review returned REWORK after297.187s, exit0, one reported turn, no denied tools
or child agents. B1 corrects unsupported command capability to non-retryable capability_unsupported;
read capability errors preserve the existing output-access convention. B2 adds exact per-fault
error/idempotency assertions and same-version material/count-only drift; the earlier version bump
proved version_conflict only. B3 adds real human-record consumption by completion, missing Evidence
bytes rejection and ChangesRequested behavior. The plan was clarified before the bounded T005
correction. The single revision review returned ACCEPT (99.368s), closing all three blockers with
no remaining concrete code issue. Original initial-source and full-gate manifests remain retained.

Optional review notes are bounded explicitly: current named-run candidate selection follows fixture
convention and remains an M2 policy question; unavailable candidate metadata admission can be
conservative and does not certify Done. Historical report reads rely on immutable semantic/artifact
state; any future availability lifecycle must revisit that contract. Existing project-scoped command
identity and transaction-level cancellation behavior are not broadened here. Directory identity/mode
and additional error-code assertions were strengthened without new production behavior.

T005 focused tests/race passed on the five authorized revised files. B1 has a compiling Red, then
non-retryable capability classification tests; legacy read errors remain unchanged. B2 now verifies
exact codes, both result/idempotency rows and replay behavior. Its count-only case pre-seeds valid
semantic/artifact rows and proves completion material unchanged, so an unrelated material guard cannot
mask the count comparison. B3 reaches Done with both human semantic IDs in completion joins; distinct
Evidence bytes missing yields only evidence_unavailable and no completion/consumption rows; a later
ChangesRequested maps to Rejected and yields only review_rejected. Missing Review bytes still permits
completion, proving no new Review-byte predicate. Final root rerun and independent revision review
passed. Directory names/modes are now compared, in addition to all-table snapshots.

## Final local acceptance and delivery conditions

Root ran unmodified `bash scripts/check-backend.sh` on final revised source: pins/modules, gofmt,
vet, all tests, race and build exit0 in367.911s. All168 backend/script/pin inputs remained byte-identical
through execution; manifest SHA256 `5cecf62718e9ec9722c148f7b6fd3a9b09a5c78fdc32d5ea2924554a962d2fff`.
The initial full pass442.419s is retained as superseded source evidence; final gate reran after both
production capability changes and all test additions. Web `bash scripts/check-web.sh` passed30tests
in9files plus format/lint/type/build;39unchanged inputs were reread. Fixed Redocly lint passed0warnings.
Project49contracts,8indexes, changed Markdown links/anchors, task/report contracts and diff checks
passed; final exact document count is in the private gate log. No required local check remains failed
or skipped. Root accepted T003/T005 only after inspecting actual diffs, tests, logs and frozen hashes.

Claude Code2.1.312 used the requested and observed claude-opus-5-5/high for plan and code, each
REWORK then one revised ACCEPT. Code calls took297.187s and99.368s. All four calls exited0 with one
reported turn each, no tools/denials/children, no auth/config/provider fallback. Reported token/cache
counts and list-price estimates are in the JSON receipt; actual billing and aggregate provider/tool
counts remain unknown/null. One native leaf received three bounded assignments (audit, implementation,
correction), with no recursion. Host paths were normalized only in public worker reports; originals
and exact executed commands remain in the private evidence bundle.

The remaining delivery conditions are normal final-head PR CI, merge and remote readback, then BOARD
and desk synchronization. These are not replaced by local tests or the reviewer's source inspection.
Current state is [BOARD HM1C](../tasks/BOARD.md#t-0339--m1c-sealed-human-reports). Next planned slice
is M2; it has not started. Full H02/SUCCESS AC-02..04 remain incomplete; no usable tag/release/deploy.
