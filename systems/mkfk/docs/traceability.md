# Requirement and invariant traceability (M7)

Every functional requirement (CSR §4.1) and invariant (§4.2) maps to at least one test that runs in a gate. "Gate" names the make target that runs it: `test` and `test-race` run every test; `test-model`, `test-integration`, and `test-chaos` also fail if a named test did not run and pass (`scripts/run-named-tests.sh`). Acceptance-level evidence for each milestone is in `docs/evidence/`.

## Functional requirements

| ID | Requirement | Executed tests | Gate |
| --- | --- | --- | --- |
| FR-01 | append, strict offsets, checksum, restart recovery | `TestM1ST01AppendBatchesAndReadOffsets`, `TestM1ST03DurableAfterSIGKILL`, `TestM1ST04TornActiveTailRecovery`, `TestM1ST05CorruptionAndCommitFloorFailClosed` | test, integration |
| FR-02 | segments, sparse seek without full scans, index rebuild | `TestM2ST06…`, `TestM2ST07SparseSeekMatchesReferenceAndReportsWork`, `TestM2ST08…`, `TestM2ST09…`; benchmark seek comparisons per fetch | test, bench |
| FR-03 | durable term/vote, log matching, majority commit, fencing | `TestM3RP01`–`TestM3RP07`, `TestM3DeterministicModel100Seeds1000Events`, `TestM3ThreeProcessFailoverAndRestartDriver`, `TestM7StaleCandidateDoesNotResetUpToDateElectionTimers` | test, model, integration |
| FR-04 | ISR join/evict, HW, ack gate, no success without quorum | `TestM4RP08`–`TestM4RP11`, `TestM4RandomizedISRAndGateInvariants`, `TestM7FollowerOneRoundTripBehindStaysInISRWhileStuckFollowerIsEvicted`, `TestM7DeposedDataLeaderCannotProveHighWatermarkOrFetch` | test, model |
| FR-05 | partition-scoped epoch, sequence, durable dedup | `TestM5PR01PR02PR03…` through `TestM5PR07…`, `TestM7OP04LostProduceReplyIsRetriedWithTheSameIdentity`; chaos oracle "acknowledged batch present exactly once" | test, integration, chaos |
| FR-06 | membership, round-robin, generation fence, durable offsets | `TestM6CG01`–`TestM6CG07`, `TestM6GroupModel100Seeds300Events`, `TestM7RF3CoordinatorFailoverKeepsOffsetsAndFencesOldGeneration`, `TestM7DeposedCoordinatorOffsetReadIsRejectedByReadBarrier` | test, model |
| FR-07 | bounded HTTP API, CLI, metadata refresh, typed errors | `TestM5OP01…`, `TestM6OP01…`, `TestM7OP01MalformedPeerRequestsNeverReachBackend`, `TestM7StorageFailuresAndLeaderHintsMapToContract`, `TestM7OP04StaleRoutesAreBoundedAndLeakNoGoroutines`, `TestEveryEndpointReferencesCompilableSchemas` | test, integration |
| FR-08 | metrics, replayable fault tests, three-broker evidence | `TestM7ChaosOP05RotatingCrashesPartitionsAndPauses` (seeded, replayable), `TestM7ThreeBrokerProcessesFailOverCatchUpAndKeepGroupOffsets`, `TestM7OP06GracefulShutdownKeepsDataAndLeaksNoPayload`; `make demo` in CI | integration, chaos, CI |

## Invariants

| ID | Invariant | Executed tests | Gate |
| --- | --- | --- | --- |
| INV-01 | acknowledged DATA survives into every future leader's committed prefix | `TestM3RP06…`, `TestM4RandomizedISRAndGateInvariants`; chaos oracle (acknowledged batches present after leader SIGKILLs, partitions, pauses) | model, chaos |
| INV-02 | committed offsets contiguous, ordered, never rewritten | `TestM2ST09…`, `TestM3RP04…`; chaos oracle (identical committed replicas, acknowledged order kept) | test, chaos |
| INV-03 | consumers never see uncommitted records; NOOP/FENCE take no offset | `TestM4RP10HighWatermarkUsesAppliedDATAOffsets`, `TestM4RF1PersistentHWRecoveryAndCommittedFetch`, `TestM7DeposedDataLeaderCannotProveHighWatermarkOrFetch` | test, integration |
| INV-04 | at most one leader per term; an old leader cannot win a write quorum | `TestM3RP01…`, `TestM3RP06IsolatedOldLeaderCannotCommitOrRead`, `TestM7DeposedDataLeaderCannotProveHighWatermarkOrFetch` | test |
| INV-05 | vote durable before the reply; one vote per term | `TestM3RP01DurableVoteFencesSameTermCandidates`, `TestM3RP02VoteCrashBoundary`, `TestM1HardStatePersistsAndFencesSameTermVote` | test |
| INV-06 | ISR shrink never changes the Raft majority | `TestM4RP09CapturedISRDoesNotShrinkAndRetryDoesNotAppend`, `TestM4RandomizedISRAndGateInvariants` | test, model |
| INV-07 | producer state rebuilt from the same committed log | `TestM5INV07ReplayRejectsDigestThatDoesNotBindRecords`, `TestM5PR03LeaderFailoverReplaysCommittedDedup`, `TestM5PR06…` | test |
| INV-08 | exactly one owner per partition per stable generation; groups independent | `TestM6CG01…`, `TestM6CG02…`, `TestM6GroupModel100Seeds300Events`; chaos oracle (assignments disjoint per generation, two groups) | model, chaos |
| INV-09 | stale or non-owner commits rejected; offsets survive coordinator failover | `TestM6CG04…`, `TestM6CG06…`, `TestM7DeposedCoordinatorOffsetReadIsRejectedByReadBarrier`, `TestM7ThreeBrokerProcessesFailOverCatchUpAndKeepGroupOffsets`; chaos oracle (committed offsets never go back) | test, integration, chaos |
| INV-10 | tail repair stops at the commit boundary; checksum errors fail closed | `TestM1ST04…`, `TestM1ST05…`, `TestM2SealedSegmentIncompleteTailFailsClosed`, `TestM7OP03DiskFullAndSyncFailureFailClosedWithoutFalseAck` | test |
| INV-11 | every queue, frame, batch, long poll, and session is bounded | `TestM4OP03…`, `TestM7OP03FloodSlowClientsAndFetchStormStayBounded`, `TestM7LeaderSentTableStaysBoundedWhilePeersLoseMessages`, `TestM7CallNotAcceptedBeforeDeadlineIsBusy` | test, integration |
| INV-12 | one process per data dir; mismatched cluster/node/config refused | `TestM1OP02FormattingLockAndIdentity`, `TestM7OP02MisconfiguredOrDuplicateBrokersFailWithoutTouchingData` | test, integration |

## Operations acceptance (OP-01 – OP-06)

| ID | Executed tests |
| --- | --- |
| OP-01 | `TestM5OP01…`, `TestM6OP01MalformedFetchQueriesNeverReachBackend`, `TestM6OP01MalformedGroupRequestsNeverReachBackend`, `TestM7OP01MalformedPeerRequestsNeverReachBackend` |
| OP-02 | `TestM1OP02FormattingLockAndIdentity`, `TestM7OP02MisconfiguredOrDuplicateBrokersFailWithoutTouchingData` |
| OP-03 | `TestM4OP03…`, `TestM7OP03FloodSlowClientsAndFetchStormStayBounded`, `TestM7OP03DiskFullAndSyncFailureFailClosedWithoutFalseAck` |
| OP-04 | `TestM5OP04…`, `TestM7OP04LostProduceReplyIsRetriedWithTheSameIdentity`, `TestM7OP04StaleRoutesAreBoundedAndLeakNoGoroutines` |
| OP-05 | `TestM7ChaosOP05RotatingCrashesPartitionsAndPauses` (`make test-chaos`) |
| OP-06 | `TestM7OP06GracefulShutdownKeepsDataAndLeaksNoPayload`, `TestM7ReadyOnlyWhileListenersServe` |
