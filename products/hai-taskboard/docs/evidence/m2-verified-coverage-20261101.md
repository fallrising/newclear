# M2 verified coverage — implementation evidence

T-0339 / HM2C; owner approved D1–D3 and reviewed COV contract on2026-11-01.
Baseline98b95de288d42aa72bd074a6c3f593dd98144e29; no UI/dependency/migration/provider/release/deploy.
This is the bounded backend coverage slice; complete M2 and the completion interface remain pending.

## Acceptance mapping

| AC | Observable evidence | Status |
| --- | --- | --- |
| COV-AC-01 | TestVerifiedCoverageHTTP_AuthScopeAndWireContract, RequiredFieldsAndByteBounds, MaximumContractAndAggregateBounds | focused PASS |
| COV-AC-02 | real accepted multi-AC HTTP/restart/Done, selected policy and Unicode sealed human reports; exact subject and1025 foreign-subject historical rows | focused PASS |
| COV-AC-03 | shared domain predicate/command order, evidence state/class/revision/recipe/environment/independence matrices, definite bytes versus unknown I/O, attempted budgets/dedup | focused PASS |
| COV-AC-04 | all authoritative SQLite rows/allocator snapshot, unchanged sequence ID counters, executor declaration count, repeated/reopened observations then explicit Complete | focused PASS |
| COV-AC-05 | same-version material changes, policy/head/lease/restore/epoch, expiry, sequence-only advance, writer progress during I/O, cancellation and concurrent Complete | focused PASS |
| COV-AC-06 | native backend/web/API/docs, independent Claude code review, exact-head PR CI/merge/readback | in progress |

## Test-first and retained failures

HTTP named test first compiled and failed expected200 versus404/zero service reads, before production
route implementation (http-red-canonical, exit1). Core named compiling skeletons failed on explicit
not-implemented stub before production. An earlier HTTP invocation failed125 because the old local
review image was absent; it is an environment failure, not Red. The canonical digest-pinned Go image
restored the maintained test environment. Core intermediate brace/Digest compile errors and all
original logs remain retained alongside later corrected passes.

Root diff inspection caught double byte reads in the existing local Open adapter (prehash/rewind plus
service verification), which would violate the new GET physical read ceiling. The bounded reader seam
keeps legacy Open intact and removes this extra read for coverage; actual adapter regression is required.

## Local gates (observed so far)

- Pinned Go HTTP focused tests: PASS; legal256 AC/1024 maximum-length ID fixture438395 encoded bytes;
  exact1MiB permitted,1MiB+1 and aggregate1025 IDs rejected without truncation.
- `go test ./internal/application/service -run '^TestVerifiedCoverage_AcceptedMultiACHTTPAndRestart$' -count=1 -v`: PASS.
- Pinned `bash scripts/check-web.sh`: PASS format/lint/30 tests/typecheck/build,26.836s including exact pnpm bootstrap.
  Existing jsdom canvas warning is retained. A pnpm store environment setting was ignored, so this
  disposable container downloaded218 packages; it left no persistent extra cache or dependency change.
- Pinned `redocly lint openapi.yaml`: PASS, no warnings,6.586s.
- `python3 scripts/check_project_success.py` and `python3 scripts/check_indexes.py`: PASS50 contracts/8 indexes.

Source-bound final review and Git receipts follow once observed.
Raw packets, failed and successful logs and source snapshots remain in the owner’s private handoff;
no credentials or private machine details are published here. One native leaf worker, no children.
Aggregate tool/provider counts and actual billing are unknown; exact per-command durations and
reported model usage are distinguished from estimates. No passing claim is inferred from a clean diff.


## Full gate and bounded revision binding

The unchanged `bash scripts/check-backend.sh` passed module verification, pinned formatting, vet,
all normal tests, all race tests and build in600.763s. Its190-file input manifest SHA256 is
`7720c773036fe84ee55dc02ee0369fe9748b424ef1895fa593176cb54b15dc5f`; all inputs stayed unchanged
through completion. This full local run predates the small review revision below; it is not falsely
presented as a full local rerun of that later source. The final PR CI runs the entire native gate again.

The revision changes10 Go files plus OpenAPI: corruption-before-stale validation only for coverage,
same-epoch cursor decrease rejection, coverage-only inclusive SQLite integer bounds (legacy preparation
headroom unchanged), bounded-reader compile assertion, required test rows and fixture fail-loud guard.
All other180 backend gate inputs match the full-run manifest. Exact before/after hashes are retained.
Final focused normal regression over service/httpapi/cmd passed9.920s, vet1.109s; focused race and final
format/build receipts are recorded when finished. API re-lint is required for the final schema change.

New regression Red retains the cursor decrease wrongly accepted, corruption+drift incorrectly stale,
and lawful integer boundary503 results. The first boundary test mistakenly used command ingress's
stricter conversion; that fixture failure is preserved, then independent domain-subject construction
produced the intended Red. Green retains the same assertions. Unknown final DB faults also have a
focused service test, and the HTTP error matrix verifies sanitized503 projection_unavailable.

## Claude code review and disposition

Initial code review: ACCEPT,294.007s, exit0, no denials/children, exact claude-opus-5-5/high.
Reported tokens input2/output30501/cache-read1545/cache-created236067; reported list-priceUSD2.498873,
not actual billing. CLI2.1.312 used the approved no-tools/safe-mode profile, strict MCP, no sessions,
with a480s host process-group deadline. Root inspected the actual response and source.

- E1: explicit wrong AC revision row added; it yields missing coverage and no matching IDs. PASS.
- C1: bounded-reader compile assertion; actual runtime→Compose→Service wiring passes the same local
  artifact store without wrapping. No hypothetical wrapper is treated as an existing production fault.
- C2: both legacy and bounded object/root failure matrices run; Lstat→Open injection uses their exact
  shared openObject primitive. The legacy Open path and non-completion error classifications remain.
- C3: corruption now wins over concurrent policy drift; the combined negative test reproduces and closes it.
- C4: conservative full authority comparison retained, as approved; no authority fields dropped.
- C5: existing GET/HEAD mux semantics retained with preparation compatibility. A separate method-policy
  change is outside this slice; HEAD is read-only and never grants completion authority.
- C6: anonymous query rejection order explicitly pinned at400.
- C7: CanonicalFailure and HTTP output/human-report handlers serialize stable public fields/messages,
  not wrapped internal causes. Existing suites are included in the native and final focused regressions.
- C8: fixture manifest replacement fails loudly on pattern drift; explicit revision negative closes the
  missing oracle. Equal-content distinct ACs in the multi-AC acceptance fixture remain lawful.
- C9: SUCCESS/README/traceability reconciled to actual test status; OpenAPI lists nosniff.

Root additionally rejects a same-epoch sequence decrease and fixes lawful SQLite-max observations
without changing command/preparation limits. These production corrections and their actual tests are
submitted in the one allowed materially revised Claude follow-up; final disposition remains required.

SSH synchronization stalls and bounded20s probes on both official SSH ports are retained as environment
failures. Existing HTTPS credentials with command-local Git configuration restored fetch/pull without
global configuration changes. No CI or review gate was bypassed.


## Final local acceptance and follow-up

Claude follow-up ACCEPT148.581s, exit0, no denials/children. Reported input2/output15777/cache-read1545/
cache-created164277, list-priceUSD1.630073 (not billing). Two code-review launches total442.588s and
reported list-priceUSD4.128946; provider request/retry counts and actual billing remain unknown.
Reviewer explicitly permits closing D1–D3 below without another model round:

- D1: dedicated VerifiedCoverageSubject uses MaxInt64 and256 AC bound; shared command CompletionSubject
  is unchanged. Pinned final OpenAPI lint passes.
- D2: existing strictCommandWire already validates positive uint64 fields up to MaxInt64; production
  change was unnecessary. Explicit zero/overflow epoch and generation rows reject503, max fences pass.
- D3: normative text clarifies that version headroom is a command ingress restriction, not a domain
  eligibility predicate. No command or preparation headroom contract changes.

Final focused race includes coverage, preparation, accepted identity, human-report and output consumers:
`go test -race ./internal/application/service ./internal/transport/httpapi ./cmd/taskboard -run
'TestVerifiedCoverage|TestCoverage|TestCompletionPreparation|TestConnectedCompletion|TestAcceptedACIdentity|TestHumanReport|TestOutput' -count=1`
PASS164.111s. Final integrated format/build passes1.606s. The last closeout changes only schema/text and
HTTP test rows; its focused HTTP/preparation race gate passes. Final backend190-file manifest before
those last test-only rows:9073730deecf3014eefb5b80e100a7163c08223f8d3c4fa69b65cb727f121311.
The final committed head, with the last rows, is subject to complete native CI before merge.

Root evidence-gate accepts the bounded implementation locally: every COV-AC-01..05 has concrete
oracles, failed attempts are retained, code review dispositions are closed, no scope/dependency/migration
expansion. Original worker PARTIAL cursor handoff is closed by root Red→Green; its report is preserved
as history, not relabeled. COV-AC-06 delivery remains pending exact-head CI, merge/readback and ledger
synchronization. Physical byte verification is a point-in-time observation, not filesystem atomicity,
a reservation or a guarantee of a later command's success.
