# Immutable result archive (M4 slice)

A new run that produces a result stores one bounded, immutable JSON archive in PostgreSQL before it can finish successfully. Archive bytes and metadata commit in the same transaction as the persisted run result and its terminal transition. This first slice archives the existing diff and verification report, not arbitrary workspace files. It adds no filesystem object store or external dependency.

## Contract

- One archive per run; immutable UUID, run/task identity, attempt, base SHA, profile revision, goal and an allowlisted result snapshot. No credentials, raw configuration, sessions, runtime handles or host paths are copied from runtime context. Result text remains untrusted data.
- JSON schema version (`schema_version`) `result-archive-v1`, UTF-8, stable serialization, bounded to 1 MiB; diff remains bounded to 256 KiB and validated against bytes/hash/base. Generated local mock results receive the same metadata before storage. A fake result without a diff explicitly records verification `not_run`; no successful project-test claim is invented.
- Store payload bytes, SHA-256, size, MIME and created time in a new table. Repeated persistence of identical bytes is idempotent; replacing bytes for an existing run is rejected. Run-state updates do not change archive bytes. No automatic migration/backfill of legacy results.
- `GET /api/v1/runs/{run_id}/artifacts` returns `{items:[{id,run_id,kind,sha256,size,mime,created_at}]}`. Missing run is 404; legacy/pending/no-result run has an empty list. `GET /api/v1/runs/{run_id}/artifacts/{artifact_id}` verifies session, run association, size/hash and embedded identity before returning a fixed JSON attachment `run-{run_id}-result.json`, sandbox CSP, nosniff, no-store. Reads never regenerate from mutable `runs.result`.
- UI offers the selected run's archive and displays loading/empty/error states truthfully. Historical attempts retain their own archive; no write or new runtime is triggered by a download.

## Failure and recovery

Failure to validate or persist the archive prevents a successful terminal transition. The real runtime enters existing quarantine/recovery with `artifact_persist_failed` and retains its VM/reservation until supported recovery or cancellation proves cleanup; it must not destroy the sole unarchived result. A failed DB transaction rolls back all partial archive/result writes. Recovery also recognizes a resultless interrupted finalization when the outage prevented writing the quarantine reason. If interruption occurred before result retrieval, an attested matching binding/conversation may collect the finished result through the existing connector operation; tool-enabled runs require the already-persisted drain proof first. It does not allocate or prompt again, and prioritizes persistence over an expired execution deadline or model cutoff. An explicit operator cancellation remains authoritative; the original VM TTL still bounds how long a result may be recoverable. No external filesystem write exists in this slice. The SDD's independent object-store upload retry window is deferred with that future adapter; it is not claimed by this PostgreSQL-backed slice.

Archive integrity failures return 409 without serving payload bytes. Download readiness is separate from verification: failed/unknown/not_run verification is preserved and inspectable. The archive contains source/run identity and verification evidence, not a claim that repository tests passed.

## Validation and remaining scope

Required checks cover PostgreSQL atomicity, immutable/idempotent writes, missing/expired sessions and cross-run object IDs, corruption and bounds, real Worker integration through existing deterministic connector boundaries, cleanup/retry stability, plus Chromium download from the selected historical run. No fresh KVM/live provider is needed for this database/download slice. Full M3 safety integration, arbitrary artifacts, independent object-store retry, GitHub export, backup/restore/GC, production deployment and the overall M4 MVP gate remain unfinished.
