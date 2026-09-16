# mkfk implementation status

Last updated: 2026-09-16

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 contracts / testkit | VERIFIED | `docs/evidence/m0-c86d458-contract.json`; format, vet, unit/schema, and race gates exit 0 |
| M1 durable partition log | VERIFIED | `docs/evidence/m1-8235294-storage.json`; ST-01–ST-05 and OP-02 pass, including SIGKILL and injected I/O failures |
| M2 segments / sparse index | NOT_STARTED | M1 uses one WAL; rotation, sparse index, bounded scan, and handle lifecycle do not exist |
| M3 per-partition Raft | NOT_STARTED | No election or replication implementation exists |
| M4 ISR / HW / ack gate | NOT_STARTED | No runtime implementation exists |
| M5 idempotent producer | NOT_STARTED | Fingerprint and request contracts only |
| M6 consumer groups | NOT_STARTED | Request/schema contracts only |
| M7 integrated failure evidence | NOT_STARTED | No broker or cluster harness exists |

`VERIFIED` means the milestone's declared acceptance commands completed successfully with recorded evidence. Compilable contracts do not imply that a broker can start or that later safety properties are implemented.
