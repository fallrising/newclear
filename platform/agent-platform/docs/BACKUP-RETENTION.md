# Offline backup, restore and archive retention (M4 slice)

Contract recorded before implementation, 2026-10-05. Depends on immutable archives and explicit export (PR270/282). This slice delivers operator CLI tools and archive availability in the workbench. It does not operate on a deployed database, delete real user data, restore a VM, or complete all AT-13/M4 requirements.

## Backup and restore

Operator stops API, ordinary/export workers and related control-plane writers, drains every runtime node, and completes/cancels work with confirmed cleanup. An explicit offline acknowledgement is required. Backup refuses nonterminal runs (including interrupted), unfinished jobs, unconfirmed bindings/unreleased reservations, queued/exporting exports or requested reconciliation. No lifecycle states are rewritten to make backup possible. Unknown accounting and uncertain remote outcomes are preserved, not refunded or replayed.

This version supports PostgreSQL18 only, using installed native pg_dump/pg_restore matching that server major. The known catalog fingerprint for shipped migration016 is derived from a fresh database on the pinned test image, not from the source being backed up; extra or drifted types, defaults, constraints, indexes and trigger definitions are rejected. Later migrations/catalog versions require an explicit reviewed fingerprint update. No Python/browser dependencies are added. Create a custom-format full logical database dump with a consistent exported snapshot held under SHARE table locks and the migration advisory lock. Validate exact migration names/checksums, private dedicated schema and bounds before success. Retain DB-resident archive bytes, metadata, tombstones, commands, audit and export history. Ephemeral sessions/login limits/model and tool tokens and the maintenance identity are intentionally excluded; private credential files, connector journal/fences, roles/tablespaces, running VMs, guest state and future external object stores are outside this bundle. Those operational assets need separately managed copies and recovery procedures; this CLI must never reset generations or resume jobs.

A new 0700 directory contains database.dump and manifest.json (0600). Existing destinations are never overwritten. Reject symlinks/hardlinks, unsafe ownership/permissions and malformed or unsupported manifests. Manifest records version, exact migration checksums, PostgreSQL major, dump bytes and SHA-256. Stream hashing (dump maximum8GiB), manifest maximum64KiB, explicit300s native process timeouts and sanitized errors; no connection URL/password in stdout/stderr/argv. A failed attempt is never a valid completed bundle. Hashes detect corruption, not authenticity: native restore executes trusted database definitions. Restore only backups from an operator-trusted source; do not accept arbitrary downloaded dumps.

Restore requires explicit offline acknowledgement and confirmation of the destination database name. It rejects a populated destination, a mismatched PostgreSQL major/schema manifest and corrupted files before restore. Native pg_restore uses one transaction, exit-on-error, no owner/ACL restore, no clean/create/drop database. Never overwrite a source DB. Operator keeps other writers stopped; this is not an online database swap. Finalization checks migrations/quiescence, leaves every node drained, invalidates ephemeral access and establishes a new maintenance UUID. Missing identity makes GC unavailable until successful finalization. Failed restore/finalization is not a usable recovery result. It never starts API/workers/connectors, recreates credentials, or replays exports. A fresh login and separately verified runtime registration/recovery remain operator actions after restoration.

Public Python interfaces: backup.create_backup(url, directory, *, offline), backup.verify_backup(directory), backup.restore_backup(url, directory, *, offline, confirm_database). Return bounded JSON-serializable summaries. Failures use sanitized ValueError codes. CLI: backup-create --directory PATH --offline; backup-verify --directory PATH (no DATABASE_URL required); backup-restore --directory PATH --offline --confirm-database NAME, target from DATABASE_URL. Test-only injected native tool runner may execute real tools inside the owned PostgreSQL container; production uses local installed tools, never a shell.

## Archive payload retention

Retention is manual, disabled unless explicitly invoked. Default/minimum 30 days (maximum 36500), batch 1..100. CLI archive-gc-preview --retention-days 30 --limit 100 prints a bounded plan and saves its immutable issued-plan metadata; it never prunes archive bytes. The plan binds schema version, database maintenance UUID, UTC creation/expiry (one hour), cutoff, retention days, limit and the exact ordered artifact IDs/run IDs/SHA256/size/created_at plus a canonical approval digest. CLI archive-gc-apply --plan PATH --approve DIGEST requires that exact digest and revalidates the complete plan against the database; a changed/ineligible candidate aborts the whole batch without partial changes. New candidates never get silently added to an approved batch. Completed-plan replay is a harmless no-op only when its saved receipt matches; expired/unrecognized plans fail closed. Save preview output in a 0600 plan file inside an operator-owned 0700 directory. Files are bounded and decoded as strict JSON; no arbitrary SQL or paths are taken from a plan.

Eligible archives are old enough, still available, and belong to succeeded/failed/cancelled runs with cleanup confirmed or demonstrably never allocated. The normal fake backend may use its canonical pending:<same-run> handle only with matching fake-local identity, stopped/confirmed binding and released reservation; real-runtime pending handles remain ineligible. Exclude every interrupted/active run, unfinished job, mismatched/unknown/pending binding, unreleased reservation, and every artifact referenced by any export (including succeeded/failed/uncertain). Use SQL transactions, serialization/advisory ownership and appropriate table/row locks so concurrent export approval, job/recovery changes or two applies cannot cross the eligibility check. Preserve all VM/binding/job/reservation records; this command never talks to a VM or provider.

Migration016 adds a persistent singleton maintenance_identity UUID and immutable issued plans/archive-GC receipts. result_archives retains immutable id/run/kind/hash/size/mime/created_at, adds pruned_at and permits only a one-way available payload -> NULL tombstone through the approved retention path. No metadata edit, row deletion, payload rewrite or resurrection. Original trigger tests must continue to pass. Existing runs.result/diff, events, messages, audit and approvals remain unchanged; this releases only the redundant archive payload, not all copies of task contents. It does not promise immediate disk file shrink (normal PostgreSQL vacuum/reuse applies).

Archive listing includes pruned_at (null or timestamp). Download of a tombstone returns 410 artifact_expired; export preview/approval cannot read it. The workbench shows retention expiry, preserves hash/size metadata and omits download/new export controls for a pruned artifact. Existing summary/diff and historical export operations remain available (export-referenced archives cannot be collected). persist_archive must not resurrect a tombstone.

Public Python interfaces: archive_retention.preview(db, *, retention_days=30, limit=100) and archive_retention.apply(db, plan, *, approval_digest), returning JSON-serializable plan or receipt. GC uses no backup subprocess or credentials. CLI errors are bounded, no tracebacks/secret inputs. Connection syntax is checked before pool startup, and raw background connection diagnostics are suppressed during the standalone command; the normal logging filters are restored when it exits. No new web mutation endpoint or scheduled job.

## Operator procedure

No deployed data operations were performed during development. Before use, stop the API, ordinary/export workers and connector-side writers; complete/cancel and verify cleanup using the existing supported lifecycle. Drain all runtime_capacity entries through the operator's existing database administration channel. Do not rewrite run/job/binding/reservation facts to satisfy a preflight. Keep the source application's exact migration version and PostgreSQL major with the backup; restore using matching application code before any later migration.

Install PostgreSQL18 native client utilities on the operator host, with pg_dump and pg_restore on PATH. Supply DATABASE_URL through the existing private environment configuration; do not put connection secrets into command arguments or a shared transcript. Choose an existing operator-owned private parent directory. Example commands (paths are placeholders):

```sh
agent-platform backup-create --directory /private/backups/snapshot-001 --offline
agent-platform backup-verify --directory /private/backups/snapshot-001
```

The destination directory must not exist. A successful create/verify reports the dump size and SHA-256. Store the bundle privately: it contains task contents and the operator password hash even though ephemeral access tokens are excluded. There is no built-in encryption, offsite upload, backup scheduling or automatic deletion. Preserve failed dump files for diagnosis; absence of a valid manifest means no completed backup.

Provision a separate empty target database with the normal database administration tools. Point DATABASE_URL at that target, keep all services stopped, then explicitly name that same database:

```sh
agent-platform backup-restore --directory /private/backups/snapshot-001 --offline --confirm-database restored_agent_platform
```

A populated/wrong target is refused. Do not activate a failed or partially finalized restore. On success, validate expected task/archive/history through the isolated API, log in again and separately verify required runtime credentials, catalog and connector recovery before restarting workers or changing drain settings. The CLI does not perform those actions. A backup is not a rollback of GitHub or any other external effect.

For manual retention, save the plan privately, inspect its exact candidates, byte count and cutoff, then copy its approval_digest into the apply command. Preview records only issued-plan metadata. The plan expires after one hour and is valid only for that database identity; regenerating a preview is a new review step.

```sh
umask 077
agent-platform archive-gc-preview --retention-days 30 --limit 100 > /private/maintenance/plan.json
agent-platform archive-gc-apply --plan /private/maintenance/plan.json --approve 'COPY_REVIEWED_APPROVAL_DIGEST'
```

/private/maintenance must be owned by the operator and mode0700; plan.json must be0600. Apply prints a durable receipt for the exact approved batch. It does not require or claim a verified offsite backup, and no backup is deleted. Download a needed archive or create and test a backup before approving its expiry. Retained summaries/diffs remain separate copies; archive GC is not a content-erasure guarantee.

## Acceptance and limits

Meaningful Red/Green native PostgreSQL tests cover real pg_dump/pg_restore into a second empty DB, exact archived bytes/hash/download, tombstones and retained export/audit/idempotency data; corrupted/mismatched/unsafe bundles; active/unknown source and nonempty/wrong target rejection; subprocess/transaction failures and safe partial state. Retention tests cover strict plans/expiry/wrong DB/hash, minimum retention, protected recovery/ownership/export cases, concurrency, no resurrection and atomic failure. Root runs platform-check, web-check and complete real Chromium suite including expired archive UX; independent review and hosted CI precede Draft PR delivery.

Full event/audit retention, stale runtime cleanup, external artifacts, encrypted/offsite schedules, live deployment/restore, connector/VM recovery and complete AT-13/M4 acceptance remain separate work. Billing is deferred and costs remain unknown.

## Protocol sources

PostgreSQL 18 official docs checked 2026-10-05: [pg_dump](https://www.postgresql.org/docs/18/app-pgdump.html), [pg_restore](https://www.postgresql.org/docs/18/app-pgrestore.html), [table locks](https://www.postgresql.org/docs/18/explicit-locking.html). Native logical backup is a database snapshot, not running-VM recovery; pg_restore executes trusted database definitions.
