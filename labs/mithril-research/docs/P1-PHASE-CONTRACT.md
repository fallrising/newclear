# P1e offline phase snapshot contract

Root-frozen revision p1e-v1, 2026-10-17. D1–D7 of [independent design T-014](../.team/reports/T-014.md) are the exact normative API, schemas, predicates, limits and hostile acceptance matrix. Root accepts them without semantic changes. Python3.11 standard library only.

## Scope and inputs

Add only scripts/phase_validation.py and tests/test_phase_validation.py. All existing scripts/tests/contracts and both locks remain byte-identical. The pure validate_phase_snapshot(manifest, expected_bundle_digest, ownership, expected_node_ids, collection, barrier_id) API consumes the original independently bound redis-collection document through unchanged collector.validate_collection. Require exactly six complete ordered records before predicates. No collection call, P1c envelope transformation, alternate input lane, executor token, credential or normalized caller view.

The independent bundle digest/node map are retained inputs, never inferred from observations. Existing strict process/ownership/machine/container/raw-response/endpoint checks and byte bounds apply. Every invalid original, partial/unknown entry, malformed barrier or mismatched predicate raises a bounded constant LabError. Pure validation after imports has no I/O; existing trusted helper import-time file reading remains unchanged.

## Exact barriers

| Requested barrier | Predicate |
| --- | --- |
| pristine-isolated-empty-zero-epochs | Unchanged bootstrap._classify must return pristine |
| isolated-empty-assigned-epochs | Six independent singleton empty masters, parent absent, no slots; fixed epochs M1..R3=1..6; INFO fail/known1/size0/zero slots/current=my=assigned epoch |
| six-connected-empty-masters-epoch-six | Six consistent full views, all masters without parents/slots, fixed epochs1..6, all empty; INFO fail/known6/size0/zero slots/current6/my=self epoch |
| exact-slots-with-empty-prospective-replicas | Six consistent full views, all still masters, no parents, fixed epochs1..6; exact manifest M ranges covering16384, R slots empty, all six keyspaces empty; INFO ok/known6/size3/full assigned+ok/zero failures/current6/my=self epoch |
| exact-converged-topology-snapshot | Unchanged bootstrap._classify must return already-converged, including retained nonempty data, arbitrary distinct positive master epochs and common current at least max published epoch |

D2/D3 define each required INFO field and normalized equality exactly. Ignore only presentation/local myself/ping/pong when comparing topology; optional strict-parsed statistics need not match. Empty means all parsed keyspace counters zero, not empty storage or quiescence. An exact barrier test does not search for a later phase or certify earlier phases occurred. Existing P1c intermediate refusal remains unchanged.

## Result and private CLI

D4 defines the exact16-key detached result: original origin/collection/run/plan/bundle bindings, canonical original collection fingerprint, requested barrier and predicate-matched, plus fixed offline/no-execution/no-live/no-freshness/no-authority flags. Original raw presentation affects its fingerprint even if topology is equivalent. The fingerprint is unkeyed identity only. No importer, writer, actions, admission or next-phase field.

D5 defines a validate-only CLI with manifest, independent expected-bundle-digest, ownership, node-ids, collection and exact barrier. Inputs are owned0600 single-link regular files in private owned0700 parents, absolute normalized no-follow paths outside source. Ordinary inputs cap1MiB and collection caps2MiB both as raw file bytes and canonical API data. A new reader must avoid the old1MiB file-stat/read helper limitation and bound reads to limit+1; duplicate keys/nonfinite/invalid UTF-8/deep nesting/trailing garbage refuse. No files/directories are created. No credential/transport/execute/output option.

Success exit0 emits only the ten sanitized D5 fields; refusal/interrupt exit2 emits fixed error and offline flags without untrusted values. Imported ssh origin remains an assertion. Neither a predicate match nor a digest proves live collection, freshness, health, process provenance, permission or phase admission.

## Acceptance and remaining gates

D6 tests require actual Red before implementation, all five positives and5x5 discrimination, original-binding and parser-valid predicate negatives, final parity/retained data, normalization/fingerprint, private-file bounds/privacy and pure I/O fences. Root inspects every diff and actual evidence, reruns full tests on Python3.13/3.11 plus the existing synthetic demo and independent CLI probes; Astra independently reviews and tests. Normal source delivery/CI/remote readback/private ledger review follow acceptance.

D7 live requirements remain unmet: authenticated fresh pre/post observation and per-effect identity checks, separately approved exact effects, runtime/image/config/storage/network/ACL provenance, loading/quiescence, durable mutation intent/uncertainty, replication health/lag, persistence and proxy smoke. Timeout/lost reply is not remote cancellation. Down retains data; purge needs independent exact approval. No startup/upload/create/up, executor/advance/journal, live collection, VPS/network mutation, faults, purge or release/image publication. Full P1 incomplete, MR-004 BLOCKED_ENV, counts4 DONE/1 BLOCKED_ENV/4 TODO.
