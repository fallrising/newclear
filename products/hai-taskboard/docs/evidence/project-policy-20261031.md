# Immutable project policy evidence — 2026-10-31

Status: implementation, local gates and Claude code revision ACCEPT; PR delivery pending.
Task T-0339 / HMPOL; [contract and fixed POL-AC-01..05](../sdd/local-project-policy.md).
Source f987cb85dc6a3ac4fc24ff8aaed53c73ff2d5fe2. Latest HAI tree matches #855;
no open HAI PR at intake. Owner approved the prior concrete policy-source direction.
Full M2 coverage and product AC-02..04 remain incomplete.

## Contract review

One native leaf supplied a bounded read-only audit covering 28 production Completion references,
indirect worker/publication consumers, old local-policy-v1 history and immutable registration risks.
Root verified source references. The report is in the root .team/hai-policy-20261031 task set.

Claude Code 2.1.312 exact requested/observed claude-opus-5-5/high: initial plan REWORK in 159.099s,
exit 0, no timeout, denials or children. The original prompt/result/review remains retained.
Root's revision addresses:

- B1: first registration requires a known project and no accepted/head/current/Run rows, including
  pre-head legacy Runs. Existing registrations verify Initial head bytes, recipe and exact AC coverage.
- B2: v1 accepts human class only. Existing fixture canonicalization also recognizes independent,
  but enabling additional runtime profile classes is excluded from this slice.
- B3: exact integration-base object and explicit null digest when absent.
- B4: normative consumer inventory, static resolver invariant and per-category behavior assertions.

Additional notes fix field presence, digest spelling/canonical field order, strict migration DDL,
atomic later-insert rollback, permanent 32-project ceiling, partial startup semantics, legacy
unconfigured compatibility and short project/WorkItem versus long/Unicode AC bounds.
Follow-up ACCEPT in 53.725s, exit 0 with no errors/denials/children; all four blockers resolved.
Root carried the nonblocking orphan-row/count, per-operation matrix and partial-startup notes into
the contract. V1 now requires explicit independent=true. A reviewer statement that human fixture
Evidence cannot satisfy custom human rules is corrected: it remains an explicit authenticated route
under existing service guards; no automatic Fake evidence is granted. Implementation checks remain
pending; no failed review is relabeled first-pass success.
Root also checked the outbox caveat: run_id is nullable, but DispatchCandidates starts from Runs;
nonnull dispatch rows retain their composite FK. Generic null-Run rows cannot acquire execution
authority and do not expand the fixed first-registration predicate.

## Implementation and verification

T-002 supplied 25 frozen backend files; root checked their hashes and scope before integration.
One immutable profile codec and exact-project resolver now feed all 28 audited consumers. Migration
0006 registers profiles in one startup writer transaction before Compose/listener/worker. The prior
five migration SQL files, dependency files, OpenAPI and CI configuration remain byte-identical.
Only default validation, cloning and the resolver retain direct config.Completion references.

| AC | Observed local proof | Status |
| --- | --- | --- |
| POL-AC-01 | StrictCanonicalIdentity, StrictMembersAndBounds, RunInputCompatibilityAndDocumentBounds, Envelope, RuntimePolicyFile_Admission; indented/key-reordered golden and checked-in operator example | Passed locally |
| POL-AC-02 | ImmutableRegistration, AtomicAndConcurrentRegistration, StartupCompatibility, MigrationUpgradeAndRollback; exact old SQL/checksum audit | Passed locally |
| POL-AC-03 | SelectionAndIsolation, InitialMissingRuleAndOwnedConfiguration, actual runtime captured input and other-project environment denials | Passed locally |
| POL-AC-04 | RuntimePolicyProfiles_CompletionAndRestart, LegacyStartupReplay, RegistrationSurvivesLaterListenFailure | Passed locally |
| POL-AC-05 | Root full backend, web/API/docs and scoped revision checks pass; Claude plan/code reviews pass; PR CI/merge/readback/ledger pending | Delivery pending |

Actual commands and retained raw argv/exit/durations:

- Pinned `bash scripts/check-backend.sh` — exit 0, 405.732s, 182 inputs unchanged during execution.
  Includes CI pins, module verification, gofmt, `go vet ./...`, `go test -count=1 ./...`,
  `go test -race -count=1 ./...` and `go build -buildvcs=false ./...`.
- Worker `go test ./internal/application/port ./internal/domain/sqlite ./internal/application/service ./cmd/taskboard -count=1`
  — exit 0, 19.462s; corresponding affected `go vet` — exit 0, 2.602s.
- Worker focused four-package `go test -race` for policy/runtime/selection and preparation precedence
  — exit 0, 38.061s; exact-byte file/envelope boundary race — exit 0, 2.972s.
- Final review correction changes only two test files: the indented/reordered document and checked-in
  example tests, plus an unchanged migration assertion's V6 diagnostic. Focused normal/race tests
  execute all three named cases, and affected vet/gofmt pass. Root verified 180 full-gate inputs
  unchanged and exact hashes for these two deltas. This is explicit revision coverage; the earlier
  full-gate manifest is not relabeled as containing the added tests. Final PR CI runs the full suite.
- Pinned `bash scripts/check-web.sh` — 30 tests / 9 files plus format/lint/type/build pass;
  dependency preparation 3.371s, gate 12.866s, all 39 inputs unchanged at final integration.
- Pinned Redocly `lint` — exit 0, zero warnings, 5.686s; unchanged OpenAPI SHA-256
  5b1e8b205393321e0c4c15e0d4ecc194805a9f68cd9e30d45694028ed194072c.
- `python3 scripts/check_project_success.py` — 50 contracts and navigation/index pass.
- Task/report validators, scoped Markdown links and `git diff --check` pass at recorded snapshots;
  final staged check and delivery remain separate gates.

The actual runtime test creates two projects/Drafts by HTTP, stops, selects the trusted file,
then proposes and accepts a real local Git specification. Shared ACs include ASCII 81/120 bytes
and Unicode 120 bytes. Selected recipe/rules/policy/approval/base flow into captured Run input and
completion preparation. The other project's environment is denied for both human reports and
explicit authenticated human fixture Evidence. Human Review/Evidence, QA and explicit completion
succeed; the second project additionally needs approval. Fake output alone does not grant Done.
After stop/start, acceptance, evidence and completion commands replay byte-identical results.
Unset, omitted or changed registered policies fail startup with no retained listener.

The service matrix's selected-absent cases poison the default; they alone do not distinguish a
hypothetical other-project lookup bug. Cross-project environment isolation is established by the
actual HTTP negatives. Ready selection also runs in fixture/runtime setup; captured Dispatch rules
are asserted by the runtime test. Source inspection covers the exact resolver and every consumer.

## Retained failures and review disposition

The compiling `red-codec-schema` fails because its minimal skeleton rejects a valid profile and the
new table is absent. New API skeletons were needed for compilation; their exact Red source remains.
Subsequent retained failures exposed outdated synthetic migration numbers, a duplicate fixture
project name, the existing 422 approval-gate status (initial fixture expected 409), and old V3
snapshot helpers counting newly added V6 objects. Corrections preserve existing history assertions;
the V3 helper excludes only the new table/triggers, while a separate V5→V6 snapshot compares every
prior table and schema object. All corresponding checks subsequently pass.

Claude's initial code review REWORK found no production defect. B1 requested explicit internal
whitespace/indentation equivalence, now covered by the literal reordered golden document and
checked-in example tests. The final test-only correction also fixes the V6 diagnostic. Broader
policy precomputation is a nonblocking optimization and is deferred; each operation already resolves
once outside AC/evidence loops. No acceptance criterion was weakened to obtain a pass.
Code review ran for 169.335s; its test-only follow-up returned ACCEPT in 32.136s, both exit 0,
without timeout, permission denial or children. B1 is resolved. Review accepts the explicit full-gate
plus test-delta binding; final-commit full CI remains a merge condition. The raw REWORK is retained.

## Proof limits and delivery

Runtime stop/start occurs in one test process using the real runtime/SQLite/Fake/artifact stack;
it is not a two-process crash, backup or restore qualification. Replay/rejection count checks cover
13 named tables, not every byte of database state. V5 migration snapshots include all prior tables
and schema objects but use the existing V1-populated data fixture, not populated examples of every
later table. Historical v1/v2 compatibility tests explicitly seed old accepted material; current custom
policy completion uses real HTTP setup. SQL constraints and startup verification do not authenticate
a hostile operator's wholesale offline database rewrite. A profile is configuration, not Passing evidence.

No new browser run, coverage endpoint, completion UI, real provider, dependency, release/deploy or
backup/restore acceptance follows. Full M2 and SUCCESS AC-02..04 remain incomplete. Current delivery
state is [BOARD HMPOL](../tasks/BOARD.md); local passing tests are not a merge or owner acceptance.

## Evidence and accounting

[Machine-readable local receipt](project-policy-20261031.json) records source hashes, checks and
review results. Raw packets, failures, source manifests, exact argv and receipts are retained under
`/home/ckc/test/backup/hai-policy-20261031/README.md` at delivery; worktree evidence is the current
source until that copy is verified. One native leaf performed an audit, implementation and separate
bounded test-correction assignment. Four external Claude review launches are observed and
recorded in the JSON; launches are not provider requests. Worker invocation counts/durations are
self-reported or derived from their retained command receipts, with snapshot windows preserved.
Root active/wait totals, aggregate outer/nested calls, provider requests and actual billing remain
unknown/null. CLI-reported usage/list-price estimates are retained separately.
