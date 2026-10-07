# mkfk architecture and failure results

mkfk is a teaching implementation of a replicated, partitioned log: every partition is its own Raft group, an ISR-based acknowledgement gate decides when a write is acknowledged, an idempotent producer makes retries safe, and consumer groups commit offsets through a replicated coordinator. It is core-complete and verified (M0–M7), not production-hardened. This note explains how the pieces fit and what the M7 failure and load testing found.

## One broker

```text
client listener ──► transport handlers ──► partition actor (one goroutine per replica)
                                               │  raft.Node      (consensus core, deterministic)
                                               │  replication    (ISR, HW, acks=all gate)
                                               │  producer / group state machines
                                               ▼
                                          storage.PartitionLog (WAL segments, sparse index, hard state)
peer listener  ◄──► partition.Outbox (one bounded link per peer) ◄──► other brokers
admin listener ──► /healthz /readyz /metrics
```

- **Single owner per partition.** Each local replica is a `partition.Actor`: one goroutine runs every Step, Tick, proposal, and read barrier, and results return to waiting callers through channels. Nothing holds a lock across network waits or fsync, and the Raft core stays a deterministic function of its inputs.
- **Durability before messages.** A Raft Ready leaves the core only after its WAL and hard-state writes have been synced, so no RPC ever claims progress that is not on disk.
- **Peer transport.** Each Raft request is one HTTP/JSON POST, and the reply comes back in the response body (ADR-008, ADR-011). Links coalesce superseded AppendEntries, and proposals stop pipelining at eight unanswered appends (ADR-012).
- **Reads.** Fetch, the coordinator's offset reads, and the high-watermark proof a commit needs all run only after a current-term ReadIndex barrier. A deposed leader cannot answer from stale state.
- **Unknown is not "no".** A write whose acknowledgement deadline passes, or that hit a storage failure, answers `outcome: unknown`. The client resends the identical batch, and producer dedup returns the original offsets.

## Failure results (M7)

| Fault (seeded, `make test-chaos`) | Observed result |
| --- | --- |
| SIGKILL of a partition leader | a follower leads within about one election timeout; acknowledged records survive; the restarted broker catches up |
| SIGKILL of the group coordinator | members rejoin under a new generation; committed offsets are kept and committed records are not reprocessed |
| SIGSTOP of a broker for 2 s | it rejoins; no acknowledged batch is lost or duplicated |
| isolation of a broker's peer links | the majority keeps serving; the isolated broker cannot prove a high watermark or serve a read |
| one-way link cut (reply lost) | the request applies, the reply is lost, and the retry is deduplicated |
| 200 ms peer delay | slower acknowledgements; no safety violation |
| disk full or sync failure | the partition fails closed (`STORAGE_ERROR`, `readyz` false); the write's outcome is unknown, and the sync-failure case shows the record can survive recovery |

After each schedule the oracle checks that acknowledged batches are present once and in order, that committed replicas are identical, that both consumer groups processed every record, that assignments never overlap within a generation, and that committed offsets never go back. The full 28-fault profile passed on five seeds.

Testing found five defects in earlier milestones. Each is fixed with a regression test and a mutation check:

1. On RF3, a new coordinator never started serving: the failover rebalance's messages were never sent (M6).
2. The leader's sent-RPC table grew without bound under message loss (M3).
3. Followers that trailed a busy leader by one round trip were evicted from the ISR, so under load writes failed with `NOT_ENOUGH_REPLICAS` (M4).
4. A rejected vote from a stale candidate reset every timer, so a partition could stay leaderless forever after a partition healed (M3).
5. Restart replay was quadratic in log length (M3).

## Performance baseline

See [benchmarks/m7-baseline.md](benchmarks/m7-baseline.md) for the configuration matrix, the machines, and the raw results. The numbers describe this design on that hardware, not a target:

- Every proposal syncs the WAL, and every commit advance rewrites the hard state with two more syncs. All of it runs on the partition's single actor and there is no group commit, so single-record throughput per partition is bounded by fsync latency and is low.
- Batches of 100 records amortize that cost, and throughput then becomes CPU-bound on JSON and base64 encoding of the WAL payload.
- Read-back throughput is far higher than write throughput because reads use the sparse index and need no new syncs.

Changing these trade-offs (group commit, a binary payload, lazy commit-index persistence) belongs to the X3 track.

## Not claimed

No TLS or authentication (X4); no transactions (X1); no retention, snapshots, or deletion (X2); no Kafka wire compatibility or performance comparison (X3); fixed membership only.
