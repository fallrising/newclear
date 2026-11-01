# HAI Taskboard Traceability

Status legend: `Specified`, `Skeleton`, `Candidate`, `Passing`, `Failing`, `NotRun`, `Deferred`. A
check may move to `Passing` only with a named executable command, retained output/report and the
required acceptance decision. `Candidate` means executed worker evidence still awaits that decision.

## G0 design clauses

| Clause group | Design source | Planned oracle | Status |
| --- | --- | --- | --- |
| HAI-BOUNDARY-001..004 | SDD §3 | architecture/package dependency tests; Fake capability tests | NotRun |
| HAI-AUTH-001..006 | SDD §4, ADR-001/005 | transaction, import, artifact, migration, backup tests | Passing bounded command/artifact transaction subset (T-090); backup and full group remain NotRun |
| HAI-DOMAIN-001..005 | SDD §5, ADR-002 | domain identity, immutability, blocker, version/idempotency tests | Passing bounded version/current-subject subset (T-090); full group remains NotRun |
| HAI-STATE-001..006 | SDD §5 | table-driven WorkItem transition tests; UI parity tests | NotRun |
| HAI-DONE-001..004 | SDD §5, ADR-002 | positive and exhaustive negative completion tests | NotRun |
| HAI-EXEC-001..008 | SDD §6, ADR-003 | outbox, fencing, cancel, expiry, stale publisher, Fake tests | Passing bounded Fake/manual vertical and persistent polling subsets (T-073/T-089/T-099); restore remains NotRun |
| HAI-RECON-001..007 | SDD §7, ADR-004 | DAG/cycle, old+new closure, stale-plan, reuse tests | Passing bounded pure kernel (T-024); durable import/activation remains NotRun |
| HAI-API-001,005 | SDD §8 | stable full-command error matrix; deterministic projection rebuild | NotRun |
| HAI-API-002..004 | SDD §8 | SSE gap/backpressure/reset/high-water tests | Passing bounded transport (T-081); T-089 binds durable response-loss/result projection, not an SSE end-to-end loop |
| HAI-UX-001..006 | SDD §9 | component/a11y/keyboard/rejection/disconnect Playwright tests | NotRun |
| HAI-SEC-001..007 | SDD §10 | bind/path/redaction/capability/TOCTOU/retention tests | Passing bounded Approval/artifact TOCTOU subset (T-090); full group remains NotRun |
| HAI-OPS-001..005 | SDD §11, ADR-005 | backup/restore/corruption/capacity/retention tests | NotRun |
| HAI-DELIVERY-001..004 | SDD §12, ADR-006 | document/task validator and evidence-gate review | Passing for bounded T-047 workflow; repository G1 remains NotRun |

## Accepted implementation checkpoint

- T-020/T-022 pure-Go domain and reconciliation kernel accepted by T-024: pinned Go 1.27.1 format,
  vet, unit, race, public Done-authority, named-oracle and authority/module checks passed. This is
  value-domain evidence only; persistence atomicity and rehydration remain NotRun.
- T-030/T-032 static Board-first fixture shell accepted by T-033: pinned frozen install, format,
  lint, typecheck, 8 Vitest tests/full jsdom axe and Vite build passed. Browser Playwright, rendered
  contrast, zoom, keyboard-only and coarse-pointer evidence remains NotRun.
- T-043/T-054/T-056 SQLite foundation plus T-058/T-061/T-063 repairs are accepted by T-064. The
  fresh review covers the public UnitOfWork, project scoping, atomic rollback, guarded Done
  rehydration including nineteen corrupt cases, exact Approval-consumption cardinality, real-
  allocator canonical result replay, verifier-role persistence, immutable identities, typed busy
  behavior and pinned full/race checks. Its accepted application consumer is recorded separately.
- T-044 application commands plus the T-066 repair are accepted by T-067. Pinned application,
  SQLite, full and race gates plus independent real-Store completion/replay/rollback, executor-call
  timing, strict canonical OpenAPI, idempotency and negative completion matrices passed.
- T-045 deterministic Fake plus T-069/T-075 repairs are accepted by T-073/T-076. Fresh independent
  probes cover fail-closed capabilities, immutable scripted observations, explicit-tick determinism,
  all fence dimensions, lifecycle/uncertainty/zero-redispatch behavior, bounded staging/digests and
  hostile artifact names including exact `..`. This is a Fake-package and in-memory worker-seam
  checkpoint only; it did not itself accept application persistence wiring or HTTP/SSE. HTTP/SSE is
  accepted separately below, as are the later predecessor-authority and T-047 integration checkpoints.
- T-046 HTTP/SSE plus T-078/T-080 repairs are accepted by T-081 and a separate orchestrator gate.
  T-077/T-079 remain historical FAIL evidence. Fresh checks cover strict auth-before-read and exact
  Origin, five accepted commands, immutable canonical result lookup, SHA-256 wire encoding,
  contiguous snapshot/replay/live ordering, OpenAPI cursor-bound events, reset/revocation precedence,
  project isolation and both queue limits. This is a transport/composition checkpoint only.
- T-047 vertical integration is accepted through T-087/T-089 plus a separate orchestrator gate.
  T-047/T-082 preserve the original three NotRun boundaries; T-083/T-085 introduced only the
  separately bounded exported predecessor authority accepted by T-086, with T-084 retained as FAIL.
  T-088 remains a read-first chronology FAIL. T-089 freshly passed the exact three oracles,
  ten repetitions, complete backend, race, inventory and adversarial probes against read-only
  candidate bytes. This is deterministic, manually driven Fake-to-application vertical evidence;
  it does not accept automatic persistent polling, restore/backup, browser or provider execution.
- T-090 is accepted by a separate pre-push orchestrator evidence gate. It repairs object verification
  outside SQLite write transactions, WorkItem-version error classification and exact current
  WorkItem/Candidate Approval binding while keeping all three T-047 oracles green. Report SHA-256 is
  `9f52dd6d1b0764b69989544cc7bc7e2f1a3ef66a8b3bb70125d34b6465704f82`.

## T-041 implementation-contract inventory

`docs/sdd/fake-vertical-slice-implementation.md` freezes V1 package direction, SQLite constraints,
guarded Done rehydration, command/failure seams, Fake fencing, `/api/v1` boundaries, SSE replay and
serial child writable scopes. Its bounded persistence, transaction, Fake, HTTP/SSE and T-047
integration oracles are now accepted by their named reports and orchestrator gates. No accepted
child status is broadened into automatic polling, restore/backup, browser, provider or G1 acceptance.

## T-047 exact vertical oracles

| Required oracle | Accepted evidence | Status |
| --- | --- | --- |
| `TestVerticalFake_CompletionAndResponseLoss` | Real SQLite and exported application/Fake/HTTP seams; create-to-Done material and one-use Approval; byte-exact lost-response lookup/replay after artifact loss; no duplicate Run, dispatch or projection | Passing (T-087/T-089/T-090) |
| `TestRunLease_RejectsStaleEpochPublication` | Real epoch N, injected deadline plus 1ns, reconciliation-only N+1, old-N terminal rejection and audit; no durable mutation, Candidate or redispatch; orphan-only sealed object | Passing (T-087/T-089/T-090) |
| `TestCancel_UnknownStopIsNotCanceled` | Persisted cancel intent followed by Fake timeout/lookup-unknown; `CancelRequested`/`NeedsReconcile`/`OutcomeUnknown`, no cancel acknowledgement, Done or redispatch | Passing (T-087/T-089/T-090) |

The original T-047 PARTIAL, T-082 FAIL, T-084 FAIL and T-088 process FAIL remain retained evidence;
none is rewritten as a pass. T-089 report SHA-256 is
`699d117f53e06f6149c2eb3402bd1ce81a42154a04fda6ca7ca1d8322ba11394`, and the accepted
integration candidate SHA-256 is `94f3fc807eb4686b4273abb3f1390625147bc07ed3cc1d95383d7afbd39063ea`.

T-090 retains that history and supersedes only the bounded reviewed authority/contract bytes. Its
report SHA-256 is `9f52dd6d1b0764b69989544cc7bc7e2f1a3ef66a8b3bb70125d34b6465704f82`;
the current integration SHA-256 is `e25e6bad0618edfc083168a7fe0ed798c9beac30677d05820b41cb541c3644b4`.

## First named G1 acceptance skeletons

| ID | Required test/oracle | Expected evidence | Status |
| --- | --- | --- | --- |
| AC-P0A-001 | `TestCompleteWorkItem_AllRequiredEvidence` | domain gate, public SQLite atomic write/load and real-Store application completion/replay pass | Passing (T-024/T-064/T-067; vertical T-089) |
| AC-P0A-002 | `TestCompleteWorkItem_RejectsEveryNonPassingEvidenceState` | subtests for missing/failed/skipped/not-run/unknown/stale | Passing (T-024) |
| AC-P0A-003 | `TestCompleteWorkItem_RejectsSubjectTOCTOU` | no phase/record mutation after subject change | Passing (T-024) |
| AC-P0A-004 | `TestCommand_IdempotencySameRequestAndConflict` | application same/concurrent request replays one exact result; mismatched bytes conflict | Passing (T-024/T-067) |
| AC-P0A-005 | `TestRunLease_RejectsStaleEpochPublication` | stale terminal result rejected and audited | Passing (Fake seam T-073; durable vertical T-089) |
| AC-P0A-006 | `TestRunRecovery_ExpiryDoesNotImplyStoppedOrRetry` | NeedsReconcile/OutcomeUnknown retained | Passing (Fake seam T-073; durable integration NotRun) |
| AC-P0A-007 | `TestImpactPlan_UsesOldAndNewReverseClosure` | removed/redirected edge dependents included | Passing (T-024) |
| AC-P0A-008 | `TestImpactActivation_RejectsStalePlan` | pure decision rejects stale plan; durable activation remains NotRun | Passing (T-024) |
| AC-P0A-009 | `TestSSE_SnapshotGapReplayAndRetentionReset` | monotonic replay or explicit reset | Passing (transport T-081; durable integration NotRun) |
| AC-P0A-010 | `TestSSE_SlowConsumerCannotBlockCommand` | bounded disconnect; transaction latency retained | Passing (transport T-081; transaction integration NotRun) |
| AC-P0A-011 | `TestRestore_VerifiesArtifactDigestAndRebuildsProjection` | corruption blocks Done and creates attention | NotRun |
| AC-P0A-012 | `board-transition-accessibility.spec.tsx` | fixture drag/keyboard/button parity and focus recovery; browser remains NotRun | Passing (T-033) |
| AC-P0A-013 | `attention-recovery-states.spec.tsx` | distinct disconnect/conflict/unknown/cancel/stale fixture UI | Passing (T-033) |
| AC-P0A-014 | `resume-without-chat.spec.ts` | fresh process resumes current work from durable state | NotRun |
| AC-P0A-015 | `TestSSE_RestoreEpochMismatchRequiresReset` | old cursor cannot resume after restored backup | NotRun (wrong-epoch transport seam passes T-081; restore rotation not implemented) |
| AC-P0A-016 | `TestRestore_FencesPreRestoreCallbacksAndDispatch` | old generation cannot publish or auto-dispatch | NotRun |

## Reviewed v0.2 acceptance-case registry

These IDs are preserved from the augmented v0.2 review and are not renumbered. P0-A implements and
executes the subset named by its task contracts; a case that is not reached remains `NotRun`, not
implicitly passed. AC-54 belongs exclusively to G2/P0-B.

| Source ID | Required oracle | P0-A status |
| --- | --- | --- |
| AC-01 | Run success with one missing required AC cannot complete; exact gap returned | NotRun |
| AC-02 | Candidate B cannot use Candidate A evidence; history remains | NotRun |
| AC-03 | Changed AC/policy makes old evidence inapplicable | NotRun |
| AC-04 | Forged/self human or verifier identity is denied without mutation | NotRun |
| AC-05 | Skipped/Error/Inconclusive required check is not Passing | NotRun |
| AC-06 | Replaced artifact bytes fail digest and become Missing/Quarantined | NotRun |
| AC-07 | Concurrent same key/request yields one result/event group | Passing (application T-067; HTTP boundary T-081; vertical replay T-089; concurrent vertical NotRun) |
| AC-08 | Same key with different request yields idempotency conflict | Passing (application T-067) |
| AC-09 | Concurrent old version yields one success and one conflict | NotRun |
| AC-10 | Response loss after commit replays result without a new Run | Passing (application T-067; HTTP lookup T-081; vertical T-089) |
| AC-11 | State/audit/outbox/result failure is all commit or all rollback | Passing (application/SQLite T-067) |
| AC-12 | Lost Start acknowledgement is looked up; unknown blocks restart | Passing (Fake T-073; durable integration NotRun) |
| AC-13 | Expired lease holder cannot finalize or publish | Passing (Fake T-073; durable vertical T-089) |
| AC-14 | Live process with missed heartbeat enters recovery, not redispatch | NotRun |
| AC-15 | Unconfirmed cancel remains CancelRequested, not Canceled | Passing (Fake T-073; durable vertical T-089) |
| AC-16 | Deadline plus unknown external outcome blocks automatic retry | Passing (Fake T-073; durable vertical T-089) |
| AC-17 | Duplicate/stale Question response cannot resolve a newer blocker | NotRun |
| AC-18 | Resolving one of two blockers leaves the WorkItem blocked and phase intact | NotRun |
| AC-19 | Resume on unsupported profile fails closed and requires new Run | NotRun |
| AC-20 | Fake checkpoint survives restart only after binding revalidation | NotRun |
| AC-21 | Retry budget/WIP limit forbids extra execution and raises attention | NotRun |
| AC-22 | Heartbeat without progress raises silence attention without fake progress | NotRun |
| AC-23 | A change invalidates declared B/C consumers while independent D is reusable | NotRun |
| AC-24 | Removed/redirected edge still includes consumers via old+new topology | NotRun |
| AC-25 | Self-loop/cycle/missing required node rejects activation with path | NotRun |
| AC-26 | Stable-ID rename preserves identity; presentation-only move may be no-op | NotRun |
| AC-27 | Unmapped required requirement blocks an all-unaffected claim | NotRun |
| AC-28 | Changed graph/policy/relevant Run makes preview stale and unapplied | NotRun |
| AC-29 | In-flight stale input may retain candidate but cannot publish/complete | NotRun |
| AC-30 | Upstream change preserves historical Done but makes it ineffective | NotRun |
| AC-31 | Same bytes with different recipe/environment is not an automatic cache hit | NotRun |
| AC-32 | Unauthorized AI edge deletion/no-op proposal cannot change accepted graph | NotRun |
| AC-33 | Unapproved/import-crashed candidate cannot change accepted graph | NotRun |
| AC-34 | Rebuild preserves canonical state and deterministic view ordering/checksum | NotRun |
| AC-35 | Snapshot-to-SSE race loses no event and permits deduplication | Passing (transport T-081; real-Store integration NotRun) |
| AC-36 | Expired/wrong-epoch/slow/disconnected stream resets or closes boundedly | Passing (transport T-081; restore rotation NotRun) |
| AC-37 | Revoked session stops receiving stream data | Passing (transport T-081; real-session integration NotRun) |
| AC-38 | Lost sink acknowledgement deduplicates delivery without redoing source mutation | NotRun |
| AC-39 | Notification storm/failure is bounded/dead-lettered and cannot block commands | NotRun |
| AC-40 | Backup/restore manifest exposes missing artifact; dispatch begins disabled | NotRun |
| AC-41 | Disk full/SQLITE_BUSY/migration interruption leaves no half mutation | NotRun |
| AC-42 | Fake boundary denies DB/sibling/secret-canary access and leakage | Passing (Fake package T-076; OS isolation/integration NotRun) |
| AC-43 | Malicious repository instructions remain data and cannot alter authority | NotRun |
| AC-44 | Active artifact/symlink cannot execute, escape or overwrite | NotRun |
| AC-45 | Changed/expired approval subject fails and single-use cannot repeat | Passing bounded wrong-target/stale-version/current-subject checks (T-090) and one-use vertical completion (T-089); expiry/repeat attack remains NotRun |
| AC-46 | No auth/cross-project/wrong Origin denies without resource disclosure | Passing (HTTP transport T-081; artifact/browser integration NotRun) |
| AC-47 | Producer test/recipe change requires independent review | NotRun |
| AC-48 | Changed integration base prevents old candidate completing new base | NotRun |
| AC-49 | Keyboard/click movement and rejection preserve focus and server phase | NotRun |
| AC-50 | 320px/theme/zoom/disconnect keeps primary actions and non-color cues | NotRun |
| AC-51 | Fresh context finds next safe action; stale pack requires refresh | NotRun |
| AC-52 | Real-provider auth/rate/schema failure is deferred; no fallback provider | Deferred |
| AC-53 | Restore rejects old callback/authority and does not replay unknown mutation | Passing (Fake fence T-073; restore integration NotRun) |
| AC-54 | Real Codex bounded task with independent evidence and human completion | Deferred (G2) |

### Required minimum before P0-A exit

- Authority/atomicity: AC-10, AC-11, AC-33, AC-34.
- Done/evidence: AC-01..06, AC-29, AC-30, AC-47, AC-48.
- Idempotency/concurrency: AC-07..11.
- Lease/cancel/recovery: AC-12..16, AC-20, AC-53.
- Reconciliation: AC-23..31.
- SSE: AC-35..37, including wrong restore epoch in AC-36.
- Backup/restore: AC-40, AC-41, AC-53.
- Fake security boundary: AC-42..46 as denial/rendering evidence only.
- UI/resume: AC-49..51.

## Deferred acceptance families

Real provider conformance, credentials, host/network sandboxing beyond Fake, Slack/Lark/MCP,
multi-user authorization, deploy/release and cross-project orchestration are `Deferred` to G2 or
later. They MUST NOT be reported as P0-A coverage.

## Persistent local runtime (T-095/T-096/T-098, accepted by T-099)

| Clause | Executable oracle | Evidence | Status |
| --- | --- | --- | --- |
| HAI-RUNTIME-101..102 | `TestPersistentRuntime_ExecutesPendingFakeOnce`, `TestPersistentRuntime_ConcurrentScansClaimOnce`, `TestPersistentRuntime_ProcessPollerAndHTTP` | T-095 native full/race | Passing bounded native T-099 |
| HAI-RUNTIME-103 | `TestPersistentRuntime_RestartPendingAndClaimed` | T-095 Pending/claimed restart and no redispatch | Passing bounded native T-099 |
| HAI-RUNTIME-104 | `TestPersistentRuntime_ShutdownJoinsWorker`, `TestPersistentRuntime_WorkerFailureDrainsHandlers` | T-095 native full/race | Passing bounded native T-099 |
| HAI-RUNTIME-105..106 | `TestPersistedProjection_SnapshotAndRestart`, `TestPersistedProjection_ReplayIntegrityAndProjectScope`, `TestPersistentRuntime_ProcessPollerAndHTTP` | T-096/T-095 native SQLite/HTTP/full/race | Passing bounded native T-099 |

Native Go 1.27.1 and Node 24.20.0/pnpm 11.25.0 evidence does not substitute for unavailable
container/browser/root-CI evidence. Global project-event gaps reset; current-policy coverage is
unavailable and conservatively represented, as specified in `sdd/persistent-fake-runtime.md`.

## Bounded CI gate

| Clause | Executable oracle | Evidence | Status |
| --- | --- | --- | --- |
| HAI-CI-001 | root HAI workflow on a PR touching the component; `scripts/check-backend.sh`, `scripts/check-web.sh`, `scripts/check-ci-pins.sh` | T-110/T-113, fresh T-112 PASS; candidate `8f45a951d6f5285d833a51fe452eda708a86ceeb`, [PR run 37147865046](https://github.com/fallrising/newclear/actions/runs/37147865046); acceptance in PLAN | Passing bounded |

The workflow covers native backend and fixture-UI gates. It supplies no missing browser, import,
restore or real-provider acceptance evidence.

## Admission and integrity predecessors (T-0163 bounded acceptance)

| Clause | Oracle or contract | Status |
| --- | --- | --- |
| HAI-ADMISSION-001..008 | `sdd/accepted-spec-admission.md` proposal/head/provenance/activation/read-set/input/migration contract; seven durable child oracle groups | Accepted H01 design (T-126); H06..H09 Specified/NotRun |
| HAI-INTEGRITY-001 | `TestRuntime_RejectsUnsupportedScenarioBeforeDispatch`, `TestDispatchRun_RejectsUnsupportedScenarioWithoutMutation`, `TestFakeAdapter_DeclaresRegisteredScenariosWithoutAliases` | Passing bounded (T-124/T-126); original T-121 Red retained |
| HAI-INTEGRITY-002..005 | `TestCompleteWorkItem_RejectsPostPublicationArtifactTamper`, `TestCompleteWorkItem_MaterialVerificationOutsideWriteTransaction`, `TestCompleteWorkItem_RejectsMaterialSnapshotChange`, `TestCompleteWorkItem_RechecksAllCandidateBindingsAndProjectScope`, `TestCompleteWorkItem_MaterialObjectBudgets`, `TestArtifactMetadata_ImmutableLocatorAndAvailability`, `TestCompletionMaterial_BoundedCollectionsRejectOverflow`; existing response-loss replay | Passing bounded (T-122/T-125/T-126); original artifact Red retained |
| HAI-INTEGRITY-006 | existing persistent restart/worker-failure/no-redispatch and full/race regressions | Passing bounded full/race regression gate |

AC-06 has only the bounded new-completion corruption rejection predecessor in this slice.
Persisted Missing/Quarantined disposition, repair, restore and full AC-06 remain NotRun.
Unsupported dispatch rejection does not implement resume or AC-19. No accepted-head authority,
current graph importer, browser or broader G1 coverage is inferred.


## Ordered migration prerequisite (bounded acceptance)

| Clause | Executable oracle | Status |
| --- | --- | --- |
| HAI-MIGRATION-001..006 | `TestAdmission_MigrationPreservesV1AndRejectsUnknownSchema`, `TestMigrationRunner_RegistryAndHistoryValidation`, `TestMigrationRunner_AtomicUpgradeRollbackAndRestart`, `TestMigrationRunner_ConcurrentStartup`, `TestMigrationRunner_CancellationReleasesWriter` | T-130 lawful Red/focused Green; T-131 independent PASS and root full/race/web gate; accepted bounded |

This predecessor checkpoint is the runner subset of HAI-ADMISSION-008 only. It did not supply
V2 schema, accepted heads, proposal/import/activation, process-kill/COMMIT I/O fault or
backup/restore evidence.
The subsequent V2 storage child below supplies actual V2-specific migration criteria; durable
admission commands and broader H06..H09 acceptance remain Specified/NotRun.

## V2 persistence schema child (bounded acceptance)

| Clause | Named oracle | Status |
| --- | --- | --- |
| HAI-V2-001..007 | `TestAcceptanceSchema_FreshUpgradeAndReopen`, `TestAcceptanceSchema_V1UpgradePreservesHistoryAndLeavesHeadsEmpty`, `TestAcceptanceSchema_RejectsUnknownAndOldBinary`, `TestAcceptanceSchema_ActualV2RollbackRestart`, `TestAcceptanceSchema_ActualV2CancelAndConcurrent`, `TestAcceptanceSchema_ScopedRelationsAndHeadSwap`, `TestAcceptanceSchema_ImmutableHistoryAndReplacement` | T-140 root ACK before code; T-141 lawful Red/Green; T-142 native PASS; root full/race/web gates; passing bounded T-0189-gate |

This child proves storage/migration boundaries only; SQL fixture writes do not prove operator
acceptance. HAI-ADMISSION-001..008 canonical verification, auth/CAS, complete mapping, import,
activation and current accepted-input consumers remain Specified/NotRun. No G1 inference follows.

## Immutable proposal foundation (bounded child)

| Clause | Named oracle | Status |
| --- | --- | --- |
| HAI-IMPORT-001..002,005 | `TestProposalCore_ImmutableCapture` | Passed: lawful Red, root native/pinned gates and independent review |
| HAI-IMPORT-003 | `TestProposalCore_StrictManifest` | Passed: root gates and independent semantic review |
| HAI-IMPORT-004 | `TestProposalCore_NormativeIdentity`, `TestProposalCore_CanonicalReadAndCopies` | Passed: root gates and independent semantic review |
| HAI-IMPORT-005..006 | `TestGitReader_RealObjectsAndRefCapture`, `TestGitReader_Confinement` | Passed: SHA1/SHA256 loose/packed on Git 2.47.3 and 2.39.5 |
| HAI-IMPORT-005..007 | `TestGitReader_BoundsAndCancellation` and core budget/cancellation subtests | Passed: root gates and independent semantic review |

The exact `sdd/proposal-import-core.md` contract, preimplementation ACK and six runnable positive
Red assertions are bound in PLAN. This child separates immutable proposal provenance from normative
Graph revision and adds no durable command, acceptance or current-head authority. Full
`TestAdmission_ProposalProvenanceAndCrashIsolation` remains Specified/NotRun: authentication,
binding recheck, transaction/result/audit and crash isolation belong to the later command child.

T-151 implements only the two new packages. Exact source and seven-group inventory are bound in
PLAN and T-0197-gate; T-152 independently passed 212 native and 65 additional tests/subtests.
T-153 confirms inventory without making a semantic acceptance claim. Pinned shared full/race/
vet/build and fresh web gates passed. Failed fixture/setup/intermediate cancellation evidence is
retained, and the original positive Red assertions were preserved. PR CI remains a separate
exact-head delivery gate; this local coverage does not advance the broader durable admission status.

## 2026-10-23 resumed durable proposal command

| Clause | Named oracle and retained evidence | Status |
| --- | --- | --- |
| HAI-PROPOSE-001..004 | `TestAdmission_ProposalProvenanceAndCrashIsolation`, `TestAdmission_PostwriteRejectionAndCancellationRollback`; T-981 lawful Red/Green, T-982 independent review/adversarial storage checks, root pinned full/race/vet/build | Passing bounded service/storage slice |
| HAI-PROPOSE-005..008 | `TestAdmission_HTTPCommand`, `TestRepositoryConfiguration_RejectsUnsafeInput`, `TestRepositoryDescription_PublicOnly`, `TestAdmission_HTTPReplayAndRestart`; T-983 Red/Green, T-985 review/closure, root full/race gate plus two fresh OS processes | Passing bounded HTTP/runtime slice |

The current work board is `docs/tasks/BOARD.md`; historical class A records remain unchanged.
This checkpoint supersedes only the earlier statement that durable proposal commands are wholly
unimplemented. Approved binding identity, immutable proposal/graph persistence, exact replay,
transaction rollback and existing SSE event shape now have fresh evidence. SQL write-fault and
cancellation rollback tests do not establish process-kill or COMMIT-I/O crash behavior.
At that proposal checkpoint, first acceptance and all successor slices remained unaccepted;
the subsequent first-acceptance evidence is recorded below.

T-985 initially requested rework because the Go runtime restart test stays within one OS process
and the proposal OpenAPI condition allowed expected_version=0. That history remains in its report.
Root corrected the new schema (including nonzero OIDs, scoped permission response and lint warnings)
and ran task `proposal-process-gate-20261023`: the pinned built binary ran as two fresh processes,
with graceful SIGTERM between them, source removal and registry revocation before restart, exact
POST/result-lookup replay, unchanged durable row counts, clean FKs and no heads/requirements/Runs.
Its receipt binds binary/result hashes, both process exits, counts and source inventory; fixture
state is retained in preserve/artifacts with a separate SHA-256 inventory. This is graceful restart
evidence, not process-kill or restore. T-985 independently verified those artifacts and accepted
HAI-PROPOSE-005..008 after rework.

`runtime-backend-gate-20261023` passed the final unmodified full/race/vet/build gate on frozen Go
bytes. `runtime-owner-gate-20261023` actually executed the wrong-owner branch as UID0 inside an
offline bounded container; the native unprivileged branch is not counted as exercised.
`runtime-api-final-20261023` passed pinned Redocly 2.51.2 with no warnings; the initial four-warning
lint output remains in `runtime-api-gate-20261023`. No Git publication was performed.

Root executed the unmodified backend gate in its pinned Go container through common workspace
task `proposal-backend-gate-20261023`; `preserve/evidence/inputs.json` binds source bytes and
`backend.log` records format/vet/full/race/build success. The pinned Node gate in task
`web-baseline-20261023` passed format/lint, eight fixture tests, typecheck and build; it supplies
no live browser evidence. T-981's local full test failure on sandbox-denied listeners remains
in its original PARTIAL report; the separate root container gate passed those runtime tests.

## 2026-10-23 explicit first acceptance

HAI-FIRST001..006 are accepted locally after T-986, T-989 independent review and T-999 correction.
The durable `TestAdmission_FirstAcceptAtomicAndSingleWinner` and rollback/corruption controls
cover service-created empty Drafts, full mapping/AC bytes, exact subjects, concurrency, immutable
heads/requirements, versions and response replay. Initial acceptance preserves Draft and creates
no Run. It supplies no current-head readiness, dispatch or whole Done acceptance by itself.

T-989's retained independent probe found QueryRow could ignore a conflicting deterministic AC
identity when an exact legacy tuple also existed. `root999-red` reproduces it with the permanent
`TestAdmission_InitialAcceptanceImmutableDedupKeys`; `root999-green` and the unchanged independent
`review989-closure` overlay pass after bounded verification of both unique keys. The review's
original REWORK remains alongside its ACCEPT closure.

Root inspected all eleven original files and the correction, then ran the unmodified pinned
backend gate in `initial-backend-final-20261023`: full/race/vet/build and module/pin checks passed.
Its `inputs.json` binds 105 backend source inputs, verified unchanged after the gate. Final log
SHA-256 is `7c1567ad3595ecbed0fcf5023f88cf507772e25c83a23a676f2ce6529b6358bd`.
The earlier sandbox Docker access failure and original pre-fix passing full gate remain separate
evidence, never substitutes for correction verification.

The isolated `browser-cookie-chromium-20261023` probe passed native Secure __Host cookie set/send
on Chromium151.0.7922.34 HTTP loopback. This is protocol feasibility, not application login/UI
acceptance. The earlier multi-browser probe timed out after recording Chromium's result; other
browser results are unverified. No matching probe container remained when inspected.

### Current input storage and browser transport — 2026-10-23

T-988 HAI-INPUT001..004 is accepted locally after full eight-file inspection, compiling Red,
HAI-local T-004 independent review (eleven additional adversarial probes) and root pinned
`input-browser-backend-20261023` full/race/vet/build with all113 backend hashes stable.
HAI-INPUT005..007 consumers remain separate, pending work.

HAI-local T-003 session/static transport is accepted locally after retained T-005 REWORK
identified file/root FIFO startup blocking races. T-003 permanent Red/Green and fresh T-006
independent existing-regression review close both on pinned Linux/Go1.27.1. Seven source
hashes match `worker-hai003-fifo-green/preserve/evidence/rework-source-manifest-final.json`.
Final root `input-browser-final-20261023` passes unmodified pinned full tests/race/vet/build
with all114 backend inputs stable. `browser-api-integrated-20261023` pinned OpenAPI lint
passes without warnings. `browser-runtime-final-20261023` builds/runs the actual Go binary
and Chromium151.0.7922.34: anonymous denial, explicit static entry, login, Secure host cookie,
authenticated read, Origin/Host/ambiguous-cookie denials, no API fallback and logout all pass;
runtime exits0 on SIGTERM. This fixture-shell probe explicitly records productUIAcceptance=false.

Evidence lives under common workspace `hai-taskboard/tasks/<task>/preserve/evidence/`;
backend inputs/log and browser inputs/images/receipt/logs are retained. Earlier sandbox
socket denials and the first harness wrong-Host failure remain: Node fetch rewrote Host;
an isolated echo diagnosis justified using http.get for the final negative request. No
Firefox/WebKit, connected React, candidate/Done, activation or restore acceptance is claimed.

### Current-head Ready/dispatch — 2026-10-23

HAI-local T001 is accepted locally for HAI-INPUT005 and its007 readiness/dispatch oracle.
Root inspected all16 frozen source files and guarded every integration against the prior
baseline. Independent T008 ACCEPT reran service/SQLite/integration and focused poller tests.
Root `ready-dispatch-integrated-20261023` unmodified pinned full/race/vet/build passes, including
listener tests denied in the worker sandbox, with all120 backend paths/hashes stable.
Worker historical fixture failures and nine sandbox socket denials remain in T001 report.
Real service empty-Draft/proposal/first-accept/Ready/dispatch is the authority proof; modeled
old fixture views and storage fixture setup remain explicitly distinct. Stale Pending input
gets only a committed NeedsReconcile mark/audit/event and typed nonfatal outcome, without a
lease or retry; corruption stays fatal. Publication/Done is separately pending T002.

### Connected first acceptance — 2026-10-23

HAI-FIRST007..009 accepted locally: root inspected/integrated six T007 files against exact
baseline, independent T010 ACCEPT with maximum-capacity/strict nested-field probes, root
initial-http-api-final-20261023 zero-warning pinned lint, and initial-output-integrated-20261023
unmodified pinned full/race/vet/build with all128 backend inputs unchanged. The latter also
contains an unaccepted V4 candidate; T011 SQL text/byte-bound REWORK still blocks output storage.
Root added the preparation GET global Host403 response after the review without changing Go.

Actual initial-http-process-20261023 built binary SHA256
6614a1b75b5b1bf619731eb8f1e6cb7a029f779f83ad9deb89c4ae281db5e41d and ran two OS processes:
read-only preparation, explicit acceptance, Ready, one Fake execution, then source loss and
registry revocation. Exact acceptance/result lookup replay survived restart. Both SIGTERM exits0;
heads/requirements/proposal/input envelope/Run each1, command/idempotency6, audit/event10 stable
after restart, FKs clean. WorkItem remained Developing and CompletionRecord count0. Receipt,
inputs, logs and retained generated fixture/binary are in the common task evidence/artifacts.
This is actual API/process evidence, not connected React or Done acceptance.

## 2026-10-23 current consumers, output correction and directory checkpoint

Root accepted bounded HAI-local T002/T009/T015 after full diff inspections, guarded exact
source integration and independent T016/T013/T017 ACCEPT. Common launcher task
current-output-directory-integrated-20261023 ran unmodified pinned check-backend.sh:
module verification, formatting, vet, full tests, race tests and build all exit0 on 134
unchanged inputs. Evidence backend.log SHA256 `fe8c21bec493d6a6d857f6f79ec40755651b0df054c022aade2103fdbc2f8817`; inputs.json retained.
Directory OpenAPI lint task directory-api-integrated-20261023 passed0warnings.
T009 original NUL/text length defect, worker failed instrumentation attempt and corrected
regressions remain in T011/T009 reports. T015 Red is root transcript receipt session98153
chunkf01cce (compiled404), not an independently retained log; initial duplicate-name fixture
failure and corrected scoped2 are explicit in T015/T017. T002 historical socket denials are
superseded for integration by this listener-enabled pinned gate, not deleted.

Root connected-web-integrated-20261023 passed19tests/type/lint/format/build in pinned
Node24.20 with offline RO modules and retained build assets. This does not accept T014:
T018 independently reproduced stream reset retaining command authority and stale login
response overwriting newer session authority. T019 rework is pending; browser foundation
gate diagnostics and all full UI/Done/activation/restore requirements remain separate.

## 2026-10-23 interrupted-work recovery and completion prerequisites

Root inspected all T012 eight-file and T020 five-file diffs, checked baseline/frozen hashes and
integrated the independently reviewed candidates. T027 ACCEPT covers complete scoped Run outputs,
atomic fenced publication and explicit local-policy-v2 human independence. T026 ACCEPT covers
strict existing completion/cancel HTTP adapters. T023 ACCEPT covers two new exact completion
preparation service files. Root accepts these bounded slices after `completion-integrated-20261023`
ran unmodified pinned Go1.27.1 check-backend.sh: full/race/vet/build, format/modules/pins exit0;
all141 source inputs unchanged. backend.log SHA256 `e80fad7c2fe16b1b6e4be6f507a18fd7997acaa4f3da3dfd985da5de3282972a`.
`completion-api-integrated-20261023` pinned Redocly lint exit0, zero warnings.

T018 reset/session REWORK remains retained; T019 correction passed independent T022. Actual browser
found percent-encoded digest paths and intermittent noncanonical issued_at fractional zeros;
the path fix and root T024 timestamp Red/Green are retained. T025 independently checked all1000
millisecond values and captured intent. Actual axe then exposed a keyboard-inaccessible horizontal
board after Fake completion; T028 tabIndex/visible-focus correction retains the original Red.
T029 independently verified Tab entry and ArrowRight scroll0→280 with a3px focus outline.
Its source-equality diagnostic and socket denial remain in PARTIAL report, final bounded ACCEPT.

`root-hai028-green` passed pinned Node24.20 thirty tests/nine files, typecheck/lint/format/build.
`connected-browser-accessible-20261023` passed the original corrected frontend foundation;
`completion-connected-browser-20261023` rebuilt the integrated current backend and reran actual
Chromium151.0.7922.34: login/cookie, project/Draft creation, headlessReady rejection/focus, durable
project restart, explicit binding/proposal/preparation/acceptance, lost Ready response recovered by
original-result GET without repost, actual Fake/SSE Succeeded stays Developing, disconnect/reconnect,
board keyboard focus, axe light/dark no violations,320px dark,640px at200percent CSS zoom and logout.
Each uses two fresh processes, exits0 and records fullProductAcceptance=false/doneAcceptance=false.
Artifacts, exact inputs, logs and screenshots remain in common workspace preserve directories.
CSS zoom is not native browser zoom; full keyboard/coarse-pointer acceptance remains pending.

Whole HAI-DONE/UX/ops acceptance remains pending: completion/artifact/report reads and UI,
current-policy detail/coverage, full attention/impact, durable activation, verified restore and
ContextPack fresh-context resume. No Git publication, tag or deployment. Historical failures,
worker socket-denied tests and private-harness errors were not rewritten as first-run successes.

## 2026-10-30 M1a completion preparation

Owner-approved [HAI-PREP-001..005](sdd/completion-preparation.md) refine HAI-API-001 and support HAI-DONE
without moving completion authority. PREP-AC-01..04 map to the four named HTTP oracles and
`TestCompletionPreparation_PolicyPrecedence`; transport tests are in `backend/internal/transport/httpapi`,
real SQLite HTTP/no-write/reopen tests in `backend/internal/application/service`. C01/HAI-DELIVERY-004
aligns BOARD/bootstrap authority; C06 aligns preflight wording with HAI-INTEGRITY-003/004.
[Current M1a evidence](evidence/m1a-completion-preparation-20261030.md) distinguishes focused results,
root gates, independent review and delivery. No whole-product or historical oracle is promoted.

## 2026-10-30 M1b output access

[ACCESS-AC-01..04](plans/m1b-output-access-20261030.md) refine the authorized M1b read slice
under HAI-OUTPUT-001..003, HAI-AUTH-004, HAI-SEC-003 and HAI-API. Scope is authenticated
project/WorkItem/Run output metadata and bound verified byte access, with unchanged historical
identity and zero writes. [M1b evidence](evidence/m1b-output-access-20261030.md) maps the four
ACs to actual HTTP/service/SQLite/runtime oracles and root/Claude acceptance; Git delivery is in BOARD.
Full v0.2 AC-06/44/46 and SUCCESS AC-02..04 are not accepted by this bounded slice.


## 2026-10-31 M1c human report submission and reads

[REPORT-AC-01..05](plans/m1c-human-reports-20261031.md) cover explicit bounded human text,
server-owned actor/digest/time, immutable subject/scope provenance, atomic separate Review/Evidence
and command bookkeeping, replay and historical verified downloads. [M1c evidence](evidence/m1c-human-reports-20261031.md)
maps each AC to command/service/HTTP/SQLite/confined-store tests and separates worker/root/reviewer
acceptance. Migration0005 is appended;0001..0004 and fixture/Done contracts are unchanged.

`TestHumanReport_PostIOSnapshotDecisions` distinguishes version-stable material changes from count-only
report changes and checks recorded stale replay versus unrecorded conflict.
`TestHumanReport_CompletionConsumesHumanRecords` exercises real QA/approval/completion joins containing
both submitted semantic IDs, isolated missing Evidence and ChangesRequested failures, and completion
with missing Review bytes under the unchanged predicate. These are bounded backend integration tests;
full connected completion UI and SUCCESS AC-02..04 remain pending. Current delivery status is BOARD HM1C.


## 2026-10-31 M2 accepted-workflow AC identity

[Plan](plans/m2-ac-identity-20261031.md) ID-AC-01..04 and [evidence](evidence/m2-ac-identity-20261031.md)
map HAI-IMPORT-003/004, HAI-FIRST-001, HAI-INPUT-002/005/006 and HAI-CONNECT-007 without changing
their acceptance criteria. TestACIdentity_AcceptedBoundary/CommandIngress/HTTPIngress and
CanonicalCompatibility cover exact byte/Unicode agreement and historical canonical identity.
TestAcceptedACIdentity_EvidenceAndCompletionBoundary covers real SQLite/proposal/Fake plus HTTP
acceptance/human reports/QA/Done, missing explicit policy and Store reopen/replay. Existing
TestAdmission_AllPublicationConsumersRejectStaleInputs, ModeledCurrentSemanticChangesRejectAllConsumers,
TestCompletionPreparation_PolicyPrecedence and runtime/domain independence/Done regressions passed
in the final full gate; those negatives retain original IDs. No full HAI-DONE/UX/OPS claim follows.
Legacy nonempty Draft and domain rehydration stay unchanged. The approved policy-source successor
is tracked below. At this historical checkpoint, TestCoverageProjection_MatchesCurrentDonePredicate was Proposed/NotRun; the 2026-11-01 section below supersedes that test status. Full M2 remains incomplete.

## 2026-10-31 immutable local project policy

[Contract](sdd/local-project-policy.md) POL-AC-01..05 is the approved policy-source successor to
HAI-CONNECT-005, preserving HAI-FIRST-002/005, HAI-INPUT-002/005/006 and preparation error precedence.
Claude plan/code revision ACCEPT and named codec/admission, immutable registration, project selection
matrix and actual runtime completion/restart oracles pass locally. [Evidence](evidence/project-policy-20261031.md)
records full-gate/test-delta binding and limitations. Migration 0006 is implemented; 0001..0005
remain frozen. Final CI/delivery status is BOARD HMPOL.
At this historical checkpoint, TestCoverageProjection_MatchesCurrentDonePredicate was Proposed/NotRun; the 2026-11-01 section below supersedes that test status. Full M2 remains incomplete.


## 2026-11-01 verified coverage

[Approved contract](sdd/verified-coverage.md) COV-AC-01..06 maps the bounded coverage portion of
HAI-CONNECT-007, HAI-DONE and M2 to an authenticated observation-only API. It does not accept the
remaining completion UI or all M2. `TestCoverageProjection_MatchesCurrentDonePredicate` now runs
against real accepted SQLite state and follows a satisfied QA observation with explicit Complete.
`TestVerifiedCoverage_AcceptedMultiACHTTPAndRestart` adds authenticated multi-AC Git acceptance,
selected immutable policy, 120-byte Unicode identity, sealed human reports, HTTP observations,
reopen and explicit Done. `TestVerifiedCoverageHTTP_*` checks closed wire/auth/scope/byte limits;
service matrices check all-match vetoes, artifact budgets, two-snapshot races and all-table no-writes.
Exact gate results and residual limits are recorded in [delivery evidence](evidence/m2-verified-coverage-20261101.md).


## 2026-11-01 WorkItem material index

[Approved IDX-01..05](sdd/work-item-material-index.md) refines HAI-API-001/004/005 and supports
HAI-CONNECT-007 through stored identity discovery. Fixed IDX-AC-01..06 map to
`TestWorkItemMaterialIndexHTTP_*` (auth, closed wire, bounds and optional adapter),
`TestWorkItemMaterialIndex_StoredIdentityAndHistory/AcceptedRelations/BoundsAndCorruption/RunEnumVocabulary/AcceptedBoundsAndCorruption`,
`TestWorkItemMaterialIndex_SnapshotAndNoWrites` (real WAL concurrent writer and reopen), and
`TestWorkItemMaterialIndex_DiscoverThenComplete/MissingPolicyAndArtifactsStillReadable` (real
accepted SQLite/Fake/HTTP, downstream discovered IDs, explicit completion and semantic stale rejection).
[Evidence](evidence/work-item-material-index-20261101.md) distinguishes injected Impact rows,
actual accepted command history, synthetic wire bounds and source-bound native gates.
No full WorkItemDetail/history, M2 or connected completion acceptance is inferred.
