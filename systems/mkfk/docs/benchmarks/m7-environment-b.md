# mkfk M7 benchmark: second environment

The [M7 baseline](m7-baseline.md) (environment A) was repeated on a second set of three VMs (environment B) to see which limits move with the hardware. Same workload: 1 KiB records, four closed-loop idempotent producers per partition, `acks=all`, 10 s warm-up, 60 s × 3 measured runs, read-back and cold restart after each configuration. B ran eight of the twelve configurations (RF1, and RF3 with min ISR 2). Raw results: [m7-environment-b-results.json](m7-environment-b-results.json); diagnostic reruns: [m7-environment-b-reruns.json](m7-environment-b-reruns.json).

These numbers describe this design on this hardware. They are not a target.

## Environments

| | A (baseline) | B |
| --- | --- | --- |
| Hosts | 4 / 2 / 4 vCPU Intel Xeon, 1.9–7.8 GiB | 3 × 6 vCPU AMD EPYC, 25 GiB |
| Single 4 KiB `O_DSYNC` write (`dd`) | ~0.7 ms | ~3 ms |
| Broker-to-broker RTT | ~0.2 ms, private network | ~0.4 ms, public addresses restricted to the three peers by host firewall (the `launcher` string in the JSON says "private network"; that text is fixed in the tool) |
| Commit | `12aa275` | `216643e` (broker code identical; only `cmd/mkfkbench` ssh retry differs) |

## Results (medians of three runs)

| Config | A records/s | B records/s | B/A | A p50 / p99 ms | B p50 / p99 ms | A fsync mean ms | B fsync mean ms | fsyncs per batch, all brokers |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | ---: |
| rf1-isr1-b1-p1 | 154 | 52 | 0.34 | 25 / 32 | 68 / 156 | 1.10 | 3.46 | 5.0 |
| rf1-isr1-b1-p3 | 213 | 96 | 0.45 | 57 / 69 | 117 / 234 | 2.25 | 5.81 | 5.0 |
| rf1-isr1-b100-p1 | 6423 | 3060 | 0.48 | 62 / 68 | 128 / 183 | 0.80 | 3.40 | 5.0 |
| rf1-isr1-b100-p3 | 12482 | 6700 | 0.54 | 95 / 117 | 172 / 281 | 1.01 | 5.35 | 5.0 |
| rf3-isr2-b1-p1 | 141 | 26 (2.8–48) | 0.18 | 29 / 37 | 85 / 1047 | 0.82 | 3.75 | 13–15 |
| rf3-isr2-b1-p3 | 204 | 87 | 0.43 | 59 / 86 | 119 / 496 | 2.06 | 6.09 | 13–14 |
| rf3-isr2-b100-p1 | 2545 | 1343 | 0.53 | 157 / 210 | 288 / 440 | 0.85 | 3.95 | 13–14 |
| rf3-isr2-b100-p3 | 3788 | 3470 | 0.92 | 321 / 442 | 336 / 702 | 1.07 | 5.62 | 14 |

## Findings

1. **Single-record throughput is set by fsync latency times five.** Every acknowledged batch costs 5.0 fsyncs on each replica in both environments (13–15 summed over three replicas). One is the WAL append and two are the hard-state rewrite on commit (file and directory); the remaining two per batch were not attributed in this run. For rf1-b1-p1 the serial bound `1 / (5 × fsync mean)` predicts 182 records/s on A and 58 on B; observed are 154 and 52 (0.85 and 0.91 of the bound). The leader disk is busy 85–90 % of the time. A faster CPU does not help; a slower fsync hurts proportionally.
2. **Batched writes are not CPU-bound on either environment.** B has more and faster cores, yet b100 throughput is 0.48–0.54 of A for RF1, and leader CPU is lower on B. B's slower fsync still dominates, and the leader disk-busy fraction rises from 0.26 to 0.52 (rf1-b100-p1).
3. **Fsync stalls on B reach the election timeout.** Single fsyncs on B stalled for 0.5–1.6 s (process-lifetime maximum) on all three brokers, against at most 85 ms on A in its rf3-isr2-b1 runs. The election timeout is 600–1200 ms, and a partition's fsyncs, ticks and Raft steps share one actor goroutine. B's RF3 runs show produce errors in 7 of 12 runs (`NOT_LEADER` up to 131, `REQUEST_TIMEOUT`, `OUT_OF_ORDER_SEQUENCE` up to 48); A had none in these configurations.
4. **One unreproduced degradation.** In the matrix run, rf3-isr2-b1-p1 fell from 48 to 26 to 3 records/s over its three repeats: a follower started elections twice during measurement, and in the third repeat a second follower performed no fsyncs for the whole 60 s window and logged nothing, while producers got `NOT_ENOUGH_REPLICAS`. The first diagnostic rerun (that configuration alone, per-second admin metrics) stayed healthy: 54 / 48 / 46 records/s, no term change, `outbox_dropped_total` and `inbox_dropped_total` zero. The second rerun replayed the original order (rf1-b100-p3 then rf3-isr2-b1-p1) and again had 1.0–1.6 s fsync stalls, but also stayed healthy: 52 / 52 / 47 records/s. The trigger for a follower going silent is not identified; catching it needs slow-fsync and actor-stall logging.

## Limitations

- Fsync maximum is per process lifetime, so the three repeats of one configuration share it.
- B's peer traffic uses public addresses; RTT is small but the path is not an isolated network.
- Only one matrix run plus two targeted reruns; the degradation in finding 4 occurred once.
