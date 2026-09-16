# mkfk implementation status

Last updated: 2026-09-16

| Milestone | State | Evidence |
| --- | --- | --- |
| M0 contracts / testkit | VERIFIED | `docs/evidence/m0-c86d458-contract.json`; format, vet, unit/schema, and race gates exit 0 |
| M1 durable partition log | VERIFIED | `docs/evidence/m1-8235294-storage.json`; ST-01–ST-05 and OP-02 pass, including SIGKILL and injected I/O failures |
| M2 segments / sparse index | VERIFIED | `docs/evidence/m2-3dbd61a-segments.json`; ST-06–ST-09 and M1 regression pass, including index repair and stable read-view tests |
| M3 per-partition Raft | VERIFIED | `docs/evidence/m3-af2d7d1-raft.json`; RP-01–RP-07, ReadIndex, RF1/RF3, model, and three-process restart tests pass |
| M4 ISR / HW / ack gate | NOT_STARTED | Raft exists; ISR observation, HW mapping, captured-A ack gate, and public success semantics do not |
| M5 idempotent producer | NOT_STARTED | Fingerprint and request contracts only |
| M6 consumer groups | NOT_STARTED | Request/schema contracts only |
| M7 integrated failure evidence | NOT_STARTED | No broker or cluster harness exists |

`VERIFIED` means the milestone's declared acceptance commands completed successfully with recorded evidence. Compilable contracts do not imply that a broker can start or that later safety properties are implemented.
