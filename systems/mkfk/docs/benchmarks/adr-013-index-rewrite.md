# ADR-013 option 1: index rewrite only on anchor change, before and after

[ADR-013](../adr/013-fsync-on-the-partition-actor.md) option 1 stops rewriting a segment's sparse index after appends that add no anchor. This measures the change on one machine with the same workload as the [M7 baseline](m7-baseline.md): 1 KiB records, four closed-loop idempotent producers per partition, `acks=all`, 10 s warm-up, 60 s × 3 measured runs, read-back and cold restart after each configuration. Raw results: [adr-013-index-rewrite-results.json](adr-013-index-rewrite-results.json).

- Brokers: local loopback child processes in one Linux VM on a laptop (10 vCPU, 7.8 GiB, btrfs on SSD), go1.27.1. All three RF3 replicas share one disk, so absolute numbers are lower than the multi-host environments and are not comparable with them.
- Before: `e3d0c3f`. After: the same commit plus this change.
- Before and after alternated per configuration (before, after, next configuration) so that drift in the VM's disk affects both sides alike. Single runs on this VM vary by up to ±25 %.

## Results (medians of three runs)

| Config | before records/s | after records/s | after / before | before p50 / p99 ms | after p50 / p99 ms | fsyncs per batch per broker, before → after |
| --- | ---: | ---: | ---: | --- | --- | --- |
| rf1-isr1-b1-p1 | 111 | 160 | 1.45 | 22.9 / 304.0 | 15.7 / 214.2 | 5.00 → 3.67 |
| rf3-isr2-b1-p1 | 62 | 85 | 1.38 | 40.1 / 595.2 | 27.4 / 458.5 | 4.80 → 3.31 |
| rf1-isr1-b100-p1 | 8723 | 8517 | 0.98 | 45.1 / 71.5 | 45.4 / 80.7 | 5.01 → 5.01 |
| rf3-isr2-b100-p1 | 3768 | 3760 | 1.00 | 101.8 / 178.2 | 104.7 / 191.0 | 4.15 → 4.16 |

Fsyncs per batch is the broker's sync count during the measured window divided by acknowledged produce requests, averaged over brokers. No run had produce errors.

## Reading

- **Single-record batches: 1.4× throughput, a third lower latency.** Syncs per batch fall from five to about 3.5 rather than three, because a 1 KiB record frame is about a quarter of the 4 KiB anchor stride, so roughly every fourth batch still adds an anchor and rewrites the index. Smaller records would get closer to three.
- **Batches of 100: unchanged.** A 100 KiB batch always crosses the stride, so every batch still adds an anchor and rewrites the index. These configurations are CPU-bound anyway ([architecture](../architecture.md)).
- Cold restart time still follows WAL size (single-record runs: 3.0 s before, 3.5 s after for 43 vs 61 MiB per replica, since after wrote more; batches of 100: 64 s and 37 s on both sides). A restart still validates every index against the anchors rebuilt from the WAL.
