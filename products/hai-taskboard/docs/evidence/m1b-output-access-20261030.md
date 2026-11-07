# M1b output access — review and verification

Status: locally accepted after plan/code REWORK and corrective ACCEPT. Required Git/CI delivery is tracked in BOARD.
Source `e00866434e856d164a59516bc9c7de2f4770020b`; desk T-0339 continuation PR326 merged.
[Plan](../plans/m1b-output-access-20261030.md), [BOARD](../tasks/BOARD.md#t-0339--m1b-scoped-output-access).
Full P0-A remains incomplete; no new browser, real provider adapter, release or deploy.

## Scope

Authenticated exact Project/WorkItem/Run output list and existing project-bound artifact GET.
Narrow optional persistence/service/HTTP reads; no migration, dependency, mutation command,
UI or M1c report-writing change. Published output is historical, never a completion verdict.

## Claude plan review and dispositions

Installed Claude Code2.1.312, requested/observed claude-opus-5-5, requested high effort.
Fresh public-source packets; safe-mode, no built-in tools, strict MCP exclusion, dontAsk,
permission-prompts none, no slash commands/Chrome/session persistence. No recursive agents,
configuration/auth changes, CLI install or model fallback. Each external subprocess has a480s
process-group deadline and TERM/KILL cleanup. These are no-tools reviews, not OS sandbox claims.
Original plan REWORK and revised ACCEPT retained; provider events show exit0,is_error=false,
zero permission denials, one reported turn and zero spawned children for both calls.

| Finding | Resolution |
| --- | --- |
| B1 opaque artifact Open failures | All Open failures503 projection_unavailable; downstream byte/metadata faults503 storage_corruption; no invented missing-file taxonomy. |
| B2 missing Run corruption wrapper; B3 WorkItem scope | Exact persisted Run scope checked first in same transaction; absent/wrong scope404. |
| B4 multiple associations and final snapshot | Select deterministic first Run, validate complete output set, then reread exact selected tuple; no reselection/fallback. |
| B5 MIME leaks | Project authorization and association precede metadata/MIME classification. |
| B6 metadata size and zero bytes | Read0..10MiB; preserve accepted zero-byte semantics while documenting local store refusal. |
| B7 artifact permission | Current operator plus project authorization plus DB association enforce both existing permissions. |
| B8 paths/href; B9 HEAD | Exact prefixed hash path; encoded/dot handling; HEAD405 after identity checks, zero material reads. |
| B10 read transaction claim | Keep metadata-only existing BEGIN IMMEDIATE/empty commit; I/O outside; prove no table/directory changes. |
| B11 deterministic fault seams | Reader/read/Close/cancel faults and optional-interface-preserving snapshot wrapper; real triggers unchanged. |

C1..C8 nonblocking confirmations are fixed in the plan: unchanged SHA256 schema, corrupt
sibling/capacity fail closed, cancellation precedence, exact error assertions, existing application
10MiB publication maximum, actual runtime optional wiring, HEAD order and fault-wrapper interfaces.
No additional plan review call is needed or claimed.

## Verification

- Plan task/report validators and initial document links passed.
- `bash scripts/check-web.sh` in the existing pinned offline image:30tests plus formatting,
  lint, TypeScript and Vite build passed. Existing frozen-lockfile preparation preceded it.
- Fixed Redocly2.51.2 image: OpenAPI lint passed with zero warnings.
- `python3 scripts/check_project_success.py`:47contracts passed.
- `python3 scripts/check_indexes.py`:8indexes,zero errors.
- Native Go leaf retained compiling Red for missing routes (404 instead of401/503). Final complete
  service/SQLite/HTTP/cmd package tests passed (15.184s/13.379s/0.379s/3.335s).
- Root original pinned `bash scripts/check-backend.sh` passed pins/modules/format/vet/full/race/build
  on191unchanged inputs. Service full17.243s/race314.396s; SQLite full15.406s/race177.444s.
- Claude code review reported no production defect, but REWORK for two test assertion gaps. Root
  strengthened exact error codes/404 equality/error headers and CSP/CORP/Accept-Ranges/length
  assertions in three test files. Every production input remains byte-identical to the fullgate source.
- Final assertion delta: pinned `go test -race -timeout=500s -count=1 -run TestOutputAccess` on
  service/httpapi/cmd passed (24.987s/1.510s/5.378s). This is scoped delta verification; the earlier
  fullgate is not relabeled as a whole-suite run after those assertion edits. Required PR CI runs
  the final integrated head separately.

| Case | Concrete observed evidence |
| --- | --- |
| ACCESS-AC-01 | HTTP authentication/capability/path/HEAD/scope, strict nested null/unknown/duplicate/size, cancellation/revocation; errors sanitized/no-store. |
| ACCESS-AC-02 | Real SQLite exact scope/empty history/1024..1025/no fallback and real service list; actual returned href downloaded. |
| ACCESS-AC-03 | Exact10MiB/zero/overflow and MIME tests; outside-transaction Open and selected binding reread; missing/tamper/symlink actual confined-store refusal; exact error and success-header assertions. |
| ACCESS-AC-04 | Real SQLite plus actual local store repeated/reopened HTTP; all-table snapshots and artifact-directory names unchanged; lease removal/head version/restore generation changes preserve history. |

Initial environment/test diagnostics remain retained: worker sandbox Docker socket denial; meaningful
compiling Red; first Green missing JSONv2 fixture tag, FK-protected head deletion and malformed MIME
classification. Corrections changed the fixture and new read validation only. Initial report-format
validator and root private-path audit failures were corrected and preserved. No failure was erased
or an accepted write/command validation weakened. Worker PARTIAL report deliberately preserves
historical failures; root acceptance is based on actual resolved checks and final independent review.

## Limits and accounting

No byte availability/Done guarantee comes from the list. Unsupported MIME fails download.
Existing local store Open has opaque errors and refuses empty files; this slice fails closed
without broadening runtime behavior. Short metadata reads still acquire the existing writer lock.
Full AC02/03/04, human reports, completion UI, restore and external adapters remain unfinished.

Raw packets/results, Red/Green/fullgate logs, source hashes and final delivery receipts are
retained in the private M1b backup. [JSON receipt](m1b-output-access-20261030.json) distinguishes exact observed invocation
telemetry and provider-reported list-price estimates from unknown billing/aggregate usage.

## Final independent review and root acceptance

Claude code review found no production defect and requested B1 exact error-code/error-header
assertions and B2 complete safe-download header assertions. Root added them to three tests,
including the actual confined-store chain. One bounded follow-up returned ACCEPT with no blocker.
The reviewer inspected supplied source/tests/logs; it did not independently execute checks or
verify hashes. Root checked both191-file manifests: only those three assertion files differ;
all production inputs match the successful fullgate. Final delta race results are above.
Root reviewed the full diff and documents separately, including README/HANDOFF/traceability;
no full-product or browser acceptance is claimed. Evidence gate accepts ACCESS-AC-01..04 locally.

Four external review subprocesses completed within their480s bounds, each one reported turn,
zero tools/denials/children and exact observed claude-opus-5-5. These counts are not provider
request totals. Provider list-price estimates and token reports are retained per invocation;
actual billing, aggregate root/provider tools and active-vs-wait time remain unknown/null.

Optional notes remain scoped: runtime zero-byte HTTP refusal is supported by separate valid
zero-byte service and actual empty-store refusal tests, not one end-to-end zero-byte fixture;
404 bodies and safety headers are compared, not the entire header map. Uppercase hash and
foreign unsupported MIME refusal follow reviewed code but lack dedicated HTTP cases. Literal
non-resource dot segments retain existing redirects; their target authenticates again. Triple
hashing/brief writer locks remain acceptable for the current single local operator.
