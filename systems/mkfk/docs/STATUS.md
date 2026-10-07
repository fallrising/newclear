# mkfk implementation status

Last updated: 2026-10-08

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 contracts / testkit | VERIFIED | `docs/evidence/m0-c86d458-contract.json`; format, vet, unit/schema, and race gates exit 0 |
| M1 durable partition log | VERIFIED | `docs/evidence/m1-8235294-storage.json`; ST-01–ST-05 and OP-02 pass, including SIGKILL and injected I/O failures |
| M2 segments / sparse index | VERIFIED | `docs/evidence/m2-3dbd61a-segments.json`; ST-06–ST-09 and M1 regression pass, including index repair and stable read-view tests |
| M3 per-partition Raft | VERIFIED | `docs/evidence/m3-af2d7d1-raft.json`; RP-01–RP-07, ReadIndex, RF1/RF3, model, and three-process restart tests pass |
| M4 ISR / HW / ack gate | VERIFIED | `docs/evidence/m4-dc75958-isr-hw.json`; RP-08–RP-11, RP-06 regression, bounded waiters, 100×1,000-event invariants, and RF1 recovery pass |
| M5 idempotent producer | VERIFIED | `docs/evidence/m5-002e6cd-producer.json`; PR-01–PR-07 and relevant OP-01/OP-04 pass across RF1 restart, RF3 failover, HTTP, SDK, and CLI ledger tests |
| M6 consumer groups | VERIFIED | `docs/evidence/m6-8b99818-groups.json`; CG-01–CG-07 pass on in-memory RF1/RF3 Raft and on a real RF1 WAL behind the HTTP handlers and SDK consumer, plus a 100-seed group model and the rebalance/crash/coordinator-restart demo |
| M7 integrated failure evidence | VERIFIED | `docs/evidence/m7-12aa275-integrated.json`; OP-01–OP-06 executed, including `make test-chaos` (28 seeded faults, five seeds) and a three-process failover test; every FR/INV maps to an executed test (`docs/traceability.md`); the extended model profile (1,000 seeds × 10,000 events) passes; the Compose demo runs in CI; the benchmark baseline on three hosts is in `docs/benchmarks/m7-baseline.md`. Core complete, not production-hardened |

`VERIFIED` means the milestone's declared acceptance commands completed successfully with recorded evidence. Compilable contracts do not imply that a broker can start or that later safety properties are implemented.
