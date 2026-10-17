# P1d read-only collector contract

Root-frozen revision p1d-v1, 2026-10-17. D1–D7 in [independent design T-011](../.team/reports/T-011.md) are the exact binding schemas, APIs, limits and required tests. Python3.11 standard library only. This slice develops a six-node collector and verifies it with offline/mock transports; actual SSH/Redis/Docker collection is UNEXECUTED.

## Scope decision

Implement only scripts/collector.py, scripts/collector_helper.py and tests/test_collector.py. P1c bootstrap.py and its tests, P1b SSH helper/controller, bundle and both locks remain byte-identical. The collector accepts fully framed, parser-valid intermediate observations only as collection data. It never classifies topology or produces/adopts a bootstrap proposal. P1c continues to admit only pristine or exact already-converged snapshots, with independently retained node IDs and intermediate refusal.

Separate phase-aware snapshot validation was evaluated and deliberately deferred: D6 specifies the proposed independent predicates, not implemented capabilities. No phase admission/advance/executor, provisioning/upload/create/up, new mutation journal or purge is part of this slice. Full P1 remains incomplete; MR-004 remains BLOCKED_ENV with4 DONE/1 BLOCKED_ENV/4 TODO.

## Binding and acquisition

D1/D2 define strict collect/validate_collection/write_collection/Transport APIs and exact request, helper response and collection schemas. Reuse validated bundle/ownership; require all six exact Redis targets and independent node IDs. Only backend_operator credential leaves local memory, in SSH stdin JSON then RESP AUTH bytes; no credential in argv/environment, request logs/hashes, result or public output. Do not save raw secret-bearing transport requests.

D3/D4 define fixed trusted helper source, reduced existing SSH policy, exact host-local Docker inspect and direct AF_INET/TCP. No Docker exec, shell/request interpolation, redirects, lookup, arbitrary operation or mutation. Check machine identity plus running full container ID/ownership and StartedAt/Pid before and after one authenticated connection. Full response framing is AUTH +OK followed by three non-null bounded RESP2 bulk payloads, then write-half-close and EOF without trailing data. One monotonic20-second helper deadline covers every step; no per-byte timeout reset. Half-close compatibility is a future real-runtime gate.

Raw payload bounds remain64/16/4KiB; new request64KiB, helper/SSH JSON streams512KiB, serialized collection2MiB, Docker streams64KiB. Enforce byte caps while reading. Do not modify the older modules' limits. Parse original raw fields and bind every observed node ID/endpoint plus the direct myself ID against independent inputs; no topology classifier.

## Completion and evidence

A complete node requires all frames, EOF, pre/post identities and raw parsers to validate. Any transport, protocol, parser or binding failure yields unknown with record=null. Attempt each exact role once, preserve six ordered entries, continue other read-only attempts and derive complete only when all six succeed; otherwise partial. Invalid shared input refuses before transport. Interruption refuses; no retry or cancellation claim. Existing mutation uncertainty state is neither read as authority nor cleared.

The collection lane is redis-collection with origin ssh or mock-ssh, phase_execution_supported=false, live_ready=false, live_runtime=UNEXECUTED. Injected dependencies force mock origin. No timestamp, collection ID, complete flag, SSH success or unkeyed declaration proves freshness, atomicity, health, storage/loading/quiescence, process-to-endpoint provenance or authority. No automatic P1c snapshot conversion/export exists.

## Private interface and acceptance

D5 fixes private no-follow0600 input files/0700 parents, private exclusive output collection.json, sanitized CLI and partial persistence. Actual CLI form is documented there; execute-approved records intent only and requires separate exact session authority. This delivery uses only mocked successful CLI wrappers and actual refusal/help subprocesses. No CLI mock/command bypass is exposed.

D7 is mandatory Red-Green/adversarial coverage. Root independently reruns the full unchanged baseline plus new tests, Python3.11 Make check/demo, mocked CLI acceptance and full diff/privacy/contract gates; Astra independently reviews source and probes. Required CI, normal merge, remote readback and private ledger review follow source acceptance. No live-runtime result is inferred from this contract.
