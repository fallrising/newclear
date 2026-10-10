# ADR-013 option 1 on real hosts: M7 rerun

[ADR-013](../adr/013-fsync-on-the-partition-actor.md) option 1 was first measured on [one machine with loopback brokers](adr-013-index-rewrite.md). This reruns the [M7 baseline](m7-baseline.md) matrix on the baseline's own three hosts with option 1 merged, and adds a second run across an overlay network as a functional check. Same workload as the baseline: 1 KiB records, four closed-loop idempotent producers per partition, `acks=all`, 10 s warm-up, 60 s × 3 measured runs, read-back and cold restart after each configuration. Three configurations of the overlay run aborted before completing that sequence.

These numbers describe this design on this hardware. They are not a target.

| | Run 1: baseline hosts | Run 2: overlay |
| --- | --- | --- |
| Hosts | the three baseline VMs (4 / 2 / 4 vCPU, 1.9–7.8 GiB), same node roles | three other VMs (2 / 2 / 4 vCPU, 1.8–3.7 GiB) on separate networks |
| Broker-to-broker path | private network, ~0.2 ms RTT | mesh VPN overlay, 29 / 44 / 50 ms RTT between the pairs (the `launcher` string in the JSON says "private network"; that text is fixed in the tool) |
| Commit | `79109d62` (baseline: `12aa275`) | `79109d62` |
| Matrix | all twelve configurations | eight: RF1, and RF3 with min ISR 2 |
| Raw results | [adr-013-real-host-results.json](adr-013-real-host-results.json) | [adr-013-real-host-overlay-results.json](adr-013-real-host-overlay-results.json) |

## Run 1: baseline hosts, before and after (medians of three runs)

"Before" is the published baseline, measured three days earlier on the same hosts, not an interleaved run.

| Config | before records/s | after records/s | after / before | before p50 / p99 ms | after p50 / p99 ms | before fsync mean ms | after fsync mean ms | fsyncs per batch per broker, before → after |
| --- | ---: | ---: | ---: | --- | --- | ---: | ---: | --- |
| rf1-isr1-b1-p1 | 154 | 227 | 1.47 | 25.3 / 32.0 | 17.6 / 23.5 | 1.10 | 0.99 | 5.00 → 3.67 |
| rf1-isr1-b1-p3 | 213 | 292 | 1.37 | 57.3 / 69.0 | 40.4 / 53.9 | 2.25 | 2.10 | 5.00 → 3.67 |
| rf1-isr1-b100-p1 | 6423 | 6323 | 0.98 | 62.1 / 67.7 | 63.1 / 68.8 | 0.80 | 0.81 | 5.01 → 5.01 |
| rf1-isr1-b100-p3 | 12482 | 12478 | 1.00 | 95.4 / 116.8 | 95.4 / 116.5 | 1.01 | 1.05 | 5.01 → 5.01 |
| rf3-isr1-b1-p1 | 142 | 173 | 1.22 | 28.3 / 36.4 | 23.1 / 30.8 | 0.80 | 0.81 | 4.94 → 3.55 |
| rf3-isr1-b1-p3 | 201 | 300 | 1.49 | 59.8 / 83.7 | 39.7 / 61.0 | 2.06 | 1.85 | 4.82 → 3.15 |
| rf3-isr1-b100-p1 | 2518 | 2557 | 1.02 | 159.5 / 216.1 | 156.6 / 208.8 | 0.85 | 0.88 | 4.51 → 4.48 |
| rf3-isr1-b100-p3 | 3762 | 3758 | 1.00 | 318.9 / 442.9 | 322.2 / 440.1 | 1.13 | 1.14 | 4.68 → 4.66 |
| rf3-isr2-b1-p1 | 141 | 171 | 1.21 | 28.5 / 37.1 | 23.4 / 31.0 | 0.82 | 0.80 | 4.93 → 3.56 |
| rf3-isr2-b1-p3 | 204 | 269 | 1.32 | 59.1 / 85.6 | 44.1 / 62.4 | 2.06 | 1.75 | 4.80 → 3.48 |
| rf3-isr2-b100-p1 | 2545 | 2543 | 1.00 | 157.3 / 209.6 | 157.2 / 217.2 | 0.85 | 0.90 | 4.50 → 4.46 |
| rf3-isr2-b100-p3 | 3788 | 3672 | 0.97 | 320.5 / 442.0 | 327.4 / 445.9 | 1.07 | 1.16 | 4.69 → 4.73 |

Fsync mean is the leader's. Fsyncs per batch is each broker's sync count during the measured window divided by acknowledged produce requests, averaged over brokers. No run on either side had produce errors.

- **Single-record batches: 1.21–1.49× throughput.** Syncs per batch fall from about five to 3.67 on RF1, the same figure as on loopback, and to 3.15–3.56 on RF3. The leader's mean fsync latency moved by between −15 % and +1 % in these rows, which is too little to account for the gain; most of it comes from doing fewer syncs. For rf1-isr1-b1-p1 the serial bound `1 / (3.67 × fsync mean)` is 275 records/s and 227 were observed (0.82 of the bound; the baseline reached 0.85 of its bound of 182).
- **Batches of 100: unchanged**, within 0.97–1.02. Every 100 KiB batch still crosses the anchor stride and rewrites the index.
- **No stalls.** The three broker logs (not kept in this repository) contain no `slow fsync` and no `actor stall` line (both thresholds are 500 ms). The largest single fsync on any broker was 153 ms. Every broker fsynced in every measured window, and no partition changed leader during a measured window; the only elections are at cluster start and around the cold restarts.
- The follower that went silent in [environment B](m7-environment-b.md) did not recur. These disks do not stall the way B's do, so this run says nothing about that trigger.

## Run 2: overlay, functional check only

The path between these hosts, not the broker, bounds every number here: read-back ran at about 390 records/s (0.4 MiB/s) in every RF1 configuration against 11,000–36,000 on the private network, and the leader used 5 % of one core in the b100 runs. Do not read these as broker performance.

| Config | repeat | records/s | p50 / p99 ms | fsyncs per batch per broker | fsyncs per broker | produce errors |
| --- | ---: | ---: | --- | ---: | --- | --- |
| rf1-isr1-b1-p1 | 1–3 | 122 / 121 / 120 | 32 / 48 | 3.67 | 26414–26801 | none |
| rf1-isr1-b1-p3 | 1–3 | 186 / 176 / 186 | 37 / 393 | 3.67 | 38736–40973 | none |
| rf1-isr1-b100-p1 | 1–3 | 237 / 240 / 237 | 1576 / 3460 | 5.00 | 710–720 | none |
| rf1-isr1-b100-p3 | 1–3 | 228 / 237 / 220 | 4388 / 8885 | 5.00 | 660–705 | `TRANSPORT` 9 / 2 / 8 |
| rf3-isr2-b1-p1 | 1 | 33 | 101 / 500 | 2.42 | 5395 / 3920 / 4996 | `OUT_OF_ORDER_SEQUENCE` 154, `REQUEST_TIMEOUT` 4 |
| rf3-isr2-b1-p1 | 2 | 34 | 93 / 486 | 2.43 | 5905 / 4054 / 5035 | `OUT_OF_ORDER_SEQUENCE` 124 |
| rf3-isr2-b1-p1 | 3 | 20 | 162 / 557 | 2.59 | 2845 / 3682 / 2908 | none |
| rf3-isr2-b1-p3 | 1 | aborted | | | | a producer could not resolve a batch after `OUT_OF_ORDER_SEQUENCE` |
| rf3-isr2-b100-p1 | 1 | 92 | 2309 / 6825 | 6.09 | 286 / 364 / 355 | `REQUEST_TIMEOUT` 22, `NOT_LEADER` 8, `OUT_OF_ORDER_SEQUENCE` 5, `NOT_READY` 2 |
| rf3-isr2-b100-p1 | 2 | aborted | | | | a producer could not resolve a batch after `OUT_OF_ORDER_SEQUENCE` |
| rf3-isr2-b100-p3 | 1 | aborted | | | | a producer could not resolve a batch after `NOT_LEADER` |

RF1 rows give the three repeats' records/s and the median latencies. In the RF3 rows the per-batch figure divides by acknowledged requests while brokers also sync for elections and unacknowledged appends, so it is not comparable with run 1.

- **RF1 works over the overlay**, with the same 3.67 syncs per single-record batch as run 1. The three-partition b100 repeats each had a few `TRANSPORT` errors.
- **RF3 does not hold a leader over this path.** Leadership of the one data partition reached term 17 within the three repeats of rf3-isr2-b1-p1, and term 31, 33 and 54 in the three configurations that aborted, with all three brokers taking turns as leader. A leader sends a heartbeat every 100 ms and a follower starts an election after 600–1200 ms without one; a follower that times out raises the term and deposes a working leader, because there is no pre-vote.
- **Nothing points at the disks.** The broker logs contain no `slow fsync` and no `actor stall` line, and the largest single fsync was 60 ms. The elections are therefore attributed to heartbeats arriving late over a path that carries about 0.4 MiB/s. Both the path limit and that attribution are inferences: the run recorded no per-link delay, loss or bandwidth.
- **No silent follower.** Every broker fsynced in each recorded RF3 window (2845–5905 times per single-record window, 286–364 in the one b100 window) and logged throughout. The falling throughput in rf3-isr2-b1-p1 (33, 34, 20 records/s) looks like environment B's degradation from the outside but has a different signature: constant elections, no stall.

## Limitations

- Run 1's before and after are separate runs three days apart on shared cloud hosts; differences of a few percent in the b100 rows are within run-to-run variation.
- Fsync maximum is per process lifetime, so the three repeats of one configuration share it.
- The benchmark host's clock and the broker hosts' clocks are not synchronised; placing log lines inside a measured window is accurate to about two seconds.
- Run 2 is a single run on a path with no bandwidth or latency guarantee, and three of its four RF3 configurations aborted. It shows that this election timing does not tolerate that path; it does not measure what timing would.
