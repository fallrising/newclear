# Rework loop — implementation evidence

T-0339 / BOARD HRWK. Contract: [rework-loop](../sdd/rework-loop.md), owner-approved D1/D2 on 2026-11-01.
Worktree base `935ffbc1` (HAI tree identical to the proposal merge `cc7931dd`). Root-only implementation, no worker.

## Acceptance

| AC | Oracle | Result |
| --- | --- | --- |
| RWK-AC-01 | `TestRequestRework_GuardsAndHistory` (Review and QA success, byte-exact multiline Unicode reason in the stored result, replay, idempotency conflict; wrong phase/version/subject, invalid/oversized/missing reason, unknown field, version 0, unknown item, cross-project; 2000-code-point boundary) | Pass |
| RWK-AC-02 | `TestDispatchRun_RedispatchFromDeveloping` (after rework, after Failed Run, Succeeded-without-Candidate abandonment; strict clock order with retryable refusal, same-key replay, regressed clock; active Run; injected CancelRequested+Failed, NeedsReconcile, OutcomeUnknown and blocker; retry_of_run_id; Review phase) | Pass |
| RWK-AC-03 | `TestCurrentCandidate_LatestRunOnly` (older-Run Candidate stale for human evidence/review, fixture review, approval, RequestQA, completion, RequestRework, preparation and coverage GETs, for both its original subject and an impersonated current-version subject; SubmitCandidate on an older Run or a second Candidate refused; material-index and Run outputs keep both histories) | Pass |
| RWK-AC-04 | `TestReworkLoop_CandidateBCannotUseCandidateAEvidence` (real SQLite/Fake/HTTP: ChangesRequested → rework → Run 2 → Candidate B over HTTP; Review-phase completion `stale_subject`; producer-class reviewer and forged principal refused; QA with only A-bound Evidence and with one of two ACs → `done_gate_unsatisfied` exactly `evidence_missing`; explicit completion joins only B's two Evidence; A verdict stays `Rejected`; restart replays the completion result with unchanged history) | Pass |
| RWK-AC-05 | Gates, review and delivery below; Git/CI/merge/readback recorded in BOARD and the desk task | Pending delivery |

"No domain writes" is asserted by snapshotting every table except `command_results` and `idempotency_records`,
which grow by exactly one row for recordable refusals and not at all for 400/404, permission and human-report refusals.
Injected Run/blocker states are schema-valid fixtures; no lawful writer currently produces them in this flow.

## Red, mutation and gates

- Named Red before production code (pinned golang 1.27.1): all four oracles failed for the intended reasons —
  `RequestRework` "operation is unsupported in v1" (400) and Developing redispatch refused by the domain.
- Mutation: removing the latest-Run check from `currentCompletionMaterial` let Candidate A's impersonated subject pass
  human evidence/review, fixture review, approval and RequestQA; the oracle failed, confirming the hole. Guard restored.
- `bash scripts/check-backend.sh` (format, vet, full, race, build) in the pinned container: exit 0, 550.293 s. During
  the run only Markdown/OpenAPI text changed. Afterwards the test file changed status literals only (finding 4);
  pinned gofmt, vet, normal and race of the four oracles passed in 26.865 s. Exact-head PR CI reruns the full gate.
- Redocly CLI 2.51.2 lint: 0 warnings, before and after the typed `ReworkRequestedResult` schema; 10 JSON-schema
  fixtures for `CommandSuccess` (valid result, missing/extra/oversized fields, wrong phase, reason leaked into
  another operation) pass.
- `bash scripts/check-web.sh` in the pinned Node container: 30 tests / 9 files, format, lint, type check and build pass (17.329 s); web source unchanged.

## Claude Code review

Claude Code 2.1.316, `claude-opus-5-5` effort high, read-only Read/Grep/Glob in the worktree, 600 s timeout:
**ACCEPT** in 257.596 s, no blocker or major finding; reported list price USD 2.0835964 (not billing). It confirmed
every subject consumer reaches the latest-Run check, snapshot consistency of the Runs summary, stored-result
compatibility and SQL ordering/collation.

| Finding | Disposition |
| --- | --- |
| 1 Missing evidence file | This document |
| 2 BOARD row mixed planning and implementation | Split into HRWKP (done, #926 merge time) and HRWK |
| 3 New result fields untyped in OpenAPI | `ReworkRequestedResult` with RequestRework branch; other operations forbid `reason`/`subject_digest`; lint and fixtures above |
| 4 Ignored 409 literals for service-level `lifecycle_rejected` | Corrected to the mapped 422 |
| 5 Latent: a future ReopenWorkItem → Ready dispatch on an item with Runs bypasses the strict-order rule | Recorded here as a constraint for that future slice: Ready dispatch with existing Runs must apply the same settled and strictly-later-clock rules. Not reachable today |

No follow-up model call: every post-review change implements the reviewer's own remedy and is verified above.
Aggregate provider requests, tokens beyond the reported totals, billing and active/wait split are unknown/null.

## Limits

Lawful command history only. Nonpassing Evidence (v0.2 AC-05) stays domain-only; AC-03/29/30/47/48 need M4 Impact;
AC-06 needs M6. If an accepted input ever changed while an item was in Review/QA, RequestRework would report
`stale_subject` (approved wording; unreachable while policy is immutable and only Draft accepts specifications).
No completion UI, full M2, full detail/history or SUCCESS AC-02..04 claim; no migration, dependency, provider,
release or deploy.
