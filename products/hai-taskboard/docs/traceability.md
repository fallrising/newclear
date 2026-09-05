# HAI Taskboard Traceability

Status legend: `Specified`, `Skeleton`, `Candidate`, `Passing`, `Failing`, `NotRun`, `Deferred`. A
check may move to `Passing` only with a named executable command, retained output/report and the
required acceptance decision. `Candidate` means executed worker evidence still awaits that decision.

## G0 design clauses

| Clause group | Design source | Planned oracle | Status |
| --- | --- | --- | --- |
| HAI-BOUNDARY-001..004 | SDD §3 | architecture/package dependency tests; Fake capability tests | NotRun |
| HAI-AUTH-001..006 | SDD §4, ADR-001/005 | transaction, import, artifact, migration, backup tests | NotRun |
| HAI-DOMAIN-001..005 | SDD §5, ADR-002 | domain identity, immutability, blocker, version/idempotency tests | NotRun |
| HAI-STATE-001..006 | SDD §5 | table-driven WorkItem transition tests; UI parity tests | NotRun |
| HAI-DONE-001..004 | SDD §5, ADR-002 | positive and exhaustive negative completion tests | NotRun |
| HAI-EXEC-001..008 | SDD §6, ADR-003 | outbox, fencing, cancel, expiry, stale publisher, Fake tests | NotRun |
| HAI-RECON-001..007 | SDD §7, ADR-004 | DAG/cycle, old+new closure, stale-plan, reuse tests | NotRun |
| HAI-API-001..005 | SDD §8 | OpenAPI contract, SSE gap/backpressure/reset/rebuild tests | NotRun |
| HAI-UX-001..006 | SDD §9 | component/a11y/keyboard/rejection/disconnect Playwright tests | NotRun |
| HAI-SEC-001..007 | SDD §10 | bind/path/redaction/capability/TOCTOU/retention tests | NotRun |
| HAI-OPS-001..005 | SDD §11, ADR-005 | backup/restore/corruption/capacity/retention tests | NotRun |
| HAI-DELIVERY-001..004 | SDD §12, ADR-006 | document/task validator and evidence-gate review | NotRun |

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
  timing, strict canonical OpenAPI, idempotency and negative completion matrices passed. This is the
  application-command checkpoint only; Fake, HTTP/SSE and vertical integration remain NotRun.

## T-041 implementation-contract inventory

`docs/sdd/fake-vertical-slice-implementation.md` freezes V1 package direction, SQLite constraints,
guarded Done rehydration, command/failure seams, Fake fencing, `/api/v1` boundaries, SSE replay and
serial child writable scopes. It is design evidence only. Its named persistence, transaction, Fake,
HTTP/SSE and integration oracles remain NotRun until the corresponding child executes; no existing
Passing status is broadened.

## First named G1 acceptance skeletons

| ID | Required test/oracle | Expected evidence | Status |
| --- | --- | --- | --- |
| AC-P0A-001 | `TestCompleteWorkItem_AllRequiredEvidence` | domain gate, public SQLite atomic write/load and real-Store application completion/replay pass | Passing (T-024/T-064/T-067) |
| AC-P0A-002 | `TestCompleteWorkItem_RejectsEveryNonPassingEvidenceState` | subtests for missing/failed/skipped/not-run/unknown/stale | Passing (T-024) |
| AC-P0A-003 | `TestCompleteWorkItem_RejectsSubjectTOCTOU` | no phase/record mutation after subject change | Passing (T-024) |
| AC-P0A-004 | `TestCommand_IdempotencySameRequestAndConflict` | application same/concurrent request replays one exact result; mismatched bytes conflict | Passing (T-024/T-067) |
| AC-P0A-005 | `TestRunLease_RejectsStaleEpochPublication` | stale terminal result rejected and audited | NotRun |
| AC-P0A-006 | `TestRunRecovery_ExpiryDoesNotImplyStoppedOrRetry` | NeedsReconcile/OutcomeUnknown retained | NotRun |
| AC-P0A-007 | `TestImpactPlan_UsesOldAndNewReverseClosure` | removed/redirected edge dependents included | Passing (T-024) |
| AC-P0A-008 | `TestImpactActivation_RejectsStalePlan` | pure decision rejects stale plan; durable activation remains NotRun | Passing (T-024) |
| AC-P0A-009 | `TestSSE_SnapshotGapReplayAndRetentionReset` | monotonic replay or explicit reset | NotRun |
| AC-P0A-010 | `TestSSE_SlowConsumerCannotBlockCommand` | bounded disconnect; transaction latency retained | NotRun |
| AC-P0A-011 | `TestRestore_VerifiesArtifactDigestAndRebuildsProjection` | corruption blocks Done and creates attention | NotRun |
| AC-P0A-012 | `board-transition-accessibility.spec.tsx` | fixture drag/keyboard/button parity and focus recovery; browser remains NotRun | Passing (T-033) |
| AC-P0A-013 | `attention-recovery-states.spec.tsx` | distinct disconnect/conflict/unknown/cancel/stale fixture UI | Passing (T-033) |
| AC-P0A-014 | `resume-without-chat.spec.ts` | fresh process resumes current work from durable state | NotRun |
| AC-P0A-015 | `TestSSE_RestoreEpochMismatchRequiresReset` | old cursor cannot resume after restored backup | NotRun |
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
| AC-07 | Concurrent same key/request yields one result/event group | Passing (application T-067; HTTP/integration NotRun) |
| AC-08 | Same key with different request yields idempotency conflict | Passing (application T-067) |
| AC-09 | Concurrent old version yields one success and one conflict | NotRun |
| AC-10 | Response loss after commit replays result without a new Run | Passing (application T-067; HTTP/integration NotRun) |
| AC-11 | State/audit/outbox/result failure is all commit or all rollback | Passing (application/SQLite T-067) |
| AC-12 | Lost Start acknowledgement is looked up; unknown blocks restart | NotRun |
| AC-13 | Expired lease holder cannot finalize or publish | NotRun |
| AC-14 | Live process with missed heartbeat enters recovery, not redispatch | NotRun |
| AC-15 | Unconfirmed cancel remains CancelRequested, not Canceled | NotRun |
| AC-16 | Deadline plus unknown external outcome blocks automatic retry | NotRun |
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
| AC-35 | Snapshot-to-SSE race loses no event and permits deduplication | NotRun |
| AC-36 | Expired/wrong-epoch/slow/disconnected stream resets or closes boundedly | NotRun |
| AC-37 | Revoked session stops receiving stream data | NotRun |
| AC-38 | Lost sink acknowledgement deduplicates delivery without redoing source mutation | NotRun |
| AC-39 | Notification storm/failure is bounded/dead-lettered and cannot block commands | NotRun |
| AC-40 | Backup/restore manifest exposes missing artifact; dispatch begins disabled | NotRun |
| AC-41 | Disk full/SQLITE_BUSY/migration interruption leaves no half mutation | NotRun |
| AC-42 | Fake boundary denies DB/sibling/secret-canary access and leakage | NotRun |
| AC-43 | Malicious repository instructions remain data and cannot alter authority | NotRun |
| AC-44 | Active artifact/symlink cannot execute, escape or overwrite | NotRun |
| AC-45 | Changed/expired approval subject fails and single-use cannot repeat | NotRun |
| AC-46 | No auth/cross-project/wrong Origin denies without resource disclosure | NotRun |
| AC-47 | Producer test/recipe change requires independent review | NotRun |
| AC-48 | Changed integration base prevents old candidate completing new base | NotRun |
| AC-49 | Keyboard/click movement and rejection preserve focus and server phase | NotRun |
| AC-50 | 320px/theme/zoom/disconnect keeps primary actions and non-color cues | NotRun |
| AC-51 | Fresh context finds next safe action; stale pack requires refresh | NotRun |
| AC-52 | Real-provider auth/rate/schema failure is deferred; no fallback provider | Deferred |
| AC-53 | Restore rejects old callback/authority and does not replay unknown mutation | NotRun |
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
