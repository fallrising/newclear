# M2 accepted-workflow AC identity evidence

Status: local identity implementation, full gates and Claude plan/code review accepted; required CI/delivery pending.
Task T-0339 / BOARD HM2ID. Source `24af3ab7c7d6722314125cbe3ac009db57bd4ad1`;
documentation-first commit `84ec059814f9a8cd0acaaf78266b6d9b299f9f05`.
Scope and fixed acceptance: [reviewed plan](../plans/m2-ac-identity-20261031.md).
No full M2 or product AC-02/03/04 acceptance follows. Runtime remains Fake/local-only.

## Source and plan review

Main HAI product matches delivered M1c; latest open HAI PR search returned none at intake.
Session/control-room/provider proposals remain Proposed. Native T001 inventory identifies accepted
UTF-8 AC paths, frozen legacy Draft, policy-source and verified-coverage gaps. Its report is retained
under root `.team/hai-m2-20261031/` with task/report validation.

Claude Code 2.1.312, requested and observed claude-opus-5-5/high, no-tools safe-mode packet review:
initial 89.582s REWORK; follow-up 81.380s ACCEPT subject to five document edits before dispatch.
Both exited 0 with no errors, denials or child agents. Root applied and checked every required edit.
Original requests/results/reviews are retained; model statements were checked against source.

| Finding | Disposition |
| --- | --- |
| Canonical validation before replay might reject historical commands | Freeze legacy Draft; fixture Evidence keeps old 80-byte arm plus strict 120-byte extension. Initial/human HTTP was already strict; source/caller inventory proves no production alternate ingress. Preserve canonical bytes and add regression evidence. |
| Initial review suspected completion subject shared legacy decoder | Full source shows independent strict 120-byte loop, not decodeRevisions; correction accepted. Complete caller inventory retained. |
| Missing meaningful Red | Require observed compiling Red on actual faulty command boundaries; baseline-green accepted flows remain regression coverage. |
| Unicode/actor/error details | Exact Unicode predicates and Cf vectors fixed; actor behavior unchanged; preparation/mutation/human/fixture error paths distinguished. |
| API schema sharing | WorkItem accepted AC response and fixture Evidence reference accepted 120-byte schema; legacy CreateWorkItem schema unchanged. |
| Policy/coverage scope | General profiles and verified coverage remain proposed/unimplemented. No new policy authority or prerequisite claimed complete. |

The reviewer suggested an optional accepted-SDD delta note. No normative SDD edit is needed to
implement the already accepted import/connected vocabulary; this plan, API correction and traceability
record the change while HAI-FIRST-001 legacy behavior remains preserved.

## Implementation and current verification

Ten Go files changed: one shared strict domain validator, four small production integrations,
four new regression files and one existing fixture-helper parameterization. Legacy Draft canonicalizer/
HTTP decoder, domain subject, runtime policy, module files and all five migrations match baseline bytes.
Root independently compared all ten integrated file hashes and eleven frozen-compatibility hashes.

| Acceptance | Evidence / current outcome |
| --- | --- |
| ID-AC-01 | Command meaningful Red then green; actual proposal and Run-input codecs agree with domain/HTTP boundaries on 80/81/120/121 bytes, Unicode categories and lone-surrogate rejection. |
| ID-AC-02 | Literal legacy fixture canonical bytes/hash preserve ASCII 80 and old space/separator cases; NFC/NFD remain distinct. Actual recorded version_conflict replay succeeds with rule removed and artifact I/O made fatal; invalid initial/human commands leave selected rows/versions unchanged. |
| ID-AC-03 | ASCII 81, ASCII 120, Unicode 120 exercise actual proposal service, HTTP acceptance, deterministic Fake observations, human Review/Evidence, fixture Evidence, HTTP QA/Done and Store/service reopen. Only-local rules reject before explicit test-policy restoration. Stored responses, AC bytes and human report bytes survive reopen. |
| ID-AC-04 | Worker affected normal/vet/race and final focused normal/race passed; Claude code review ACCEPT; root final full backend passed. Web/API/doc gates passed; required PR CI/merge/readback pending. |

Worker tests use existing `service.Config.Completion` and a test disk artifact store. The final
local-only assertion is test-only; after it, focused service tests and race 7.494s passed. Root's
unmodified full gate covers that final source. Existing current-input, policy-precedence, material
integrity and Done negative suites remain required; no production predicate or error code changed.

Root final unmodified `bash scripts/check-backend.sh`: format/vet/full/race/build exit 0 in 378.361s,
173 unchanged inputs; manifest SHA256 `12bf01b5133091c20f5b9e21e7399e45c902f81f8512b07a2cdfe0676b6b972b`.
No backend source changed during or after that gate. The [JSON receipt](m2-ac-identity-20261031.json)
records the local acceptance snapshot; later Git delivery is recorded in BOARD.

Observed command evidence:

- Fixed Redocly 2.51.2 lint: exit 0, no warnings, AC schema changes only.
- `bash scripts/check-web.sh`: format/lint/typecheck, 30 tests in 9 files and build passed; 39 source inputs unchanged.
- Worker `go test -count=1` and `go vet` over domain/command/service/httpapi/runtime passed.
- Worker `go test -race -count=1` over those five packages passed (service 318.335s/runtime 76.747s).
- Final `go test [-race] -count=1 ./internal/application/service -run 'TestACIdentity|TestAcceptedACIdentity' -v` passed after the policy assertion.
- Project success 50 contracts/8 indexes; document links and task/report validators passed at their recorded snapshots.

Historical failures retained: shared-cache sandbox denial before the supported Red, test-interface
compile diagnostics, generated SQLite test paths rejected by existing path rules, and the incorrect
assumption that preflight stale_subject would be recorded. Harness corrections changed no production
gate; the replay oracle now uses a genuinely recorded version_conflict. Claude code review returned ACCEPT in 67.203s with no blockers for ID-AC-01..03;
ID-AC-04 remains conditional on delivery; the final full backend condition now passes. Root reviewed the actual diff/logs separately.

## Code review dispositions and proof limits

Claude code review had no required rework. The evidence file was not included in its packet; root
verified the actual Red log: fixture ASCII81/120/Unicode120 rejection and invalid initial/human
acceptance failed before the production edit; legacy canonical compatibility was already green.
The SQLite/HTTP flow is regression proof, not a claimed baseline Red. Original logs remain retained.

The invalid-UTF-8 constructor vector is asserted; the hostile stored-envelope decoder branch cannot
serialize that value with strict JSONv2 and therefore does not test that raw byte vector. Do not infer
all raw decoder vectors were exercised. Existing stale AC/recipe/environment and same-producer
Review negatives use their original AC-A/local IDs; they were rerun, not replicated for every long ID.
The reviewer described counts as “full table counts”; root corrects that to the21 selected tables plus
aggregate versions actually inspected. Neither the review nor this report claims executing external
provider tasks, real browser journeys or complete M2 acceptance.

## Limits and accounting

No new browser run; previous browser evidence retains its original source/date. Durability checks
inspect selected 21 table counts plus project/WorkItem versions, not every table/byte. Store/service
reopen retains the auxiliary SQL inspection connection; it is not a two-process/crash/backup proof.
Test disk artifacts do not establish production confinement; existing confinement regressions remain required. No migration,
policy loader/table, UI, real provider, dependency, permission, release or deploy changes.
General policy and verified coverage remain unfinished M2 work. Existing out-of-profile historical
subject reads may be rejected by preparation; unchanged low-level constructors do not grant new authority. HTTP cannot
create legacy generic-space Draft IDs; hypothetical out-of-repo direct callers are not a supported
new-response compatibility claim.
Observed subprocess launches and reported usage are separate from provider requests. Exact aggregate
outer/nested tool counts, provider requests, billed cost and root active/wait time remain unknown/null.
Reported usage is a list-price estimate, not actual billing. Raw failures and superseded reviews stay retained.
