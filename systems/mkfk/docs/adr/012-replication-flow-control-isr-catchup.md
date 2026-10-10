# ADR-012 — Replication flow control, ISR catch-up timing, and recovery liveness

- Status: accepted
- Date: 2026-10-07
- Applies to: M7 and later; refines M3 AppendEntries sending and the M4 ISR rule (RP-08, RP-11). No persistent format changes.

## Context

The M7 OP-03 flood (400 concurrent producers on one RF3 partition over the HTTP peer transport) acknowledged 1 of 400 batches before this change. Three causes, each reproduced in a test before the fix:

1. Every proposal sent a fresh AppendEntries carrying every entry from the peer's `nextIndex`. The bounded peer link filled with overlapping copies, and replication fell behind the leader.
2. The leader recorded every AppendEntries in its sent-RPC table until a reply arrived. Lost messages were never pruned within a term, so the table grew without bound while a peer dropped messages.
3. On every Ready, the ISR controller raised each in-sync follower's catch-up target to the leader's current last index before reading the acknowledgements. Under a steady write stream a follower that is one round trip behind never matches the moving target, so healthy followers were evicted after the 2 s lag window and admission failed with `NOT_ENOUGH_REPLICAS`.

## Decision

- **Coalescing link.** A queued AppendEntries with no read context is replaced by a newer one for the same Raft group. The newer message starts at the current `nextIndex` and carries every unacknowledged entry the older one did. Votes and read-barrier appends keep their place (`internal/partition/link.go`).
- **Proposal pipelining window.** A proposal adds an AppendEntries for a peer only while fewer than `MaxPipelinedAppends` (8) appends have gone unanswered since that peer's last reply. Heartbeats, elections, and read barriers always send, and any reply reopens the window. Commit rules are unchanged; a saturated peer receives the entries with its next reply or heartbeat.
- **Bounded sent table.** At most `MaxInflightAppends` (64) unanswered AppendEntries per peer are remembered. A reply to a forgotten RPC is ignored, which is already the rule for unknown or stale RPC IDs, so it can never advance a match index it did not prove.
- **ISR catch-up as of append time.** The controller records when the leader's log first reached each index. An in-sync follower that acknowledges through `matched` was caught up as of the moment the leader appended `matched+1`, and `LastCaughtUpAt` becomes the later of its old value and that moment. Reaching the catch-up target still refreshes it to now, and rejoining the ISR still requires reaching the current-term target (RP-11). A follower stuck below a moving leader keeps an old catch-up time and is evicted after the lag window (RP-08); one that trails a busy leader by a round trip stays. Marks are bounded (4096). Past that bound, a follower lagging further gets no refresh.

### Found by the M7 chaos schedule

- **Election timer on rejected votes.** A node moving to a higher term because of a RequestVote no longer resets its election timer unless it grants the vote (Raft §5.2: reset on AppendEntries from the current leader or on granting a vote). Before, a node with a stale log and a short timeout campaigned again and again after a partition healed, kept resetting every up-to-date node's timer, and no leader was ever elected for that partition.
- **Linear log reads.** Replaying the committed prefix on restart read a 4 MiB window for every entry and kept only the first, so restart time grew with the square of the log. After a long chaos run a restarted broker took more than 20 s to become ready. Prefix replay now reads in batches, and single-entry lookups (follower duplicate checks, operation lookups) start with a 4 KiB budget and re-read with the exact size only for a larger frame.

### Found by the M7 benchmark

- **Bounded operation history.** The replication controller kept every operation and gate it ever created and refused new writes with `RESOURCE_EXHAUSTED` once 4096 operations or 8192 gates existed, so a long-lived partition stopped accepting writes until its broker restarted. History is a cache: at its cap the oldest completed entries are evicted, and only entries still pending count against it. An evicted operation is rebuilt from the WAL by `AwaitExistingData`. The producer now retries a timed-out pending batch through that path, so eviction never breaks a retry.

## Consequences

- The OP-03 flood now acknowledges 400 of 400 batches with a peak of about 25 pending waiters. RP-08, RP-11, and the M3/M4 model suites pass unchanged. New tests cover the bounded sent table with heartbeat recovery and the one-round-trip follower.
- ISR membership never relaxes the captured-A rule (ADR-009). An acknowledgement still needs every member of the captured set to have durably matched the entry, so keeping a healthy follower in the ISR cannot weaken a successful `acks=all`.
- `make test-chaos` (28 seeded faults) passes on the seed that exposed both recovery problems and on four further random seeds. New tests cover the election timer and the read cost.
- Read barriers are not batched: each one sends its own AppendEntries. A fetch storm well above the 256-read cap answers `RESOURCE_EXHAUSTED` or `NOT_READY` within the read deadline instead of queueing without bound.
