STATUS: DONE

## Summary

Read-only contract audit for T-0339/M1c at supplied source `9e536de1dc1a532c8e3d78355e770bc757e190da`. Paths below are relative to `products/hai-taskboard/`. Recommendations require root's reviewed specification; no implementation acceptance is claimed.

**Existing authority.** HTTP authenticates, checks Origin/project before decoding (`backend/internal/transport/httpapi/server.go:126`). Service authorizes the configured operator and atomically writes result/idempotency/audit/projection (`backend/internal/application/service/service.go:325`). External-I/O commands first replay authorized committed results, including after object loss (`backend/internal/application/service/vertical.go:344`). Review checks exact subject/version/fence and reviewer independence but stores no report (`vertical.go:489`; full path as above). Evidence checks those bindings, AC revision, recipe/environment, verifier, verified bytes and unchanged snapshots; currently only Passing/Accepted/Fresh/Present is accepted (`vertical.go:532`). Its caller-supplied locator is verified, but no immutable human-report provenance exists.

**Storage gap.** `backend/internal/domain/sqlite/migrations/0001_v1.sql:116` stores global artifact metadata without actor/project/subject; line131 Review lacks a report; line142 Evidence links only an artifact digest. Existing immutable triggers begin at line331. Therefore migration is necessary for durable report identity and association; append `0005_human_reports.sql`, preserving 0001..0004 and their compiled checksums (`backend/internal/domain/sqlite/migration.go:35`).

**Recommended shape: option B (root selected).** Add `SubmitHumanReport` with kind `review|evidence`, bounded report ID reused as the semantic record ID, Run/subject/version/fences, exact UTF-8 text, and explicit review verdict or evidence AC/revision/verdict. Server derives actor, timestamp, digest, length, storage key and policy fields. Check all guards, including independence/verdict/policy, before Put; recheck the full snapshot afterward. Atomically persist distinct Report and Review/Evidence plus command bookkeeping, without phase/version change. Preserve fixture canonical bytes (`backend/internal/application/command/vertical.go:120`); avoid nested top-level commands/transactions.

Option A (seal, then existing Review/Evidence plus optional report ID) adds partial state and permits bypass when the link is optional; making it mandatory changes fixture contracts. B is narrower for the complete human submission path.

Persist project/report ID, WorkItem/Run/candidate, exact subject, actor, command ID, kind, artifact digest, server timestamp and Review/Evidence identity, with foreign keys and unconditional append-only triggers. The digest alone is not the report ID: identical bytes in different subjects retain distinct provenance. Idempotency binds canonical bytes plus kind/subject/semantic fields; unchanged retry returns original bytes without Put/Open; changed body conflicts. No Run dispatch, QA, Approval or Done is implicit.

**Read/bounds (root selected).** Project/report-ID metadata GET and `/content` return immutable association and attachment-only verified text after two snapshots; M1b routes stay unchanged. Reuse bounded outside-transaction verification (`backend/internal/application/service/output_access.go:91`). Root selected 1..65536 UTF-8 bytes and plain/Markdown text. Preserve raw bytes. **MIME decision remains:** global digest metadata cannot hold two media types for identical bytes. Canonicalize stored type with separate report presentation metadata, or explicitly reject conflicts; never overwrite. HTTP envelope cap is 1MiB (`server.go:25`).

`backend/cmd/taskboard/local_dependencies.go:86` already stages, syncs, content-addresses, deduplicates and verifies objects; line202 rejects unsafe/symlink/digest-mismatched files. It publishes with hard-link, while ADR-005 line53 says atomic rename: document the existing discrepancy rather than silently changing adapter mechanics. On post-Put rollback, retain unbound objects without authority; no automatic deletion while another request could bind them. Explicitly retain bound reports and crash/orphan objects in M1c; future safe GC/backup policy belongs to M6. This retention decision must be accepted, not omitted.

## Verification

- Read-only `rg -n`, `nl -ba ... | sed -n ...`, and named source/spec inspection established the seams above — passed
- `python3 $TEAMCTL_ROOT/scripts/teamctl.py validate-report .team/hai-m1c-20261031/T-002-report.md` exited0 — passed
- `git diff --name-only` produced no tracked changes during audit — passed

No tests/builds/providers or Git mutations were authorized or executed. Inspection is not runtime evidence. Initial skill-relative contract lookup and PATH lookup missed relocated resources; root supplied the authoritative contract and validator under `$TEAMCTL_ROOT/`, which were then used.

## Documentation

Only this report changed. Root should specify M1c/AC/oracles before code and update SUCCESS, BOARD, traceability and OpenAPI. Likely code scope: new `human_report.go` plus tests in application command/port/service, SQLite and HTTP; `command/types.go`, `command/result.go` if new result fields are needed, `service/vertical.go` only shared validation extraction, SQLite `migration.go` and new migration/tests, HTTP `server.go`, and runtime integration test. Existing local store needs tests, not necessarily implementation changes. All paths sit below `backend/`; `api/openapi.yaml` is the wire contract.

## Risks and Follow-ups

- General AC policy is **not a blocker** for this bounded local slice: `backend/cmd/taskboard/runtime.go:315` supplies local-policy-v2, human independence and the `local` rule. Reject unconfigured ACs; do not claim M2/general policy support.
- Root selected unchanged Done semantics: candidate and eligible Evidence bytes remain verified (`backend/internal/application/service/integrity.go:96`); new Review reports add auditable provenance/download, not an extra Done predicate. Evidence report loss still blocks Done.
- Meaningful future cases: wrong actor/project/Origin opens/writes nothing; producer self-review; stale subject/version/fences or unknown AC; exact replay after restart/object loss; changed-body replay conflict; same bytes/different subjects; Put/digest/DB/audit failure rolls back authoritative rows; concurrent same-key submissions create one semantic record; stale snapshot after Put leaves only orphan bytes; report-ID substitution; tamper/missing/close-error reads return no bytes; old fixtures retain canonical results; real V4→V5 migration preserves history and rollback/reopen.
- Tool/provider accounting: tool reads are observable in this worker transcript; aggregate provider requests/cost unknown. No delegation, model override, or external provider invocation occurred.
