# N01 SQLite implementation evidence — 2026-10-23

This bounded T-005 handoff implements the DB crate. Root owns Tauri integration,
governance, full native CI, independent acceptance and Git operations.

## Implementation

Pinned production dependencies: rusqlite `=0.40.2` with bundled SQLite, uuid
`=1.24.0` v7, sha2 `=0.11.0`, serde_json `=1.0.151`,
unicode-normalization `=0.1.26`, caseless `=0.2.2`. Cargo generated Cargo.lock.

The immutable v1 migration contains the canonical 11 tables, seven indexes,
nine integrity triggers and system pin. Registry validation precedes schema
mutation; an IMMEDIATE startup transaction serializes metadata checks and DDL.
Applied checksums, contiguous versions, unknown/empty-metadata schemas and
failed DDL are tested. The catalog test compares every canonical table/index
SQL definition directly against SPEC §9.2, with an additional invalid-row matrix.

Each connection verifies foreign keys, recursive triggers, WAL (memory only for
the in-memory factory), NORMAL synchronization and a 5000 ms busy timeout.
Recursive triggers prevent INSERT OR REPLACE from bypassing hard-delete and
system-tag protections. WAL conversion installs the busy timeout first and
uses only remaining time within one five-second deadline, with sleeping
backoff and structured retry count/duration/result. The final steady-state
busy timeout is restored to 5000 ms.

Typed IDs, records, enums, checked tokens/timestamps, redacted errors and owned
transaction closures are frozen. NFKC followed by default Unicode case folding
implements tag normalization. Mutations include creation/read, missing/detached
state, observation without revision changes, optimistic edits, tombstones,
idempotent tag bindings, monotonic fixed-clock app-state CAS, and atomic whole-
document commits. Reanchor commits cover every live range exactly once,
preserve annotation kind and orphan anchors, and validate old/new audit snapshots.
Savepoints protect batch atomicity even when a caller handles an inner error.

The single writer has a bounded queue and explicit completion tickets. Readers
use a configured bounded pool. Shutdown closes admission, drains accepted
writes/read calls, joins the actor, and closes pooled read connections. Writer
reentry, completion waits on the writer, and reader self-reentry/shutdown fail
before blocking. Error/panic requests roll back and preserve the actor; a chained
panic hook suppresses callback payloads only while a DB callback is active,
retaining the host hook elsewhere. A subprocess regression verifies no secret
panic body reaches output.

## Executed verification

Commands below ran from the worker component through:

```text
python3 <shared-workspace>/workspace.py run flowshot n01-worker -- bash scripts/linux-docker-check.sh <command argv>
```

The wrapper uses image `flowshot-linux:20261023`, four CPUs and 12 GiB memory.
The preserved evidence directory is:

```text
<shared-workspace>/data/projects/flowshot/tasks/n01-worker/preserve/evidence
```

- `cargo fmt --all --check`: passed; `fmt-acceptance.log`.
- `cargo clippy -p flowshot-db --all-targets -- -D warnings`: passed; `clippy-final6.log`.
- `cargo test -p flowshot-db`: 45 unit/integration checks and one compile-fail doctest passed; `tests-acceptance.log`.
- `cargo test -p flowshot-db --test wal concurrent_startup_applies_once`, repeated 20 times after repairing the startup race: all passed; `startup-stress.log`.
- `cargo bench -p flowshot-db --bench seed`: passed; `benchmark-acceptance.log`, `benchmark.json`.
- `git diff --check`: passed in the worker source tree.

Tests cover migration drift/rollback/catalog, trigger INSERT/UPDATE/DELETE and
replacement bypasses, all seven index query plans, exact tombstones, no-op
versions, stale row/document rollback, whole-batch audit/anchor semantics,
persisted integer extremes/negative decoding, app-state overflow, bounded queue
and readers, close/join behavior, WAL restart/committed read visibility, a real
five-second busy wait, concurrent startup, dependency/SQL boundary negative
fixtures, source edits and lock metadata tampering.

The lock checker pins nine exact production source paths, schema/node/status,
algorithm/generator, command list, current SPEC version/hash and freeze metadata.
It invokes the same validator for the tamper matrix and copied-source mutation.
The unit-test module is deliberately excluded from the production source list.

## Release performance

Final source result: **202,468 µs combined**, including **31,326 µs migration/open**
and **171,141 µs seed**, below the strict 1,000,000 µs budget. Dataset: 10,000
annotations and 10,000 annotation-tag bindings through the typed transaction
and production writer path, with injected deterministic clock/UUIDv7 sources.
Post-seed count, foreign-key integrity and version/tombstone defaults passed.

Hardware/runtime: AMD Ryzen 7 PRO 8700GE with Radeon 780M Graphics, x86_64,
Debian GNU/Linux 12, Docker four logical CPUs/12 GiB, release profile,
SQLite 3.53.2 bundled with rusqlite 0.40.2. Full JSON is preserved above.

## RED and rework retained

`red-contract.log` captures missing runtime/normalization assertions before
implementation; `api-initial-freeze.json` preserves the initial typed API freeze.
`red-persistence-behavior.log` captures missing persistence behavior before
transaction methods were implemented. `red-review-batch.log` captures the
orphan-anchor and incomplete-batch review regressions before their repairs.

Other retained logs include the first RED compile diagnostic, intermediate
lint diagnostics, the benchmark UUID fixture failure, and `tests-final2.log`,
which exposed the real concurrent-WAL-startup race. None substitutes for the
final successful acceptance logs. RED evidence is grouped; no unexecuted
per-task command is claimed.

## Native adapter handoff

`DbRuntime::open(&Path) -> Result<DbRuntime>` supplies production clock/UUIDv7
sources, starts the writer, opens/configures/migrates connections on that thread,
and returns only after readiness. It does not create parent directories. Root
creates the platform app-data directory and calls open synchronously before
creating the first WebView. Runtime is Send + Sync and can be Tauri managed state.

`with_config(&Path, Config, Arc<dyn Clock>, Arc<dyn IdSource>)` supports injected
sources. Defaults are queue capacity 64/read connections 4. `submit` immediately
returns an owned `Completion<T>` or Overload/Closed; `wait`, `transaction`, `read`
and `shutdown` block, so async callers use the native adapter's blocking boundary.
No SQL/connection/row handle crosses the public API.

N08 tag merge and later domain algorithms are deferred as agreed. Anchor shape,
model version and persisted snapshot consistency are checked here; canonical
UTF-8 character boundaries and stable file hashes require the future core/native
inputs specified by SPEC, rather than access to workspace files in this crate.
Root must refresh lock SPEC metadata against its integrated governance snapshot,
rerun full CI/native startup and independently accept the milestone. This worker
made no native integration, governance, commit, push, merge or release changes.

## Final review rework — unchanged resolution and event outcome

Reviewer identified that the annotation enum permits `Unchanged`, while the
immutable canonical event-method CHECK permits only `none`, `exact`, `context`,
`fuzzy`, and `manual`. The repository now validates `Resolution::Unchanged`
against event method `None`, preserving annotation `last_resolution=unchanged`.
Attached outcomes are explicitly restricted to unchanged/shifted/recovered;
attached + orphaned is rejected before any mutation. Public types and migration
DDL/checksum are unchanged.

`cargo test -p flowshot-db --test reanchor_batch` first demonstrated both defects:
valid unchanged input returned Validation, while attached + orphaned incorrectly
committed. That RED is retained in `red-unchanged-outcome-rework.log`. After the
repair, all six focused tests passed in `green-unchanged-outcome-rework.log`.
The positive regression checks source-hash refresh with an unchanged canonical
hash, preserved annotation resolution, canonical event method, and exact old/new
audit snapshots; the negative regression checks atomic preservation of the
entire document/annotations/event collection.

Additional executed commands through the same launcher/Docker task:

- `cargo fmt --all --check`: passed; `fmt-unchanged-outcome-rework.log`.
- `cargo clippy -p flowshot-db --all-targets -- -D warnings`: passed; `clippy-unchanged-outcome-rework.log`.
- `cargo test -p flowshot-db`: 47 unit/integration checks plus one compile-fail doctest passed; `tests-unchanged-outcome-rework.log`.
- `git diff --check`: passed.

Refreshed the declared nine-source lock digest to
`de170ddf60b425b79507287c3f8afe94846e98ced79ff9bf89a96b60d6599809`.
Root must preserve/refresh its integrated SPEC metadata when applying this
worker lock delta. This rework changes exactly `crates/db/src/transaction.rs`,
`crates/db/tests/reanchor_batch.rs`, `contracts/locks/N01.json`, this evidence
document and `.team/reports/T-005.md`. Root's integrated tree was not edited.
