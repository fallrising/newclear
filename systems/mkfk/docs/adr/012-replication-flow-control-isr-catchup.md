# ADR-012 — Replication flow control and ISR catch-up timing under load

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

## Consequences

- The OP-03 flood now acknowledges 400 of 400 batches with a peak of about 25 pending waiters. RP-08, RP-11, and the M3/M4 model suites pass unchanged. New tests cover the bounded sent table with heartbeat recovery and the one-round-trip follower.
- ISR membership never relaxes the captured-A rule (ADR-009). An acknowledgement still needs every member of the captured set to have durably matched the entry, so keeping a healthy follower in the ISR cannot weaken a successful `acks=all`.
- Read barriers are not batched: each one sends its own AppendEntries. A fetch storm well above the 256-read cap answers `RESOURCE_EXHAUSTED` or `NOT_READY` within the read deadline instead of queueing without bound.
