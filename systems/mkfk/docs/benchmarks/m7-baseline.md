# mkfk M7 benchmark baseline

The 04-validation §5 matrix ran on three small cloud VMs, one broker per VM, over a private network, with ext4 on cloud block storage. Each configuration got a freshly formatted cluster, then three runs of 10 s warm-up and 60 s measurement. Every run was followed by a read-back of the whole log from offset 0. After the third run all brokers were stopped and the time until every partition again had a ready leader was measured (cold restart). Records are 1 KiB; each partition has four closed-loop idempotent producers with `acks=all`; RF1 runs a single broker on node-1. Raw per-run numbers, including errors, CPU, RSS, fsync and WAL bytes per broker, are in [m7-baseline-results.json](m7-baseline-results.json).

These numbers describe this design on this hardware. They are not a target, and they are not comparable with other systems. See [architecture](../architecture.md) for what bounds them.

Reproduce: `make bench` (local loopback brokers), or `make bench BENCH_ARGS="--ssh-hosts a,b,c --ssh-ips x,y,z --ssh-command '…'"` for three hosts; `go run ./cmd/mkfkbench --summarize <results.json>` re-renders this table.

Commit `12aa275`, go1.27.1, three hosts on a private network, one broker each; the client runs on the node-3 host. Warm-up 10s, measured 1m0s, 3 repeats; medians shown.

- node-1: 4 vCPU, 7.8 GiB RAM, Intel(R) Xeon(R) Platinum 8260 CPU @ 2.40GHz, kernel 6.1.0-18-amd64, ext4 on disk reported as rotational
- node-2: 2 vCPU, 1.9 GiB RAM, Intel(R) Xeon(R) Platinum 8336C CPU @ 2.30GHz, kernel 6.1.0-18-amd64, ext4 on disk reported as rotational
- node-3: 4 vCPU, 3.8 GiB RAM, Intel(R) Xeon(R) Platinum 8260 CPU @ 2.40GHz, kernel 6.1.0-40-amd64, ext4 on disk reported as rotational

| Config | records/s | MiB/s | produce p50/p95/p99 ms | fetch records/s | fetch p99 ms | leader CPU % | max RSS MiB | fsync mean ms | seek comparisons/fetch | restart s |
| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| rf1-isr1-b1-p1 | 154 | 0.15 | 25.3 / 30.2 / 32.0 | 11745 | 88.1 | 27 | 28 | 1.10 | 14.0 | 5.21 |
| rf1-isr1-b1-p3 | 213 | 0.21 | 57.3 / 61.9 / 69.0 | 22672 | 147.2 | 38 | 39 | 2.25 | 12.8 | 6.88 |
| rf1-isr1-b100-p1 | 6423 | 6.27 | 62.1 / 65.8 / 67.7 | 17563 | 63.0 | 140 | 28 | 0.80 | 12.6 | 86.00 |
| rf1-isr1-b100-p3 | 12482 | 12.19 | 95.4 / 110.0 / 116.8 | 35803 | 102.4 | 296 | 51 | 1.01 | 12.1 | 167.10 |
| rf3-isr1-b1-p1 | 142 | 0.14 | 28.3 / 33.5 / 36.4 | 11353 | 89.7 | 79 | 26 | 0.80 | 13.8 | 4.57 |
| rf3-isr1-b1-p3 | 201 | 0.20 | 59.8 / 75.7 / 83.7 | 21626 | 148.5 | 112 | 45 | 2.06 | 12.7 | 6.55 |
| rf3-isr1-b100-p1 | 2518 | 2.46 | 159.5 / 198.5 / 216.1 | 16385 | 67.3 | 161 | 30 | 0.86 | 11.5 | 35.21 |
| rf3-isr1-b100-p3 | 3762 | 3.67 | 318.9 / 408.3 / 442.9 | 33893 | 100.6 | 329 | 56 | 1.40 | 10.8 | 52.90 |
| rf3-isr2-b1-p1 | 141 | 0.14 | 28.5 / 34.0 / 37.1 | 11377 | 91.0 | 77 | 31 | 0.82 | 13.8 | 4.51 |
| rf3-isr2-b1-p3 | 204 | 0.20 | 59.1 / 74.9 / 85.6 | 21444 | 154.3 | 109 | 47 | 2.06 | 12.6 | 7.42 |
| rf3-isr2-b100-p1 | 2545 | 2.49 | 157.3 / 196.4 / 209.6 | 16472 | 66.2 | 161 | 30 | 0.85 | 11.5 | 35.88 |
| rf3-isr2-b100-p3 | 3788 | 3.70 | 320.5 / 401.4 / 442.0 | 33937 | 101.8 | 330 | 58 | 1.35 | 10.9 | 54.03 |

Limitations:
- one closed-loop request per producer: throughput is latency-bound, not a saturation ceiling
- every acknowledged batch waits for acks=all and per-append fsync; no group commit or pipelined client
- fsync max is the process lifetime maximum, not per window
- three configurations (rf3-isr1-b100-p3, rf3-isr2-b1-p1, rf3-isr2-b1-p3) were rerun on the same broker commit after transient ssh connection resets to the test hosts aborted their first attempt
