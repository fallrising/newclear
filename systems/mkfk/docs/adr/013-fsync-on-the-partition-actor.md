# ADR-013 — Fsync on the partition actor: observability now, structural options later

- Status: accepted for observability and option 1 (both implemented); options 2–5 are not decided
- Date: 2026-10-09
- Applies to: after M7. No protocol, persistent-format, or invariant changes.

## Context

A partition actor runs every Raft step, tick, proposal, and read barrier on one goroutine, and it waits for its own syncs (architecture: "single owner per partition"). Each acknowledged batch costs five syncs per replica:

| Sync | Count | Where |
| --- | ---: | --- |
| WAL append | 1 | `storage.(*PartitionLog).appendEntriesLocked` |
| Sparse index rewrite (temporary file, directory) | 2 | `persistSegmentIndex`, after every append |
| Hard state on commit advance (temporary file, directory) | 2 | `persistHardState` via `raft.(*Node).advanceCommit` |

The counts were attributed by tracing every sync's call chain during a single-broker run (2,338 batches, 11,690 syncs, all other call sites only at start-up, elections, and shutdown).

On an environment with ~3 ms fsync and occasional 0.5–1.6 s stalls ([m7-environment-b](../benchmarks/m7-environment-b.md)), throughput followed 1 / (5 × fsync latency), RF3 runs saw spurious elections and `NOT_LEADER` errors, and once a follower went silent for a whole 60 s window. Until now nothing recorded when the actor was held, so the silent follower could not be explained.

## Decision (implemented)

Make holds visible without changing behavior:

- `adapters.SlowSyncThreshold` (500 ms). Slow syncs are counted (`mkfk_fsync_slow_total`) and the broker process logs `slow fsync` with the duration.
- `partition.StallThreshold` (500 ms). Every call, step, or tick that holds an actor that long is counted per partition (`mkfk_actor_stall_total`, `mkfk_actor_stall_max_seconds`) and logged as `actor stall` with its kind and duration. The log line is written as soon as the hold ends; the metrics of a partition whose actor is still held appear once it answers again.

500 ms is below the 600 ms minimum election timeout: a logged stall is one that could already cost leadership.

## Decision (implemented): option 1, rewrite the index only when anchors change

An append rewrites and syncs a segment's sparse index only when the append added an anchor, or when the previous index write failed and the segment's index is marked invalid. Appends never change existing anchors, so an unchanged anchor count means the file on disk is current. Single-record batches therefore cost three syncs per replica (WAL 1, hard state 2) except about once per 4 KiB of WAL, when a new anchor costs two more. Segment creation, suffix truncation, and recovery still write the index every time.

Recovery is unchanged: a crash after the WAL sync but before an index write leaves an index with fewer anchors than the WAL implies; start-up compares the decoded index with the anchors rebuilt from the WAL, finds the mismatch, and rewrites it (`TestStaleIndexIsRebuiltOnRestart`). No index format, invariant, or persistence-order change. Measured on one machine: single-record batches went from 5.0 to about 3.5 syncs per batch and 1.4× throughput; batches of 100 were unchanged ([before/after](../benchmarks/adr-013-index-rewrite.md)).

## Options not yet decided

1. **Skip unchanged index rewrites** (implemented, see above). The sparse index gains an anchor only every few KiB, yet it is rewritten and synced after every append. The index is derived: a failed write marks it unhealthy and recovery rebuilds it from the WAL (01-storage). Rewriting only when anchors change would cut single-record batches from five syncs to about three. Smallest change; needs a recovery test showing a stale index file is detected and rebuilt.
2. **Lazy commit-index persistence.** Raft does not require the commit index to be durable; recovery can relearn it from the leader. mkfk persists it as the durable commit floor that recovery uses to decide which entries apply before contact with a leader (01-storage). Dropping it from the hot path would remove two more syncs but changes recovery semantics, so it needs its own ADR and safety tests (listed under X2 in the architecture note).
3. **Group commit.** Several proposals share one WAL sync. Largest throughput gain; X2 track.
4. **Separate ticks from storage.** Run election and heartbeat timing on a goroutine that never waits for a sync, so one slow sync cannot trigger an election. This weakens the "one deterministic owner" model the Raft core relies on, and a leader that cannot persist should not keep claiming leadership, so a stall that delays heartbeats is arguably correct behavior. Not recommended without evidence that stalls on healthy disks are common.
5. **Longer election timeout.** Trades failover time for tolerance of slow disks. A deployment knob, not a design change.

## Recommendation

Keep the observability and option 1. Leave options 2–4 to the X2 track. Use the new stall logs to catch the silent-follower case before changing any timing.
