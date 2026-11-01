# WorkItem material-index implementation evidence

T-0339 / HMDTL, owner approved D1 on2026-11-01 after the independent plan review.
Actual worktree base d55db6a9ad4606cd7df30b2bc9411b559d04f75a; intake211da65f differs only in
unrelated product work (HAI/CI diff empty). No UI/provider/dependency/migration/release/deploy.
The [accepted contract](../sdd/work-item-material-index.md) fixes IDX-01..05 and IDX-AC-01..06.
Full M2, full detail/history and completion UI remain incomplete.

## Acceptance mapping

| AC | Concrete oracle | Observed status |
| --- | --- | --- |
| IDX-AC-01 | TestWorkItemMaterialIndexHTTP_AuthScopeAndClosedWire, RequiredFieldsAndCorruption, PersistedAdapter; raw all-method intercept, scope mask, no-store/nosniff, required/unknown/duplicate fields and revocation/cancellation | focused PASS |
| IDX-AC-02 | StoredIdentityAndHistory, AcceptedRelations, RunEnumVocabulary; legacy byte identities, all phases, exact accepted set/relations; actual accepted multi-AC Unicode command flow in DiscoverThenComplete | focused PASS |
| IDX-AC-03 | SnapshotAndNoWrites: real deferred WAL read, independent writer progress, complete old then new snapshot, all durable rows and allocator identities unchanged by reads/reopen | focused PASS |
| IDX-AC-04 | BoundsAndCorruption, AcceptedBoundsAndCorruption and HTTP BoundsAndCompatibility;1024/1025, blocker1024/2MiB, byte limits/types/digests/int64/time/enums/foreign relation;4MiB/+1 wire | focused PASS |
| IDX-AC-05 | DiscoverThenComplete uses returned IDs for outputs/preparation/coverage, actual accepted Fake/human reports/reopen/explicit Done; later semantic recipe drift rejects stale_subject and remains QA; MissingPolicyAndArtifactsStillReadable proves no policy/artifact IO | focused PASS |
| IDX-AC-06 | Native backend normal/race/vet/build, web/API/docs; independent Claude code review and exact-head CI/merge/readback/ledger | in progress |

## Retained Red and corrections

Named HTTP test compiled and failed expected200 versus404 with zero source reads (3.031s), before
production implementation. Earlier shared-cache denial is an environment failure, not the Red.
The integration-before-core run failed503 because the optional storage reader was not implemented.
Worker retained its own capability Red and four immutable-trigger fixture setup failures before
correcting setup. Root copied both worker files with exact hashes and inspected actual source/tests.
Raw worker report remains unchanged; root copy adds a source-hashes heading required by the report
validator. No production behavior or result assertion was changed by that formatting correction.

An integration negative initially changed only head_version and incorrectly expected stale rejection.
Existing Complete correctly accepted because the semantic CompletionSubject was unchanged. This
fixture failure (integrated-focused,19.722s) remains retained. Root inspected the authoritative subject
comparison, changed the fixture to actual recipe-config digest drift, and retained the409 stale_subject
and QA assertions. No completion guard or product oracle was relaxed. The subsequent integrated
SQLite/HTTP/service matrix passed14.495s. Intermediate parseDigest/unused-import compile failures
and their later fixes are retained separately from meaningful behavioral Red.

The API lint first warned about a shallow oneOf overlap, even after both503 branches were made
closed. Final schema uses anyOf for the two actually disjoint closed error objects; unknown details
still fail.38 fixtures evaluated against the actual OpenAPI schemas pass, including missing required
fields, null arrays, accepted/legacy IDs, nonzero digests, integer/count bounds and closed503 details.
Final pinned Redocly2.51.2 lint passes with zero warnings (6.111s).

## Evidence limits and local gates

Impact is a valid schema-injected relation fixture, not a claim that an Impact writer exists.
The real accepted Initial multi-AC/Fake/human-report flow supplies independent lawful command history.
The4MiB HTTP limit test uses valid JSON whitespace to reach exact wire size; it does not claim that
bounded real stored rows naturally produce4MiB. Missing policy/artifacts are tested with readers that
fail if invoked. Reads do not infer freshness, eligibility, success, a current Candidate or Done.

Focused command: `go test ./internal/domain/sqlite ./internal/transport/httpapi ./internal/application/service
-run TestWorkItemMaterialIndex -count=1` (backend working directory), PASS14.495s including invocation.
Additional adapter-only check passes1.725s. Worker focused SQLite normal6.017s/race117.422s pass;
root does not use those alone as full integration acceptance.

Shell-default native gates immediately rejected Go1.22.2 versus1.27.1 and Node24.18.0 versus24.20.0;
original exits1 retained. The same unchanged scripts run in existing digest-pinned images afterward.
Pinned web `bash scripts/check-web.sh` passes format/lint/30 tests/typecheck/build in36.470s.
Existing jsdom canvas warning remains. The npm store-dir setting was ignored;218 packages downloaded
inside the disposable container, no persistent new SDK/cache or dependency/lockfile change.
Backend full gate, final document gates and Claude review results will be appended when observed.

One native bounded leaf, no children/Git/provider calls. Root owns integration and evidence gate.
Claude code review uses CLI2.1.312 exact claude-opus-5-5/high, supplied public packet, no tools,
safe-mode/strict MCP/no persistent sessions and480s host process-group deadline, with at most one
material-revision follow-up. Reported usage and durations are measured; aggregate orchestration,
provider request/retry counts, actual billing and active-versus-wait time are unknown.
Raw failures, commands, manifests, review packets and receipts are retained in the private handoff.


## Claude code review and bounded revision

Initial review ACCEPT conditional on F1,249.363s, exit0; exact opus5.5/high, no tools, denials or
children. Reported input2/output25606/cache-read1545/cache-created89300, reported list-price
USD1.226837, not actual billing. Root read the full review and source; fixed acceptance stays unchanged.

- F1: command/canonical.go validText uses len(string), hence bytes; canonical CreateWorkItem and
  SubmitCandidate apply240/8000/120 and80 respectively. New actual-service regressions admit an
  80-CJK/240-byte title and80-byte Candidate ID, reject81-CJK/243-byte title and81-byte ID before
  storage, and verify complete durable state is unchanged on rejection. Reads and reopen preserve them.
- F2: a detected malformed scalar among1025 preflight rows previously returned capacity. Two actual
  Red cases4.362s retain this result; minimal precedence correction makes detected SQL-preflight
  corruption win before capacity for collections and blockers. Rows beyond the bounded scanned
  window remain uninspected; this is not a whole-database corruption audit.
- F3: invalid item plus query and dotdot item plus body each return404 with zero reads.
- F4: removed unreachable GET mux registration. The raw all-method interceptor remains authoritative;
  HEAD still405 and canonical paths retain their original precedence.
- F5: non-text blocker regression and lawful legacy AC/Candidate reopen compare complete snapshots.
- F6: proposal table is explicitly historical, linked to these current results. Initial toolchain failures,
  corrected semantic stale fixture and schema/lint evidence remain visible. No full-M2 promotion.

Five Go files differ from the194-input frozen full gate: two production files (preflight ordering and
removed mux registration), two existing test files, one new review regression file. Revision is isolated
while the original full gate runs; no source is changed underneath that gate. Focused integrated
normal checks pass8.600s; focused race, final vet/build and the one substantive Claude follow-up are
tracked separately. Final-head native CI is still required after integration and before merge.


Final revision `go test -race ./internal/domain/sqlite ./internal/transport/httpapi
./internal/application/service -run 'TestWorkItemMaterialIndex|TestVerifiedCoverage_AcceptedMultiACHTTPAndRestart'
-count=1` passes88.873s. Full final revision formatting, `go vet ./...` and `go build -buildvcs=false ./...`
pass5.854s. API/dependency/migration/web/CI inputs are unchanged by this revision.


## Final local acceptance

The original pinned native backend gate passes573.127s (module verification, formatting, vet, all
normal and race tests, build). All194 backend/API/script inputs remained byte-identical throughout;
private manifest and result binding are retained. Its two-production/three-test-file revision is
covered by the final normal/race/vet/build results above. This is not presented as a second complete
local backend run. Final-head PR CI must execute the complete native gate before merge.

Claude follow-up ACCEPT91.023s, exit0, no denials/children, F1–F5 closed. F6 final documentation
inspection remains root-owned as explicitly stated by the reviewer; root confirms historical NotRun
labels, current evidence links and incomplete full-M2/IDX-AC-06 delivery status. Reported input2/
output8907/cache-read1545/cache-created32723, list-priceUSD0.440241. Two code-review launches total
340.386s and reported list-priceUSD1.667078, not billing; aggregate requests/retries remain unknown.
Optional nits do not hold ACCEPT; no third model call or product-contract expansion is needed.

Root evidence gate ACCEPTS the bounded implementation locally after inspecting the actual worker
source and revision diff, passing named regression/full baseline/revision gates, unchanged dependency
and migration inputs, and closed independent-review findings. IDX-AC-01..05 are accepted for this
slice; IDX-AC-06 remains pending exact-final-head CI, normal merge/readback and BOARD/desk/handoff.
Document gates pass52 contracts,9 indexes/0errors and11 Markdown files/239 local links/anchors.
No browser/full-detail/current-Done applicability or whole-product acceptance is claimed.
