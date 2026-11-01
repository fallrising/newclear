STATUS: DONE

## Summary

Implemented the accepted M1c backend scope in this isolated worktree; production source is frozen. Base: `9e536de1dc1a532c8e3d78355e770bc757e190da`. Acceptance started 2026-10-31T11:00:15Z; final package gate and manifest reread completed 11:17:12Z, within the 45-minute bound. Root retains final acceptance, API/docs, full repository gates, independent review and delivery.

The 17-file inventory and SHA-256 values are in `private M1c worker evidence/source-manifest.sha256` and `source-manifest.json`. Only assigned backend paths changed; supplied plan/tasks remain root-owned inputs. No Git mutation, dependency, runtime policy, provider, UI or old migration changes.

- `SubmitHumanReport` has strict union/content validation, canonical identity, copied intent across external I/O, immutable actor/scope/subject provenance and exact replay. All preflight guards and metadata budgets precede Put; actual sealed bytes are verified outside the transaction; final snapshot/capacity checks precede atomic report, separate Review/Evidence, result/idempotency/audit/projection writes. No phase/version/outbox/Done mutation.
- Migration0005 adds scoped append-only report records, kind-specific composite FKs, exclusive-kind CHECK and provenance triggers. Read joins independently validate associations; global artifact metadata is immutable and MIME collisions fail closed.
- Scoped metadata/content GETs preserve historical readability, closed output shapes, bounded digest/length verification, final association recheck, security headers, auth/HEAD/path/cancellation/revocation behavior. Existing M1b authority is unchanged.
- Existing fixture request/result canonical shapes and completion predicates remain unchanged. `service.go` was not modified: only version/stale/lifecycle/Done-gate decisions are recordable; final storage503/idempotency409 failures remain unrecorded.

## Verification

All Go commands below ran offline in existing image `fe-review-hai-go:20261024`, ID `sha256:a3f100d3404f142bff2f2b4e0ca7765eb88926043e9a3ce9ddfed7fa9b68d407`, with the assigned workspace, shared module/build caches and tmpfs. No downloads or replacement cache.

- Full Modern Go CLI `list --file-path products/hai-taskboard/backend/internal/application/service/vertical.go` read before editing; final successful list retained as `private M1c worker evidence/modern-go.log` — passed
- Compiling Red retained in `red.log`: valid new HTTP operation returned unsupported400 instead of capability503; fresh DB lacked report provenance. Both failures were intended assertions, not compile errors — passed
- `go test -timeout=600s -count=1 ./internal/application/command ./internal/application/service ./internal/domain/sqlite ./internal/transport/httpapi ./cmd/taskboard -run TestHumanReport`; final `focused-final.log`, all five packages — passed
- Same command with `-race`; final `focused-final.log`, all five packages including actual runtime race44.522s — passed
- `go test -timeout=600s -count=1 ./internal/application/command ./internal/application/service ./internal/domain/sqlite ./internal/transport/httpapi ./cmd/taskboard`; frozen-source `packages-final.log`, exit0, all five complete package suites — passed
- `gofmt -l` over all 16 scoped Go files, asserted empty output in final read-only gate; `git diff --check`; migrations0001..0004 byte comparison against HEAD — passed
- `sha256sum -c private M1c worker evidence/source-manifest.sha256`, all17 files matched after final gate — passed
- `python3 $TEAMCTL_ROOT/scripts/teamctl.py validate-report .team/hai-m1c-20261031/T-003-report.md`, exit0 — passed

REPORT-AC mapping: command/HTTP strict bytes, union fields and policy refusals cover AC01; actual SQLite/HTTP/store submission, byte-identical restart/lost-object replay, no duplicate rows and simultaneous Put race cover AC02; transient faults, stale/late-DB rollback, per-failure result presence, healthy same-key retry, MIME conflict, orphan non-authority, metadata limits and final-capacity race cover AC03; historical reads, safe headers, HEAD/auth/path/invalid output, local missing/tampered/symlink objects, cancellation/revocation and second-read changes cover AC04; V4-prefix upgrade/reopen/rollback, exact provenance-negative controls, positive Review/Evidence, immutable replacement and exclusive-kind constraints cover AC05. Original completion/fixture suites passed in the full package gate.

## Documentation

Root owns public plan, OpenAPI, SUCCESS, traceability, BOARD and product evidence. No worker edits to those paths. Root should retain the actual execute recording correction; report metadata does not guarantee byte availability, Review bytes add provenance rather than a new Done predicate, and orphan GC/backup/restore remain future work.

## Risks and Follow-ups

Historical unsuccessful runs are retained, not replaced:

- `first-green.log`: `sh` did not expand brace filenames, so gofmt reported missing paths; subsequent Go tests passed and shell exit0 masked that formatting failure. This log is not formatting proof. Later explicit filenames and final empty-output check supersede it.
- `focused-1.log`, exit1: valid surrogate-pair expectation accidentally became literal `U0001f600` through tool-string escaping; runtime Evidence fixture queried legacy requirements rather than current accepted requirements and panicked. Both test fixture defects were diagnosed and corrected; `focused-2.log` passed.
- `packages-1.log`, exit1: old synthetic migration probes still occupied new production version5, causing registry validation/cancellation tests to fail before intended callbacks. Only synthetic future sequence/expected latest-version values were advanced; `packages-2.log` and final gate passed.
- Initial Modern-Go lookup used an absent new-file path; corrected to existing vertical.go before edits. Initial Docker socket access was sandbox-denied, then approved escalated offline execution succeeded. Red wrapper ended with `cat`, so its shell exit0 is not claimed as a passing Go test; retained output explicitly reports the expected FAILs.

No outstanding failed worker check remains. Root full backend/web/API/CI and independent Claude review remain outside this worker's completion claim. Restart evidence uses actual SQLite close/reopen, not process-kill/backup/restore. Upgrade tests use a complete V4 schema/history and populated legacy rows; they do not claim backup/restore coverage.

Accounting scope: this assignment only, through final gate11:17:12Z. Eight Docker test invocations / nine `go test` processes are visible in retained logs; one invocation contains focused and race commands. Worker launches0 and explicitly invoked external providers0. Aggregate orchestration/nested-tool/provider request counts and cost are unknown/null; no estimate substitutes for them. Full source remains frozen for root review.
