STATUS: DONE

## Summary

T005 fixes and regression evidence are complete. Source froze at 2026-10-31T11:32:10Z; final focused gate passed at 11:33Z, before the 11:45:15Z deadline. Root owns full backend gates, independent revision review and acceptance.

Exactly the five authorized Go files changed from T003. `private M1c worker evidence/source-manifest-revised.{json,sha256}` covers all17 backend files; `t005-delta.sha256` lists the five changed hashes. The other12 files match the original manifest. T003 report, manifest and logs remain intact. No Git mutation, provider, dependency, policy, Done-predicate, API or documentation changes.

Paths below are relative to `products/hai-taskboard/backend/`:

- B1: `internal/application/service/human_report.go:33` returns non-retryable `capability_unsupported` for missing command persistence/authority/artifact capability; `:314` preserves read-side `projection_unavailable`. `internal/transport/httpapi/human_report.go:49` maps missing service and returned command-capability errors to503, preserving the service result payload. Regressions: service `human_report_test.go:32` and HTTP `human_report_test.go:206`.
- B2: `cmd/taskboard/human_report_test.go:393` asserts each Put/Open/cancel, integrity, late-DB, version and final-MIME error classification; `:508` asserts every preflight code. `:737` checks both command-result and idempotency row counts, also used by capacity failures. `:770` inserts an independent Review after Put with unchanged work-item version and RunAuthority, then separately tests count-only drift by pre-seeding the semantic Review/artifact and inserting only its valid report binding after Put. It explicitly proves equal completion material for the count-only case. Both stale decisions replay exact bytes without another Put; a final ID conflict remains unrecorded and allows corrected same-key intent.
- B3: `cmd/taskboard/human_report_test.go:858` submits real Approved Review and Passing Evidence with distinct digests, runs RequestQA/ApproveSubject/CompleteWorkItem, and checks Done plus both report semantic IDs in completion joins. Missing Evidence bytes yield only `evidence_unavailable` under `done_gate_unsatisfied`; a later ChangesRequested report persists Rejected and yields only `review_rejected`. Both leave QA/version unchanged and all completion/consumption tables empty. Missing Review bytes still permit Done, directly proving the accepted provenance-only boundary.
- Optional inexpensive checks included: directory names/types and modes captured before reads, and exact reused-ID/Review-in-QA error codes.

## Verification

Commands used pinned offline `fe-review-hai-go:20261024`, shared module/build caches, no network, no downloads, 600second limits. Final source mount was read-only. Logs and hashes are indexed in `private M1c worker evidence/t005-evidence-index.json`.

- Compiling B1 Red: `t005-red.log`, Go/shell exit1 for intended service and HTTP classification assertions; no compile failures. Subsequent focused gates demonstrate Green — passed
- `go test -count=1 -timeout=600s ./internal/application/service ./internal/transport/httpapi ./cmd/taskboard -run TestHumanReport`; `t005-focused-1.log` and frozen-source `t005-focused-final.log`, exit0. Final package times0.037s/0.092s/3.364s — passed
- `go test -race -count=1 -timeout=600s ./internal/application/service ./internal/transport/httpapi ./cmd/taskboard -run TestHumanReport`; `t005-race.log`, exit0, package times1.044s/1.162s/51.837s — passed
- `gofmt -l` over the five explicit allowed paths, asserted empty in the final read-only gate; `git diff --check` — passed
- `sha256sum -c private M1c worker evidence/source-manifest-revised.sha256`, all17 match; manifest comparison proves only the five allowed files changed — passed
- `python3 $TEAMCTL_ROOT/scripts/teamctl.py validate-report .team/hai-m1c-20261031/T-005-report.md` — passed

## Documentation

Root owns the updated accepted plan and public evidence. This report supplements T003, including its retained initial failure explanations; it does not replace that evidence. Existing completion recording and Review-byte policy are unchanged.

## Risks and Follow-ups

No outstanding worker failure. Root must rerun its full backend gate and obtain the independent Claude revision review before acceptance. Optional reviewer notes about latest-candidate selection, conservative admission and future mutable Evidence availability remain later-milestone concerns; this task did not alter those behaviors.

T005 used four Docker/go-test invocations including expected Red; no diagnostic retries were needed after the minimal repair. Recursive workers0; explicitly invoked external providers0. Aggregate orchestration/nested-tool/provider counts remain unknown/null after compaction. Source is frozen for root review.
